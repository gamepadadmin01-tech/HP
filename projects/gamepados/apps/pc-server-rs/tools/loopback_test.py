#!/usr/bin/env python3
"""
End-to-end loopback check: fire REAL-format 20-byte packets at the Rust server
and verify the ACK/RMB replies come back byte-correct.

Uses the wire format taken from the real `server.py` (same AST extraction as
gen_golden.py), so this proves the Rust server speaks the actual protocol —
not a format we invented to match it.

Runs on a spare port by default so it never disturbs the live Python server.

Usage:
    # terminal 1
    cargo run --release -- --dry-run --port 7778 --lan-ip 192.168.1.34
    # terminal 2
    python tools/loopback_test.py --port 7778
"""
import argparse
import ast
import os
import socket
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RS_ROOT = os.path.dirname(HERE)
CANDIDATES = [
    os.path.join(RS_ROOT, "..", "pc-server", "server.py"),
    os.path.join(RS_ROOT, "..", "..", "releases", "archive",
                 "pc-server-python-2026-07-21", "server.py"),
]


def wire_format():
    """Read PAYLOAD_FORMAT out of the real server (no import — it blocks)."""
    for cand in CANDIDATES:
        path = os.path.abspath(cand)
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            src = f.read()
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.Assign):
                for t in node.targets:
                    if isinstance(t, ast.Name) and t.id == "PAYLOAD_FORMAT":
                        return ast.literal_eval(node.value), path
    raise SystemExit("FATAL: could not read PAYLOAD_FORMAT from any server.py")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=7778)
    ap.add_argument("--token", default="ABCD1234")
    args = ap.parse_args()

    fmt, src = wire_format()
    token = int(args.token, 16)
    print("wire format %r (from %s)" % (fmt, src))
    assert struct.calcsize(fmt) == 20

    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(2.0)
    dest = (args.host, args.port)
    failures = []

    def send(ts, buttons=0, lt=0, rt=0, lsx=128, lsy=128, rsx=128, rsy=128, auth=None):
        pkt = struct.pack(fmt, ts, buttons, lt, rt, lsx, lsy, rsx, rsy,
                          token if auth is None else auth)
        assert len(pkt) == 20
        s.sendto(pkt, dest)

    def recv_all(timeout=0.4):
        """Collect everything that arrives within `timeout`."""
        out = []
        s.settimeout(timeout)
        while True:
            try:
                data, _ = s.recvfrom(256)
                out.append(data)
            except socket.timeout:
                return out

    def check(name, cond, detail=""):
        print(("  PASS  " if cond else "  FAIL  ") + name + (" — " + detail if detail else ""))
        if not cond:
            failures.append(name)

    print("\n[1] valid frame is ACKed with the echoed timestamp")
    ts = 1_000_000
    send(ts, buttons=0x0001)
    replies = recv_all()
    acks = [r for r in replies if r[:3] == b"ACK"]
    check("got an ACK", len(acks) == 1, "%d reply(ies)" % len(replies))
    if acks:
        echoed = struct.unpack("<Q", acks[0][3:11])[0]
        check("ACK echoes our exact timestamp", echoed == ts, "sent %d got %d" % (ts, echoed))
        check("ACK is exactly 11 bytes", len(acks[0]) == 11, "got %d" % len(acks[0]))

    print("\n[2] stale (out-of-order) frame is NOT ACKed")
    send(ts - 1, buttons=0x0002)
    stale = [r for r in recv_all() if r[:3] == b"ACK"]
    check("no ACK for a stale frame", len(stale) == 0, "%d ACK(s)" % len(stale))

    print("\n[3] newer frame resumes ACKing")
    send(ts + 1, buttons=0x0004)
    check("ACK resumed", any(r[:3] == b"ACK" for r in recv_all()))

    print("\n[4] malformed lengths are ignored")
    s.sendto(b"", dest)
    s.sendto(b"\x00" * 19, dest)
    s.sendto(b"\x00" * 41, dest)   # GRX-sized frame: Python's job, not ours
    check("no reply to malformed frames", len(recv_all(0.3)) == 0)

    print("\n[5] bad auth token is rejected (on-LAN source)")
    send(ts + 2, auth=0xDEADBEEF)
    check("no ACK for bad token", len([r for r in recv_all() if r[:3] == b"ACK"]) == 0)

    print("\n[6] burst coalesces queued input and ACKs the newest frame")
    echoed_burst = []
    for i in range(200):
        send(ts + 100 + i, buttons=(i & 0xFF))
    for r in recv_all(1.0):
        if r[:3] == b"ACK" and len(r) == 11:
            echoed_burst.append(struct.unpack("<Q", r[3:11])[0])
    # main.rs drains to newest per peer, matching server.py. Dropping queued
    # older input is deliberate; the final frame must still be acknowledged.
    check("newest burst frame ACKed", ts + 299 in echoed_burst,
          "%d replies" % len(echoed_burst))
    check("burst echoes are unique and in order",
          bool(echoed_burst) and echoed_burst == sorted(set(echoed_burst))
          and all(ts + 100 <= t <= ts + 299 for t in echoed_burst))

    print("\n" + ("ALL CHECKS PASSED" if not failures else "FAILURES: %r" % failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
