//! Session / virtual-pad lifecycle — one pad per source IP.
//!
//! Pure logic: no sockets, no ViGEm, no clock of its own (callers pass `now`),
//! so every rule below is unit-testable. Behaviour mirrors `server.py`'s
//! `PadManager` + `idle_tick` exactly; the numbers are not arbitrary:
//!
//!   * **> 0.5 s quiet** → reset that pad to neutral once (anti-stuck). Without
//!     this a dropped connection leaves the last input latched — e.g. a held
//!     throttle keeps the car accelerating forever.
//!   * **> 3.0 s quiet** → drop the session and free the pad, so the controller
//!     actually disappears from Windows on disconnect.
//!   * **MAX_PADS (4)** is an XInput hard limit. When full, `acquire` returns
//!     `None` and the caller must **not** ACK — a 5th device has to look
//!     unconnected rather than silently drive nothing.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

use crate::wire::{Packet, MAX_PADS};

/// Quiet for longer than this → reset the pad to neutral (once).
pub const NEUTRAL_AFTER: Duration = Duration::from_millis(500);
/// Quiet for longer than this → drop the session entirely.
pub const DROP_AFTER: Duration = Duration::from_secs(3);

/// Transport-switch migration window. A phone actively playing pings every
/// ~16 ms, so a gap in this band means "it moved", not "it's mid-game".
pub const MIGRATE_MIN_QUIET: Duration = Duration::from_millis(500);
pub const MIGRATE_MAX_QUIET: Duration = Duration::from_millis(3500);

/// UDP sessions are keyed by IP. WebSocket ("usb:N") and AOA sessions are not,
/// and must NEVER migrate — a WS session sits legitimately idle on the dashboard,
/// so stealing its pad would let two transports drive one controller.
fn is_udp_key(k: &str) -> bool {
    !k.starts_with("usb:") && k != "aoa"
}

/// `/24` of an IP-style key.
fn key_subnet(k: &str) -> &str {
    k.rsplit_once('.').map(|(h, _)| h).unwrap_or(k)
}

/// The subset of a packet that actually reaches the driver. Used as the dedup
/// baseline: an identical report is skipped so we never issue a needless IOCTL.
/// Note it excludes `ts` and `auth_token` — those don't affect pad state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Report {
    pub buttons: u16,
    pub lt: u8,
    pub rt: u8,
    pub ls_x: u8,
    pub ls_y: u8,
    pub rs_x: u8,
    pub rs_y: u8,
}

impl Report {
    pub fn from_packet(p: &Packet) -> Report {
        Report {
            buttons: p.buttons,
            lt: p.lt,
            rt: p.rt,
            ls_x: p.ls_x,
            ls_y: p.ls_y,
            rs_x: p.rs_x,
            rs_y: p.rs_y,
        }
    }
}

#[derive(Debug)]
pub struct Session {
    /// Source IP string — the identity of one phone.
    pub key: String,
    /// XInput slot 0..MAX_PADS. Lowest free slot wins so player 1 stays player 1.
    pub slot: usize,
    /// Where to send ACK/RMB replies.
    pub addr: SocketAddr,
    pub last_ts: u64,
    pub last_seen: Instant,
    pub last_report: Option<Report>,
    pub last_rmb_sent: (u8, u8),
    /// Latest force-feedback values received from the game for this pad.
    pub rumble: (u8, u8),
    pub is_neutral: bool,
    /// Per-session escape hatch for the Guide button (bit 14).
    pub allow_guide: bool,
}

impl Session {
    /// Ordering guard + bookkeeping. Returns `false` if the frame is stale and
    /// must be dropped **without** ACKing (matches `server.py handle_frame`).
    pub fn accept_ts(&mut self, ts: u64) -> bool {
        if !crate::wire::accept_ordering(self.last_ts, ts) {
            return false;
        }
        self.last_ts = ts;
        true
    }

    /// Dedup gate: `true` when this report differs and must be written to the
    /// driver. Updates the baseline and clears the neutral flag.
    pub fn should_write(&mut self, r: Report) -> bool {
        self.is_neutral = false;
        if self.last_report == Some(r) {
            return false;
        }
        self.last_report = Some(r);
        true
    }

    /// Whether to emit an RMB frame this packet, per `server.py`: send while
    /// either motor is non-zero, plus one final zero frame to stop the motor.
    pub fn should_send_rmb(&mut self) -> Option<(u8, u8)> {
        let (l, s) = self.rumble;
        if (l != 0 || s != 0) || self.last_rmb_sent != (0, 0) {
            self.last_rmb_sent = (l, s);
            Some((l, s))
        } else {
            None
        }
    }

    /// Clear dedup + mark neutral (used by the anti-stuck reset).
    pub fn mark_neutral(&mut self) {
        self.last_report = None;
        self.is_neutral = true;
    }
}

/// What the caller must do to the physical/virtual pad after an idle tick.
#[derive(Debug, PartialEq, Eq)]
pub enum IdleAction {
    /// Reset this slot's pad to neutral (session stays alive).
    Neutralize { slot: usize, key: String },
    /// Free this slot's pad and forget the session.
    Drop { slot: usize, key: String },
}

#[derive(Debug, Default)]
pub struct SessionManager {
    sessions: HashMap<String, Session>,
    used: [bool; MAX_PADS],
    /// True when the most recent `acquire` REBOUND an existing session (a
    /// transport switch) rather than creating one. The caller reads this so a
    /// migration isn't logged as a brand-new session — these logs are the
    /// primary diagnostic for double-pad bugs, so they have to be honest.
    pub migrated_last: bool,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            used: [false; MAX_PADS],
            migrated_last: false,
        }
    }

    pub fn count(&self) -> usize {
        self.sessions.len()
    }

    /// Sessions on the UDP transport only (keys that are IPs, not `usb:N`).
    ///
    /// Exists for the status window's device count, which is
    /// `udp_count() + ws::live_links()`: a wired phone is represented by its
    /// standing WebSocket connection whether or not it currently has a session,
    /// so counting WS *sessions* here as well would count that phone twice.
    pub fn udp_count(&self) -> usize {
        self.sessions.keys().filter(|k| is_udp_key(k)).count()
    }

    pub fn get(&self, key: &str) -> Option<&Session> {
        self.sessions.get(key)
    }

    pub fn get_mut(&mut self, key: &str) -> Option<&mut Session> {
        self.sessions.get_mut(key)
    }

    /// Live session keys (IPs for UDP, `usb:N` for WebSocket).
    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.sessions.keys()
    }

    /// Get the existing session for this source, or create one if a pad slot is
    /// free. Returns `None` at the MAX_PADS limit — caller must not ACK.
    pub fn acquire(&mut self, key: &str, addr: SocketAddr, now: Instant) -> Option<&mut Session> {
        self.migrated_last = false;
        if self.sessions.contains_key(key) {
            let s = self.sessions.get_mut(key)?;
            s.addr = addr; // phone may change source port across reconnects
            return Some(s);
        }
        // The SAME phone may have just hopped Wi-Fi <-> USB tether, which gives
        // it a new source IP. Rebind rather than allocate, so it keeps its pad.
        if self.try_migrate(key, now) {
            let s = self.sessions.get_mut(key)?;
            s.addr = addr;
            return Some(s);
        }
        let slot = self.used.iter().position(|u| !u)?; // None => all 4 in use
        self.used[slot] = true;
        self.sessions.insert(
            key.to_string(),
            Session {
                key: key.to_string(),
                slot,
                addr,
                last_ts: 0,
                last_seen: now,
                last_report: None,
                last_rmb_sent: (0, 0),
                rumble: (0, 0),
                is_neutral: true,
                allow_guide: true,
            },
        );
        self.sessions.get_mut(key)
    }

    /// Single-phone transport migration (Wi-Fi ↔ USB tether).
    ///
    /// The same phone reappears from a new source IP while its old session has
    /// just gone quiet. Rebinding that session keeps its **ViGEm pad and
    /// therefore its XInput slot**. Without this, the switch creates pad 2 while
    /// the old pad lingers, and the new pad is parked as player 2 — games only
    /// listen to player 1, which is exactly the "buttons work on wireless but
    /// not wired" symptom.
    ///
    /// Every guard below is required; each one prevents stealing a pad from a
    /// device that is legitimately using it:
    /// * incoming key is UDP — WS/AOA never migrate
    /// * exactly ONE existing session, and it is UDP (a second device present ⇒
    ///   a newcomer always gets its own fresh pad, no stealing, no overlap)
    /// * a DIFFERENT `/24` — same subnet means two phones on one router
    /// * the lone session went quiet 0.5-3.5 s ago — an actively-playing phone
    ///   pings every ~16 ms, so this band means "switched", not "still playing"
    fn try_migrate(&mut self, new_key: &str, now: Instant) -> bool {
        if !is_udp_key(new_key) || self.sessions.len() != 1 {
            return false;
        }
        let Some(old_key) = self.sessions.keys().next().cloned() else {
            return false;
        };
        if !is_udp_key(&old_key) || key_subnet(&old_key) == key_subnet(new_key) {
            return false;
        }
        let quiet = now.saturating_duration_since(self.sessions[&old_key].last_seen);
        if quiet <= MIGRATE_MIN_QUIET || quiet >= MIGRATE_MAX_QUIET {
            return false;
        }
        let Some(mut s) = self.sessions.remove(&old_key) else {
            return false;
        };
        s.key = new_key.to_string();
        s.last_ts = 0; // new stream -> new ordering base (different clock)
        s.last_report = None; // force the first report through the dedup gate
        s.last_seen = now;
        self.sessions.insert(new_key.to_string(), s);
        self.migrated_last = true;
        println!("Controller session {old_key} -> {new_key} (single-device transport switch; pad + XInput slot kept)");
        true
    }

    /// Drop a session immediately (freeing its slot), e.g. on explicit teardown.
    pub fn remove(&mut self, key: &str) -> Option<Session> {
        let s = self.sessions.remove(key)?;
        self.used[s.slot] = false;
        Some(s)
    }

    /// Anti-stuck neutralise + reap. Call ~1 Hz. Returns the pad actions to
    /// perform; dropped sessions are already removed from the manager.
    pub fn idle_tick(&mut self, now: Instant) -> Vec<IdleAction> {
        let mut actions = Vec::new();
        let mut to_drop = Vec::new();

        for (key, s) in self.sessions.iter_mut() {
            let gap = now.saturating_duration_since(s.last_seen);
            if gap > DROP_AFTER {
                to_drop.push(key.clone());
            } else if gap > NEUTRAL_AFTER && !s.is_neutral {
                s.mark_neutral();
                actions.push(IdleAction::Neutralize {
                    slot: s.slot,
                    key: key.clone(),
                });
            }
        }
        for key in to_drop {
            if let Some(s) = self.sessions.remove(&key) {
                self.used[s.slot] = false;
                actions.push(IdleAction::Drop { slot: s.slot, key });
            }
        }
        actions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(n: u8) -> SocketAddr {
        format!("10.0.0.{n}:5000").parse().unwrap()
    }

    /// The status window's device count uses `udp_count() + ws::live_links()`.
    /// This pins the udp_count half: WS-transport sessions (usb:N) must be
    /// EXCLUDED here, because a wired phone is already counted by its standing
    /// link — including its session too would double-count it.
    #[test]
    fn udp_count_excludes_ws_transport_sessions() {
        let mut t = SessionManager::new();
        let now = Instant::now();
        assert!(t.acquire("10.0.0.1", addr(1), now).is_some());
        assert!(t.acquire("usb:1", addr(2), now).is_some());
        assert_eq!(t.count(), 2, "both sessions exist");
        assert_eq!(t.udp_count(), 1, "but only the IP-keyed one is UDP");
    }

    #[test]
    fn one_pad_per_source_and_slot_is_stable() {
        let mut m = SessionManager::new();
        let t = Instant::now();
        let slot_a = m.acquire("10.0.0.1", addr(1), t).unwrap().slot;
        let slot_again = m.acquire("10.0.0.1", addr(1), t).unwrap().slot;
        assert_eq!(slot_a, slot_again, "same IP must reuse its pad");
        assert_eq!(m.count(), 1, "same IP must not create a second session");

        let slot_b = m.acquire("10.0.0.2", addr(2), t).unwrap().slot;
        assert_ne!(slot_a, slot_b);
        assert_eq!(m.count(), 2);
    }

    #[test]
    fn enforces_max_pads_and_reuses_freed_slot() {
        let mut m = SessionManager::new();
        let t = Instant::now();
        for i in 0..MAX_PADS {
            assert!(
                m.acquire(&format!("10.0.0.{i}"), addr(i as u8), t).is_some(),
                "pad {i} should fit"
            );
        }
        // 5th device: no pad, caller must not ACK.
        assert!(m.acquire("10.0.0.99", addr(99), t).is_none());
        assert_eq!(m.count(), MAX_PADS);

        let freed = m.remove("10.0.0.2").unwrap().slot;
        let reused = m.acquire("10.0.0.99", addr(99), t).unwrap().slot;
        assert_eq!(freed, reused, "freed slot should be reused");
    }

    #[test]
    fn acquire_updates_addr_on_reconnect() {
        let mut m = SessionManager::new();
        let t = Instant::now();
        m.acquire("10.0.0.1", addr(1), t).unwrap();
        let new: SocketAddr = "10.0.0.1:60001".parse().unwrap();
        let s = m.acquire("10.0.0.1", new, t).unwrap();
        assert_eq!(s.addr, new, "reply addr must follow the phone's new source port");
    }

    #[test]
    fn idle_neutralizes_once_then_drops() {
        let mut m = SessionManager::new();
        let t0 = Instant::now();
        {
            let s = m.acquire("10.0.0.1", addr(1), t0).unwrap();
            s.should_write(Report { buttons: 1, lt: 0, rt: 0, ls_x: 128, ls_y: 128, rs_x: 128, rs_y: 128 });
            assert!(!s.is_neutral);
        }
        // still fresh -> nothing
        assert!(m.idle_tick(t0 + Duration::from_millis(200)).is_empty());

        // past 0.5s -> neutralize once
        let a = m.idle_tick(t0 + Duration::from_millis(800));
        assert_eq!(a.len(), 1);
        assert!(matches!(a[0], IdleAction::Neutralize { .. }));

        // still quiet but already neutral -> no repeat
        assert!(m.idle_tick(t0 + Duration::from_millis(900)).is_empty());

        // past 3s -> drop, slot freed
        let a = m.idle_tick(t0 + Duration::from_millis(3100));
        assert_eq!(a.len(), 1);
        assert!(matches!(a[0], IdleAction::Drop { .. }));
        assert_eq!(m.count(), 0);
    }

    /// The happy path: one phone hops Wi-Fi -> USB tether and KEEPS its pad,
    /// so it stays player 1 instead of being parked as player 2.
    #[test]
    fn single_phone_transport_switch_keeps_its_pad() {
        let mut m = SessionManager::new();
        let t0 = Instant::now();
        let slot = m.acquire("192.168.1.55", addr(1), t0).unwrap().slot;
        m.get_mut("192.168.1.55").unwrap().last_ts = 9999;

        // Phone reappears on the tether subnet after a ~1s switch gap.
        let t1 = t0 + Duration::from_millis(1000);
        let s = m.acquire("10.66.39.130", addr(2), t1).unwrap();
        assert_eq!(s.slot, slot, "must KEEP the same pad/XInput slot");
        assert_eq!(s.last_ts, 0, "new stream needs a fresh ordering base");
        assert!(s.last_report.is_none(), "dedup baseline must be cleared");
        assert_eq!(m.count(), 1, "must rebind, not create a second session");
    }

    #[test]
    fn migration_refuses_when_a_second_device_is_present() {
        let mut m = SessionManager::new();
        let t0 = Instant::now();
        m.acquire("192.168.1.55", addr(1), t0).unwrap();
        m.acquire("192.168.1.56", addr(2), t0).unwrap();
        let t1 = t0 + Duration::from_millis(1000);
        m.acquire("10.66.39.130", addr(3), t1).unwrap();
        assert_eq!(m.count(), 3, "with 2 devices present a newcomer gets its OWN pad");
    }

    #[test]
    fn migration_refuses_same_subnet_two_phones_on_one_router() {
        let mut m = SessionManager::new();
        let t0 = Instant::now();
        m.acquire("192.168.1.55", addr(1), t0).unwrap();
        let t1 = t0 + Duration::from_millis(1000);
        m.acquire("192.168.1.77", addr(2), t1).unwrap();
        assert_eq!(m.count(), 2, "same /24 = a second phone, never a transport switch");
    }

    #[test]
    fn migration_refuses_while_the_phone_is_still_playing() {
        let mut m = SessionManager::new();
        let t0 = Instant::now();
        m.acquire("192.168.1.55", addr(1), t0).unwrap();
        // Only 100ms quiet — an active phone pings every ~16ms, so this is NOT a switch.
        let t1 = t0 + Duration::from_millis(100);
        m.acquire("10.66.39.130", addr(2), t1).unwrap();
        assert_eq!(m.count(), 2, "an actively-playing session must not be stolen");
    }

    #[test]
    fn migration_refuses_after_the_window_closes() {
        let mut m = SessionManager::new();
        let t0 = Instant::now();
        m.acquire("192.168.1.55", addr(1), t0).unwrap();
        let t1 = t0 + Duration::from_millis(4000); // past 3.5s
        m.acquire("10.66.39.130", addr(2), t1).unwrap();
        assert_eq!(m.count(), 2, "too late to be a switch — allocate fresh");
    }

    /// A WebSocket session sits idle on the dashboard legitimately; stealing its
    /// pad would let two transports drive one controller.
    #[test]
    fn websocket_sessions_never_migrate() {
        let mut m = SessionManager::new();
        let t0 = Instant::now();
        m.acquire("usb:1", addr(1), t0).unwrap();
        let t1 = t0 + Duration::from_millis(1000);
        m.acquire("10.66.39.130", addr(2), t1).unwrap();
        assert_eq!(m.count(), 2, "a WS session must never be migrated away");

        // ...and a WS newcomer must never steal a UDP session either.
        let mut m2 = SessionManager::new();
        m2.acquire("192.168.1.55", addr(1), t0).unwrap();
        m2.acquire("usb:9", addr(2), t1).unwrap();
        assert_eq!(m2.count(), 2, "a WS newcomer must not migrate a UDP session");
    }

    #[test]
    fn dedup_skips_identical_reports() {
        let mut m = SessionManager::new();
        let t = Instant::now();
        let s = m.acquire("10.0.0.1", addr(1), t).unwrap();
        let r = Report { buttons: 5, lt: 10, rt: 0, ls_x: 128, ls_y: 200, rs_x: 128, rs_y: 128 };
        assert!(s.should_write(r), "first report must be written");
        assert!(!s.should_write(r), "identical report must be skipped");
        let r2 = Report { buttons: 7, ..r };
        assert!(s.should_write(r2), "changed report must be written");
    }

    #[test]
    fn stale_frames_rejected_clock_reset_accepted() {
        let mut m = SessionManager::new();
        let t = Instant::now();
        let s = m.acquire("10.0.0.1", addr(1), t).unwrap();
        assert!(s.accept_ts(1000));
        assert!(s.accept_ts(1000), "equal timestamp is not stale");
        assert!(!s.accept_ts(999), "older frame must be dropped");
        assert_eq!(s.last_ts, 1000, "stale frame must not move the baseline");
        assert!(s.accept_ts(1001));
        // A backwards jump LARGER than CLOCK_RESET_NS is a phone clock reset,
        // not a stale packet, so it must be accepted and become the new baseline.
        assert!(s.accept_ts(5_000_000_000));
        assert!(
            s.accept_ts(5_000_000_000 - crate::wire::CLOCK_RESET_NS - 1),
            "backwards jump > 1e9 must be treated as a clock reset"
        );
        assert_eq!(s.last_ts, 5_000_000_000 - crate::wire::CLOCK_RESET_NS - 1);
        // ...but a jump of exactly CLOCK_RESET_NS is still just a stale frame.
        let base = s.last_ts;
        assert!(!s.accept_ts(base - crate::wire::CLOCK_RESET_NS));
    }

    #[test]
    fn rmb_sends_while_active_then_one_final_zero() {
        let mut m = SessionManager::new();
        let t = Instant::now();
        let s = m.acquire("10.0.0.1", addr(1), t).unwrap();
        assert_eq!(s.should_send_rmb(), None, "idle motors send nothing");

        s.rumble = (200, 50);
        assert_eq!(s.should_send_rmb(), Some((200, 50)));
        assert_eq!(s.should_send_rmb(), Some((200, 50)), "sustains while active");

        s.rumble = (0, 0);
        assert_eq!(s.should_send_rmb(), Some((0, 0)), "one final zero to stop");
        assert_eq!(s.should_send_rmb(), None, "then silence");
    }
}
