//! Lock-free status bridge from the server loop to the GUI.
//!
//! ## Why this exists instead of the GUI just reading the `Server`
//!
//! The `Server` lives behind a mutex that is taken **on the input path**, once
//! per drained batch. The GUI repaints on a timer and would take that same lock
//! from a second thread — putting a UI redraw in contention with gamepad input.
//! Even a rare stall there is a dropped frame of input, which is exactly the
//! class of jitter this project already spent a session chasing (see
//! `winperf.rs`).
//!
//! So the server *pushes* a few plain atomics and the GUI only ever reads those.
//! Relaxed ordering is correct here: these are independent counters for display,
//! nothing else is ordered against them, and a value one tick stale is
//! invisible to a human.
//!
//! Updated on the server's existing 1 Hz idle tick — **no new work on the hot
//! path**.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

#[derive(Debug, Default)]
pub struct Status {
    /// Phones with a live session (== virtual pads in use).
    devices: AtomicUsize,
    /// Accepted input packets, cumulative.
    packets_ok: AtomicU64,
    /// True once the server loop is actually bound and running, so the GUI can
    /// distinguish "no phone yet" from "the server never came up".
    running: AtomicBool,
}

impl Status {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    // ── written by the server thread ────────────────────────────────────────
    pub fn set_devices(&self, n: usize) {
        self.devices.store(n, Ordering::Relaxed);
    }
    pub fn set_packets_ok(&self, n: u64) {
        self.packets_ok.store(n, Ordering::Relaxed);
    }
    pub fn set_running(&self, v: bool) {
        self.running.store(v, Ordering::Relaxed);
    }

    // ── read by the GUI thread ──────────────────────────────────────────────
    pub fn devices(&self) -> usize {
        self.devices.load(Ordering::Relaxed)
    }
    pub fn packets_ok(&self) -> u64 {
        self.packets_ok.load(Ordering::Relaxed)
    }
    pub fn running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_cross_threads() {
        let s = Status::new();
        let w = Arc::clone(&s);
        std::thread::spawn(move || {
            w.set_running(true);
            w.set_devices(2);
            w.set_packets_ok(99);
        })
        .join()
        .unwrap();
        assert!(s.running());
        assert_eq!(s.devices(), 2);
        assert_eq!(s.packets_ok(), 99);
    }

    #[test]
    fn defaults_read_as_not_running_and_empty() {
        let s = Status::new();
        assert!(!s.running());
        assert_eq!(s.devices(), 0);
    }
}
