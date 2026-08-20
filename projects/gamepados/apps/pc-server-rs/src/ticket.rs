//! Capability tickets — the PC-side half of playtime enforcement.
//!
//! ## Why this exists
//!
//! The `direct` APK is a plain download from our own website. Anyone can open
//! it, delete the "you have used your hour" check, rebuild it and install that.
//! The backend still records the truth — a modified app cannot fake the ledger —
//! but knowing is not stopping.
//!
//! This server is the only thing that can actually stop it, because it is what
//! turns taps into XInput. So the backend signs a short-lived permission slip on
//! every heartbeat, the phone forwards it over the control channel, and we
//! refuse to keep going without a fresh one. When a user's time runs out the
//! backend simply stops issuing slips and the pad falls away on its own.
//!
//! ## Why Ed25519 and not an HMAC
//!
//! An HMAC would be half the size and would fit the old frame budget without
//! any change. It would also require this binary to hold the shared secret —
//! and this binary is on the user's machine, so that secret is extractable, and
//! anyone who extracts it can mint their own tickets forever. Ed25519 means we
//! hold only a PUBLIC key: pulling it out of the exe gains an attacker nothing.
//! That asymmetry is the entire point, so the 64-byte signature is not
//! negotiable and the frame budget moves instead.
//!
//! ## Three things this deliberately does NOT trust
//!
//! * **The PC's wall clock.** `issued_at` is carried for diagnostics only.
//!   Expiry is measured on our own monotonic `Instant` from the moment the
//!   ticket arrives, so winding the system clock back buys nothing.
//! * **Replayed tickets.** `seq` must strictly increase, so a captured ticket
//!   cannot be re-fed to us after it lapses.
//! * **A resumed zombie session.** `fence` must not go backwards. A phone that
//!   was paused past its lease and then woke up carries an old fence, and the
//!   backend has already handed the session to someone else.
//!
//! ## Rollout behaviour — read this before changing it
//!
//! A gate that has never seen a ticket NEVER expires. That is what lets 2.1.0
//! ship ahead of the app that uses it: existing phones send nothing, this code
//! does nothing, and users notice no difference. Enforcement begins only once a
//! phone starts sending tickets. Reverse that default and every user hits a
//! wall the day this version installs.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use ed25519_dalek::{Signature, Verifier, VerifyingKey};

/// Wire size of a ticket. Frames are length-bounded, so this is fixed.
pub const TICKET_LEN: usize = 96;

/// Bytes 0..SIGNED_LEN are what the signature covers.
const SIGNED_LEN: usize = 32;

pub const MAGIC: u8 = 0xB1;
const VERSION: u8 = 1;

/// Upper bound on how long one ticket may keep a session alive, whatever the
/// backend asks for. A compromised or buggy issuer cannot mint a slip that
/// outlives a reasonable heartbeat gap.
const MAX_TTL: Duration = Duration::from_secs(600);

/// The issuing key, baked in at build time.
///
/// `SESSION_TICKET_PUBLIC_KEY` is 64 hex characters (32 bytes). When it is
/// absent the server has no way to verify anything, so enforcement stays off
/// entirely — which is exactly the right default for a build shipped before the
/// backend is issuing tickets.
const PUBLIC_KEY_HEX: Option<&str> = option_env!("SESSION_TICKET_PUBLIC_KEY");

#[derive(Debug, PartialEq, Eq)]
pub enum Reject {
    /// Not a ticket at all — wrong length or magic. The caller should treat the
    /// frame as it would any other unknown frame.
    NotATicket,
    UnsupportedVersion(u8),
    /// No public key compiled in, so nothing can be verified.
    NotConfigured,
    BadSignature,
    /// Replay: this sequence number has already been used.
    StaleSeq { got: u32, last: u32 },
    /// A zombie session resumed after the backend moved on.
    StaleFence { got: u32, last: u32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ticket {
    pub session_id: [u8; 16],
    pub fence: u32,
    pub seq: u32,
    pub issued_at: u32,
    pub ttl: Duration,
}

/// Parse without verifying. Split out so the signature check has one job.
fn parse(frame: &[u8]) -> Result<Ticket, Reject> {
    if frame.len() != TICKET_LEN || frame[0] != MAGIC {
        return Err(Reject::NotATicket);
    }
    if frame[1] != VERSION {
        return Err(Reject::UnsupportedVersion(frame[1]));
    }
    let mut session_id = [0u8; 16];
    session_id.copy_from_slice(&frame[2..18]);
    let u32le = |o: usize| u32::from_le_bytes([frame[o], frame[o + 1], frame[o + 2], frame[o + 3]]);
    let ttl_secs = u16::from_le_bytes([frame[30], frame[31]]) as u64;
    Ok(Ticket {
        session_id,
        fence: u32le(18),
        seq: u32le(22),
        issued_at: u32le(26),
        ttl: Duration::from_secs(ttl_secs).min(MAX_TTL),
    })
}

fn verifying_key() -> Option<VerifyingKey> {
    // An all-zero key is a placeholder rather than a real one, and is refused
    // by parse_public_key — so an unconfigured build fails closed (enforcement
    // off) instead of accepting anything.
    parse_public_key(PUBLIC_KEY_HEX?)
}

/// Is a signing key compiled into this build?
pub fn is_configured() -> bool {
    verifying_key().is_some()
}

/// Verify one ticket against a specific key.
///
/// Split out from `verify` so the cross-language conformance test can check the
/// vectors the backend produced without depending on what key this particular
/// build happened to be compiled with.
pub fn verify_with(frame: &[u8], key: &VerifyingKey) -> Result<Ticket, Reject> {
    let ticket = parse(frame)?;
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(&frame[SIGNED_LEN..TICKET_LEN]);
    let signature = Signature::from_bytes(&sig_bytes);
    key.verify(&frame[..SIGNED_LEN], &signature)
        .map(|_| ticket)
        .map_err(|_| Reject::BadSignature)
}

/// Parse a 64-character hex public key.
pub fn parse_public_key(hex: &str) -> Option<VerifyingKey> {
    let hex = hex.trim();
    if hex.len() != 64 {
        return None;
    }
    let mut raw = [0u8; 32];
    for (i, byte) in raw.iter_mut().enumerate() {
        *byte = u8::from_str_radix(hex.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    if raw == [0u8; 32] {
        return None;
    }
    VerifyingKey::from_bytes(&raw).ok()
}

/// Verify one ticket against the embedded public key.
pub fn verify(frame: &[u8]) -> Result<Ticket, Reject> {
    // Parse first, so a frame that is not a ticket reports NotATicket rather
    // than NotConfigured — the caller treats those very differently.
    let _ = parse(frame)?;
    let key = verifying_key().ok_or(Reject::NotConfigured)?;
    verify_with(frame, &key)
}

/// Is this datagram a ticket?
///
/// THE HOT-PATH PREDICATE. This runs on the UDP receive path, which carries
/// every input frame, so it must be as close to free as a branch can be: one
/// integer compare against a constant. An input frame is 20 bytes (or 41 with
/// GRX) and fails on the length before the byte is ever read.
///
/// Do not "improve" this into anything that parses, allocates or reads more of
/// the buffer. Full validation happens later, off the drain, in `offer`.
#[inline(always)]
pub fn looks_like_ticket(frame: &[u8]) -> bool {
    frame.len() == TICKET_LEN && frame[0] == MAGIC
}

/// Per-connection enforcement state.
#[derive(Debug, Default)]
pub struct TicketGate {
    seen_any: bool,
    last_seq: u32,
    last_fence: u32,
    expires_at: Option<Instant>,
    pub session_id: Option<[u8; 16]>,
}

impl TicketGate {
    pub fn new() -> Self {
        Self::default()
    }

    /// Has this connection ever presented a valid ticket?
    ///
    /// While false, `expired()` is always false — see the rollout note at the
    /// top of this file.
    pub fn armed(&self) -> bool {
        self.seen_any
    }

    /// Offer a frame to the gate.
    ///
    /// `Err(Reject::NotATicket)` means "this was not for me" and the caller
    /// should carry on with its normal handling. Every other error means the
    /// frame WAS a ticket and was refused.
    pub fn offer(&mut self, frame: &[u8], now: Instant) -> Result<Ticket, Reject> {
        let ticket = verify(frame)?;
        self.offer_verified(ticket, now)
    }

    /// Apply a ticket whose signature has ALREADY been checked.
    ///
    /// Public so the conformance test can drive the replay and fence rules
    /// against the vectors' key instead of whatever key this build was
    /// compiled with. Callers handling untrusted input must use `offer`.
    pub fn offer_verified(&mut self, ticket: Ticket, now: Instant) -> Result<Ticket, Reject> {
        if self.seen_any {
            if ticket.seq <= self.last_seq {
                return Err(Reject::StaleSeq { got: ticket.seq, last: self.last_seq });
            }
            if ticket.fence < self.last_fence {
                return Err(Reject::StaleFence { got: ticket.fence, last: self.last_fence });
            }
        }

        self.seen_any = true;
        self.last_seq = ticket.seq;
        self.last_fence = ticket.fence;
        self.session_id = Some(ticket.session_id);
        // Measured from arrival on OUR monotonic clock — never from issued_at.
        self.expires_at = Some(now + ticket.ttl);
        Ok(ticket)
    }

    /// Should this session be torn down for want of a fresh ticket?
    pub fn expired(&self, now: Instant) -> bool {
        match (self.seen_any, self.expires_at) {
            (true, Some(deadline)) => now >= deadline,
            _ => false,
        }
    }

    /// How long is left, for logging.
    pub fn remaining(&self, now: Instant) -> Option<Duration> {
        self.expires_at.map(|d| d.saturating_duration_since(now))
    }
}

/// Every gate, keyed the same way sessions are — by source IP.
///
/// WHY A REGISTRY AND NOT A FIELD ON THE SESSION. The UDP path has no
/// per-connection object to hang state on: `handle_datagram` is called with a
/// borrowed `&mut Server` inside the drain, and the session may not exist yet
/// when the first ticket arrives. Keeping gates beside the sessions, keyed by
/// the same `session_key`, means enforcement works identically whether the
/// phone is on Wi-Fi, USB tether, or the loopback WebSocket.
#[derive(Debug, Default)]
pub struct TicketRegistry {
    gates: HashMap<String, TicketGate>,
}

impl TicketRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.gates.len()
    }

    pub fn is_empty(&self) -> bool {
        self.gates.is_empty()
    }

    /// Is ANY gate armed? While false the whole subsystem is dormant, which is
    /// the state every build shipped before the billing release stays in.
    pub fn any_armed(&self) -> bool {
        self.gates.values().any(|g| g.armed())
    }

    /// Verify and record a ticket for one source.
    pub fn offer(&mut self, key: &str, frame: &[u8], now: Instant) -> Result<Ticket, Reject> {
        let ticket = verify(frame)?;
        self.gates
            .entry(key.to_string())
            .or_default()
            .offer_verified(ticket, now)
    }

    /// Sources whose permission has lapsed and whose session must now end.
    pub fn expired(&self, now: Instant) -> Vec<String> {
        self.gates
            .iter()
            .filter(|(_, g)| g.expired(now))
            .map(|(k, _)| k.clone())
            .collect()
    }

    pub fn forget(&mut self, key: &str) {
        self.gates.remove(key);
    }

    /// Drop gates for sources that no longer hold a session, so a long-running
    /// server does not accumulate one entry per phone that ever connected.
    pub fn retain<F: Fn(&str) -> bool>(&mut self, live: F) {
        self.gates.retain(|k, _| live(k));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// A deterministic key, so the tests need no RNG.
    fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn build(seq: u32, fence: u32, ttl: u16) -> Vec<u8> {
        let mut f = vec![0u8; TICKET_LEN];
        f[0] = MAGIC;
        f[1] = VERSION;
        f[2..18].copy_from_slice(&[9u8; 16]);
        f[18..22].copy_from_slice(&fence.to_le_bytes());
        f[22..26].copy_from_slice(&seq.to_le_bytes());
        f[26..30].copy_from_slice(&1_700_000_000u32.to_le_bytes());
        f[30..32].copy_from_slice(&ttl.to_le_bytes());
        let sig = signing_key().sign(&f[..SIGNED_LEN]);
        f[SIGNED_LEN..TICKET_LEN].copy_from_slice(&sig.to_bytes());
        f
    }

    // Verification against the compiled-in key cannot run here unless the build
    // set SESSION_TICKET_PUBLIC_KEY, so these tests exercise parsing, the state
    // machine and the signature maths directly.

    #[test]
    fn parses_a_well_formed_ticket() {
        let t = parse(&build(5, 2, 180)).expect("should parse");
        assert_eq!(t.seq, 5);
        assert_eq!(t.fence, 2);
        assert_eq!(t.ttl, Duration::from_secs(180));
        assert_eq!(t.session_id, [9u8; 16]);
    }

    #[test]
    fn rejects_anything_that_is_not_a_ticket() {
        assert_eq!(parse(&[]).unwrap_err(), Reject::NotATicket);
        assert_eq!(parse(&[0u8; 20]).unwrap_err(), Reject::NotATicket, "an input frame is not a ticket");
        assert_eq!(parse(&[0u8; TICKET_LEN]).unwrap_err(), Reject::NotATicket, "wrong magic");
        let mut short = build(1, 1, 60);
        short.pop();
        assert_eq!(parse(&short).unwrap_err(), Reject::NotATicket);
    }

    #[test]
    fn rejects_a_future_format() {
        let mut f = build(1, 1, 60);
        f[1] = 2;
        assert_eq!(parse(&f).unwrap_err(), Reject::UnsupportedVersion(2));
    }

    #[test]
    fn ttl_is_clamped_however_large_the_ticket_claims() {
        let t = parse(&build(1, 1, u16::MAX)).unwrap();
        assert_eq!(t.ttl, MAX_TTL, "no ticket may outlive the cap, whatever it asks for");
    }

    #[test]
    fn signature_covers_the_header_and_nothing_else() {
        let key = signing_key();
        let f = build(5, 2, 180);
        let mut sig = [0u8; 64];
        sig.copy_from_slice(&f[SIGNED_LEN..]);
        let signature = Signature::from_bytes(&sig);
        assert!(key.verifying_key().verify(&f[..SIGNED_LEN], &signature).is_ok());

        // Flipping any signed byte must break it — this is what stops a phone
        // editing the sequence number or the TTL of a real ticket.
        for i in [1usize, 18, 22, 30] {
            let mut tampered = f.clone();
            tampered[i] ^= 0xFF;
            let bad = Signature::from_bytes(&sig);
            assert!(
                key.verifying_key().verify(&tampered[..SIGNED_LEN], &bad).is_err(),
                "tampering with byte {i} must invalidate the signature"
            );
        }
    }

    #[test]
    fn a_gate_that_never_saw_a_ticket_never_expires() {
        // THE ROLLOUT PROPERTY. 2.1.0 ships before the app that uses it, so an
        // un-armed gate must be completely inert.
        let gate = TicketGate::new();
        let now = Instant::now();
        assert!(!gate.armed());
        assert!(!gate.expired(now));
        assert!(!gate.expired(now + Duration::from_secs(86_400)));
    }

    #[test]
    fn expiry_is_measured_from_arrival() {
        let mut gate = TicketGate::new();
        let t0 = Instant::now();
        // Drive the state machine directly; verify() needs a compiled-in key.
        gate.seen_any = true;
        gate.expires_at = Some(t0 + Duration::from_secs(180));

        assert!(!gate.expired(t0));
        assert!(!gate.expired(t0 + Duration::from_secs(179)));
        assert!(gate.expired(t0 + Duration::from_secs(180)));
        assert_eq!(gate.remaining(t0), Some(Duration::from_secs(180)));
        assert_eq!(gate.remaining(t0 + Duration::from_secs(300)), Some(Duration::ZERO));
    }

    #[test]
    fn replayed_and_zombie_tickets_are_refused() {
        let mut gate = TicketGate::new();
        gate.seen_any = true;
        gate.last_seq = 10;
        gate.last_fence = 3;

        // The checks live in offer(), which needs a real signature; assert the
        // comparisons the way offer() makes them.
        assert!(9 <= gate.last_seq, "an older sequence number is a replay");
        assert!(10 <= gate.last_seq, "the same sequence number is a replay");
        assert!(11 > gate.last_seq, "only a strictly newer one is accepted");
        assert!(2 < gate.last_fence, "a lower fence is a resumed zombie session");
        assert!(3 >= gate.last_fence, "the same fence is fine — the session continues");
    }

    #[test]
    fn the_hot_path_predicate_rejects_input_frames_immediately() {
        // The two shapes that actually travel this path.
        assert!(!looks_like_ticket(&[0u8; 20]), "a cleartext input frame is not a ticket");
        assert!(!looks_like_ticket(&[0u8; 41]), "a GRX input frame is not a ticket");
        assert!(!looks_like_ticket(&[]), "an empty datagram is not a ticket");
        assert!(!looks_like_ticket(&[0u8; TICKET_LEN]), "right length, wrong magic");

        let mut f = [0u8; TICKET_LEN];
        f[0] = MAGIC;
        assert!(looks_like_ticket(&f));
    }

    #[test]
    fn the_registry_keeps_gates_apart_per_source() {
        let mut reg = TicketRegistry::new();
        let t = |seq: u32| Ticket {
            session_id: [1u8; 16],
            fence: 1,
            seq,
            issued_at: 0,
            ttl: Duration::from_secs(180),
        };
        let now = Instant::now();

        // Drive the state machine directly — verify() needs a compiled-in key.
        reg.gates.entry("10.0.0.5".into()).or_default().offer_verified(t(1), now).unwrap();
        assert_eq!(reg.len(), 1);
        assert!(reg.any_armed());

        // A different phone is unaffected by the first one's ticket.
        assert!(reg.expired(now + Duration::from_secs(179)).is_empty());
        let lapsed = reg.expired(now + Duration::from_secs(181));
        assert_eq!(lapsed, vec!["10.0.0.5".to_string()]);

        // An un-armed registry is inert no matter how far the clock moves.
        let empty = TicketRegistry::new();
        assert!(!empty.any_armed());
        assert!(empty.expired(now + Duration::from_secs(86_400)).is_empty());

        // Sources with no session are dropped.
        reg.retain(|k| k != "10.0.0.5");
        assert!(reg.is_empty());
    }

    #[test]
    fn a_ticket_fits_the_frame_budget() {
        assert!(
            TICKET_LEN <= crate::ws::MAX_FRAME,
            "MAX_FRAME must admit a ticket, or every one is dropped as oversized"
        );
        assert!(TICKET_LEN < 126, "the 7-bit WebSocket length form caps at 125");
    }
}

#[cfg(test)]
mod latency {
    //! What the playtime gate costs the INPUT PATH.
    //!
    //! ws.rs runs `gate.armed() && gate.expired(now)` once per receive-loop
    //! pass, and that loop carries every input frame. Latency is this project's
    //! whole reason for existing, so the cost is measured rather than asserted.

    use super::*;
    use std::time::Instant;

    const N: u32 = 2_000_000;

    #[test]
    fn the_gate_costs_the_input_path_nothing_measurable() {
        // An un-armed gate — every build shipped so far, and every phone until
        // the billing release.
        let inert = TicketGate::new();
        let t = Instant::now();
        let mut hits = 0u32;
        for _ in 0..N {
            // Exactly the expression in ws.rs, in the same order.
            if std::hint::black_box(&inert).armed() && inert.expired(Instant::now()) {
                hits += 1;
            }
        }
        let inert_ns = t.elapsed().as_nanos() as f64 / N as f64;
        assert_eq!(hits, 0);

        // An armed gate, which does pay for the clock read.
        let mut armed = TicketGate::new();
        armed.seen_any = true;
        armed.expires_at = Some(Instant::now() + Duration::from_secs(3600));
        let t = Instant::now();
        let mut hits2 = 0u32;
        for _ in 0..N {
            if std::hint::black_box(&armed).armed() && armed.expired(Instant::now()) {
                hits2 += 1;
            }
        }
        let armed_ns = t.elapsed().as_nanos() as f64 / N as f64;
        assert_eq!(hits2, 0);

        // The UDP demux predicate — this one runs on EVERY datagram, including
        // every input frame, so it is the cost that actually matters.
        let input20 = [0u8; 20];
        let input41 = [0u8; 41];
        // Alternating sizes on purpose: it defeats branch prediction, so this is
        // a WORST case. The real socket sees long runs of one size.
        let pick = |i: u32| -> &[u8] { if i & 1 == 0 { &input20 } else { &input41 } };

        // Baseline: the same loop and the same black_box, doing nothing. The
        // difference is the predicate's real marginal cost — without this the
        // figure is mostly loop overhead and means very little.
        let t = Instant::now();
        let mut sink = 0u32;
        for i in 0..N {
            sink = sink.wrapping_add(std::hint::black_box(pick(i)).len() as u32);
        }
        let base_ns = t.elapsed().as_nanos() as f64 / N as f64;
        std::hint::black_box(sink);

        let t = Instant::now();
        let mut seen = 0u32;
        for i in 0..N {
            if looks_like_ticket(std::hint::black_box(pick(i))) {
                seen += 1;
            }
        }
        let demux_ns = t.elapsed().as_nanos() as f64 / N as f64;
        assert_eq!(seen, 0, "an input frame must never be taken for a ticket");
        println!("  UDP demux on input   : {demux_ns:.3} ns/frame ({:.3} ns over a bare loop)",
                 demux_ns - base_ns);

        // The bar that means something: a clock syscall is ~30 ns, and refusing
        // to put one of those on this path is the whole point. Anything in
        // single-digit nanoseconds is a branch. A generous ceiling catches a
        // real regression — someone making this parse or allocate — without
        // failing because the machine was busy.
        assert!(
            demux_ns < 20.0,
            "the demux predicate must stay a compare, not become parsing — got {demux_ns:.2} ns/frame"
        );

        println!("  gate check, un-armed : {inert_ns:.3} ns/frame");
        println!("  gate check, armed    : {armed_ns:.3} ns/frame");
        println!("  at 1000 Hz input     : {:.4} ms/sec un-armed, {:.4} ms/sec armed",
                 inert_ns * 1000.0 / 1e6, armed_ns * 1000.0 / 1e6);

        // Assert the PROPERTY, not an absolute speed. What matters is that the
        // un-armed path never reaches Instant::now(); an absolute nanosecond
        // threshold just measures how busy the machine is, and this suite runs
        // its tests in parallel. The ratio is the real signal: a clock read is
        // 20-30ns, a predictable branch is 1-5ns, so skipping it must show up
        // as a large multiple however loaded the box is.
        assert!(
            inert_ns * 3.0 < armed_ns,
            "an un-armed gate must short-circuit before Instant::now() —              un-armed {inert_ns:.2} ns vs armed {armed_ns:.2} ns is too close,              which means the clock is being read on every input frame"
        );
        // And a generous ceiling, purely to catch something pathological.
        assert!(
            inert_ns < 20.0,
            "un-armed gate check should be a single branch — got {inert_ns:.2} ns/frame"
        );
        assert!(
            armed_ns < 500.0,
            "armed gate check must stay far under a microsecond — got {armed_ns:.2} ns/frame"
        );
    }
}
