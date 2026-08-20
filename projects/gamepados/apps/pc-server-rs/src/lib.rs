//! GamepadOS PC server — Rust. **Full replacement for the Python server.**
//!
//! Scope history: this began (2026-07-21) as a UDP-hot-path-only port, with
//! Python keeping WebSocket/AOA/GRX. That is **no longer accurate** — WebSocket
//! (`ws`), GRX encrypted input (`grx`), pairing, QR and the adb-reverse watcher
//! are all implemented and proven against the real Android build. AOA was
//! deliberately **dropped**, not ported: the Python implementation had never
//! moved a packet either (it logs `AOA: no accessory yet`), so there was nothing
//! working to preserve.
//!
//! Adoption status (2026-07-21): proven over several hours of continuous F1
//! gameplay against a real phone — the gate that had been blocking the release.
//! What remains before it can *ship* is packaging, not protocol: see `singleton`
//! for the installer contract.
//!
//! The Python server is preserved, byte-verified, at
//! `releases/archive/pc-server-python-2026-07-21/` — see its `_PRESERVED_README.md`.
//! It stays the documented rollback until the Rust build has real-world soak
//! time beyond this one machine.

pub mod adbreverse;
pub mod grx;
pub mod http;
pub mod net;
pub mod netdetect;
pub mod pairing;
pub mod pktinfo;
pub mod qr;
pub mod session;
pub mod singleton;
pub mod status;
pub mod ticket;
pub mod ui;
#[cfg(windows)]
pub mod vigem;
pub mod winperf;
pub mod wire;
pub mod ws;
