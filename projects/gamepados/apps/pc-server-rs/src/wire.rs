//! The GamepadOS wire protocol — the IMMUTABLE contract shared with the phone.
//!
//! This module is pure: no sockets, no driver, no state. Everything here is
//! verified byte-for-byte against golden vectors extracted from the shipped
//! Python server (`tests/conformance.rs` + `tools/gen_golden.py`).
//!
//! ⚠️ HISTORY — READ BEFORE CHANGING ANYTHING HERE:
//! A previous Rust server (`pc-server-rust/`, ~3.1 GB) was DELETED because it
//! invented its own format (HMAC + i16 sticks + 16-char key) and therefore
//! dropped EVERY packet from the phone. The format below is not ours to choose;
//! it is fixed by three files that must agree byte-for-byte:
//!   * `apps/controller-ui/src/app/App.tsx`      (sendGamepadTelemetry)
//!   * `apps/android-client/.../gamepad-engine.cpp` (GamepadPayload struct)
//!   * `apps/pc-server/server.py`                (PAYLOAD_FORMAT)
//! Change one → you must change all three, and regenerate the golden vectors.

/// `<Q H B B B B B B I` little-endian — exactly 20 bytes.
pub const PAYLOAD_SIZE: usize = 20;

/// A backwards timestamp jump larger than this is treated as a phone clock
/// reset (accept) rather than an out-of-order packet (drop). Matches
/// `server.py` `handle_frame`.
pub const CLOCK_RESET_NS: u64 = 1_000_000_000;

/// XInput supports four controllers (`server.py` MAX_PADS).
pub const MAX_PADS: usize = 4;

/// One decoded 20-byte input frame.
///
/// Field order and widths mirror the C++ `GamepadPayload` struct exactly.
/// Stick axes are unsigned bytes with **128 = centre**.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Packet {
    pub ts: u64,
    pub buttons: u16,
    pub lt: u8,
    pub rt: u8,
    pub ls_x: u8,
    pub ls_y: u8,
    pub rs_x: u8,
    pub rs_y: u8,
    pub auth_token: u32,
}

impl Packet {
    /// Decode a datagram. Returns `None` unless it is exactly 20 bytes — the
    /// Python server likewise only unpacks frames of exactly `PAYLOAD_SIZE`.
    pub fn decode(buf: &[u8]) -> Option<Packet> {
        if buf.len() != PAYLOAD_SIZE {
            return None;
        }
        Some(Packet {
            ts: u64::from_le_bytes(buf[0..8].try_into().ok()?),
            buttons: u16::from_le_bytes(buf[8..10].try_into().ok()?),
            lt: buf[10],
            rt: buf[11],
            ls_x: buf[12],
            ls_y: buf[13],
            rs_x: buf[14],
            rs_y: buf[15],
            auth_token: u32::from_le_bytes(buf[16..20].try_into().ok()?),
        })
    }

    /// Re-encode (used by tests and by any future loopback/replay tooling).
    pub fn encode(&self) -> [u8; PAYLOAD_SIZE] {
        let mut b = [0u8; PAYLOAD_SIZE];
        b[0..8].copy_from_slice(&self.ts.to_le_bytes());
        b[8..10].copy_from_slice(&self.buttons.to_le_bytes());
        b[10] = self.lt;
        b[11] = self.rt;
        b[12] = self.ls_x;
        b[13] = self.ls_y;
        b[14] = self.rs_x;
        b[15] = self.rs_y;
        b[16..20].copy_from_slice(&self.auth_token.to_le_bytes());
        b
    }
}

/// Centre-deadzone snap: `|v - 128| <= 4` collapses to exact centre.
/// Python: `_SNAP_LUT = bytes(128 if abs(v - 128) <= 4 else v for v in range(256))`
pub fn snap(v: u8) -> u8 {
    if (v as i16 - 128).abs() <= 4 { 128 } else { v }
}

/// Byte → XInput float axis. `f64` deliberately: Python floats are doubles, and
/// this must reproduce their values bit-for-bit for the conformance vectors.
/// Python: `_AXIS_LUT = tuple(max(-1.0, min(1.0, (b - 128) / 127.0)) ...)`
pub fn axis(v: u8) -> f64 {
    (((v as f64) - 128.0) / 127.0).clamp(-1.0, 1.0)
}

/// The four axis values handed to the virtual pad, after snapping.
///
/// ⚠️ The **Y axes are negated** — `server.py` calls
/// `left_joystick_float(y_value_float=-_AXIS_LUT[ls_y])`. Getting this wrong
/// inverts every stick in every game, so it is encoded here once and tested.
pub fn pad_axes(p: &Packet) -> PadAxes {
    PadAxes {
        left_x: axis(snap(p.ls_x)),
        left_y: -axis(snap(p.ls_y)),
        right_x: axis(snap(p.rs_x)),
        right_y: -axis(snap(p.rs_y)),
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PadAxes {
    pub left_x: f64,
    pub left_y: f64,
    pub right_x: f64,
    pub right_y: f64,
}

/// One stick byte → the XInput `i16` the virtual pad receives.
///
/// Mirrors vgamepad: `left_joystick(round(x_value_float * 32767))`, fed by
/// `pad_axes` (so snapping and the Y negation are already applied upstream).
///
/// ⚠️ Python's `round()` is banker's rounding (half-to-even); Rust's is
/// half-away-from-zero. They differ only on an exact `.5`, which cannot occur
/// here: the value is `258*(b-128) + (b-128)/127`, and with 127 being odd the
/// fractional part `k/127` is never exactly one half. Verified for all 256
/// inputs against Python-generated vectors in `tests/conformance.rs`.
pub fn thumb_i16(axis_value: f64) -> i16 {
    (axis_value * 32767.0).round().clamp(-32768.0, 32767.0) as i16
}

/// Triggers are passed to the pad as RAW BYTES — `server.py` calls
/// `left_trigger(value=lt)` with the wire byte untouched. This exists only to
/// make that explicit, so nobody "helpfully" adds a conversion.
pub fn trigger_u8(v: u8) -> u8 {
    v
}

/// `"ACK"` + the echoed 8-byte send-timestamp. The phone subtracts this from
/// its own clock to display true round-trip latency, so the timestamp must be
/// echoed back **unmodified**.
pub fn ack_frame(ts: u64) -> [u8; 11] {
    let mut b = [0u8; 11];
    b[0..3].copy_from_slice(b"ACK");
    b[3..11].copy_from_slice(&ts.to_le_bytes());
    b
}

/// `"RMB"` + large (low-frequency) + small (high-frequency) motor, 0..255.
pub fn rmb_frame(large: u8, small: u8) -> [u8; 5] {
    [b'R', b'M', b'B', large, small]
}

/// Per-session ordering guard. Drops genuinely stale frames but accepts a large
/// backwards jump as a phone clock reset. Equal timestamps are NOT stale.
pub fn accept_ordering(last_ts: u64, ts: u64) -> bool {
    if ts < last_ts {
        last_ts - ts > CLOCK_RESET_NS
    } else {
        true
    }
}

/// Cleartext auth policy (GRX frames skip this — GCM already authenticates).
/// A matching token is always accepted (QR pairing). Token 0 is accepted ONLY
/// from an off-LAN or USB-tether client, which is how keyless USB pairing works.
pub fn accept_auth(token: u32, expected: u32, offlan_or_tether: bool) -> bool {
    token == expected || (token == 0 && offlan_or_tether)
}

/// Button bit → XInput button name, in the same order `apply_inputs` presses
/// them. Bit 14 (Guide) is gated per-session by `allow_guide` at the call site.
pub const BUTTON_MAP: [(u8, &str); 15] = [
    (0, "A"),
    (1, "B"),
    (2, "X"),
    (3, "Y"),
    (4, "LEFT_SHOULDER"),
    (5, "RIGHT_SHOULDER"),
    (6, "START"),
    (7, "BACK"),
    (8, "LEFT_THUMB"),
    (9, "RIGHT_THUMB"),
    (10, "DPAD_UP"),
    (11, "DPAD_DOWN"),
    (12, "DPAD_LEFT"),
    (13, "DPAD_RIGHT"),
    (14, "GUIDE"),
];

/// Names of every button set in `mask`, in bit order.
pub fn buttons_pressed(mask: u16) -> Vec<&'static str> {
    BUTTON_MAP
        .iter()
        .filter(|(bit, _)| mask & (1u16 << bit) != 0)
        .map(|(_, name)| *name)
        .collect()
}
