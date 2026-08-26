#!/usr/bin/env python3
"""
GRX INTEROP: drive the Rust implementation with the REAL Python client session.

Golden vectors prove the Rust matches Python's arithmetic. This proves the two
actually talk to each other — a full 1-RTT handshake plus encrypted traffic in
both directions, with Python playing the role the Android phone plays.

It exercises the Rust side through a tiny helper binary (`examples/grx_peer.rs`)
that reads framed messages on stdin and writes replies on stdout, so no network
is involved and the test is deterministic.

Usage:
    cargo build --release --example grx_peer
    python tools/grx_interop_test.py
"""
import binascii
import importlib.util
import json
import os
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RS_ROOT = os.path.dirname(HERE)
PY_DIRS = [
    os.path.abspath(os.path.join(RS_ROOT, "..", "pc-server")),
    os.path.abspath(os.path.join(RS_ROOT, "..", "..", "releases", "archive",
                                 "pc-server-python-2026-07-21")),
]
PEER = os.path.join(RS_ROOT, "target", "release", "examples", "grx_peer.exe")

FAILS = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (" — " + detail if detail else ""))
    if not cond:
        FAILS.append(name)


def load(modname):
    for d in PY_DIRS:
        path = os.path.join(d, modname + ".py")
        if os.path.exists(path):
            if d not in sys.path:
                sys.path.insert(0, d)
            spec = importlib.util.spec_from_file_location(modname, path)
            m = importlib.util.module_from_spec(spec)
            sys.modules[modname] = m
            spec.loader.exec_module(m)
            return m
    raise SystemExit(f"FATAL: {modname}.py not found")


def main():
    if not os.path.exists(PEER):
        raise SystemExit(f"FATAL: {PEER} not built.\n"
                         f"Run: cargo build --release --example grx_peer")
    gx = load("grx_crypto")
    gs = load("grx_session")

    psk = bytes([0xA5] * 32)
    ltid = b"gamepados-grx-v1"

    proc = subprocess.Popen([PEER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE)

    def rpc(op, data=b""):
        """One line of JSON in, one line of JSON out."""
        msg = json.dumps({"op": op, "data": binascii.hexlify(data).decode()}) + "\n"
        proc.stdin.write(msg.encode())
        proc.stdin.flush()
        line = proc.stdout.readline()
        if not line:
            err = proc.stderr.read().decode(errors="replace")
            raise SystemExit(f"peer died during '{op}':\n{err}")
        r = json.loads(line)
        if "error" in r:
            return None, r["error"]
        return binascii.unhexlify(r.get("data", "")), None

    # Tell the Rust peer which psk/ltid to use.
    _, err = rpc("init", psk + ltid)
    check("rust peer initialised", err is None, err or "")

    print("\n[1] full 1-RTT handshake: PYTHON client -> RUST server")
    client = gs.GrxClientSession(psk, ltid)
    hello = client.hello()
    check("python HELLO built", hello[0] == gs.T_HELLO and len(hello) >= 34)

    shello, err = rpc("hello", hello)
    check("rust returned SERVER_HELLO", err is None and shello is not None, err or "")
    if shello:
        check("SERVER_HELLO is 65 bytes, type 0xE2",
              len(shello) == 65 and shello[0] == gs.T_SHELLO, f"got {len(shello)}B")
        # This verifies the RUST server's confirm tag using PYTHON's crypto —
        # if the key derivation differed at all, this raises.
        try:
            cconfirm = client.handle_server_hello(shello)
            check("python VERIFIED rust's server-confirm tag", True,
                  "key derivation agrees end-to-end")
        except Exception as e:
            check("python VERIFIED rust's server-confirm tag", False, str(e))
            cconfirm = None

        if cconfirm:
            _, err = rpc("confirm", cconfirm)
            check("rust accepted python's CLIENT_CONFIRM", err is None, err or "")

    print("\n[2] encrypted input: PYTHON seals -> RUST opens")
    ok = 0
    for i in range(100):
        pt = struct.pack("<Q H B B B B B B I", 5000 + i, i & 0xFFFF,
                         i & 0xFF, 0, 128, 128, 128, 128, 0xABCD1234)
        frame = client.seal(pt)
        if len(frame) != gx.WIRE_LEN:
            break
        got, err = rpc("open", frame)
        if err is None and got == pt:
            ok += 1
    check("100 encrypted frames decrypted correctly by rust", ok == 100, f"got {ok}")

    print("\n[3] replay is rejected by rust")
    pt = struct.pack("<Q H B B B B B B I", 9999, 0, 0, 0, 128, 128, 128, 128, 0)
    frame = client.seal(pt)
    got, err = rpc("open", frame)
    check("fresh frame opens", err is None and got == pt)
    got2, err2 = rpc("open", frame)
    check("replayed frame REJECTED", got2 is None or err2 is not None)

    print("\n[4] tampered frame rejected, window not wedged")
    good = client.seal(struct.pack("<Q H B B B B B B I", 10001, 0, 0, 0, 128, 128, 128, 128, 0))
    bad = bytearray(client.seal(struct.pack("<Q H B B B B B B I", 10002, 0, 0, 0, 128, 128, 128, 128, 0)))
    bad[gx.HEADER_LEN + 2] ^= 0x01
    _, err = rpc("open", bytes(bad))
    check("bit-flipped frame rejected", err is not None)
    got, err = rpc("open", good)
    check("legit frame still accepted afterwards", err is None and got is not None,
          "forgery did not wedge the replay window")

    print("\n[5] reverse direction: RUST seals -> PYTHON opens")
    rumble = struct.pack("<Q H B B B B B B I", 1, 0, 200, 180, 0, 0, 0, 0, 0)
    sealed, err = rpc("seal", rumble)
    check("rust sealed an s2c frame", err is None and sealed is not None and len(sealed) == gx.WIRE_LEN,
          err or (f"{len(sealed)}B" if sealed else ""))
    if sealed:
        opened = client.open(sealed)
        check("python decrypted rust's s2c frame", opened == rumble)

    print("\n[6] wrong-PSK client cannot establish against rust")
    _, err = rpc("reset", b"")
    bad_client = gs.GrxClientSession(os.urandom(32), ltid)
    shello2, err = rpc("hello", bad_client.hello())
    if shello2:
        try:
            bad_confirm = bad_client.handle_server_hello(shello2)
            # Python's own check should already fail; if it somehow passes,
            # Rust must still reject the confirm.
            _, err = rpc("confirm", bad_confirm)
            check("rust rejected wrong-PSK confirm", err is not None, err or "ACCEPTED (BAD!)")
        except Exception:
            check("wrong-PSK rejected at handshake", True, "python could not verify rust's tag")

    proc.stdin.close()
    proc.terminate()

    print("\n" + ("ALL GRX INTEROP CHECKS PASSED" if not FAILS else f"FAILURES: {FAILS}"))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
