#!/usr/bin/env python3
"""
PHASE 2 — wire-conformance GOLDEN VECTOR GENERATOR.

Emits `tests/golden_vectors.json`, the byte-exact contract the Rust UDP server
must reproduce.

WHY THIS EXISTS: a previous Rust rewrite (`pc-server-rust/`, ~3.1 GB) was
DELETED because it invented its own wire format (HMAC + i16 sticks + 16-char
key) and therefore dropped EVERY packet. Conformance is proven here FIRST; no
Rust server code is trusted until these vectors pass.

HOW IT STAYS HONEST: every constant, lookup table and button mapping is
EXTRACTED FROM THE REAL `server.py` SOURCE — never hand-transcribed. We parse
the file with `ast` and evaluate only the specific pure expressions
(`PAYLOAD_FORMAT`, `_SNAP_LUT`, `_AXIS_LUT`, `MAX_PADS`) plus scrape the
button-bit table straight out of `apply_inputs`. We deliberately do NOT import
server.py: importing it blocks (ViGEm/vgamepad init + network probing) and
could disturb the live server. If any of those expressions change upstream,
this generator picks the change up automatically, and the Rust tests fail loudly
instead of drifting silently.

Run:  python tools/gen_golden.py
"""
import ast
import json
import os
import re
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
RS_ROOT = os.path.dirname(HERE)
# Prefer the LIVE server; fall back to the verified 2026-07-21 preserved snapshot.
CANDIDATES = [
    os.path.join(RS_ROOT, "..", "pc-server", "server.py"),
    os.path.join(RS_ROOT, "..", "..", "releases", "archive",
                 "pc-server-python-2026-07-21", "server.py"),
]

# Pure builtins the extracted expressions legitimately need. Nothing else is
# reachable, so evaluating them cannot touch the filesystem, network or driver.
SAFE_BUILTINS = {
    "abs": abs, "min": min, "max": max, "range": range,
    "bytes": bytes, "tuple": tuple, "list": list, "len": len,
    "int": int, "float": float,
}
WANTED = ("PAYLOAD_FORMAT", "_SNAP_LUT", "_AXIS_LUT", "MAX_PADS")


def find_server():
    for cand in CANDIDATES:
        path = os.path.abspath(cand)
        if os.path.exists(path):
            return path
    raise SystemExit("FATAL: no reference server.py found in %r" % (CANDIDATES,))


def extract(path):
    """Pull the constants + button map out of the real source, without importing."""
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        src = f.read()
    tree = ast.parse(src)

    consts = {}
    apply_src = None
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id in WANTED and t.id not in consts:
                    expr = ast.get_source_segment(src, node.value)
                    consts[t.id] = eval(expr, {"__builtins__": SAFE_BUILTINS}, {})
        elif isinstance(node, ast.FunctionDef) and node.name == "apply_inputs":
            apply_src = ast.get_source_segment(src, node)

    missing = [w for w in WANTED if w not in consts]
    if missing:
        raise SystemExit("FATAL: could not extract %r from %s" % (missing, path))
    if apply_src is None:
        raise SystemExit("FATAL: could not locate apply_inputs() in %s" % path)

    # Scrape the button-bit -> XInput mapping directly out of apply_inputs, in
    # source order, so the table is the server's own truth.
    bits = [int(b) for b in re.findall(r"1\s*<<\s*(\d+)", apply_src)]
    names = re.findall(r"XUSB_GAMEPAD_(\w+)", apply_src)
    if len(bits) != len(names):
        raise SystemExit("FATAL: button scrape mismatch — %d bits vs %d names"
                         % (len(bits), len(names)))
    buttons = {}
    for b, n in zip(bits, names):
        if b in buttons and buttons[b] != n:
            raise SystemExit("FATAL: conflicting mapping for bit %d" % b)
        buttons[b] = n
    return consts, buttons, src


def main():
    path = find_server()
    consts, buttons_map, _src = extract(path)
    print("[golden] extracted from: %s" % path)

    fmt = consts["PAYLOAD_FORMAT"]
    size = struct.calcsize(fmt)
    if size != 20 or fmt != "<Q H B B B B B B I":
        raise SystemExit("FATAL: wire format changed! fmt=%r size=%d" % (fmt, size))

    snap_lut = list(consts["_SNAP_LUT"])
    axis_lut = [float(v) for v in consts["_AXIS_LUT"]]
    if len(snap_lut) != 256 or len(axis_lut) != 256:
        raise SystemExit("FATAL: LUT length changed")
    print("[golden] format=%r size=%d  buttons=%d  max_pads=%s"
          % (fmt, size, len(buttons_map), consts["MAX_PADS"]))

    # ── Round-trip packets: (ts, buttons, lt, rt, lsx, lsy, rsx, rsy, auth) ──
    cases = [
        (0, 0, 0, 0, 128, 128, 128, 128, 0xABCD1234),           # neutral
        (1, 0xFFFF, 255, 255, 255, 255, 255, 255, 0xABCD1234),  # everything max
        (2, 0x0001, 0, 0, 0, 0, 0, 0, 0),                       # A + all-min, token 0
        (0xFFFFFFFFFFFFFFFF, 0x4000, 1, 254, 127, 129, 124, 132, 0xFFFFFFFF),
        (1234567890123, 0x2A55, 33, 200, 130, 126, 132, 124, 0xABCD1234),
        (999, 1 << 14, 128, 128, 132, 124, 128, 128, 0xABCD1234),   # guide bit
        (10, 0, 0, 0, 132, 124, 133, 123, 0xABCD1234),              # deadzone edges
    ]
    packets = []
    for c in cases:
        raw = struct.pack(fmt, *c)
        assert len(raw) == 20
        assert struct.unpack(fmt, raw) == c, "round-trip failed for %r" % (c,)
        ts, btns, lt, rt, lsx, lsy, rsx, rsy, auth = c
        s = {"ls_x": snap_lut[lsx], "ls_y": snap_lut[lsy],
             "rs_x": snap_lut[rsx], "rs_y": snap_lut[rsy]}
        packets.append({
            "desc": "ts=%d buttons=0x%04X" % (ts, btns),
            "fields": {"ts": ts, "buttons": btns, "lt": lt, "rt": rt,
                       "ls_x": lsx, "ls_y": lsy, "rs_x": rsx, "rs_y": rsy,
                       "auth_token": auth},
            "bytes": list(raw),
            "snapped": s,
            # Exactly what apply_inputs hands the virtual pad. NOTE: Y axes are
            # NEGATED (server.py `y_value_float=-_AXIS_LUT[...]`).
            "pad_axes": {
                "left_x":  axis_lut[s["ls_x"]],
                "left_y":  -axis_lut[s["ls_y"]],
                "right_x": axis_lut[s["rs_x"]],
                "right_y": -axis_lut[s["rs_y"]],
            },
        })

    # ── Thumbstick byte -> XInput i16, EXACTLY as vgamepad computes it ───────
    # vgamepad/win/virtual_gamepad.py:
    #   left_joystick_float(x, y) -> left_joystick(round(x * 32767), round(y * 32767))
    # and server.py negates BOTH Y axes before calling it.
    #
    # ⚠️ Python's round() is BANKER'S rounding (half-to-even); Rust's f64::round()
    # is half-away-from-zero. They differ only on exact .5 values. Here the input
    # is (b-128)/127*32767 = 258*(b-128) + (b-128)/127, whose fractional part is
    # k/127 — and since 127 is odd, k/127 can never equal exactly 0.5. So the two
    # rounding modes agree for every possible input. We emit all 256 values
    # anyway so the Rust side is *verified*, not merely argued.
    thumb_i16 = [int(round(axis_lut[snap_lut[b]] * 32767)) for b in range(256)]
    thumb_i16_neg = [int(round(-axis_lut[snap_lut[b]] * 32767)) for b in range(256)]
    # sanity: nothing may exceed the i16 range
    assert all(-32768 <= v <= 32767 for v in thumb_i16 + thumb_i16_neg)

    # Triggers are passed through as RAW BYTES (server.py: left_trigger(value=lt)),
    # so there is deliberately no trigger conversion table.

    # ── Reply framing ────────────────────────────────────────────────────────
    acks = [{"ts": ts, "bytes": list(b"ACK" + struct.pack("<Q", ts))}
            for ts in (0, 1, 1234567890123, 0xFFFFFFFFFFFFFFFF)]
    rmbs = [{"large": l, "small": r, "bytes": list(b"RMB" + bytes([l & 0xFF, r & 0xFF]))}
            for (l, r) in ((0, 0), (255, 0), (0, 255), (128, 64), (255, 255))]

    # ── Ordering rule (server.py handle_frame) ───────────────────────────────
    # if ts < last_ts: accept ONLY when (last_ts - ts) > 1e9 (clock reset), else drop.
    CLOCK_RESET_NS = 1_000_000_000
    ordering = [
        {"last_ts": 0, "ts": 0, "accept": True},
        {"last_ts": 100, "ts": 101, "accept": True},
        {"last_ts": 100, "ts": 100, "accept": True},           # equal is NOT older
        {"last_ts": 100, "ts": 99, "accept": False},            # stale -> drop
        {"last_ts": 5_000_000_000, "ts": 4_000_000_000, "accept": False},  # ==1e9, not >
        {"last_ts": 5_000_000_001, "ts": 4_000_000_000, "accept": True},   # >1e9 -> reset
    ]
    for o in ordering:
        lt_, t = o["last_ts"], o["ts"]
        assert ((not (t < lt_)) or (lt_ - t) > CLOCK_RESET_NS) == o["accept"], o

    # ── Cleartext auth policy ────────────────────────────────────────────────
    auth = [
        {"token": 0xABCD1234, "expected": 0xABCD1234, "offlan_or_tether": False, "accept": True},
        {"token": 0xABCD1234, "expected": 0xABCD1234, "offlan_or_tether": True,  "accept": True},
        {"token": 0, "expected": 0xABCD1234, "offlan_or_tether": True,  "accept": True},
        {"token": 0, "expected": 0xABCD1234, "offlan_or_tether": False, "accept": False},
        {"token": 0xDEADBEEF, "expected": 0xABCD1234, "offlan_or_tether": True, "accept": False},
        {"token": 0, "expected": 0, "offlan_or_tether": False, "accept": True},
    ]
    for a in auth:
        ok = (a["token"] == a["expected"]) or (a["token"] == 0 and a["offlan_or_tether"])
        assert ok == a["accept"], a

    out = {
        "_comment": "GENERATED by tools/gen_golden.py from the real Python server "
                    "source (AST-extracted, not transcribed). DO NOT hand-edit — "
                    "re-run the generator.",
        "source_server": path,
        "payload_format": fmt,
        "payload_size": size,
        "clock_reset_ns": CLOCK_RESET_NS,
        "max_pads": int(consts["MAX_PADS"]),
        "snap_lut": snap_lut,
        "axis_lut": axis_lut,
        "thumb_i16": thumb_i16,
        "thumb_i16_neg": thumb_i16_neg,
        "packets": packets,
        "ack_frames": acks,
        "rmb_frames": rmbs,
        "buttons": {str(k): v for k, v in sorted(buttons_map.items())},
        "ordering": ordering,
        "auth": auth,
    }

    dest_dir = os.path.join(RS_ROOT, "tests")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, "golden_vectors.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print("[golden] wrote %s" % dest)
    print("[golden] %d packets, %d acks, %d rmbs, %d ordering, %d auth"
          % (len(packets), len(acks), len(rmbs), len(ordering), len(auth)))
    print("[golden] button map: %s" % out["buttons"])


if __name__ == "__main__":
    main()
