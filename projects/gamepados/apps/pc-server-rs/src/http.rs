//! Update manifest, installer download, and feedback submission.
//!
//! Ported from `apps/pc-server/server.py` (`check_for_update` 164-205,
//! `download_update` 207-250, the feedback worker 1783-1810). The behaviour is
//! deliberately identical — this talks to the SAME live backend as the shipping
//! Python server, so the endpoints, the JSON shape and the version-comparison
//! rule are a contract with something already in production, not a fresh design.
//!
//! ## Why a TLS dependency here, in an otherwise hand-rolled server
//!
//! Every protocol layer in this crate is hand-rolled to stay lean — WebSocket
//! included. TLS is the same exception `Cargo.toml` already makes for crypto:
//! rolling it would be the single worst decision available. `ureq` is blocking,
//! so it needs no async runtime and does not infect the hot path.
//!
//! **Cert roots use the platform verifier, not bundled webpki-roots** — a
//! deliberate, slightly-more-expensive choice. Bundled Mozilla roots are baked
//! into the binary and age with it; if one rotated out, update checks would
//! break **with no recovery path, because the updater is the one component that
//! cannot use the updater to fix itself.** The Windows cert store is maintained
//! by Windows Update, independently of us.
//!
//! ## Nothing here may run on the input path
//!
//! Every function blocks on network I/O. Call them from a worker thread only.
//! The Python GUI does exactly this (`threading.Thread(target=worker)`).

use std::io::Read;
use std::time::Duration;

/// Version of THIS build.
///
/// ⚠️ Three things must agree or the in-app updater loops forever
/// (install → relaunch → "update available" again), which is the exact trap
/// `server.py:130-133` warns about:
///   1. this constant,
///   2. `AppVersion` in `installer/GamepadServer.iss`,
///   3. the `pc.version` the backend serves from the Releases panel.
///
/// **2.0.0** was a major bump, and deliberately so: the entire server was
/// rewritten in Rust, the transport stack (UDP, WebSocket, GRX encrypted input,
/// pairing, adb-reverse) is new code, AOA was dropped, and the UI was rebuilt.
/// A user seeing "1.1.17 -> 2.0.x" is being told the truth about how much
/// changed. It must compare GREATER than 1.1.17 or existing users are never
/// offered the migration at all.
///
/// **2.0.1** — the off-LAN test now uses the interface's REAL prefix length
/// instead of assuming /24 (`net::is_offlan`). On any LAN wider than a /24 the
/// old logic called same-wire peers "off-LAN", and off-LAN is the branch that
/// accepts auth token 0 — so keyless pairing was reachable from LAN peers it was
/// never meant to be. Patch-level because nothing about the wire protocol,
/// pairing format or UI changed.
///
/// **2.1.0** — playtime capability tickets (`src/ticket.rs`). The server now
/// understands a signed permission slip forwarded by the phone over the control
/// channel and ends the session when fresh ones stop arriving, which is what
/// makes the daily playtime limit enforceable against a modified APK. MINOR,
/// not patch: it adds a new client→server message and raises `ws::MAX_FRAME`
/// from 64 to 96 to carry it.
///
/// ⚠️ **Tickets ride UDP, not the WebSocket.** The first cut of 2.1.0 verified
/// them in `ws.rs`. That bridge binds 127.0.0.1 and is only reachable through
/// `adb reverse` — USB debugging — while the Android engine opens exactly one
/// socket, `SOCK_DGRAM`. So Wi-Fi and tether users, the whole population this
/// exists to police, never touched it. Caught in review before release; the
/// demux now sits on the UDP path beside the GRX handshake check and costs a
/// single integer compare (measured at zero over a bare loop). `ws.rs` keeps
/// its own gate so USB-debugging sessions are covered too.
///
/// ⚠️ **This release is deliberately INERT.** A connection that never presents
/// a ticket is never cut off, so 2.1.0 behaves exactly like 2.0.1 for every
/// phone built before the billing release. That is what allows it to be shipped
/// FIRST and spread through the normal updater for weeks before the app starts
/// requiring it. Ship them together and every user hits a wall on day one.
/// Enforcement also stays off entirely unless `SESSION_TICKET_PUBLIC_KEY` was
/// set at build time.
///
/// ⚠️ `app_version!` is a macro, not just a const, because `USER_AGENT` needs a
/// literal for `concat!` — which is how the two used to be separate copies of
/// the same number. One definition now feeds both; they cannot drift.
macro_rules! app_version {
    () => {
        "2.1.0"
    };
}

pub const APP_VERSION: &str = app_version!();

const USER_AGENT: &str = concat!("GamepadServer/", app_version!());

/// Public manifest: `{"pc": {"version","url","notes","sha256"}, ...}`.
/// Env-overridable so a backend move never needs a code change + reship.
/// NOTE: the historical default `admin.gamepad.space` NEVER served this
/// endpoint — do not "restore" it.
fn update_manifest_url() -> String {
    std::env::var("GAMEPAD_UPDATE_URL")
        .unwrap_or_else(|_| "https://supportportal.gamepad.space/api/version".into())
}

fn feedback_url() -> String {
    std::env::var("GAMEPAD_FEEDBACK_URL")
        .unwrap_or_else(|_| "https://supportportal.gamepad.space/api/support/ticket".into())
}

/// Why an update check failed, so the UI can say something specific instead of
/// a generic "couldn't check". Mirrors Python's `kind` field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// No route to the backend.
    Offline,
    /// Reached it; it returned a non-2xx.
    Server,
    /// Reached it; it never answered in time.
    Timeout,
    /// Answered with something that isn't the manifest we expect.
    Parse,
}

/// Where a user goes when the in-app updater can't do its job. Any failure path
/// must surface this: the updater is the one component that cannot use the
/// updater to fix itself, so a dead check would otherwise strand the user on an
/// old build with no route forward.
pub const DOWNLOAD_PAGE_URL: &str = "https://gamepad.space/#download";

impl ErrorKind {
    /// User-facing text. Deliberately blames the network, not the user.
    ///
    /// `Server`/`Timeout`/`Parse` all PROVE the machine reached the internet —
    /// we got bytes (or a refusal) back from our own backend — so telling that
    /// user to "check your connection" is actively misleading. `Offline` can't
    /// tell "no internet" from "our host is unreachable", so it hedges instead
    /// of asserting the user is offline.
    pub fn message(self) -> &'static str {
        match self {
            ErrorKind::Offline => "Couldn't reach the update server",
            ErrorKind::Server => "The update server returned an error",
            ErrorKind::Timeout => "The update server timed out",
            ErrorKind::Parse => "The update server sent an unreadable reply",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct UpdateInfo {
    pub available: bool,
    pub latest: String,
    pub url: String,
    pub notes: String,
    pub sha256: String,
    /// `None` on success.
    pub error: Option<(ErrorKind, String)>,
}

/// `"1.2.10"` -> `[1, 2, 10]`; non-numeric parts become 0.
///
/// This exists so versions compare NUMERICALLY. As strings, `"1.2.10" < "1.2.9"`
/// — which would strand every user on .9 forever. `Vec` ordering is
/// lexicographic, so it also handles differing lengths the way Python tuples do
/// (`[1,2] < [1,2,0]`).
fn parse_version(v: &str) -> Vec<u32> {
    let parts: Vec<u32> = v
        .trim()
        .split('.')
        .map(|p| p.trim().parse::<u32>().unwrap_or(0))
        .collect();
    if parts.is_empty() { vec![0] } else { parts }
}

/// Append an update-check failure to a log next to the exe, so a user reporting
/// "it says it can't check" can actually be diagnosed. Best-effort; never fails.
fn log_update_error(msg: &str) {
    let dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("update_check.log"))
        .map(|mut f| {
            use std::io::Write;
            let _ = writeln!(f, "{msg}");
        });
}

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        .user_agent(USER_AGENT)
        .build()
        .into()
}

/// Fetch the manifest and compare against [`APP_VERSION`]. NEVER panics.
///
/// Retries once by default: the backend cold-starts on its hosting tier, so the
/// first request after an idle period can legitimately be slow. That is a real
/// observed behaviour, not defensive padding — without the retry the launch
/// check reports "offline" to users who are perfectly online.
pub fn check_for_update(timeout: Duration, retries: u32) -> UpdateInfo {
    let url = update_manifest_url();
    let mut last: Option<(ErrorKind, String)> = None;

    for attempt in 0..=retries {
        match agent(timeout).get(&url).call() {
            Ok(mut resp) => match resp.body_mut().read_json::<serde_json::Value>() {
                Ok(data) => {
                    let pc = &data["pc"];
                    let latest = pc["version"].as_str().unwrap_or("").trim().to_string();
                    // A manifest with no version is not a usable answer. Treat
                    // it as a parse failure rather than silently reporting
                    // "up to date" — otherwise a broken backend looks identical
                    // to no update, and nobody ever finds out.
                    if latest.is_empty() {
                        last = Some((ErrorKind::Parse, "manifest has no pc.version".into()));
                    } else {
                        return UpdateInfo {
                            available: parse_version(&latest) > parse_version(APP_VERSION),
                            latest,
                            url: pc["url"].as_str().unwrap_or("").to_string(),
                            notes: pc["notes"].as_str().unwrap_or("").to_string(),
                            sha256: pc["sha256"].as_str().unwrap_or("").to_string(),
                            error: None,
                        };
                    }
                }
                Err(e) => last = Some((ErrorKind::Parse, format!("bad manifest: {e}"))),
            },
            Err(ureq::Error::StatusCode(code)) => {
                last = Some((ErrorKind::Server, format!("HTTP {code} from update server")))
            }
            Err(ureq::Error::Timeout(_)) => {
                last = Some((ErrorKind::Timeout, "update server timed out".into()))
            }
            Err(e) => last = Some((ErrorKind::Offline, format!("no connection ({e})"))),
        }

        // Brief backoff before the cold-start retry.
        if attempt < retries {
            std::thread::sleep(Duration::from_millis(1500));
        }
    }

    let (kind, msg) = last.unwrap_or((ErrorKind::Offline, "unknown error".into()));
    log_update_error(&format!("[{kind:?}] {url} -> {msg}"));
    UpdateInfo { error: Some((kind, msg)), ..Default::default() }
}

/// Stream the installer to `dest`, reporting progress as `(done, total)`.
///
/// Verifies the manifest's SHA-256 **and** an `MZ` header before the file is
/// ever handed to the OS. Both matter: this download is subsequently executed
/// **elevated**, so running a corrupt, truncated, or HTML-error-page "installer"
/// is not a cosmetic bug. A checksum mismatch deletes the file rather than
/// leaving a poisoned artifact on disk for a later retry to find.
pub fn download_update(
    url: &str,
    dest: &std::path::Path,
    expected_sha256: &str,
    timeout: Duration,
    mut progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    use sha2::{Digest, Sha256};

    let mut resp = agent(timeout)
        .get(url)
        .call()
        .map_err(|e| format!("download failed ({e})"))?;

    let total: u64 = resp
        .headers()
        .get("Content-Length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let mut reader = resp.body_mut().as_reader();
    let mut file = std::fs::File::create(dest).map_err(|e| format!("cannot write file ({e})"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 65536];
    let mut done: u64 = 0;
    let mut first2 = [0u8; 2];

    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("download failed ({e})"))?;
        if n == 0 {
            break;
        }
        if done == 0 && n >= 2 {
            first2.copy_from_slice(&buf[..2]);
        }
        use std::io::Write;
        file.write_all(&buf[..n]).map_err(|e| format!("cannot write file ({e})"))?;
        hasher.update(&buf[..n]);
        done += n as u64;
        progress(done, total);
    }
    drop(file);

    // Every failure below removes the file. Leaving a bad installer on disk
    // invites a later code path — or a curious user — to run it.
    let reject = |msg: &str| -> Result<(), String> {
        let _ = std::fs::remove_file(dest);
        Err(msg.to_string())
    };

    if done == 0 {
        return reject("downloaded 0 bytes");
    }
    if &first2 != b"MZ" {
        return reject("not a valid Windows installer");
    }
    if !expected_sha256.is_empty() {
        let got = hasher.finalize();
        let got_hex: String = got.iter().map(|b| format!("{b:02x}")).collect();
        if got_hex != expected_sha256.trim().to_lowercase() {
            return reject("checksum mismatch — download corrupt");
        }
    }
    Ok(())
}

/// Minimal equivalent of Python's `[^@\s]+@[^@\s]+\.[^@\s]+`, hand-rolled to
/// avoid a regex dependency for one check. Intentionally permissive — this is a
/// typo guard, not RFC 5322 validation, and the backend validates for real.
pub fn looks_like_email(s: &str) -> bool {
    let s = s.trim();
    let Some((local, domain)) = s.split_once('@') else {
        return false;
    };
    let ok = |p: &str| !p.is_empty() && !p.contains(|c: char| c.is_whitespace() || c == '@');
    ok(local) && ok(domain) && domain.split_once('.').is_some_and(|(a, b)| ok(a) && ok(b))
}

/// Minimum message length, matching the Python dialog.
pub const MIN_FEEDBACK_LEN: usize = 10;

/// POST feedback into the team's admin portal, tagged `source: "pc"` so it lands
/// in the PC bucket rather than mixing with app feedback.
///
/// The field names are fixed by the live backend — see `server.py:1786-1789`.
pub fn submit_feedback(email: &str, message: &str, timeout: Duration) -> Result<(), String> {
    let email = email.trim();
    let message = message.trim();
    if !looks_like_email(email) {
        return Err("Please enter a valid email.".into());
    }
    if message.chars().count() < MIN_FEEDBACK_LEN {
        return Err(format!("Please write at least {MIN_FEEDBACK_LEN} characters."));
    }

    let body = serde_json::json!({
        "name": "PC User",
        "email": email,
        "subject": "feedback",
        "message": message,
        "source": "pc",
    });

    match agent(timeout).post(&feedback_url()).send_json(&body) {
        Ok(_) => Ok(()),
        Err(ureq::Error::StatusCode(code)) => Err(format!("Server error ({code})")),
        Err(_) => Err("No internet connection".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_numerically_not_as_strings() {
        // The whole reason parse_version exists: as strings "1.2.10" < "1.2.9",
        // which would strand every user on .9.
        assert!(parse_version("1.2.10") > parse_version("1.2.9"));
        assert!(parse_version("1.2.0") > parse_version("1.1.17"));
        assert!(parse_version("1.10.0") > parse_version("1.9.99"));
    }

    #[test]
    fn shorter_version_sorts_below_its_zero_padded_form() {
        // Matches Python tuple semantics: (1,2) < (1,2,0).
        assert!(parse_version("1.2") < parse_version("1.2.0"));
    }

    #[test]
    fn non_numeric_parts_become_zero_and_never_panic() {
        assert_eq!(parse_version("1.beta.3"), vec![1, 0, 3]);
        assert_eq!(parse_version(""), vec![0]);
        assert_eq!(parse_version("   "), vec![0]);
        assert_eq!(parse_version("garbage"), vec![0]);
    }

    /// THE regression that matters: this build must be offered to users on the
    /// last Python release, or the migration never reaches anybody.
    #[test]
    fn this_build_supersedes_the_shipping_python_server() {
        assert!(
            parse_version(APP_VERSION) > parse_version("1.1.17"),
            "APP_VERSION {APP_VERSION} must be > the shipping Python 1.1.17"
        );
    }

    #[test]
    fn email_guard_accepts_normal_addresses() {
        assert!(looks_like_email("a@b.co"));
        assert!(looks_like_email("  akhil@gamepad.space  "));
        assert!(looks_like_email("first.last+tag@sub.example.com"));
    }

    #[test]
    fn email_guard_rejects_the_common_typos() {
        assert!(!looks_like_email(""));
        assert!(!looks_like_email("nodomain"));
        assert!(!looks_like_email("@example.com"));
        assert!(!looks_like_email("user@"));
        assert!(!looks_like_email("user@nodot"));
        assert!(!looks_like_email("two @spaces.com"));
        assert!(!looks_like_email("a@b@c.com"));
    }
}
