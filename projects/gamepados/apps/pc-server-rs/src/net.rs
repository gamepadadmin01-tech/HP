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

use crate::session::{Composed, Report, SessionManager};
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
    /// The last frame written, so tests can see WHAT reached the pad.
    pub last: Option<Packet>,
}

impl PadSink for NullSink {
    fn acquire_pad(&mut self, _slot: usize) -> bool {
        if self.fail_acquire {
            return false;
        }
        self.acquired += 1;
        true
    }
    fn write(&mut self, _slot: usize, pkt: &Packet, _allow_guide: bool) {
        self.writes += 1;
        self.last = Some(*pkt);
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
    /// Wi-Fi health (added 2026-10-05). See the matching fields on `Server`.
    pub gaps_50: u64,
    pub gaps_100: u64,
    pub gaps_250: u64,
    pub max_gap_ms: u64,
    pub merged_presses: u64,
    pub held_releases: u64,
    pub neutralized: u64,
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

/// How long a phone's GRX keys are kept after its pad session was dropped, so a
/// phone returning from the background resumes without a rescan (2026-10-05).
pub const GRX_KEEP: std::time::Duration = std::time::Duration::from_secs(600);

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
    /// When each GRX session's phone last held a live pad session (updated on
    /// the idle tick). Keeps the keys for `GRX_KEEP` after the pad is dropped.
    grx_seen: std::collections::HashMap<String, Instant>,
    /// Frames that arrived encrypted and decrypted successfully.
    pub grx_ok: u64,
    /// Encrypted frames dropped (forged / replayed / not yet established).
    pub grx_dropped: u64,
    // ── Wi-Fi health (added 2026-10-05) ─────────────────────────────────────
    // A phone that is playing sends at least every 33 ms, so a longer silence
    // between accepted frames is the network, not the player. These turn "it
    // felt laggy" into numbers on the 5 s stats line.
    /// Silences between accepted frames of one UDP session longer than 50/100/250 ms.
    pub gaps_50: u64,
    pub gaps_100: u64,
    pub gaps_250: u64,
    /// Longest such silence since the last stats line (reset by the caller).
    pub max_gap_ms: u64,
    /// Buttons that were pressed AND released inside one received pile and were
    /// written as a press anyway — before 2.1.4 each of these was a lost input.
    pub merged_presses: u64,
    /// Releases held back so a press stayed visible for `MIN_PRESS`.
    pub held_releases: u64,
    /// Anti-stuck resets after 0.5 s of silence.
    pub neutralized: u64,
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
            grx_seen: std::collections::HashMap::new(),
            grx_ok: 0,
            grx_dropped: 0,
            gaps_50: 0,
            gaps_100: 0,
            gaps_250: 0,
            max_gap_ms: 0,
            merged_presses: 0,
            held_releases: 0,
            neutralized: 0,
        }
    }

    /// Decode one input datagram (GRX-encrypted or cleartext) into a packet,
    /// applying the same checks `handle_datagram` does. No pad is touched.
    /// Handshake frames must NOT come here — the drain separates them first.
    pub fn decode_input(&mut self, data: &[u8], addr: SocketAddr) -> Option<Packet> {
        if self.grx_psk.is_some() && data.len() == crate::grx::WIRE_LEN {
            let ip = addr.ip().to_string();
            let pt = match self.grx_sessions.get_mut(&ip) {
                Some(s) if s.established => s.open(data),
                _ => None,
            };
            return match pt {
                Some(pt) => {
                    self.grx_ok += 1;
                    Packet::decode(&pt)
                }
                None => {
                    self.grx_dropped += 1;
                    None
                }
            };
        }
        if data.len() != PAYLOAD_SIZE {
            return None;
        }
        let pkt = Packet::decode(data)?;
        let ip = addr.ip().to_string();
        let offlan_or_tether = is_offlan(&ip, self.auth.lan_ip.as_deref(), self.auth.lan_prefix_len)
            || is_usb_tether(&ip, &self.auth.tether_subnets);
        if !accept_auth(pkt.auth_token, self.auth.expected_hash, offlan_or_tether) {
            self.packets_rejected += 1;
            return None;
        }
        Some(pkt)
    }

    /// Every input frame one phone sent that arrived in the same received pile
    /// (added 2026-10-05).
    ///
    /// Before 2.1.4 the drain kept only the LAST frame of a pile. Over Wi-Fi the
    /// PC's card holds packets while it naps or scans and then delivers them all
    /// at once, so a quick tap's press and release often arrived together — and
    /// only the release was written. The game never saw the press. Now every
    /// frame is decoded: the newest by TIMESTAMP (not by arrival order) is the
    /// state, and any button that was pressed somewhere in the pile but is up in
    /// the newest is still written as a press, held for `MIN_PRESS`.
    ///
    /// Still exactly one ACK, for the newest frame, so the phone's RTT reading
    /// is not dragged by the backlog (the reason the drain exists — main.rs).
    pub fn handle_batch(&mut self, frames: &[&[u8]], addr: SocketAddr, now: Instant) -> Replies {
        let mut pkts: Vec<Packet> = Vec::with_capacity(frames.len());
        for f in frames {
            if let Some(p) = self.decode_input(f, addr) {
                pkts.push(p);
            }
        }
        if pkts.is_empty() {
            return Replies::default();
        }
        let ip = addr.ip().to_string();
        self.apply_batch(&ip, addr, &pkts, now)
    }

    /// Write any held-back release whose `MIN_PRESS` has run out. Call whenever
    /// the receive loop wakes and `next_due` has passed.
    pub fn flush_due(&mut self, now: Instant) {
        let keys: Vec<String> = self.sessions.keys().cloned().collect();
        for key in keys {
            let Some(sess) = self.sessions.get_mut(&key) else { continue };
            let Some(pkt) = sess.take_due(now) else { continue };
            let (slot, allow_guide) = (sess.slot, sess.allow_guide);
            if sess.should_write(Report::from_packet(&pkt)) {
                self.sink.write(slot, &pkt, allow_guide);
                self.pad_writes += 1;
            }
        }
    }

    /// The earliest moment a held-back release must be written, if any.
    pub fn next_due(&self) -> Option<Instant> {
        self.sessions
            .keys()
            .filter_map(|k| self.sessions.get(k).and_then(|s| s.pending.map(|(_, at)| at)))
            .min()
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
                //
                // Narrowed 2026-10-05: only while that phone still holds a LIVE pad
                // session. GRX state is now kept for GRX_KEEP after the pad is
                // dropped (see idle_tick), and a phone coming back after that must
                // be able to start a fresh session — refusing it would leave it on
                // cleartext. A spoofed HELLO for an idle IP disturbs nobody.
                if self.grx_sessions.get(&ip).is_some_and(|s| s.established)
                    && self.sessions.get(&ip).is_some()
                {
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
        self.apply_batch(key, addr, std::slice::from_ref(pkt), now)
    }

    /// `apply_packet` for one or more frames from the same source. A single
    /// frame behaves exactly as before 2.1.4, apart from the `MIN_PRESS` hold.
    fn apply_batch(
        &mut self,
        key: &str,
        addr: SocketAddr,
        pkts: &[Packet],
        now: Instant,
    ) -> Replies {
        let mut out = Replies::default();
        let ip = key.to_string();
        if pkts.is_empty() {
            return out;
        }
        // The press hold is for UDP (Wi-Fi / tether). The USB-debugging
        // WebSocket streams every 3 ms over a cable and is left exactly as it was.
        let hold = crate::session::is_udp_key(key);

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
        // Every frame is judged against the baseline from BEFORE this pile. If
        // the baseline moved frame by frame, a press frame that arrived after
        // its own (newer) release would be thrown away as stale.
        let base = sess.last_ts;
        let mut newest: Option<Packet> = None;
        let mut pressed_in_pile: u16 = 0;
        let mut accepted: u64 = 0;
        for p in pkts {
            if !crate::wire::accept_ordering(base, p.ts) {
                continue;
            }
            accepted += 1;
            pressed_in_pile |= p.buttons;
            // Equal timestamps: the later ARRIVAL wins, as it did before 2.1.4.
            newest = Some(match newest {
                Some(n) if n.ts > p.ts => n,
                _ => *p,
            });
        }
        self.packets_stale += pkts.len() as u64 - accepted;
        let Some(newest) = newest else {
            return out;
        };

        // ── Wi-Fi health: how long was this phone silent? ────────────────────
        if hold && !is_new {
            let gap = now.saturating_duration_since(sess.last_seen).as_millis() as u64;
            if gap > 50 {
                self.gaps_50 += 1;
            }
            if gap > 100 {
                self.gaps_100 += 1;
            }
            if gap > 250 {
                self.gaps_250 += 1;
            }
            if gap > self.max_gap_ms {
                self.max_gap_ms = gap;
            }
        }
        sess.last_ts = newest.ts;
        sess.last_seen = now;

        // ── pad write (deduped) ──────────────────────────────────────────────
        let c = if hold {
            let shown = sess.last_report.map(|r| r.buttons).unwrap_or(0);
            // Pressed somewhere in the pile, up in the newest frame, and never
            // shown on the pad: a tap that would otherwise be lost entirely.
            let lost = pressed_in_pile & !newest.buttons & !shown;
            self.merged_presses += lost.count_ones() as u64;
            sess.compose(newest, lost, now)
        } else {
            Composed { pkt: newest, held: 0 }
        };
        self.held_releases += c.held.count_ones() as u64;
        let write = sess.should_write(Report::from_packet(&c.pkt));
        if write {
            self.sink.write(slot, &c.pkt, allow_guide);
            self.pad_writes += 1;
        }
        self.packets_ok += accepted;

        // ── ACK last: the pad IOCTL must not wait on this syscall ────────────
        out.ack = Some(ack_frame(newest.ts));
        out
    }

    /// Anti-stuck + reap. Call ~1 Hz.
    pub fn idle_tick(&mut self, now: Instant) {
        for action in self.sessions.idle_tick(now) {
            match action {
                crate::session::IdleAction::Neutralize { slot, key } => {
                    self.sink.neutralize(slot);
                    self.neutralized += 1;
                    // Used to be silent. 0.5 s without input is exactly the
                    // moment a held throttle drops, so it is worth a line.
                    eprintln!("Controller {key}: no input for 0.5 s -> pad reset to neutral");
                }
                crate::session::IdleAction::Drop { slot, key } => {
                    self.sink.release(slot);
                    eprintln!("Controller session -{key} (active={})", self.sessions.count());
                }
            }
        }

        // Evict GRX state for phones that have been gone a while. Without this
        // the handshake map grows for the whole life of the process — every
        // phone that ever connected keeps its keys and replay window resident.
        //
        // Changed 2026-10-05: the keys are KEPT for GRX_KEEP after the pad
        // session is dropped (3 s of silence), no longer evicted at once. A phone
        // left in recents is frozen by Android; when the player came back, its
        // encrypted frames met a server that had already thrown the keys away,
        // were dropped unanswered, and only a QR rescan recovered. Kept, they
        // decrypt, a pad is created again and play resumes by itself. State for
        // an IP that never held a pad (a lone HELLO) is still evicted at once.
        if !self.grx_sessions.is_empty() {
            let live: std::collections::HashSet<String> = self
                .sessions
                .keys()
                .filter(|k| !k.starts_with("usb:") && *k != "aoa") // UDP keys are IPs
                .cloned()
                .collect();
            for ip in &live {
                if self.grx_sessions.contains_key(ip) {
                    self.grx_seen.insert(ip.clone(), now);
                }
            }
            let seen = &self.grx_seen;
            self.grx_sessions.retain(|ip, _| {
                live.contains(ip)
                    || seen.get(ip).is_some_and(|t| now.saturating_duration_since(*t) < GRX_KEEP)
            });
            let kept = &self.grx_sessions;
            self.grx_seen.retain(|ip, _| kept.contains_key(ip));
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
            gaps_50: self.gaps_50,
            gaps_100: self.gaps_100,
            gaps_250: self.gaps_250,
            max_gap_ms: self.max_gap_ms,
            merged_presses: self.merged_presses,
            held_releases: self.held_releases,
            neutralized: self.neutralized,
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

    // ── 2.1.4: piles, ordering and the minimum press (added 2026-10-05) ──────

    fn frame(ts: u64, buttons: u16, lt: u8) -> Vec<u8> {
        Packet {
            ts,
            buttons,
            lt,
            rt: 0,
            ls_x: 128,
            ls_y: 128,
            rs_x: 128,
            rs_y: 128,
            auth_token: 0xABCD_1234,
        }
        .encode()
        .to_vec()
    }

    fn ms(n: u64) -> std::time::Duration {
        std::time::Duration::from_millis(n)
    }

    /// THE Wi-Fi bug: a tap whose press and release arrive in one pile used to
    /// leave only the release, so the game never saw the press.
    #[test]
    fn tap_inside_one_pile_still_reaches_the_pad() {
        let mut s = server();
        let a = from("192.168.1.55");
        let t0 = Instant::now();
        s.handle_frame(&frame(1, 0, 0), a, t0); // session up, nothing held
        let (p, r) = (frame(10, 0x1000, 0), frame(20, 0, 0));
        let rep = s.handle_batch(&[&p[..], &r[..]], a, t0 + ms(100));
        assert_eq!(s.sink.last.unwrap().buttons, 0x1000, "the press must be written");
        assert_eq!(s.merged_presses, 1);
        assert_eq!(rep.ack.unwrap(), ack_frame(20), "one ACK, for the newest frame");
        assert_eq!(s.next_due(), Some(t0 + ms(100) + crate::session::MIN_PRESS));

        s.flush_due(t0 + ms(110));
        assert_eq!(s.sink.last.unwrap().buttons, 0x1000, "not before 20 ms");
        s.flush_due(t0 + ms(121));
        assert_eq!(s.sink.last.unwrap().buttons, 0, "then the real release");
        assert_eq!(s.next_due(), None);
    }

    /// The newest frame is chosen by timestamp, not by arrival order. Before,
    /// a reordered pile could keep an old frame and drop the new one.
    #[test]
    fn newest_by_timestamp_wins_over_arrival_order() {
        let mut s = server();
        let a = from("192.168.1.55");
        let t0 = Instant::now();
        let (newer, older) = (frame(20, 0x0001, 200), frame(10, 0x0001, 50));
        let rep = s.handle_batch(&[&newer[..], &older[..]], a, t0);
        assert_eq!(s.sink.last.unwrap().lt, 200, "the newest state is applied");
        assert_eq!(rep.ack.unwrap(), ack_frame(20));
        assert_eq!(s.packets_stale, 0, "same-pile frames are not stale");
        // Something older than the pile is still stale afterwards.
        assert!(s.handle_frame(&frame(15, 0, 0), a, t0 + ms(5)).ack.is_none());
    }

    #[test]
    fn equal_timestamps_take_the_later_arrival() {
        let mut s = server();
        let a = from("192.168.1.55");
        let t0 = Instant::now();
        s.handle_frame(&frame(1, 0, 0), a, t0);
        let (p, r) = (frame(10, 0x1000, 0), frame(10, 0, 0));
        s.handle_batch(&[&p[..], &r[..]], a, t0 + ms(100));
        assert_eq!(s.sink.last.unwrap().buttons, 0x1000, "press shown first");
        s.flush_due(t0 + ms(121));
        assert_eq!(s.sink.last.unwrap().buttons, 0, "the later arrival is the state");
    }

    #[test]
    fn release_5ms_after_press_waits_until_20ms() {
        let mut s = server();
        let a = from("192.168.1.55");
        let t0 = Instant::now();
        s.handle_frame(&frame(1, 0x0010, 0), a, t0);
        s.handle_frame(&frame(2, 0, 0), a, t0 + ms(5));
        assert_eq!(s.sink.last.unwrap().buttons, 0x0010, "still held at 5 ms");
        assert_eq!(s.held_releases, 1);
        assert!(s.handle_frame(&frame(3, 0, 0), a, t0 + ms(12)).ack.is_some());
        assert_eq!(s.sink.last.unwrap().buttons, 0x0010, "still held at 12 ms");
        s.flush_due(t0 + ms(20));
        assert_eq!(s.sink.last.unwrap().buttons, 0, "released at 20 ms");
    }

    #[test]
    fn normal_press_length_is_not_delayed() {
        let mut s = server();
        let a = from("192.168.1.55");
        let t0 = Instant::now();
        s.handle_frame(&frame(1, 0x0010, 0), a, t0);
        s.handle_frame(&frame(2, 0, 0), a, t0 + ms(80));
        assert_eq!(s.sink.last.unwrap().buttons, 0, "an 80 ms press releases at once");
        assert_eq!(s.held_releases, 0);
        assert_eq!(s.next_due(), None);
    }

    #[test]
    fn triggers_are_never_delayed() {
        let mut s = server();
        let a = from("192.168.1.55");
        let t0 = Instant::now();
        s.handle_frame(&frame(1, 0, 255), a, t0);
        s.handle_frame(&frame(2, 0, 0), a, t0 + ms(2));
        assert_eq!(s.sink.last.unwrap().lt, 0, "a trigger follows the phone exactly");
        assert_eq!(s.next_due(), None);
    }

    #[test]
    fn other_input_still_flows_while_a_release_is_held() {
        let mut s = server();
        let a = from("192.168.1.55");
        let t0 = Instant::now();
        s.handle_frame(&frame(1, 0x0010, 0), a, t0);
        s.handle_frame(&frame(2, 0, 180), a, t0 + ms(4));
        let last = s.sink.last.unwrap();
        assert_eq!((last.buttons, last.lt), (0x0010, 180), "button held, trigger live");
    }

    #[test]
    fn neutral_reset_cancels_a_held_release() {
        let mut s = server();
        let a = from("192.168.1.55");
        let t0 = Instant::now();
        s.handle_frame(&frame(1, 0x0010, 0), a, t0);
        s.handle_frame(&frame(2, 0, 0), a, t0 + ms(5));
        assert!(s.next_due().is_some());
        s.idle_tick(t0 + ms(800));
        assert_eq!(s.next_due(), None, "nothing may be written after the reset");
        assert_eq!(s.neutralized, 1);
        let writes = s.sink.writes;
        s.flush_due(t0 + ms(900));
        assert_eq!(s.sink.writes, writes);
    }

    #[test]
    fn usb_websocket_path_is_unchanged() {
        let mut s = server();
        let t0 = Instant::now();
        s.handle_ws_frame("usb:1", &frame(1, 0x0010, 0), t0);
        s.handle_ws_frame("usb:1", &frame(2, 0, 0), t0 + ms(1));
        assert_eq!(s.sink.last.unwrap().buttons, 0, "no hold on the cable path");
        assert_eq!(s.next_due(), None);
    }

    #[test]
    fn wifi_gaps_are_counted() {
        let mut s = server();
        let a = from("192.168.1.55");
        let t0 = Instant::now();
        s.handle_frame(&frame(1, 0, 0), a, t0);
        s.handle_frame(&frame(2, 0, 0), a, t0 + ms(30));
        s.handle_frame(&frame(3, 0, 0), a, t0 + ms(150));
        assert_eq!((s.gaps_50, s.gaps_100, s.gaps_250), (1, 1, 0));
        assert_eq!(s.max_gap_ms, 120);
    }

    /// Back from recents: the pad was dropped after 3 s of silence, but the
    /// phone's GRX keys must survive so its encrypted frames still decrypt.
    #[test]
    fn grx_keys_outlive_a_dropped_pad_for_a_while() {
        let mut s = server();
        s.grx_psk = Some([0x11; 32]);
        let a = from("192.168.1.55");
        let t0 = Instant::now();
        let mut hello = vec![crate::grx::T_HELLO];
        hello.extend_from_slice(&[7u8; 32]);
        hello.extend_from_slice(&(crate::grx::GRX_LTID.len() as u32).to_le_bytes());
        hello.extend_from_slice(crate::grx::GRX_LTID);
        s.handle_datagram(&hello, a, t0);
        s.handle_frame(&frame(1, 0, 0), a, t0); // a live pad session
        s.idle_tick(t0 + ms(100));
        assert_eq!(s.grx_session_count(), 1);
        s.idle_tick(t0 + ms(3200)); // pad dropped (3 s of silence)
        assert_eq!(s.sessions.count(), 0);
        assert_eq!(s.grx_session_count(), 1, "keys kept after the pad is dropped");
        s.idle_tick(t0 + GRX_KEEP + ms(5000));
        assert_eq!(s.grx_session_count(), 0, "but not forever");
    }

    /// A phone returning after its pad was dropped may start a FRESH session;
    /// while its pad is live, a HELLO is still ignored (anti-spoof).
    #[test]
    fn hello_replaces_an_established_session_only_when_the_pad_is_gone() {
        let mut s = server();
        s.grx_psk = Some([0x11; 32]);
        let a = from("192.168.1.55");
        let t0 = Instant::now();
        let hello = |b: u8| {
            let mut h = vec![crate::grx::T_HELLO];
            h.extend_from_slice(&[b; 32]);
            h.extend_from_slice(&(crate::grx::GRX_LTID.len() as u32).to_le_bytes());
            h.extend_from_slice(crate::grx::GRX_LTID);
            h
        };
        assert!(s.handle_datagram(&hello(7), a, t0).hs.is_some());
        s.grx_sessions.get_mut("192.168.1.55").unwrap().established = true;
        s.handle_frame(&frame(1, 0, 0), a, t0); // live pad
        assert!(s.handle_datagram(&hello(8), a, t0).hs.is_none(), "live pad: HELLO ignored");
        s.idle_tick(t0 + ms(3200)); // pad dropped, keys kept
        assert!(s.handle_datagram(&hello(9), a, t0 + ms(3300)).hs.is_some(), "pad gone: fresh session");
    }
}
