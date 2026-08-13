//! Single-instance guard. Dependency-free (direct `extern "system"` to
//! kernel32), matching the style of `winperf.rs`.
//!
//! ## Why the exact name `RemoteGamepadServerSingleton` is load-bearing
//!
//! This is NOT just a "don't run twice" nicety — the string is a contract with
//! two other components, and changing it breaks both silently:
//!
//! 1. **The Inno installer.** `installer/GamepadServer.iss:44` declares
//!    `AppMutex=RemoteGamepadServerSingleton` together with
//!    `CloseApplications=force`. That is how an upgrade closes the *running*
//!    server before overwriting its files. A server that does not create this
//!    mutex is invisible to the installer, which then hits a file-in-use error
//!    mid-upgrade — the worst possible moment, since the old exe may already be
//!    partially replaced.
//!
//! 2. **The Python server** (`apps/pc-server/server.py:611`) creates the very
//!    same mutex. Sharing it is deliberate: during the migration a user may have
//!    both builds on disk, and exactly one of them must win. Cross-guarding also
//!    prevents the two servers from fighting over udp/7777 and producing two
//!    virtual pads — the double-pad bug fixed on 2026-07-21.
//!
//! ## Semantics deliberately copied from Python
//!
//! * **Session-local namespace** (no `Global\` prefix) — one server *per user
//!   session*, which is what `AppMutex` checks and what fast-user-switching
//!   wants.
//! * **Not owned** (`bInitialOwner = FALSE`) — we only care about existence.
//! * **Never closed.** Windows releases the mutex when the owning process exits,
//!   so a crashed or force-killed instance never permanently blocks the next
//!   launch. Releasing it *early* would be a bug: a second instance could start
//!   while this one still owns the UDP port.
//! * **A failed guard never blocks startup.** If `CreateMutexW` itself fails we
//!   run anyway — refusing to start a working server because a guard could not
//!   be created would trade a minor annoyance for a total outage.

/// Outcome of trying to claim the single-instance guard.
#[derive(Debug, PartialEq, Eq)]
pub enum Claim {
    /// We own the guard (or the platform/API has none). Safe to start.
    Acquired,
    /// Another instance — Python or Rust — is already running. Do not start.
    AlreadyRunning,
}

#[cfg(windows)]
mod imp {
    use super::Claim;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateMutexW(lpAttributes: *const u8, bInitialOwner: i32, lpName: *const u16) -> isize;
        fn GetLastError() -> u32;
    }

    const ERROR_ALREADY_EXISTS: u32 = 183;

    /// Must match `AppMutex` in `installer/GamepadServer.iss` and the name used
    /// by `apps/pc-server/server.py`. See the module docs before touching it.
    const MUTEX_NAME: &str = "RemoteGamepadServerSingleton";

    pub fn claim() -> Claim {
        claim_named(MUTEX_NAME)
    }

    /// The mechanism, parameterised by name.
    ///
    /// Exists so tests can exercise it against a throwaway name. A test that
    /// claimed the REAL mutex would pass or fail depending on whether the
    /// server happened to be running on the developer's machine — which it did,
    /// once, before this split.
    pub fn claim_named(name: &str) -> Claim {
        // Null-terminated UTF-16, as CreateMutexW expects.
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();

        // SAFETY: `wide` is a valid null-terminated UTF-16 buffer that outlives
        // the call, and a null `lpAttributes` is the documented default-security
        // case. The returned handle is intentionally never closed — see the
        // module docs ("Never closed").
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, wide.as_ptr()) };

        // The ordering here matters and mirrors Python: CreateMutexW SUCCEEDS
        // and returns a valid handle even when the mutex already exists, so the
        // handle alone tells us nothing. Only GetLastError distinguishes
        // "created it" from "opened someone else's".
        if handle == 0 {
            // The guard could not be created at all. Deliberately permissive:
            // start anyway rather than refuse to run. If a second instance does
            // slip through, the udp/7777 bind fails with a clear message.
            eprintln!(
                "warn: single-instance guard unavailable (CreateMutexW failed, err={}); \
                 starting anyway",
                unsafe { GetLastError() }
            );
            return Claim::Acquired;
        }

        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            Claim::AlreadyRunning
        } else {
            Claim::Acquired
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Claim;

    /// No guard off Windows. The server is Windows-only in practice (ViGEm), and
    /// the installer contract this exists for is Windows-only too.
    pub fn claim() -> Claim {
        Claim::Acquired
    }

    pub fn claim_named(_name: &str) -> Claim {
        Claim::Acquired
    }
}

pub use imp::{claim, claim_named};

#[cfg(test)]
mod tests {
    use super::*;

    /// First claim succeeds, second sees the existing mutex.
    ///
    /// Uses a THROWAWAY name, never the production one. Claiming the real mutex
    /// here made this test depend on whether the server happened to be running
    /// on the machine — it passed on an idle box and failed the moment a real
    /// server was up. A unit test must not consult global machine state.
    ///
    /// Both halves must also stay in ONE test: cargo runs tests as threads in a
    /// single process, so splitting them would make them race for the same
    /// mutex, and whichever ran second would fail at random.
    ///
    /// The case that actually matters — a *separate process* being turned away —
    /// cannot be covered here. That check is live-only; see
    /// `docs/REGRESSION_CHECKLIST.md` (A14).
    #[test]
    fn claim_is_exclusive_within_the_process() {
        let name = "GamepadOSTestMutex-claim-exclusivity";
        assert_eq!(claim_named(name), Claim::Acquired, "first claim should acquire");

        // Off Windows `claim_named` is a no-op stub that always returns Acquired,
        // so the exclusivity half only applies to the real implementation.
        if cfg!(windows) {
            assert_eq!(claim_named(name), Claim::AlreadyRunning, "second should see it");
        }
    }
}
