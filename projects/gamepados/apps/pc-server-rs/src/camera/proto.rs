//! CamOS stream protocol v1 — the bytes on TCP :7780. Pure code, unit-tested.
//!
//! ```text
//! server → phone   "CAMS" ver:u8 nonce:[16]                                 (21 bytes)
//! phone  → server  "CAMC" ver:u8 w:u16 h:u16 fps:u8 flags:u8 name_len:u8 tag:[16] name (28 + name_len)
//!                  flags bit 0 = "check only": prove the key, get the answer, stream nothing (the phone's
//!                  "is my PC ready?" check right after pairing)
//! server → phone   "CAMA" status:u8                                         (5 bytes)
//! phone  → server  repeated: len:u32 pts_us:u64 flags:u8 payload[len]       (H.264 Annex-B)
//! server → phone   'K' at any time = "please send a key frame"
//! server → phone   'C' len:u16 json[len]   a request from the PC window ("zoom 2x", "flashlight on")
//! phone  → server  a frame with flags & FLAG_STATE: payload is the phone's state as JSON (what is set,
//!                  what this phone/plan allows) instead of video
//! ```
//!
//! **Finding the PC** (UDP :7780, broadcast). The phone asks "where is my PC?":
//! ```text
//! phone  → broadcast  "CAMD" ver:u8 nonce:[16] tag:[16]      tag = HMAC(key, "CAMD" ‖ nonce)[..16]
//! server → phone      "CAMR" ver:u8 nonce:[16] port:u16 name_len:u8 name   (only if the tag proves the key —
//!                     or, with an all-zero tag, only to a phone on the USB cable, which needs no key)
//! ```
//! It finds the PC on a USB-tether cable, and on Wi-Fi after the PC's address changed.
//!
//! **Who decides.** The phone. The PC only *asks*; the phone applies a request only if its own plan allows it
//! (Premium, the 45-minute HD unlock), then reports back what is really set. The watermark and the HD limit are
//! applied on the phone before the picture is encoded, so a modified PC server cannot unlock or remove anything.
//! All integers big-endian (what Java's DataOutputStream writes).
//!
//! **Why a challenge instead of sending the key** (GamepadOS input puts the key
//! in every packet): the server sends 16 fresh random bytes, and the phone proves
//! it knows the pairing key by returning HMAC-SHA256(key, nonce ‖ its hello)
//! — a fingerprint that only someone holding the key can produce, and that is
//! useless for the next connection. Someone watching the Wi-Fi never sees the key.

use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;

pub const VERSION: u8 = 1;
pub const SERVER_HELLO_LEN: usize = 21;
pub const CLIENT_HELLO_FIXED: usize = 28;
pub const FRAME_HEADER_LEN: usize = 13;
/// Largest single H.264 frame we accept (a 1080p key frame is ~100–400 KB).
pub const MAX_FRAME: usize = 4 * 1024 * 1024;

pub const FLAG_CONFIG: u8 = 1;
pub const FLAG_KEY: u8 = 2;
/// The frame carries the phone's state (JSON), not video.
pub const FLAG_STATE: u8 = 8;
/// Largest state or request message accepted (they are a few hundred bytes).
pub const MAX_STATE: usize = 16 * 1024;
/// Server → phone request marker.
pub const REMOTE_COMMAND: u8 = b'C';

pub const STATUS_OK: u8 = 0;
pub const STATUS_BAD_KEY: u8 = 1;
pub const STATUS_BUSY: u8 = 2;
pub const STATUS_BAD_REQUEST: u8 = 3;

pub const REQUEST_KEYFRAME: u8 = b'K';

pub fn server_hello(nonce: &[u8; 16]) -> [u8; SERVER_HELLO_LEN] {
    let mut b = [0u8; SERVER_HELLO_LEN];
    b[0..4].copy_from_slice(b"CAMS");
    b[4] = VERSION;
    b[5..21].copy_from_slice(nonce);
    b
}

pub fn server_ack(status: u8) -> [u8; 5] {
    [b'C', b'A', b'M', b'A', status]
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClientHello {
    pub width: u16,
    pub height: u16,
    pub fps: u8,
    pub name: String,
    /// The phone only wants to know whether this PC is ready (flags bit 0); no video follows.
    pub check: bool,
}

/// The fingerprint the phone must send. `fixed` is the 28-byte header with the
/// tag bytes (12..28) ignored, so both sides hash exactly the same bytes.
pub fn tag(key: &str, nonce: &[u8; 16], fixed: &[u8], name: &[u8]) -> [u8; 16] {
    let mut mac = <Hmac<Sha256>>::new_from_slice(key.as_bytes()).expect("HMAC takes any key length");
    mac.update(nonce);
    mac.update(&fixed[0..12]);
    mac.update(name);
    let out = mac.finalize().into_bytes();
    let mut t = [0u8; 16];
    t.copy_from_slice(&out[..16]);
    t
}

/// Name length from the fixed header, so the caller knows how much more to read.
pub fn name_len(fixed: &[u8; CLIENT_HELLO_FIXED]) -> usize {
    fixed[11] as usize
}

// ── finding the PC ───────────────────────────────────────────────────────────────────────────────────────────

pub const DISCOVER_LEN: usize = 37;

fn discover_tag(key: &str, nonce: &[u8; 16]) -> [u8; 16] {
    let mut mac = <Hmac<Sha256>>::new_from_slice(key.as_bytes()).expect("HMAC takes any key length");
    mac.update(b"CAMD");
    mac.update(nonce);
    let out = mac.finalize().into_bytes();
    let mut t = [0u8; 16];
    t.copy_from_slice(&out[..16]);
    t
}

/// The phone's "where is my PC?" (also used by tests and the test phone). `None` key = USB cable, no key.
pub fn build_discover(key: Option<&str>, nonce: &[u8; 16]) -> [u8; DISCOVER_LEN] {
    let mut b = [0u8; DISCOVER_LEN];
    b[0..4].copy_from_slice(b"CAMD");
    b[4] = VERSION;
    b[5..21].copy_from_slice(nonce);
    if let Some(k) = key {
        b[21..37].copy_from_slice(&discover_tag(k, nonce));
    }
    b
}

/// What a "where is my PC?" packet proves.
#[derive(Debug, PartialEq)]
pub enum Discover {
    /// Proves the pairing key: answer from anywhere on the network.
    Keyed([u8; 16]),
    /// No key (all-zero tag): answer only a phone on the USB cable.
    Keyless([u8; 16]),
}

pub fn check_discover(key: &str, pkt: &[u8]) -> Option<Discover> {
    if pkt.len() != DISCOVER_LEN || &pkt[0..4] != b"CAMD" || pkt[4] != VERSION {
        return None;
    }
    let nonce: [u8; 16] = pkt[5..21].try_into().ok()?;
    let tag = &pkt[21..37];
    if tag.iter().all(|&b| b == 0) {
        return Some(Discover::Keyless(nonce));
    }
    if bool::from(discover_tag(key, &nonce).ct_eq(tag)) { Some(Discover::Keyed(nonce)) } else { None }
}

/// The PC's answer: the nonce back (so the phone knows it is a reply to its own question), the TCP port, a name.
pub fn build_discover_reply(nonce: &[u8; 16], port: u16, name: &str) -> Vec<u8> {
    let n: Vec<u8> = name.bytes().take(40).collect();
    let mut v = Vec::with_capacity(24 + n.len());
    v.extend_from_slice(b"CAMR");
    v.push(VERSION);
    v.extend_from_slice(nonce);
    v.extend_from_slice(&port.to_be_bytes());
    v.push(n.len() as u8);
    v.extend_from_slice(&n);
    v
}

/// Check the phone's hello. `Err(status)` is what to send back.
///
/// `trusted` = the phone is on the USB cable (adb tunnel or USB tether): like GamepadOS, no key is needed there,
/// so the fingerprint is not checked (the hello must still be well formed).
pub fn verify_client_hello_from(
    key: &str,
    nonce: &[u8; 16],
    fixed: &[u8; CLIENT_HELLO_FIXED],
    name: &[u8],
    trusted: bool,
) -> Result<ClientHello, u8> {
    if trusted {
        return verify_client_hello("", nonce, &with_tag(fixed, &tag("", nonce, fixed, name)), name);
    }
    verify_client_hello(key, nonce, fixed, name)
}

fn with_tag(fixed: &[u8; CLIENT_HELLO_FIXED], t: &[u8; 16]) -> [u8; CLIENT_HELLO_FIXED] {
    let mut f = *fixed;
    f[12..28].copy_from_slice(t);
    f
}

/// Check the phone's hello. `Err(status)` is what to send back.
pub fn verify_client_hello(
    key: &str,
    nonce: &[u8; 16],
    fixed: &[u8; CLIENT_HELLO_FIXED],
    name: &[u8],
) -> Result<ClientHello, u8> {
    if &fixed[0..4] != b"CAMC" || fixed[4] != VERSION || name.len() != name_len(fixed) {
        return Err(STATUS_BAD_REQUEST);
    }
    let want = tag(key, nonce, fixed, name);
    if !bool::from(want.ct_eq(&fixed[12..28])) {
        return Err(STATUS_BAD_KEY);
    }
    let width = u16::from_be_bytes([fixed[5], fixed[6]]);
    let height = u16::from_be_bytes([fixed[7], fixed[8]]);
    let fps = fixed[9];
    if !(160..=3840).contains(&width) || !(120..=2160).contains(&height) || width % 2 != 0 || height % 2 != 0 || fps == 0 {
        return Err(STATUS_BAD_REQUEST);
    }
    let name: String = String::from_utf8_lossy(name).chars().filter(|c| !c.is_control()).take(40).collect();
    Ok(ClientHello { width, height, fps, name, check: fixed[10] & 1 != 0 })
}

#[derive(Debug, PartialEq)]
pub struct FrameHeader {
    pub len: usize,
    pub pts_us: u64,
    pub flags: u8,
}

pub fn parse_frame_header(b: &[u8; FRAME_HEADER_LEN]) -> Result<FrameHeader, String> {
    let len = u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize;
    if len == 0 || len > MAX_FRAME {
        return Err(format!("frame length {len} out of range"));
    }
    let pts_us = u64::from_be_bytes(b[4..12].try_into().expect("8 bytes"));
    Ok(FrameHeader { len, pts_us, flags: b[12] })
}

/// A request from the PC window to the phone: 'C' + length + JSON. None if the JSON is too big to send.
pub fn remote_command(json: &str) -> Option<Vec<u8>> {
    let b = json.as_bytes();
    if b.is_empty() || b.len() > MAX_STATE || b.len() > u16::MAX as usize {
        return None;
    }
    let mut v = Vec::with_capacity(3 + b.len());
    v.push(REMOTE_COMMAND);
    v.extend_from_slice(&(b.len() as u16).to_be_bytes());
    v.extend_from_slice(b);
    Some(v)
}

/// Build a client hello — used by tests and by the desktop test sender.
pub fn build_client_hello(key: &str, nonce: &[u8; 16], h: &ClientHello) -> Vec<u8> {
    let name = h.name.as_bytes();
    let mut fixed = [0u8; CLIENT_HELLO_FIXED];
    fixed[0..4].copy_from_slice(b"CAMC");
    fixed[4] = VERSION;
    fixed[5..7].copy_from_slice(&h.width.to_be_bytes());
    fixed[7..9].copy_from_slice(&h.height.to_be_bytes());
    fixed[9] = h.fps;
    fixed[10] = h.check as u8;
    fixed[11] = name.len() as u8;
    let t = tag(key, nonce, &fixed, name);
    fixed[12..28].copy_from_slice(&t);
    let mut v = fixed.to_vec();
    v.extend_from_slice(name);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hello() -> ClientHello {
        ClientHello { width: 1280, height: 720, fps: 30, name: "Redmi Note 12".into(), check: false }
    }

    fn split(v: &[u8]) -> ([u8; CLIENT_HELLO_FIXED], Vec<u8>) {
        let mut f = [0u8; CLIENT_HELLO_FIXED];
        f.copy_from_slice(&v[..CLIENT_HELLO_FIXED]);
        (f, v[CLIENT_HELLO_FIXED..].to_vec())
    }

    #[test]
    fn discover_needs_the_key_or_the_cable() {
        let n = [9u8; 16];
        assert_eq!(check_discover("777a51b3", &build_discover(Some("777a51b3"), &n)), Some(Discover::Keyed(n)));
        assert_eq!(check_discover("777a51b3", &build_discover(None, &n)), Some(Discover::Keyless(n)));
        assert_eq!(check_discover("777a51b3", &build_discover(Some("deadbeef"), &n)), None, "wrong key: no answer");
        assert_eq!(check_discover("777a51b3", b"hello"), None);
        let r = build_discover_reply(&n, 7780, "DESKTOP-1");
        assert_eq!(&r[0..4], b"CAMR");
        assert_eq!(&r[5..21], &n);
        assert_eq!(u16::from_be_bytes([r[21], r[22]]), 7780);
    }

    #[test]
    fn cable_phone_needs_no_key_but_wifi_phone_does() {
        let nonce = [7u8; 16];
        let (f, n) = split(&build_client_hello("", &nonce, &hello()));
        assert!(verify_client_hello_from("777a51b3", &nonce, &f, &n, true).is_ok());
        assert_eq!(verify_client_hello_from("777a51b3", &nonce, &f, &n, false), Err(STATUS_BAD_KEY));
    }

    #[test]
    fn remote_command_is_framed_and_bounded() {
        let v = remote_command(r#"{"set":{"zoom":2}}"#).unwrap();
        assert_eq!(v[0], b'C');
        assert_eq!(u16::from_be_bytes([v[1], v[2]]) as usize, v.len() - 3);
        assert!(remote_command("").is_none());
        assert!(remote_command(&"x".repeat(MAX_STATE + 1)).is_none());
    }

    #[test]
    fn right_key_is_accepted() {
        let nonce = [7u8; 16];
        let (f, n) = split(&build_client_hello("777a51b3", &nonce, &hello()));
        assert_eq!(verify_client_hello("777a51b3", &nonce, &f, &n), Ok(hello()));
    }

    #[test]
    fn check_only_flag_round_trips_and_is_signed() {
        let nonce = [7u8; 16];
        let mut h = hello();
        h.check = true;
        let (mut f, n) = split(&build_client_hello("777a51b3", &nonce, &h));
        assert_eq!(verify_client_hello("777a51b3", &nonce, &f, &n).map(|x| x.check), Ok(true));
        // Flipping the flag without the key breaks the fingerprint.
        f[10] = 0;
        assert_eq!(verify_client_hello("777a51b3", &nonce, &f, &n), Err(STATUS_BAD_KEY));
    }

    #[test]
    fn wrong_key_or_replayed_nonce_is_refused() {
        let nonce = [7u8; 16];
        let (f, n) = split(&build_client_hello("777a51b3", &nonce, &hello()));
        assert_eq!(verify_client_hello("deadbeef", &nonce, &f, &n), Err(STATUS_BAD_KEY));
        // Same bytes against a new connection's nonce: a recording cannot be replayed.
        assert_eq!(verify_client_hello("777a51b3", &[8u8; 16], &f, &n), Err(STATUS_BAD_KEY));
    }

    #[test]
    fn tampered_size_is_refused() {
        let nonce = [1u8; 16];
        let (mut f, n) = split(&build_client_hello("777a51b3", &nonce, &hello()));
        f[5..7].copy_from_slice(&1920u16.to_be_bytes());
        assert_eq!(verify_client_hello("777a51b3", &nonce, &f, &n), Err(STATUS_BAD_KEY));
    }

    #[test]
    fn frame_header_limits() {
        let mut b = [0u8; FRAME_HEADER_LEN];
        b[0..4].copy_from_slice(&1000u32.to_be_bytes());
        b[4..12].copy_from_slice(&123u64.to_be_bytes());
        b[12] = FLAG_KEY;
        assert_eq!(parse_frame_header(&b), Ok(FrameHeader { len: 1000, pts_us: 123, flags: FLAG_KEY }));
        b[0..4].copy_from_slice(&0u32.to_be_bytes());
        assert!(parse_frame_header(&b).is_err());
        b[0..4].copy_from_slice(&(MAX_FRAME as u32 + 1).to_be_bytes());
        assert!(parse_frame_header(&b).is_err());
    }

    /// Golden value shared with the Android side (CamStream.kt test): if either
    /// side changes how the fingerprint is computed, both tests break together.
    #[test]
    fn golden_tag() {
        let nonce: [u8; 16] = core::array::from_fn(|i| i as u8);
        let v = build_client_hello("777a51b3", &nonce, &hello());
        let hex: String = v[12..28].iter().map(|b| format!("{b:02x}")).collect();
        // Same value from Python's hmac with the Kotlin byte order (checked 2026-11-21).
        assert_eq!(hex, "5494042a9ef225af4ab9f9d6c0d0f9ca");
    }
}
