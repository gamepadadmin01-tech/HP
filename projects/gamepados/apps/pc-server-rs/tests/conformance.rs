//! WIRE-CONFORMANCE GATE.
//!
//! Proves this Rust implementation reproduces the shipped Python server's wire
//! behaviour byte-for-byte, using golden vectors generated from the REAL
//! `server.py` source (`tools/gen_golden.py`, AST-extracted — not transcribed).
//!
//! WHY: the previous Rust server was deleted because it invented its own format
//! and dropped every packet from the phone. These tests are the gate that
//! failure would have caught. **No server code ships until they pass.**
//!
//! Regenerate vectors after ANY change to the Python wire path:
//!     python tools/gen_golden.py

use pc_server_rs::wire::*;
use serde_json::Value;

fn golden() -> Value {
    let raw = include_str!("golden_vectors.json");
    serde_json::from_str(raw).expect("golden_vectors.json is not valid JSON")
}

fn u64_of(v: &Value) -> u64 {
    v.as_u64().unwrap_or_else(|| panic!("not a u64: {v}"))
}

/// The format string and size are the whole contract — if these drift, every
/// other test is meaningless, so assert them loudly and first.
#[test]
fn payload_format_and_size_unchanged() {
    let g = golden();
    assert_eq!(g["payload_format"].as_str().unwrap(), "<Q H B B B B B B I");
    assert_eq!(g["payload_size"].as_u64().unwrap() as usize, PAYLOAD_SIZE);
    assert_eq!(g["clock_reset_ns"].as_u64().unwrap(), CLOCK_RESET_NS);
    assert_eq!(g["max_pads"].as_u64().unwrap() as usize, MAX_PADS);
}

/// Decode every golden packet from its exact on-wire bytes.
#[test]
fn decodes_golden_packets_byte_exactly() {
    let g = golden();
    for p in g["packets"].as_array().unwrap() {
        let bytes: Vec<u8> = p["bytes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b.as_u64().unwrap() as u8)
            .collect();
        assert_eq!(bytes.len(), PAYLOAD_SIZE, "golden packet wrong length");

        let pkt = Packet::decode(&bytes).expect("failed to decode golden packet");
        let f = &p["fields"];
        let desc = p["desc"].as_str().unwrap_or("");
        assert_eq!(pkt.ts, u64_of(&f["ts"]), "ts mismatch [{desc}]");
        assert_eq!(pkt.buttons as u64, u64_of(&f["buttons"]), "buttons [{desc}]");
        assert_eq!(pkt.lt as u64, u64_of(&f["lt"]), "lt [{desc}]");
        assert_eq!(pkt.rt as u64, u64_of(&f["rt"]), "rt [{desc}]");
        assert_eq!(pkt.ls_x as u64, u64_of(&f["ls_x"]), "ls_x [{desc}]");
        assert_eq!(pkt.ls_y as u64, u64_of(&f["ls_y"]), "ls_y [{desc}]");
        assert_eq!(pkt.rs_x as u64, u64_of(&f["rs_x"]), "rs_x [{desc}]");
        assert_eq!(pkt.rs_y as u64, u64_of(&f["rs_y"]), "rs_y [{desc}]");
        assert_eq!(pkt.auth_token as u64, u64_of(&f["auth_token"]), "auth [{desc}]");

        // Re-encoding must reproduce the original bytes exactly.
        assert_eq!(&pkt.encode()[..], &bytes[..], "re-encode differs [{desc}]");
    }
}

/// A frame of any other length must be rejected outright (Python only unpacks
/// frames of exactly PAYLOAD_SIZE).
#[test]
fn rejects_wrong_length_frames() {
    assert!(Packet::decode(&[]).is_none());
    assert!(Packet::decode(&[0u8; 19]).is_none());
    assert!(Packet::decode(&[0u8; 21]).is_none());
    assert!(Packet::decode(&[0u8; 20]).is_some());
}

/// Both lookup tables, all 256 entries each.
#[test]
fn snap_and_axis_luts_match_all_256_entries() {
    let g = golden();
    let snap_lut = g["snap_lut"].as_array().unwrap();
    let axis_lut = g["axis_lut"].as_array().unwrap();
    assert_eq!(snap_lut.len(), 256);
    assert_eq!(axis_lut.len(), 256);

    for v in 0u16..256 {
        let b = v as u8;
        assert_eq!(
            snap(b) as u64,
            snap_lut[v as usize].as_u64().unwrap(),
            "snap({b}) mismatch"
        );
        let want = axis_lut[v as usize].as_f64().unwrap();
        let got = axis(b);
        assert!(
            (got - want).abs() < 1e-12,
            "axis({b}) = {got}, python = {want}"
        );
    }
}

/// The exact floats handed to the virtual pad — including the negated Y axes,
/// which are the single easiest thing to get backwards.
#[test]
fn pad_axes_match_including_negated_y() {
    let g = golden();
    for p in g["packets"].as_array().unwrap() {
        let bytes: Vec<u8> = p["bytes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b.as_u64().unwrap() as u8)
            .collect();
        let pkt = Packet::decode(&bytes).unwrap();
        let desc = p["desc"].as_str().unwrap_or("");

        // snapped bytes
        let s = &p["snapped"];
        assert_eq!(snap(pkt.ls_x) as u64, u64_of(&s["ls_x"]), "snap ls_x [{desc}]");
        assert_eq!(snap(pkt.ls_y) as u64, u64_of(&s["ls_y"]), "snap ls_y [{desc}]");
        assert_eq!(snap(pkt.rs_x) as u64, u64_of(&s["rs_x"]), "snap rs_x [{desc}]");
        assert_eq!(snap(pkt.rs_y) as u64, u64_of(&s["rs_y"]), "snap rs_y [{desc}]");

        // final pad floats
        let a = pad_axes(&pkt);
        let e = &p["pad_axes"];
        for (got, key) in [
            (a.left_x, "left_x"),
            (a.left_y, "left_y"),
            (a.right_x, "right_x"),
            (a.right_y, "right_y"),
        ] {
            let want = e[key].as_f64().unwrap();
            assert!(
                (got - want).abs() < 1e-12,
                "{key} = {got}, python = {want} [{desc}]"
            );
        }
    }
}

/// Every stick byte → the exact XInput i16 vgamepad would produce, for all 256
/// inputs, in both normal and negated (Y-axis) form. This is where a port
/// silently inverts or off-by-ones an axis, so it is checked exhaustively.
#[test]
fn thumb_i16_conversion_matches_vgamepad_for_all_256() {
    let g = golden();
    let pos = g["thumb_i16"].as_array().unwrap();
    let neg = g["thumb_i16_neg"].as_array().unwrap();
    assert_eq!(pos.len(), 256);
    assert_eq!(neg.len(), 256);

    for v in 0u16..256 {
        let b = v as u8;
        let a = axis(snap(b));
        assert_eq!(
            thumb_i16(a) as i64,
            pos[v as usize].as_i64().unwrap(),
            "thumb_i16 for byte {b}"
        );
        assert_eq!(
            thumb_i16(-a) as i64,
            neg[v as usize].as_i64().unwrap(),
            "negated thumb_i16 for byte {b}"
        );
    }
    // Neutral must be exactly 0 — a resting stick must not drift the cursor.
    assert_eq!(thumb_i16(axis(snap(128))), 0);
    // Triggers are pass-through, not scaled.
    assert_eq!(trigger_u8(0), 0);
    assert_eq!(trigger_u8(255), 255);
}

/// ACK framing — the phone's RTT badge depends on the echoed timestamp.
#[test]
fn ack_frames_match() {
    let g = golden();
    for a in g["ack_frames"].as_array().unwrap() {
        let ts = u64_of(&a["ts"]);
        let want: Vec<u8> = a["bytes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b.as_u64().unwrap() as u8)
            .collect();
        assert_eq!(&ack_frame(ts)[..], &want[..], "ACK frame for ts={ts}");
    }
}

/// Rumble framing.
#[test]
fn rmb_frames_match() {
    let g = golden();
    for r in g["rmb_frames"].as_array().unwrap() {
        let l = u64_of(&r["large"]) as u8;
        let s = u64_of(&r["small"]) as u8;
        let want: Vec<u8> = r["bytes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b.as_u64().unwrap() as u8)
            .collect();
        assert_eq!(&rmb_frame(l, s)[..], &want[..], "RMB frame l={l} s={s}");
    }
}

/// Button bit → XInput name, scraped from the real `apply_inputs`.
#[test]
fn button_map_matches_apply_inputs() {
    let g = golden();
    let want = g["buttons"].as_object().unwrap();
    assert_eq!(want.len(), BUTTON_MAP.len(), "button count differs");
    for (bit, name) in BUTTON_MAP {
        let k = bit.to_string();
        let w = want
            .get(&k)
            .unwrap_or_else(|| panic!("python has no mapping for bit {bit}"))
            .as_str()
            .unwrap();
        assert_eq!(name, w, "bit {bit} maps to {w} in python, {name} here");
    }
    // spot-check the decoder over a mask
    let pressed = buttons_pressed(0b0100_0000_0000_0101);
    assert_eq!(pressed, vec!["A", "X", "GUIDE"]);
    assert!(buttons_pressed(0).is_empty());
}

/// Ordering guard: stale frames drop, clock resets pass, equal is not stale.
#[test]
fn ordering_rule_matches() {
    let g = golden();
    for o in g["ordering"].as_array().unwrap() {
        let last = u64_of(&o["last_ts"]);
        let ts = u64_of(&o["ts"]);
        let want = o["accept"].as_bool().unwrap();
        assert_eq!(
            accept_ordering(last, ts),
            want,
            "ordering last_ts={last} ts={ts}"
        );
    }
}

/// Cleartext auth policy, including the keyless token-0 USB-tether path.
#[test]
fn auth_policy_matches() {
    let g = golden();
    for a in g["auth"].as_array().unwrap() {
        let token = u64_of(&a["token"]) as u32;
        let expected = u64_of(&a["expected"]) as u32;
        let off = a["offlan_or_tether"].as_bool().unwrap();
        let want = a["accept"].as_bool().unwrap();
        assert_eq!(
            accept_auth(token, expected, off),
            want,
            "auth token={token:#X} expected={expected:#X} offlan={off}"
        );
    }
}

/// Neutral-state sanity: a centred packet must produce exactly 0.0 on every
/// axis, so a resting pad never nudges the Windows shell.
#[test]
fn neutral_packet_is_exactly_centred() {
    let p = Packet {
        ts: 1,
        buttons: 0,
        lt: 0,
        rt: 0,
        ls_x: 128,
        ls_y: 128,
        rs_x: 128,
        rs_y: 128,
        auth_token: 0xABCD_1234,
    };
    let a = pad_axes(&p);
    assert_eq!(a.left_x, 0.0);
    assert_eq!(a.left_y, 0.0);
    assert_eq!(a.right_x, 0.0);
    assert_eq!(a.right_y, 0.0);
    assert!(buttons_pressed(p.buttons).is_empty());
}
