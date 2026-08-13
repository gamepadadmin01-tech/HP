//! GRX crypto conformance — every derived value pinned against vectors
//! generated from the shipped `grx_crypto.py` / `grx_session.py`.
//!
//! Crypto is where "it looks right" is worth nothing. A wrong HKDF label, a
//! swapped nonce field order, or a mis-sized AAD all produce perfectly
//! well-formed frames that the phone simply cannot decrypt — and the failure
//! shows up as "encrypted mode just doesn't connect", with nothing to debug.
//!
//! Regenerate after ANY change to the Python crypto:
//!     python tools/gen_grx_vectors.py

use pc_server_rs::grx::*;
use serde_json::Value;
use x25519_dalek::{PublicKey, StaticSecret};

fn vectors() -> Value {
    serde_json::from_str(include_str!("grx_vectors.json")).expect("grx_vectors.json is valid JSON")
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("valid hex"))
        .collect()
}

fn hx(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn arr32(s: &str) -> [u8; 32] {
    let v = unhex(s);
    let mut a = [0u8; 32];
    a.copy_from_slice(&v);
    a
}

/// The constants ARE the wire contract. If these drift, nothing else matters.
#[test]
fn constants_match_python() {
    let g = vectors();
    let c = &g["consts"];
    assert_eq!(c["VERSION"].as_u64().unwrap() as u8, VERSION);
    assert_eq!(c["CIPHER_ID"].as_u64().unwrap() as u8, CIPHER_ID);
    assert_eq!(c["DIR_C2S"].as_u64().unwrap() as u32, DIR_C2S);
    assert_eq!(c["DIR_S2C"].as_u64().unwrap() as u32, DIR_S2C);
    assert_eq!(c["KEY_LEN"].as_u64().unwrap() as usize, KEY_LEN);
    assert_eq!(c["TAG_LEN"].as_u64().unwrap() as usize, TAG_LEN);
    assert_eq!(c["PLAINTEXT_LEN"].as_u64().unwrap() as usize, PLAINTEXT_LEN);
    assert_eq!(c["HEADER_LEN"].as_u64().unwrap() as usize, HEADER_LEN);
    assert_eq!(c["WIRE_LEN"].as_u64().unwrap() as usize, WIRE_LEN);
    assert_eq!(WIRE_LEN, 41);
    assert_eq!(unhex(g["ltid"].as_str().unwrap()), GRX_LTID);
}

/// X25519: our public keys and the shared secret must match Python's for the
/// same fixed private keys, or nothing downstream can agree.
#[test]
fn x25519_agrees_with_python() {
    let g = vectors();
    let x = &g["x25519"];
    let c_priv = StaticSecret::from(arr32(x["client_priv"].as_str().unwrap()));
    let s_priv = StaticSecret::from(arr32(x["server_priv"].as_str().unwrap()));

    assert_eq!(hx(PublicKey::from(&c_priv).as_bytes()), x["client_pub"].as_str().unwrap());
    assert_eq!(hx(PublicKey::from(&s_priv).as_bytes()), x["server_pub"].as_str().unwrap());

    let shared = c_priv.diffie_hellman(&PublicKey::from(&s_priv));
    assert_eq!(hx(shared.as_bytes()), x["shared"].as_str().unwrap());

    // Both directions must produce the same secret.
    let shared2 = s_priv.diffie_hellman(&PublicKey::from(&c_priv));
    assert_eq!(shared.as_bytes(), shared2.as_bytes());
}

/// The transcript binds version, cipher, both publics and the device id —
/// that binding is what defeats downgrade and MITM.
#[test]
fn transcript_hash_matches() {
    let g = vectors();
    let x = &g["x25519"];
    let th = transcript_hash(
        &unhex(x["client_pub"].as_str().unwrap()),
        &unhex(x["server_pub"].as_str().unwrap()),
        &unhex(g["ltid"].as_str().unwrap()),
    );
    assert_eq!(hx(&th), g["transcript_hash"].as_str().unwrap());
}

/// One HKDF extract+expand per subkey (Tink-compatible). A master-then-expand
/// scheme would silently derive different keys from the Android side.
#[test]
fn derived_keys_match() {
    let g = vectors();
    let th = arr32(g["transcript_hash"].as_str().unwrap());
    let keys = derive_keys(
        &unhex(g["x25519"]["shared"].as_str().unwrap()),
        &unhex(g["psk"].as_str().unwrap()),
        &th,
    );
    assert_eq!(hx(&keys.c2s), g["derived"]["c2s"].as_str().unwrap(), "c2s key");
    assert_eq!(hx(&keys.s2c), g["derived"]["s2c"].as_str().unwrap(), "s2c key");
    assert_eq!(hx(&keys.confirm), g["derived"]["confirm"].as_str().unwrap(), "confirm key");
    assert_ne!(keys.c2s, keys.s2c, "directions MUST use different keys");
}

#[test]
fn confirm_tags_match_both_roles() {
    let g = vectors();
    let th = arr32(g["transcript_hash"].as_str().unwrap());
    let ck = unhex(g["derived"]["confirm"].as_str().unwrap());
    assert_eq!(
        hx(&confirm_tag(&ck, &th, ROLE_CLIENT)),
        g["confirm_tags"]["client"].as_str().unwrap()
    );
    assert_eq!(
        hx(&confirm_tag(&ck, &th, ROLE_SERVER)),
        g["confirm_tags"]["server"].as_str().unwrap()
    );
    // The two roles must differ, or a reflection attack replays one side's tag.
    assert_ne!(
        confirm_tag(&ck, &th, ROLE_CLIENT),
        confirm_tag(&ck, &th, ROLE_SERVER)
    );
}

/// PSK bootstraps off the EXISTING pairing key, so this must match exactly or
/// every already-paired phone fails to establish.
#[test]
fn psk_from_pairing_key_matches() {
    let g = vectors();
    for case in g["psk_from_pairing_key"].as_array().unwrap() {
        let key = case["pairing_key"].as_str().unwrap();
        assert_eq!(
            hx(&psk_from_pairing_key(key)),
            case["psk"].as_str().unwrap(),
            "psk for pairing key {key}"
        );
    }
}

/// Byte-exact sealed frames: header, ciphertext and tag, for a fixed key.
/// Also pins the nonce and AAD construction, which are invisible on the wire but
/// must match or decryption fails.
#[test]
fn sealed_frames_are_byte_identical() {
    let g = vectors();
    let key_v = unhex(g["seal"]["key"].as_str().unwrap());
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&key_v);
    let mut snd = GrxSender::new(&key, DIR_C2S);

    for f in g["seal"]["frames"].as_array().unwrap() {
        let pt = unhex(f["plaintext"].as_str().unwrap());
        let frame = snd.seal(&pt).expect("seal must succeed for a 20-byte frame");
        assert_eq!(frame.len(), WIRE_LEN);
        assert_eq!(
            hx(&frame),
            f["frame"].as_str().unwrap(),
            "sealed frame differs at counter {}",
            f["counter"]
        );
        assert_eq!(snd.counter, f["counter"].as_u64().unwrap());
    }
}

/// Round-trip through our own receiver, then the security properties.
#[test]
fn seal_open_roundtrip_and_replay_rejection() {
    let key = [7u8; KEY_LEN];
    let mut snd = GrxSender::new(&key, DIR_C2S);
    let mut rcv = GrxReceiver::new(&key, DIR_C2S);

    let mut frames = Vec::new();
    for i in 0..200u64 {
        let mut pt = [0u8; PLAINTEXT_LEN];
        pt[0..8].copy_from_slice(&i.to_le_bytes());
        let f = snd.seal(&pt).unwrap();
        frames.push((pt, f));
    }
    for (pt, f) in &frames {
        assert_eq!(rcv.open(f).as_deref(), Some(&pt[..]), "plaintext must round-trip");
    }
    // Replay of an already-accepted frame must be rejected.
    assert!(rcv.open(&frames[10].1).is_none(), "replayed frame must be dropped");
    assert!(rcv.open(&frames[199].1).is_none(), "replayed newest frame must be dropped");
}

/// The DoS guard: a forged high-counter frame must be dropped AND must not move
/// the replay window, or one 41-byte packet wedges the session permanently.
#[test]
fn forged_frame_does_not_advance_the_window() {
    let key = [3u8; KEY_LEN];
    let mut snd = GrxSender::new(&key, DIR_C2S);
    let mut rcv = GrxReceiver::new(&key, DIR_C2S);

    let good = snd.seal(&[1u8; PLAINTEXT_LEN]).unwrap();

    let mut forged = vec![VERSION];
    forged.extend_from_slice(&0x7FFF_FFFFu32.to_le_bytes());
    forged.extend_from_slice(&[0u8; PLAINTEXT_LEN + TAG_LEN]);
    assert_eq!(forged.len(), WIRE_LEN);

    assert!(rcv.open(&forged).is_none(), "forged frame must be dropped");
    assert_eq!(rcv.win.high, 0, "forged frame must NOT advance the window");
    assert!(rcv.open(&good).is_some(), "legit input must still work after a forgery");
}

/// A tampered ciphertext must fail authentication.
#[test]
fn tampered_ciphertext_is_rejected() {
    let key = [9u8; KEY_LEN];
    let mut snd = GrxSender::new(&key, DIR_C2S);
    let mut rcv = GrxReceiver::new(&key, DIR_C2S);
    let mut f = snd.seal(&[2u8; PLAINTEXT_LEN]).unwrap();
    f[HEADER_LEN + 3] ^= 0x01; // flip one bit of ciphertext
    assert!(rcv.open(&f).is_none(), "bit-flipped frame must fail the tag check");
    assert_eq!(rcv.win.high, 0, "failed auth must not advance the window");
}

/// Wrong key (i.e. wrong PSK / MITM) cannot produce acceptable frames.
#[test]
fn wrong_key_cannot_be_opened() {
    let mut snd = GrxSender::new(&[1u8; KEY_LEN], DIR_C2S);
    let mut rcv = GrxReceiver::new(&[2u8; KEY_LEN], DIR_C2S);
    let f = snd.seal(&[0u8; PLAINTEXT_LEN]).unwrap();
    assert!(rcv.open(&f).is_none(), "a frame sealed with another key must not open");
}

/// Directions use different keys AND different nonce prefixes, so a c2s frame
/// must never be openable as s2c (cross-direction reflection).
#[test]
fn directions_do_not_cross() {
    let key = [5u8; KEY_LEN];
    let mut snd = GrxSender::new(&key, DIR_C2S);
    let mut rcv_wrong_dir = GrxReceiver::new(&key, DIR_S2C);
    let f = snd.seal(&[4u8; PLAINTEXT_LEN]).unwrap();
    assert!(
        rcv_wrong_dir.open(&f).is_none(),
        "c2s frame must not open as s2c even with the same key"
    );
}

#[test]
fn replay_window_matches_python() {
    let g = vectors();
    let mut w = ReplayWindow::default();
    for case in g["replay_window"].as_array().unwrap() {
        let c = case["counter"].as_u64().unwrap();
        let want = case["accept"].as_bool().unwrap();
        // The trailing "counter 0" case is checked on a fresh window in Python.
        if c == 0 {
            assert!(!ReplayWindow::default().check(0), "counter 0 is never valid");
            continue;
        }
        let got = w.check(c);
        assert_eq!(got, want, "window.check({c})");
        if got {
            w.commit(c);
        }
    }
}

#[test]
fn counter_reconstruction_matches_python() {
    let g = vectors();
    for case in g["reconstruct"].as_array().unwrap() {
        let high = case["high"].as_u64().unwrap();
        let low32 = case["low32"].as_u64().unwrap() as u32;
        let want = case["counter"].as_u64().unwrap();
        let mut w = ReplayWindow::default();
        w.high = high;
        assert_eq!(w.reconstruct(low32), want, "reconstruct(high={high}, low={low32:#x})");
    }
}

/// Frame routing. This guard is why the UDP thread no longer dies: a legacy
/// 20-byte input frame starts with a timestamp whose low byte sweeps 0-255, so
/// ~1/128 of them look like a handshake byte.
#[test]
fn handshake_routing_rejects_short_lookalikes() {
    let g = vectors();
    let shape = &g["handshake_shape"];
    assert_eq!(shape["T_HELLO"].as_u64().unwrap() as u8, T_HELLO);
    assert_eq!(shape["T_SHELLO"].as_u64().unwrap() as u8, T_SHELLO);
    assert_eq!(shape["T_CONFIRM"].as_u64().unwrap() as u8, T_CONFIRM);

    // A 20-byte input frame that happens to begin with 0xE3 must NOT route to
    // the handshake path.
    let mut fake = vec![T_CONFIRM];
    fake.extend_from_slice(&[0u8; 19]);
    assert_eq!(fake.len(), 20);
    assert!(!is_handshake(&fake), "a 20-byte lookalike must not be a handshake");

    assert!(is_handshake(&[vec![T_HELLO], vec![0u8; 40]].concat()));
    assert!(is_handshake(&[vec![T_SHELLO], vec![0u8; 64]].concat()));
    assert!(is_handshake(&[vec![T_CONFIRM], vec![0u8; 32]].concat()));
    assert!(!is_handshake(&[vec![T_HELLO], vec![0u8; 5]].concat()), "too short");
    assert!(!is_handshake(&[]));
    // A real data frame starts with VERSION (0x01) and is never a handshake.
    assert!(!is_handshake(&[vec![VERSION], vec![0u8; WIRE_LEN - 1]].concat()));
}

/// Full server-side session: HELLO -> SERVER_HELLO -> CONFIRM -> encrypted data,
/// driven with fixed keys so the whole flow is deterministic.
#[test]
fn server_session_completes_handshake_and_decrypts() {
    let g = vectors();
    let psk = arr32(g["psk"].as_str().unwrap());
    let ltid = unhex(g["ltid"].as_str().unwrap());
    let c_priv = StaticSecret::from(arr32(g["x25519"]["client_priv"].as_str().unwrap()));
    let s_priv = StaticSecret::from(arr32(g["x25519"]["server_priv"].as_str().unwrap()));
    let c_pub = PublicKey::from(&c_priv).to_bytes();

    // Client's HELLO
    let mut hello = vec![T_HELLO];
    hello.extend_from_slice(&c_pub);
    hello.extend_from_slice(&(ltid.len() as u32).to_le_bytes());
    hello.extend_from_slice(&ltid);

    let mut server = GrxServerSession::new(psk, &ltid);
    let shello = server.handle_hello(&hello, s_priv.clone()).expect("hello accepted");
    assert_eq!(shello.len(), 65);
    assert_eq!(shello[0], T_SHELLO);

    // Client derives the same keys and answers CONFIRM.
    let ck = handshake(&c_priv, &PublicKey::from(&s_priv).to_bytes(), &psk, &ltid, true);
    // The server's confirm tag must verify on the client side.
    assert_eq!(&shello[33..65], &confirm_tag(&ck.confirm, &ck.transcript, ROLE_SERVER)[..]);

    let mut confirm = vec![T_CONFIRM];
    confirm.extend_from_slice(&confirm_tag(&ck.confirm, &ck.transcript, ROLE_CLIENT));
    server.handle_confirm(&confirm).expect("confirm accepted");
    assert!(server.established);

    // Client seals input; the server must decrypt it.
    let mut snd = GrxSender::new(&ck.c2s, DIR_C2S);
    let pt = [0x5Au8; PLAINTEXT_LEN];
    let frame = snd.seal(&pt).unwrap();
    assert_eq!(server.open(&frame).as_deref(), Some(&pt[..]));
}

/// A client with the WRONG psk must fail at CONFIRM — this is the MITM check.
#[test]
fn wrong_psk_client_is_rejected_at_confirm() {
    let g = vectors();
    let psk = arr32(g["psk"].as_str().unwrap());
    let ltid = unhex(g["ltid"].as_str().unwrap());
    let c_priv = StaticSecret::from(arr32(g["x25519"]["client_priv"].as_str().unwrap()));
    let s_priv = StaticSecret::from(arr32(g["x25519"]["server_priv"].as_str().unwrap()));

    let mut hello = vec![T_HELLO];
    hello.extend_from_slice(&PublicKey::from(&c_priv).to_bytes());
    hello.extend_from_slice(&(ltid.len() as u32).to_le_bytes());
    hello.extend_from_slice(&ltid);

    let mut server = GrxServerSession::new(psk, &ltid);
    server.handle_hello(&hello, s_priv.clone()).unwrap();

    // Attacker derives with a DIFFERENT psk.
    let bad = handshake(&c_priv, &PublicKey::from(&s_priv).to_bytes(), &[0xFFu8; 32], &ltid, true);
    let mut confirm = vec![T_CONFIRM];
    confirm.extend_from_slice(&confirm_tag(&bad.confirm, &bad.transcript, ROLE_CLIENT));
    assert!(server.handle_confirm(&confirm).is_err(), "wrong PSK must not establish");
    assert!(!server.established);
}

/// An unknown device id must be refused before any key work.
#[test]
fn unknown_long_term_id_is_rejected() {
    let g = vectors();
    let psk = arr32(g["psk"].as_str().unwrap());
    let ltid = unhex(g["ltid"].as_str().unwrap());
    let c_priv = StaticSecret::from(arr32(g["x25519"]["client_priv"].as_str().unwrap()));
    let s_priv = StaticSecret::from(arr32(g["x25519"]["server_priv"].as_str().unwrap()));

    let other = b"some-other-device";
    let mut hello = vec![T_HELLO];
    hello.extend_from_slice(&PublicKey::from(&c_priv).to_bytes());
    hello.extend_from_slice(&(other.len() as u32).to_le_bytes());
    hello.extend_from_slice(other);

    let mut server = GrxServerSession::new(psk, &ltid);
    assert!(server.handle_hello(&hello, s_priv).is_err(), "unknown ltid must be refused");
}
