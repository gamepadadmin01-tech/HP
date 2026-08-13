//! GRX — GamepadOS Realtime eXchange: authenticated encryption for input.
//!
//! Port of `grx_crypto.py` + `grx_session.py`. Every constant, label and byte
//! order below is a **wire contract with the Android client** — a wrong HKDF
//! label or a swapped nonce field produces perfectly well-formed output that the
//! phone simply cannot decrypt. All of it is pinned by golden vectors generated
//! from the shipped Python (`tools/gen_grx_vectors.py`).
//!
//! ## Shape
//!
//! 1-RTT handshake, fresh X25519 ephemerals per session:
//! ```text
//! 0xE1 CLIENT_HELLO   : 0xE1 | client_eph_pub(32) | lp(long_term_id)
//! 0xE2 SERVER_HELLO   : 0xE2 | server_eph_pub(32) | server_confirm(32)
//! 0xE3 CLIENT_CONFIRM : 0xE3 | client_confirm(32)
//! 0x01 DATA           : version(1) | counter_low32(4) | ct(20) | tag(16) = 41 B
//! ```
//! Then per-direction AES-128-GCM with a 96-bit counter nonce that never
//! repeats, and a tag-first sliding replay window.
//!
//! ## Rules that are NOT stylistic
//!
//! * **Verify the tag BEFORE touching the replay window.** Committing on an
//!   unauthenticated counter lets anyone forge one high-counter packet and
//!   permanently wedge the window — a 41-byte denial of service.
//! * **Counters start at 1 and never reset.** Safe only because the ephemerals
//!   are fresh per session; reusing a key with a reset counter reuses a nonce,
//!   which destroys AES-GCM completely.
//! * **Confirmation tags compare in constant time.** A byte-by-byte `==` leaks
//!   the tag through timing.
//! * **One HKDF extract+expand per subkey**, matching Android's Tink
//!   `computeHkdf`. Do NOT switch to master-then-expand — Tink has no standalone
//!   HKDF-Expand, so the two ends would silently derive different keys.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes128Gcm, Nonce};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use x25519_dalek::{PublicKey, StaticSecret};

pub const VERSION: u8 = 1;
pub const CIPHER_ID: u8 = 1; // AES-128-GCM
pub const DIR_C2S: u32 = 1; // client -> server (input)
pub const DIR_S2C: u32 = 2; // server -> client (rumble / ack)
pub const KEY_LEN: usize = 16;
pub const TAG_LEN: usize = 16;
pub const PLAINTEXT_LEN: usize = 20;
pub const HEADER_LEN: usize = 5; // version(1) + counter_low32(4)
pub const WIRE_LEN: usize = HEADER_LEN + PLAINTEXT_LEN + TAG_LEN; // 41

pub const T_HELLO: u8 = 0xE1;
pub const T_SHELLO: u8 = 0xE2;
pub const T_CONFIRM: u8 = 0xE3;

pub const ROLE_CLIENT: u8 = b'C';
pub const ROLE_SERVER: u8 = b'S';

/// The fixed domain id bound into the handshake transcript (`server.py GRX_LTID`).
pub const GRX_LTID: &[u8] = b"gamepados-grx-v1";

/// Length-prefixed, for unambiguous transcript hashing.
fn lp(out: &mut Vec<u8>, b: &[u8]) {
    out.extend_from_slice(&(b.len() as u32).to_le_bytes());
    out.extend_from_slice(b);
}

/// SHA-256 over the length-prefixed handshake transcript. Binds the version,
/// cipher, both ephemeral publics and the device id, which is what kills
/// downgrade and MITM.
pub fn transcript_hash(client_pub: &[u8], server_pub: &[u8], long_term_id: &[u8]) -> [u8; 32] {
    let mut buf = Vec::with_capacity(160);
    lp(&mut buf, &[VERSION, CIPHER_ID]);
    lp(&mut buf, client_pub);
    lp(&mut buf, server_pub);
    lp(&mut buf, long_term_id);
    let mut h = Sha256::new();
    h.update(&buf);
    h.finalize().into()
}

#[derive(Debug, Clone)]
pub struct Keys {
    pub c2s: [u8; KEY_LEN],
    pub s2c: [u8; KEY_LEN],
    pub confirm: [u8; 32],
    pub transcript: [u8; 32],
}

/// `ikm = shared || psk`, `salt = transcript`, one extract+expand per label.
pub fn derive_keys(shared: &[u8], psk: &[u8], th: &[u8; 32]) -> Keys {
    let mut ikm = Vec::with_capacity(shared.len() + psk.len());
    ikm.extend_from_slice(shared);
    ikm.extend_from_slice(psk);

    let hk = |label: &[u8], out: &mut [u8]| {
        let h = Hkdf::<Sha256>::new(Some(th), &ikm);
        h.expand(label, out).expect("HKDF output length is valid");
    };
    let mut c2s = [0u8; KEY_LEN];
    let mut s2c = [0u8; KEY_LEN];
    let mut confirm = [0u8; 32];
    hk(b"grx c2s v1", &mut c2s);
    hk(b"grx s2c v1", &mut s2c);
    hk(b"grx confirm v1", &mut confirm);
    Keys { c2s, s2c, confirm, transcript: *th }
}

/// `HMAC-SHA256(confirm_key, transcript || role)`.
pub fn confirm_tag(confirm_key: &[u8], th: &[u8; 32], role: u8) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(confirm_key)
        .expect("HMAC accepts any key length");
    mac.update(th);
    mac.update(&[role]);
    mac.finalize().into_bytes().into()
}

/// 32-byte PSK from the pairing key (`server.py::_grx_psk_from_key`).
/// The key is hex when it can be — otherwise its raw bytes are used, matching
/// Python's `bytes.fromhex` / fallback-to-`encode()` behaviour exactly.
pub fn psk_from_pairing_key(key: &str) -> [u8; 32] {
    let ikm: Vec<u8> = match hex_decode(key) {
        Some(b) => b,
        None => key.as_bytes().to_vec(),
    };
    let h = Hkdf::<Sha256>::new(Some(b""), &ikm);
    let mut out = [0u8; 32];
    h.expand(b"grx psk v1", &mut out).expect("32 bytes is a valid HKDF length");
    out
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.is_empty() || s.len() % 2 != 0 || !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// A fresh X25519 secret for one session, from the OS CSPRNG.
///
/// `StaticSecret` is used only because a key must be constructible from fixed
/// bytes for the golden vectors; every one produced here is used for exactly one
/// session and then dropped, which is what keeps the counter-from-1 nonce scheme
/// safe. Never persist or reuse one.
pub fn new_ephemeral() -> Result<StaticSecret, String> {
    let mut b = [0u8; 32];
    crate::pairing::os_random(&mut b)?;
    Ok(StaticSecret::from(b))
}

/// Run the key agreement from one side.
pub fn handshake(
    my_priv: &StaticSecret,
    their_pub_bytes: &[u8; 32],
    psk: &[u8],
    long_term_id: &[u8],
    am_client: bool,
) -> Keys {
    let my_pub = PublicKey::from(my_priv).to_bytes();
    let shared = my_priv.diffie_hellman(&PublicKey::from(*their_pub_bytes));
    let (cli, srv) = if am_client {
        (my_pub, *their_pub_bytes)
    } else {
        (*their_pub_bytes, my_pub)
    };
    let th = transcript_hash(&cli, &srv, long_term_id);
    derive_keys(shared.as_bytes(), psk, &th)
}

// ── Replay window (tag-first) ────────────────────────────────────────────────

/// Sliding window over authenticated counters. `high` is the largest counter
/// that has been **authenticated**; `mask` bit *i* marks `high - i` as seen.
/// How far out of order a frame may arrive and still be accepted.
///
/// Python uses 1024 bits (a Python int is a bignum, so it is free there). A
/// `u128` gives 128, which at ~1000 packets/sec is 128 ms of reorder depth —
/// far beyond anything real UDP does on a LAN or USB link, and the client sends
/// in order anyway. A frame later than this is dropped, which is harmless:
/// newer frames have already superseded it. Not worth a bignum.
const WINDOW_BITS: u64 = 128;

#[derive(Debug, Default)]
pub struct ReplayWindow {
    pub high: u64,
    mask: u128,
}

impl ReplayWindow {
    /// Rebuild the full 64-bit counter from the 32 bits actually on the wire.
    pub fn reconstruct(&self, low32: u32) -> u64 {
        let mut cand = (self.high & !0xFFFF_FFFF) | (low32 as u64);
        if cand.wrapping_add(0x8000_0000) < self.high {
            cand = cand.wrapping_add(0x1_0000_0000);
        } else if cand > self.high.wrapping_add(0x8000_0000) && cand >= 0x1_0000_0000 {
            cand -= 0x1_0000_0000;
        }
        cand
    }

    /// Pre-auth admissibility. Counter 0 is never valid (they start at 1).
    pub fn check(&self, counter: u64) -> bool {
        if counter == 0 {
            return false;
        }
        if counter > self.high {
            return true;
        }
        let offset = self.high - counter;
        if offset >= WINDOW_BITS {
            return false; // too old
        }
        (self.mask >> offset) & 1 == 0
    }

    /// **Post-auth only.** Calling this before the tag verifies is the DoS hole.
    ///
    /// Shifts are guarded: `1u128 << 128` overflows, so a jump of a full window
    /// or more resets the mask to "only this counter seen" instead.
    pub fn commit(&mut self, counter: u64) {
        if counter > self.high {
            let shift = counter - self.high;
            self.mask = if shift >= WINDOW_BITS { 1 } else { (self.mask << shift) | 1 };
            self.high = counter;
        } else {
            let offset = self.high - counter;
            if offset < WINDOW_BITS {
                self.mask |= 1u128 << offset;
            }
        }
    }
}

fn nonce_bytes(direction: u32, counter: u64) -> [u8; 12] {
    let mut n = [0u8; 12];
    n[0..4].copy_from_slice(&direction.to_le_bytes());
    n[4..12].copy_from_slice(&counter.to_le_bytes());
    n
}

fn aad_bytes(counter: u64) -> [u8; 9] {
    let mut a = [0u8; 9];
    a[0] = VERSION;
    a[1..9].copy_from_slice(&counter.to_le_bytes());
    a
}

pub struct GrxSender {
    aead: Aes128Gcm,
    direction: u32,
    pub counter: u64,
}

impl GrxSender {
    pub fn new(key: &[u8; KEY_LEN], direction: u32) -> Self {
        GrxSender {
            aead: Aes128Gcm::new(key.into()),
            direction,
            counter: 0,
        }
    }

    /// Seal one 20-byte input frame. Counter increments first, so the first
    /// frame uses 1 — never 0, and never repeats for this key.
    pub fn seal(&mut self, plaintext: &[u8]) -> Option<Vec<u8>> {
        if plaintext.len() != PLAINTEXT_LEN {
            return None;
        }
        self.counter += 1;
        let c = self.counter;
        let ct = self
            .aead
            .encrypt(
                Nonce::from_slice(&nonce_bytes(self.direction, c)),
                Payload { msg: plaintext, aad: &aad_bytes(c) },
            )
            .ok()?;
        let mut out = Vec::with_capacity(WIRE_LEN);
        out.push(VERSION);
        out.extend_from_slice(&(c as u32).to_le_bytes());
        out.extend_from_slice(&ct);
        Some(out)
    }
}

pub struct GrxReceiver {
    aead: Aes128Gcm,
    direction: u32,
    pub win: ReplayWindow,
}

impl GrxReceiver {
    pub fn new(key: &[u8; KEY_LEN], direction: u32) -> Self {
        GrxReceiver {
            aead: Aes128Gcm::new(key.into()),
            direction,
            win: ReplayWindow::default(),
        }
    }

    /// Returns the 20-byte plaintext, or `None` to DROP (old / dup / forged).
    ///
    /// Order is load-bearing: length, version, window *check*, **decrypt**, then
    /// window *commit*. The window is never advanced by anything unauthenticated.
    pub fn open(&mut self, frame: &[u8]) -> Option<Vec<u8>> {
        if frame.len() != WIRE_LEN || frame[0] != VERSION {
            return None;
        }
        let low32 = u32::from_le_bytes([frame[1], frame[2], frame[3], frame[4]]);
        let counter = self.win.reconstruct(low32);
        if !self.win.check(counter) {
            return None; // old or duplicate — rejected before any crypto work
        }
        let pt = self
            .aead
            .decrypt(
                Nonce::from_slice(&nonce_bytes(self.direction, counter)),
                Payload { msg: &frame[HEADER_LEN..], aad: &aad_bytes(counter) },
            )
            .ok()?; // auth failure -> drop, window UNTOUCHED
        self.win.commit(counter);
        Some(pt)
    }
}

// ── Session layer ────────────────────────────────────────────────────────────

/// Minimum plausible length per handshake type.
///
/// This guard is not cosmetic: a legacy 20-byte cleartext input frame begins
/// with a little-endian timestamp whose low byte sweeps 0-255, so first-byte
/// matching alone misrouted roughly 1 in 128 input frames into the handshake
/// path. Before this was hardened, a "CONFIRM" that was really an input frame
/// raised an unpack error and **killed the server's UDP thread** — the port
/// stayed bound but silent until restart.
pub fn is_handshake(frame: &[u8]) -> bool {
    match frame.first() {
        Some(&T_HELLO) => frame.len() >= 34,
        Some(&T_SHELLO) => frame.len() >= 65,
        Some(&T_CONFIRM) => frame.len() >= 33,
        _ => false,
    }
}

#[derive(Debug)]
pub enum HandshakeError {
    Malformed,
    UnknownDevice,
    ConfirmFailed,
}

/// Server side of one phone's session.
pub struct GrxServerSession {
    psk: [u8; 32],
    long_term_id: Vec<u8>,
    keys: Option<Keys>,
    eph: Option<StaticSecret>,
    pub established: bool,
    sender: Option<GrxSender>,
    receiver: Option<GrxReceiver>,
}

impl GrxServerSession {
    pub fn new(psk: [u8; 32], long_term_id: &[u8]) -> Self {
        GrxServerSession {
            psk,
            long_term_id: long_term_id.to_vec(),
            keys: None,
            eph: None,
            established: false,
            sender: None,
            receiver: None,
        }
    }

    /// CLIENT_HELLO -> SERVER_HELLO. A fresh ephemeral per session is what makes
    /// the counter-from-1 scheme safe.
    pub fn handle_hello(&mut self, frame: &[u8], eph: StaticSecret) -> Result<Vec<u8>, HandshakeError> {
        if frame.len() < 34 || frame[0] != T_HELLO {
            return Err(HandshakeError::Malformed);
        }
        let mut client_pub = [0u8; 32];
        client_pub.copy_from_slice(&frame[1..33]);
        // length-prefixed long_term_id
        if frame.len() < 37 {
            return Err(HandshakeError::Malformed);
        }
        let n = u32::from_le_bytes([frame[33], frame[34], frame[35], frame[36]]) as usize;
        let end = 37usize.checked_add(n).ok_or(HandshakeError::Malformed)?;
        if frame.len() < end {
            return Err(HandshakeError::Malformed);
        }
        if &frame[37..end] != self.long_term_id.as_slice() {
            return Err(HandshakeError::UnknownDevice);
        }

        let keys = handshake(&eph, &client_pub, &self.psk, &self.long_term_id, false);
        let server_pub = PublicKey::from(&eph).to_bytes();
        let server_confirm = confirm_tag(&keys.confirm, &keys.transcript, ROLE_SERVER);

        let mut out = Vec::with_capacity(65);
        out.push(T_SHELLO);
        out.extend_from_slice(&server_pub);
        out.extend_from_slice(&server_confirm);

        self.eph = Some(eph);
        self.keys = Some(keys);
        Ok(out)
    }

    /// CLIENT_CONFIRM -> session established.
    pub fn handle_confirm(&mut self, frame: &[u8]) -> Result<(), HandshakeError> {
        if frame.len() < 33 || frame[0] != T_CONFIRM {
            return Err(HandshakeError::Malformed);
        }
        let keys = self.keys.as_ref().ok_or(HandshakeError::Malformed)?;
        let expect = confirm_tag(&keys.confirm, &keys.transcript, ROLE_CLIENT);
        // Constant-time: a plain == would leak the expected tag via timing.
        if expect.ct_eq(&frame[1..33]).unwrap_u8() != 1 {
            return Err(HandshakeError::ConfirmFailed);
        }
        self.sender = Some(GrxSender::new(&keys.s2c, DIR_S2C));
        self.receiver = Some(GrxReceiver::new(&keys.c2s, DIR_C2S));
        self.established = true;
        Ok(())
    }

    pub fn open(&mut self, data_frame: &[u8]) -> Option<Vec<u8>> {
        self.receiver.as_mut()?.open(data_frame)
    }

    pub fn seal(&mut self, plaintext: &[u8]) -> Option<Vec<u8>> {
        self.sender.as_mut()?.seal(plaintext)
    }
}
