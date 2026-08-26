#!/usr/bin/env python3
"""
GRX golden-vector generator.

Emits `tests/grx_vectors.json` from the REAL `grx_crypto.py` / `grx_session.py`,
so the Rust implementation is checked against the shipped crypto rather than
against my reading of it.

Crypto is where "looks right" is worth nothing: a wrong HKDF label, a swapped
nonce field order or a mis-sized AAD all produce output that is perfectly
well-formed and completely undecryptable by the phone. Every derived value below
is therefore pinned.

Deterministic by construction: all keys/nonces are FIXED test values, never
random, so the vectors are reproducible and diffable.

Run:  python tools/gen_grx_vectors.py
"""
import binascii
import importlib.util
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RS_ROOT = os.path.dirname(HERE)
PY_DIRS = [
    os.path.abspath(os.path.join(RS_ROOT, "..", "pc-server")),
    os.path.abspath(os.path.join(RS_ROOT, "..", "..", "releases", "archive",
                                 "pc-server-python-2026-07-21")),
]


def load(modname):
    for d in PY_DIRS:
        path = os.path.join(d, modname + ".py")
        if not os.path.exists(path):
            continue
        if d not in sys.path:
            sys.path.insert(0, d)
        spec = importlib.util.spec_from_file_location(modname, path)
        m = importlib.util.module_from_spec(spec)
        sys.modules[modname] = m
        spec.loader.exec_module(m)
        return m, path
    raise SystemExit(f"FATAL: {modname}.py not found in {PY_DIRS}")


def hx(b):
    return binascii.hexlify(bytes(b)).decode()


def main():
    gx, gx_path = load("grx_crypto")
    gs, gs_path = load("grx_session")
    print(f"[grx] using {gx_path}")
    print(f"[grx] using {gs_path}")

    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives import hashes

    # Sanity: constants must be what the Rust side hardcodes.
    assert gx.VERSION == 1 and gx.CIPHER_ID == 1
    assert gx.KEY_LEN == 16 and gx.TAG_LEN == 16
    assert gx.PLAINTEXT_LEN == 20 and gx.HEADER_LEN == 5 and gx.WIRE_LEN == 41
    assert gx.DIR_C2S == 1 and gx.DIR_S2C == 2

    # ── FIXED key material (never random — vectors must be reproducible) ─────
    c_priv_raw = bytes(range(32))                       # 00 01 02 ... 1f
    s_priv_raw = bytes(range(32, 64))                   # 20 21 22 ... 3f
    c_priv = X25519PrivateKey.from_private_bytes(c_priv_raw)
    s_priv = X25519PrivateKey.from_private_bytes(s_priv_raw)
    c_pub = c_priv.public_key().public_bytes_raw()
    s_pub = s_priv.public_key().public_bytes_raw()
    psk = bytes([0xA5] * 32)
    ltid = gs and b"gamepados-grx-v1"

    shared = c_priv.exchange(s_priv.public_key())
    th = gx.transcript_hash(c_pub, s_pub, ltid)
    keys = gx.derive_keys(shared, psk, th)

    # Server side must derive identical keys from the mirrored inputs.
    sk = gx.handshake(s_priv, c_pub, psk, ltid, am_client=False)
    assert sk["c2s"] == keys["c2s"] and sk["s2c"] == keys["s2c"], "key agreement mismatch"
    assert sk["transcript"] == th

    # ── PSK derivation from the pairing key (server.py::_grx_psk_from_key) ───
    def psk_from_key(key_str):
        try:
            ikm = bytes.fromhex(key_str)
        except (ValueError, TypeError):
            ikm = (key_str or "").encode()
        return HKDF(algorithm=hashes.SHA256(), length=32,
                    salt=b"", info=b"grx psk v1").derive(ikm)

    psk_cases = []
    for k in ["777a51b3", "abcd1234", "00000000", "deadbeef"]:
        psk_cases.append({"pairing_key": k, "psk": hx(psk_from_key(k))})

    # ── seal/open with a FIXED key so ciphertext is byte-pinned ─────────────
    fixed_key = bytes(range(16))
    seals = []
    snd = gx.GrxSender(fixed_key, gx.DIR_C2S)
    for i in range(5):
        pt = struct.pack(gx.PLAINTEXT_LEN * "B" if False else "<Q H B B B B B B I",
                         1000 + i, (i * 7) & 0xFFFF, i, 255 - i, 128, 128 + i, 128, 128, 0xABCD1234)
        frame = snd.seal(pt)
        assert len(frame) == gx.WIRE_LEN
        seals.append({
            "counter": snd.counter,
            "plaintext": hx(pt),
            "frame": hx(frame),
            "nonce": hx(gx._nonce(gx.DIR_C2S, snd.counter)),
            "aad": hx(gx._aad(snd.counter)),
        })

    # ── replay-window behaviour (pure logic, easy to get subtly wrong) ───────
    win_cases = []
    w = gx.ReplayWindow()
    for c in [1, 2, 3, 10, 9, 8, 3, 1, 2000, 1999]:
        ok = w.check(c)
        win_cases.append({"counter": c, "accept": bool(ok)})
        if ok:
            w.commit(c)
    # counter 0 is never valid
    win_cases.append({"counter": 0, "accept": bool(gx.ReplayWindow().check(0))})

    reconstruct_cases = []
    w2 = gx.ReplayWindow()
    w2.high = 0x1_0000_0005
    for low in [0x00000006, 0x00000004, 0xFFFFFFFF, 0x80000006]:
        reconstruct_cases.append({"high": w2.high, "low32": low,
                                  "counter": w2.reconstruct(low)})

    # ── a full 1-RTT handshake transcript, message by message ───────────────
    # Uses the real session layer, so the framing bytes are pinned too.
    c = gs.GrxClientSession(psk, ltid)
    s = gs.GrxServerSession(psk, ltid)
    hello = c.hello()
    shello = s.handle_hello(hello)
    cconfirm = c.handle_server_hello(shello)
    s.handle_confirm(cconfirm)
    assert c.established and s.established
    # ephemeral keys are random here, so pin only the STRUCTURE, not the bytes
    handshake_shape = {
        "hello_first_byte": hello[0],
        "hello_len": len(hello),
        "shello_first_byte": shello[0],
        "shello_len": len(shello),
        "confirm_first_byte": cconfirm[0],
        "confirm_len": len(cconfirm),
        "T_HELLO": gs.T_HELLO, "T_SHELLO": gs.T_SHELLO, "T_CONFIRM": gs.T_CONFIRM,
        "hs_min_len": {str(k): v for k, v in gs._HS_MIN_LEN.items()},
    }

    out = {
        "_comment": "GENERATED by tools/gen_grx_vectors.py from the real "
                    "grx_crypto.py/grx_session.py. DO NOT hand-edit.",
        "source": [gx_path, gs_path],
        "consts": {
            "VERSION": gx.VERSION, "CIPHER_ID": gx.CIPHER_ID,
            "DIR_C2S": gx.DIR_C2S, "DIR_S2C": gx.DIR_S2C,
            "KEY_LEN": gx.KEY_LEN, "TAG_LEN": gx.TAG_LEN,
            "PLAINTEXT_LEN": gx.PLAINTEXT_LEN, "HEADER_LEN": gx.HEADER_LEN,
            "WIRE_LEN": gx.WIRE_LEN,
        },
        "ltid": hx(ltid),
        "x25519": {
            "client_priv": hx(c_priv_raw), "client_pub": hx(c_pub),
            "server_priv": hx(s_priv_raw), "server_pub": hx(s_pub),
            "shared": hx(shared),
        },
        "psk": hx(psk),
        "transcript_hash": hx(th),
        "derived": {
            "c2s": hx(keys["c2s"]),
            "s2c": hx(keys["s2c"]),
            "confirm": hx(keys["confirm"]),
        },
        "confirm_tags": {
            "client": hx(gx.confirm_tag(keys["confirm"], th, gs.ROLE_CLIENT)),
            "server": hx(gx.confirm_tag(keys["confirm"], th, gs.ROLE_SERVER)),
        },
        "psk_from_pairing_key": psk_cases,
        "seal": {"key": hx(fixed_key), "direction": gx.DIR_C2S, "frames": seals},
        "replay_window": win_cases,
        "reconstruct": reconstruct_cases,
        "handshake_shape": handshake_shape,
    }

    dest = os.path.join(RS_ROOT, "tests", "grx_vectors.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print(f"[grx] wrote {dest}")
    print(f"[grx] transcript={hx(th)[:16]}…  c2s={hx(keys['c2s'])[:16]}…")
    print(f"[grx] {len(seals)} sealed frames, {len(win_cases)} window cases, "
          f"{len(psk_cases)} psk cases")


if __name__ == "__main__":
    main()
