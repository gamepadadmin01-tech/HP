//! Cross-language conformance for playtime capability tickets.
//!
//! The vectors in `ticket_vectors.json` are produced by the REAL backend issuer
//! (`website/backend/billing/ticket.js`) via `tools/gen_ticket_vectors.js`.
//! Verifying them here is what stops the two implementations drifting apart:
//! a byte-layout change on either side fails this test rather than silently
//! rejecting every ticket in the field, which is a failure that would look like
//! "enforcement randomly kills sessions" and take a day to trace.
//!
//! Same idea as `conformance.rs` for the wire protocol and `grx_conformance.rs`
//! for GRX — the pattern this project already trusts.

use std::time::{Duration, Instant};

use pc_server_rs::ticket::{self, Reject, TICKET_LEN};
use serde_json::Value;

fn vectors() -> Value {
    serde_json::from_str(include_str!("ticket_vectors.json"))
        .expect("ticket_vectors.json is not valid JSON")
}

fn b64(s: &str) -> Vec<u8> {
    // Small decoder — the crate has no base64 dependency and does not need one
    // for a test fixture.
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    for ch in s.bytes() {
        if ch == b'=' || ch == b'\n' || ch == b'\r' {
            continue;
        }
        let v = T.iter().position(|&c| c == ch).expect("bad base64 character") as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

fn hex(s: &str) -> Vec<u8> {
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).expect("bad hex"))
        .collect()
}

#[test]
fn every_backend_issued_ticket_verifies() {
    let v = vectors();
    let key = ticket::parse_public_key(v["publicKeyHex"].as_str().unwrap())
        .expect("the vector public key must be a valid Ed25519 point");

    assert_eq!(
        v["ticketLen"].as_u64().unwrap() as usize,
        TICKET_LEN,
        "the backend and this server disagree about how long a ticket is"
    );

    let cases = v["cases"].as_array().unwrap();
    assert!(!cases.is_empty());

    for case in cases {
        let desc = case["desc"].as_str().unwrap();
        let frame = b64(case["base64"].as_str().unwrap());
        assert_eq!(frame.len(), TICKET_LEN, "{desc}: wrong length");

        let t = ticket::verify_with(&frame, &key)
            .unwrap_or_else(|e| panic!("{desc}: should verify, got {e:?}"));

        assert_eq!(t.fence, case["fence"].as_u64().unwrap() as u32, "{desc}: fence");
        assert_eq!(t.seq, case["seq"].as_u64().unwrap() as u32, "{desc}: seq");

        let expected_id = hex(case["sessionIdBytesHex"].as_str().unwrap());
        assert_eq!(t.session_id.to_vec(), expected_id, "{desc}: session id");

        // The TTL is clamped on our side, so a ticket asking for 18 hours gets
        // the cap. That is the check that a compromised issuer cannot mint a
        // slip which outlives any sane heartbeat gap.
        let asked = Duration::from_secs(case["ttlSeconds"].as_u64().unwrap());
        assert!(t.ttl <= asked, "{desc}: ttl must never exceed what was asked");
        assert!(
            t.ttl <= Duration::from_secs(600),
            "{desc}: ttl must be clamped to the cap"
        );
    }
}

#[test]
fn a_tampered_ticket_is_refused() {
    let v = vectors();
    let key = ticket::parse_public_key(v["publicKeyHex"].as_str().unwrap()).unwrap();
    let good = b64(v["cases"][0]["base64"].as_str().unwrap());
    assert!(ticket::verify_with(&good, &key).is_ok());

    // Every signed byte matters. A phone editing the sequence number, the fence
    // or the TTL of a real ticket must be caught.
    for offset in [1usize, 2, 18, 22, 26, 30, 31] {
        let mut bad = good.clone();
        bad[offset] ^= 0xFF;
        let result = ticket::verify_with(&bad, &key);
        assert!(
            matches!(result, Err(Reject::BadSignature) | Err(Reject::UnsupportedVersion(_))),
            "flipping byte {offset} must invalidate the ticket, got {result:?}"
        );
    }

    // And the signature itself cannot be swapped for another valid one.
    let other = b64(v["cases"][1]["base64"].as_str().unwrap());
    let mut spliced = good.clone();
    spliced[32..].copy_from_slice(&other[32..]);
    assert_eq!(
        ticket::verify_with(&spliced, &key),
        Err(Reject::BadSignature),
        "a signature from a different ticket must not verify"
    );
}

#[test]
fn a_ticket_signed_by_the_wrong_key_is_refused() {
    let v = vectors();
    let frame = b64(v["cases"][0]["base64"].as_str().unwrap());
    // A different, valid key. Tickets from another issuer must not be honoured.
    let wrong = ticket::parse_public_key(
        "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29",
    )
    .expect("test key parses");
    assert_eq!(ticket::verify_with(&frame, &wrong), Err(Reject::BadSignature));
}

#[test]
fn the_gate_accepts_the_real_sequence_and_rejects_a_replay() {
    let v = vectors();
    let key = ticket::parse_public_key(v["publicKeyHex"].as_str().unwrap()).unwrap();
    let cases = v["cases"].as_array().unwrap();

    // Cases 0,1,2 are seq 1,2,3 on one session — a real heartbeat sequence.
    let frames: Vec<Vec<u8>> = (0..3).map(|i| b64(cases[i]["base64"].as_str().unwrap())).collect();

    let mut gate = ticket::TicketGate::new();
    let t0 = Instant::now();
    assert!(!gate.armed(), "a fresh gate is inert");
    assert!(!gate.expired(t0 + Duration::from_secs(86_400)));

    for (i, frame) in frames.iter().enumerate() {
        let t = ticket::verify_with(frame, &key).expect("vector verifies");
        // Drive the gate the way ws.rs does, but against the vector key.
        gate.offer_verified(t, t0 + Duration::from_secs(i as u64 * 60))
            .unwrap_or_else(|e| panic!("seq {} should be accepted, got {e:?}", t.seq));
    }
    assert!(gate.armed(), "the gate is armed once a ticket has been seen");

    // Replaying an earlier ticket must be refused.
    let replay = ticket::verify_with(&frames[0], &key).unwrap();
    assert!(
        matches!(gate.offer_verified(replay, t0), Err(Reject::StaleSeq { .. })),
        "a replayed ticket must be refused"
    );

    // And expiry runs on our clock from the last acceptance.
    let last_accept = t0 + Duration::from_secs(120);
    assert!(!gate.expired(last_accept + Duration::from_secs(179)));
    assert!(gate.expired(last_accept + Duration::from_secs(180)));
}
