//! UDP transport: frame handling + the receive loop.
//!
//! `handle_frame` is deliberately **allocation-free and socket-free** so the
//! entire protocol path can be unit-tested without opening a port. The socket
//! loop below is a thin shell that feeds it bytes and sends back whatever it
//! returns.
//!
//! The order of operations mirrors `server.py handle_frame` EXACTLY, including
//! two things that look wrong but are not:
//!   1. **Rumble is emitted BEFORE the ordering check** — a stale input frame
//!      still carries force-feedback back to the phone.
//!   2. **A stale frame is NOT ACKed** — ACKing it would corrupt the phone's
//!      RTT measurement, which echoes the timestamp we send back.
//! A device that cannot get a pad (MAX_PADS reached) is also never ACKed, so it
//! shows as unconnected rather than silently driving nothing.

use std::net::{IpAddr, SocketAddr};
use std::time::Instant;

use crate::session::{Report, SessionManager};
use crate::wire::{accept_auth, ack_frame, rmb_frame, Packet, PAYLOAD_SIZE};

/// What to send back for one inbound frame. Fixed-size: no heap traffic on the
/// hot path (this runs up to ~1000×/s per phone).
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Replies {
    pub rmb: Option<[u8; 5]>,
    pub ack: Option<[u8; 11]>,
    /// GRX handshake reply (SERVER_HELLO). Variable length and allocated, but
    /// this happens once per session, never on the input hot path.
    pub hs: Option<Vec<u8>>,
}

/// Abstraction over the virtual gamepad so the protocol layer never depends on
/// ViGEm — makes the whole path testable, and keeps the Windows-only driver
/// code isolated behind one trait.
pub trait PadSink {
    /// Create the physical virtual pad for a NEW session. Returning `false`
    /// means no pad could be created (driver error / limit) and the caller must
    /// abandon the session **without ACKing** — a device that cannot be driven
    /// has to look unconnected rather than silently dead. This mirrors
    /// `server.py`, where the pad is created inside `padmgr.acquire()`.
    fn acquire_pad(&mut self, slot: usize) -> bool;
    /// Write a decoded report to the pad in `slot`. `allow_guide` gates bit 14.
    fn write(&mut self, slot: usize, pkt: &Packet, allow_guide: bool);
    /// Reset a pad to neutral (anti-stuck), keeping the session alive.
    fn neutralize(&mut self, slot: usize);
    /// Release the pad entirely so it disappears from Windows.
    fn release(&mut self, slot: usize);
    /// Current force-feedback from the game for this slot: (large, small).
    fn rumble(&mut self, slot: usize) -> (u8, u8);
}

/// A pad sink that does nothing — used by tests and by `--dry-run`, so the
/// protocol can be exercised on any machine without ViGEm installed.
#[derive(Debug, Default)]
pub struct NullSink {
    pub writes: usize,
    pub neutralized: usize,
    pub released: usize,
    /// Force-feedback to hand back, for tests.
    pub rumble_value: (u8, u8),
    /// Test hook: simulate a pad that cannot be created.
    pub fail_acquire: bool,
    pub acquired: usize,
}

impl PadSink for NullSink {
    fn acquire_pad(&mut self, _slot: usize) -> bool {
        if self.fail_acquire {
            return false;
        }
        self.acquired += 1;
        true
    }
    fn write(&mut self, _slot: usize, _pkt: &Packet, _allow_guide: bool) {
        self.writes += 1;
    }
    fn neutralize(&mut self, _slot: usize) {
        self.neutralized += 1;
    }
    fn release(&mut self, _slot: usize) {
        self.released += 1;
    }
    fn rumble(&mut self, _slot: usize) -> (u8, u8) {
        self.rumble_value
    }
}

/// Status snapshot for the tray / status output. Plain data, no locks held.
#[derive(Debug, Clone, Default)]
pub struct Telemetry {
    pub sessions: usize,
    pub packets_ok: u64,
    pub packets_stale: u64,
    pub packets_rejected: u64,
    pub pad_writes: u64,
    pub grx_ok: u64,
    pub grx_dropped: u64,
    /// How many phones completed the GRX handshake (encrypted input active).
    pub grx_established: usize,
    /// Session keys — IPs for UDP, `usb:N` for WebSocket.
    pub clients: Vec<String>,
}

/// Auth context. Kept as plain data so the policy stays pure and testable.
#[derive(Debug, Clone, Default)]
pub struct AuthConfig {
    /// Token from the pairing QR (`int(key, 16)` on the Python side).
    pub expected_hash: u32,
    /// Our primary LAN IPv4, used for the off-LAN test.
    pub lan_ip: Option<String>,
    /// Prefix length the OS assigned to `lan_ip` (e.g. 20 for a /20 campus LAN).
    /// `None` → fall back to the historical /24 comparison.
    pub lan_prefix_len: Option<u8>,
    /// `/24` prefixes belonging to our USB-tether adapters, e.g. "10.66.39".
    pub tether_subnets: Vec<String>,
}

/// `/24` prefix of a dotted IPv4 ("10.66.39.130" -> "10.66.39").
fn slash24(ip: &str) -> Option<&str> {
    ip.rsplit_once('.').map(|(head, _)| head)
}

/// Is `client_ip` outside our local network?
///
/// This gates the **token-0 branch** of `accept_auth`: keyless pairing is meant
/// to be possible only from loopback or a point-to-point USB tether, never from
/// an arbitrary peer that can reach us. Getting this wrong in the permissive
/// direction hands out a gamepad without the pairing key.
///
/// ⚠️ It previously compared `/24` prefixes unconditionally. On any LAN wider
/// than a /24 that is simply wrong: on a `/20` (`10.0.0.0/20` — a very ordinary
/// campus or office range) a peer at `10.0.9.5` and this PC at `10.0.6.194` are
/// on ONE wire, yet the /24 test called them off-LAN and therefore accepted
/// their token 0. Now the real prefix length from the OS decides, and the /24
/// comparison survives only as the fallback when the OS won't tell us —
/// degrading to the old behaviour rather than to "everyone is local".
pub fn is_offlan(client_ip: &str, lan_ip: Option<&str>, lan_prefix_len: Option<u8>) -> bool {
    let Some(lan) = lan_ip else { return false };
    if client_ip.is_empty() || lan.is_empty() {
        return false;
    }
    if client_ip.starts_with("127.") {
        return true;
    }
    match lan_prefix_len {
        Some(p) if p > 0 && p <= 32 => !crate::netdetect::same_subnet(client_ip, lan, p),
        _ => match (slash24(client_ip), slash24(lan)) {
            (Some(a), Some(b)) => a != b,
            _ => false,
        },
    }
}

/// Mirrors `server.py is_usb_tether_client`: same `/24` as one of our tether
/// adapters.
pub fn is_usb_tether(client_ip: &str, tether_subnets: &[String]) -> bool {
    match slash24(client_ip) {
        Some(p) => tether_subnets.iter().any(|s| s == p),
        None => false,
    }
}

pub struct Server<S: PadSink> {
    pub sessions: SessionManager,
    pub sink: S,
    pub auth: AuthConfig,
    /// Frames accepted and written through to a pad.
    pub packets_ok: u64,
    /// Frames rejected by the auth policy.
    pub packets_rejected: u64,
    /// Frames dropped as stale/out-of-order.
    pub packets_stale: u64,
    /// Reports actually written to a pad (i.e. survived dedup).
    pub pad_writes: u64,
    /// GRX pre-shared key, derived from the pairing key. `None` disables the
    /// encrypted path entirely and leaves legacy cleartext behaviour untouched.
    pub grx_psk: Option<[u8; 32]>,
    /// One handshake/session per phone IP.
    grx_sessions: std::collections::HashMap<String, crate::grx::GrxServerSession>,
    /// Frames that arrived encrypted and decrypted successfully.
    pub grx_ok: u64,
    /// Encrypted frames dropped (forged / replayed / not yet established).
    pub grx_dropped: u64,
}

impl<S: PadSink> Server<S> {
    pub fn new(sink: S, auth: AuthConfig) -> Self {
        Self {
            sessions: SessionManager::new(),
            sink,
            auth,
            packets_ok: 0,
            packets_rejected: 0,
            packets_stale: 0,
            pad_writes: 0,
            grx_psk: None,
            grx_sessions: std::collections::HashMap::new(),
            grx_ok: 0,
            grx_dropped: 0,
        }
    }

    /// Route one inbound datagram. This is the transport entry point: it decides
    /// between a GRX handshake, a GRX-encrypted input frame, and a legacy
    /// cleartext frame — in that order.
    ///
    /// Ordering matters for a reason that already cost a production outage: a
    /// legacy 20-byte frame begins with a little-endian timestamp whose low byte
    /// sweeps 0-255, so roughly 1 in 128 of them *starts* with a handshake byte.
    /// `is_handshake` therefore also requires a plausible length; without that
    /// check a normal input frame was parsed as a handshake and killed the UDP
    /// thread, leaving the port bound but silent until restart.
    pub fn handle_datagram(&mut self, data: &[u8], addr: SocketAddr, now: Instant) -> Replies {
        // 1. GRX handshake
        if self.grx_psk.is_some() && crate::grx::is_handshake(data) {
            return self.handle_grx_handshake(data, addr);
        }
        // 2. GRX encrypted input
        if self.grx_psk.is_some() && data.len() == crate::grx::WIRE_LEN {
            let ip = addr.ip().to_string();
            let pt = match self.grx_sessions.get_mut(&ip) {
                Some(s) if s.established => s.open(data),
                _ => None,
            };
            return match pt {
                Some(pt) => {
                    self.grx_ok += 1;
                    // No auth-token check: AES-GCM already authenticated this
                    // frame, which is strictly stronger than the token.
                    let Some(pkt) = Packet::decode(&pt) else {
                        return Replies::default();
                    };
                    self.apply_packet(&ip, addr, &pkt, now)
                }
                None => {
                    self.grx_dropped += 1;
                    Replies::default()
                }
            };
        }
        // 3. Legacy cleartext
        self.handle_frame(data, addr, now)
    }

    fn handle_grx_handshake(&mut self, data: &[u8], addr: SocketAddr) -> Replies {
        let mut out = Replies::default();
        let Some(psk) = self.grx_psk else { return out };
        let ip = addr.ip().to_string();

        match data[0] {
            crate::grx::T_HELLO => {
                // A HELLO for an ALREADY-ESTABLISHED session is ignored. Otherwise
                // a LAN attacker who spoofs a live client's source IP could reset
                // the victim's encrypted session with one packet — reintroducing
                // exactly the spoofed kill-switch that the removed BYE packet
                // avoided. A genuine reconnect arrives from a new session anyway.
                if self.grx_sessions.get(&ip).is_some_and(|s| s.established) {
                    return out;
                }
                let eph = match crate::grx::new_ephemeral() {
                    Ok(e) => e,
                    Err(e) => {
                        eprintln!("GRX: RNG failure, refusing handshake: {e}");
                        return out;
                    }
                };
                let mut sess = crate::grx::GrxServerSession::new(psk, crate::grx::GRX_LTID);
                match sess.handle_hello(data, eph) {
                    Ok(reply) => {
                        println!("[GRX] HELLO from {ip} -> sent SERVER_HELLO");
                        self.grx_sessions.insert(ip, sess);
                        out.hs = Some(reply);
                    }
                    Err(e) => eprintln!("[GRX] handshake refused from {ip}: {e:?}"),
                }
            }
            crate::grx::T_CONFIRM => {
                if let Some(sess) = self.grx_sessions.get_mut(&ip) {
                    match sess.handle_confirm(data) {
                        Ok(()) => println!("[GRX] CONFIRM from {ip} -> session ESTABLISHED"),
                        Err(e) => {
                            eprintln!("[GRX] confirm FAILED from {ip}: {e:?} (wrong PSK / MITM)");
                            // Only drop a session that never established, for the
                            // same anti-spoofing reason as above.
                            if !sess.established {
                                self.grx_sessions.remove(&ip);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        out
    }

    /// Process one datagram. Returns the replies to transmit (possibly none).
    pub fn handle_frame(&mut self, data: &[u8], addr: SocketAddr, now: Instant) -> Replies {
        let out = Replies::default();

        // Only exact-length frames are input. (GRX-encrypted frames and the
        // handshake are NOT handled here — the Python server still owns those.)
        if data.len() != PAYLOAD_SIZE {
            return out;
        }
        let Some(pkt) = Packet::decode(data) else {
            return out;
        };

        // ── auth (cleartext policy) ──────────────────────────────────────────
        let ip = addr.ip().to_string();
        let offlan_or_tether = is_offlan(&ip, self.auth.lan_ip.as_deref(), self.auth.lan_prefix_len)
            || is_usb_tether(&ip, &self.auth.tether_subnets);
        if !accept_auth(pkt.auth_token, self.auth.expected_hash, offlan_or_tether) {
            self.packets_rejected += 1;
            return out;
        }
        self.apply_packet(&ip, addr, &pkt, now)
    }

    /// Handle one 20-byte frame from the **WebSocket** (USB-debugging) transport.
    ///
    /// Deliberately skips the auth-token check, exactly like `server.py`'s WS
    /// handler: the socket arrived through the local `adb reverse` tunnel on
    /// 127.0.0.1, so it is already as trusted as loopback — there is no token to
    /// check because keyless USB pairing is the whole point of this path.
    ///
    /// `key` is the session identity (`"usb:N"`), not an IP, so a phone on the
    /// WebSocket and a phone on UDP can never collide in the session map.
    pub fn handle_ws_frame(&mut self, key: &str, data: &[u8], now: Instant) -> Replies {
        let Some(pkt) = Packet::decode(data) else {
            return Replies::default();
        };
        // WS replies go back over the socket, so the stored addr is unused here.
        let dummy: SocketAddr = "0.0.0.0:0".parse().expect("static addr parses");
        self.apply_packet(key, dummy, &pkt, now)
    }

    /// The shared tail of both transports: session, rumble, ordering, pad write,
    /// ACK. Keeping this in one place is what stops the UDP and WebSocket paths
    /// from drifting apart as the port continues.
    fn apply_packet(
        &mut self,
        key: &str,
        addr: SocketAddr,
        pkt: &Packet,
        now: Instant,
    ) -> Replies {
        let mut out = Replies::default();
        let ip = key.to_string();

        // ── session (one pad per source) ─────────────────────────────────────
        // No slot available → do NOT ACK: a 5th device must look unconnected.
        let is_new = self.sessions.get(&ip).is_none();
        let Some(sess) = self.sessions.acquire(&ip, addr, now) else {
            return out;
        };
        let slot = sess.slot;
        let allow_guide = sess.allow_guide;

        // A brand-new session must get a REAL pad before we acknowledge it.
        // If the driver refuses, drop the session and stay silent, so the phone
        // reports "not connected" instead of appearing live but driving nothing.
        if is_new {
            if !self.sink.acquire_pad(slot) {
                self.sessions.remove(&ip);
                return out;
            }
            // A migration already logged itself as "old -> new"; reporting it
            // again as "+new" would look like a second pad appeared.
            if !self.sessions.migrated_last {
                eprintln!("Controller session +{ip} (active={})", self.sessions.count());
            }
        }
        // Re-borrow after the &mut self.sink call above.
        let Some(sess) = self.sessions.get_mut(&ip) else {
            return out;
        };

        // ── rumble, BEFORE the ordering check (matches server.py) ────────────
        sess.rumble = self.sink.rumble(slot);
        if let Some((l, s)) = sess.should_send_rmb() {
            out.rmb = Some(rmb_frame(l, s));
        }

        // ── ordering: stale frames are dropped and NOT ACKed ─────────────────
        if !sess.accept_ts(pkt.ts) {
            self.packets_stale += 1;
            return out;
        }
        sess.last_seen = now;

        // ── pad write (deduped) ──────────────────────────────────────────────
        let write = sess.should_write(Report::from_packet(pkt));
        if write {
            self.sink.write(slot, pkt, allow_guide);
            self.pad_writes += 1;
        }
        self.packets_ok += 1;

        // ── ACK last: the pad IOCTL must not wait on this syscall ────────────
        out.ack = Some(ack_frame(pkt.ts));
        out
    }

    /// Anti-stuck + reap. Call ~1 Hz.
    pub fn idle_tick(&mut self, now: Instant) {
        for action in self.sessions.idle_tick(now) {
            match action {
                crate::session::IdleAction::Neutralize { slot, .. } => self.sink.neutralize(slot),
                crate::session::IdleAction::Drop { slot, key } => {
                    self.sink.release(slot);
                    eprintln!("Controller session -{key} (active={})", self.sessions.count());
                }
            }
        }

        // Evict GRX state for IPs that no longer hold a pad session. Without
        // this the handshake map grows for the whole life of the process — every
        // phone that ever connected keeps its keys and replay window resident.
        if !self.grx_sessions.is_empty() {
            let live: std::collections::HashSet<String> = self
                .sessions
                .keys()
                .filter(|k| !k.starts_with("usb:") && *k != "aoa") // UDP keys are IPs
                .cloned()
                .collect();
            self.grx_sessions.retain(|ip, _| live.contains(ip));
        }
    }

    /// How many GRX handshake states are resident (test/diagnostic hook).
    pub fn grx_session_count(&self) -> usize {
        self.grx_sessions.len()
    }

    /// A snapshot for the status surface / tray. Cheap to build; call at UI rate,
    /// never per packet.
    pub fn telemetry(&self) -> Telemetry {
        Telemetry {
            sessions: self.sessions.count(),
            packets_ok: self.packets_ok,
            packets_stale: self.packets_stale,
            packets_rejected: self.packets_rejected,
            pad_writes: self.pad_writes,
            grx_ok: self.grx_ok,
            grx_dropped: self.grx_dropped,
            grx_established: self.grx_sessions.values().filter(|s| s.established).count(),
            clients: self.sessions.keys().cloned().collect(),
        }
    }
}

/// Convenience: the IP string used as a session key.
pub fn session_key(addr: &SocketAddr) -> String {
    match addr.ip() {
        IpAddr::V4(v4) => v4.to_string(),
        IpAddr::V6(v6) => v6.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::Packet;

    fn pkt(ts: u64, buttons: u16, token: u32) -> Vec<u8> {
        Packet {
            ts,
            buttons,
            lt: 0,
            rt: 0,
            ls_x: 128,
            ls_y: 128,
            rs_x: 128,
            rs_y: 128,
            auth_token: token,
        }
        .encode()
        .to_vec()
    }

    fn server() -> Server<NullSink> {
        Server::new(
            NullSink::default(),
            AuthConfig {
                expected_hash: 0xABCD_1234,
                lan_ip: Some("192.168.1.34".to_string()),
                lan_prefix_len: Some(24),
                tether_subnets: vec!["10.66.39".to_string()],
            },
        )
    }

    fn from(ip: &str) -> SocketAddr {
        format!("{ip}:5000").parse().unwrap()
    }

    #[test]
    fn offlan_and_tether_detection() {
        assert!(is_offlan("127.0.0.1", Some("192.168.1.34"), None));
        assert!(is_offlan("10.66.39.130", Some("192.168.1.34"), None));
        assert!(!is_offlan("192.168.1.55", Some("192.168.1.34"), None), "same /24 is on-LAN");
        assert!(!is_offlan("192.168.1.55", None, None), "no LAN ip known -> not off-LAN");

        // A /24 LAN behaves identically whether the prefix is supplied or not.
        assert!(!is_offlan("192.168.1.55", Some("192.168.1.34"), Some(24)));
        assert!(is_offlan("192.168.2.55", Some("192.168.1.34"), Some(24)));

        // THE REGRESSION THIS GUARDS: a /20 LAN (10.0.0.0/20 = 10.0.0.x-10.0.15.x).
        // These two are on ONE wire. With the old /24 logic the phone was judged
        // off-LAN, which is the branch that accepts auth token 0 — i.e. keyless
        // pairing from any peer on a big LAN.
        assert!(
            !is_offlan("10.0.9.5", Some("10.0.6.194"), Some(20)),
            "same /20 must be ON-LAN, or token 0 is accepted from a LAN peer"
        );
        // Genuinely outside the /20 is still off-LAN.
        assert!(is_offlan("10.0.20.5", Some("10.0.6.194"), Some(20)));
        // Without the prefix we fall back to /24 — the old, wrong-but-known answer.
        assert!(is_offlan("10.0.9.5", Some("10.0.6.194"), None), "fallback stays /24");

        let subs = vec!["10.66.39".to_string()];
        assert!(is_usb_tether("10.66.39.130", &subs));
        assert!(!is_usb_tether("10.66.40.130", &subs));
    }

    #[test]
    fn valid_frame_acks_and_writes_pad() {
        let mut s = server();
        let r = s.handle_frame(&pkt(100, 0x0001, 0xABCD_1234), from("192.168.1.55"), Instant::now());
        assert!(r.ack.is_some(), "a good frame must be ACKed");
        assert_eq!(&r.ack.unwrap()[0..3], b"ACK");
        assert_eq!(s.sink.writes, 1);
        assert_eq!(s.sessions.count(), 1);
    }

    #[test]
    fn bad_token_on_lan_is_rejected_silently() {
        let mut s = server();
        // token 0 from an ON-LAN address: not the pairing token, not off-LAN -> reject
        let r = s.handle_frame(&pkt(1, 0, 0), from("192.168.1.55"), Instant::now());
        assert!(r.ack.is_none(), "rejected frame must not be ACKed");
        assert_eq!(s.sessions.count(), 0, "no pad for an unauthenticated source");
        assert_eq!(s.packets_rejected, 1);
        assert_eq!(s.sink.writes, 0);
    }

    #[test]
    fn keyless_token_zero_accepted_over_usb_tether() {
        let mut s = server();
        let r = s.handle_frame(&pkt(1, 0, 0), from("10.66.39.130"), Instant::now());
        assert!(r.ack.is_some(), "keyless USB-tether pairing must work");
        assert_eq!(s.sessions.count(), 1);
    }

    #[test]
    fn stale_frame_is_dropped_and_not_acked() {
        let mut s = server();
        let a = from("192.168.1.55");
        let now = Instant::now();
        assert!(s.handle_frame(&pkt(1000, 0, 0xABCD_1234), a, now).ack.is_some());
        let r = s.handle_frame(&pkt(999, 0, 0xABCD_1234), a, now);
        assert!(r.ack.is_none(), "stale frame must not be ACKed (would poison RTT)");
        assert_eq!(s.packets_stale, 1);
    }

    #[test]
    fn identical_reports_are_deduped_but_still_acked() {
        let mut s = server();
        let a = from("192.168.1.55");
        let now = Instant::now();
        s.handle_frame(&pkt(1, 0x0001, 0xABCD_1234), a, now);
        s.handle_frame(&pkt(2, 0x0001, 0xABCD_1234), a, now); // same inputs, newer ts
        assert_eq!(s.sink.writes, 1, "unchanged report must not re-write the pad");
        let r = s.handle_frame(&pkt(3, 0x0001, 0xABCD_1234), a, now);
        assert!(r.ack.is_some(), "deduped frames are still ACKed (keeps RTT/liveness alive)");
    }

    #[test]
    fn rumble_is_returned_and_stops_with_one_zero_frame() {
        let mut s = server();
        let a = from("192.168.1.55");
        let now = Instant::now();
        s.sink.rumble_value = (200, 40);
        let r = s.handle_frame(&pkt(1, 0, 0xABCD_1234), a, now);
        assert_eq!(r.rmb, Some(rmb_frame(200, 40)));

        s.sink.rumble_value = (0, 0);
        let r = s.handle_frame(&pkt(2, 0, 0xABCD_1234), a, now);
        assert_eq!(r.rmb, Some(rmb_frame(0, 0)), "one final zero stops the motor");
        let r = s.handle_frame(&pkt(3, 0, 0xABCD_1234), a, now);
        assert_eq!(r.rmb, None, "then silence");
    }

    #[test]
    fn wrong_length_frames_ignored() {
        let mut s = server();
        let a = from("192.168.1.55");
        let now = Instant::now();
        assert_eq!(s.handle_frame(&[], a, now), Replies::default());
        assert_eq!(s.handle_frame(&[0u8; 19], a, now), Replies::default());
        assert_eq!(s.handle_frame(&[0u8; 41], a, now), Replies::default(), "GRX frames are Python's job");
        assert_eq!(s.sessions.count(), 0);
    }

    /// GRX state must not accumulate for phones that have gone away, or the
    /// handshake map grows for the whole life of the process.
    #[test]
    fn grx_sessions_are_evicted_when_their_pad_session_dies() {
        use std::time::Duration;
        let mut s = server();
        s.grx_psk = Some([0x11; 32]);
        let a = from("192.168.1.55");
        let t0 = Instant::now();

        // A HELLO creates GRX state even before a pad session exists.
        let mut hello = vec![crate::grx::T_HELLO];
        hello.extend_from_slice(&[7u8; 32]);
        hello.extend_from_slice(&(crate::grx::GRX_LTID.len() as u32).to_le_bytes());
        hello.extend_from_slice(crate::grx::GRX_LTID);
        s.handle_datagram(&hello, a, t0);
        assert_eq!(s.grx_session_count(), 1, "handshake created GRX state");

        // No pad session for that IP -> the idle tick must evict it.
        s.idle_tick(t0 + Duration::from_millis(100));
        assert_eq!(s.grx_session_count(), 0, "orphaned GRX state must be evicted");
    }

    #[test]
    fn telemetry_reports_live_state() {
        let mut s = server();
        let now = Instant::now();
        s.handle_frame(&pkt(1, 0x0001, 0xABCD_1234), from("192.168.1.55"), now);
        let t = s.telemetry();
        assert_eq!(t.sessions, 1);
        assert_eq!(t.packets_ok, 1);
        assert_eq!(t.pad_writes, 1);
        assert_eq!(t.clients, vec!["192.168.1.55".to_string()]);
    }

    #[test]
    fn pad_creation_failure_means_no_session_and_no_ack() {
        // If ViGEm cannot give us a pad, the phone must NOT be told it is
        // connected — otherwise it shows a live link while driving nothing.
        let mut s = server();
        s.sink.fail_acquire = true;
        let r = s.handle_frame(&pkt(1, 0x0001, 0xABCD_1234), from("192.168.1.55"), Instant::now());
        assert!(r.ack.is_none(), "must not ACK when no pad could be created");
        assert_eq!(s.sessions.count(), 0, "failed session must not linger");
        assert_eq!(s.sink.writes, 0);
    }

    #[test]
    fn pad_acquired_once_per_session_not_per_packet() {
        let mut s = server();
        let a = from("192.168.1.55");
        let now = Instant::now();
        for i in 1..=5 {
            s.handle_frame(&pkt(i, 0x0001, 0xABCD_1234), a, now);
        }
        assert_eq!(s.sink.acquired, 1, "pad must be created once, not per packet");
    }

    #[test]
    fn fifth_device_gets_no_pad_and_no_ack() {
        let mut s = server();
        let now = Instant::now();
        for i in 1..=crate::wire::MAX_PADS {
            let a = from(&format!("192.168.1.{}", 100 + i));
            assert!(s.handle_frame(&pkt(1, 0, 0xABCD_1234), a, now).ack.is_some());
        }
        let fifth = from("192.168.1.200");
        let r = s.handle_frame(&pkt(1, 0, 0xABCD_1234), fifth, now);
        assert!(r.ack.is_none(), "5th device must look unconnected, not silently dead");
        assert_eq!(s.sessions.count(), crate::wire::MAX_PADS);
    }

    #[test]
    fn idle_tick_neutralizes_then_releases_pad() {
        use std::time::Duration;
        let mut s = server();
        let a = from("192.168.1.55");
        let t0 = Instant::now();
        s.handle_frame(&pkt(1, 0x0001, 0xABCD_1234), a, t0);

        s.idle_tick(t0 + Duration::from_millis(800));
        assert_eq!(s.sink.neutralized, 1, "quiet pad must be reset (anti-stuck)");
        assert_eq!(s.sink.released, 0);

        s.idle_tick(t0 + Duration::from_millis(3100));
        assert_eq!(s.sink.released, 1, "long-silent pad must be freed");
        assert_eq!(s.sessions.count(), 0);
    }
}
