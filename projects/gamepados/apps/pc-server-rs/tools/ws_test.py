#!/usr/bin/env python3
"""
Validate the hand-rolled WebSocket bridge against a REAL WebSocket client
library (the same `websockets` package the Python server uses).

This is the important test: if the standards-compliant client completes the
handshake and exchanges frames, the hand-rolled server speaks real WebSocket —
not merely something my own encoder can read.

Usage:
    python tools/ws_test.py [--port 7777]
"""
import argparse
import ast
import asyncio
import os
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
                        return ast.literal_eval(node.value)
    raise SystemExit("FATAL: could not read PAYLOAD_FORMAT")


FAILS = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (" — " + detail if detail else ""))
    if not cond:
        FAILS.append(name)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7777)
    args = ap.parse_args()

    try:
        import websockets
    except ImportError:
        raise SystemExit("FATAL: pip package 'websockets' not available")

    fmt = wire_format()
    assert struct.calcsize(fmt) == 20
    url = f"ws://127.0.0.1:{args.port}"

    print(f"\n[1] handshake against {url} (real client library)")
    async with websockets.connect(url, max_size=None) as ws:
        check("handshake completed", True, "server spoke valid RFC6455")

        print("\n[2] a 20-byte input frame is ACKed with the echoed timestamp")
        ts = 424242
        pkt = struct.pack(fmt, ts, 0x0001, 0, 0, 128, 128, 128, 128, 0)
        await ws.send(pkt)
        ack = None
        for _ in range(6):  # skip any RMB frames that arrive first
            msg = await asyncio.wait_for(ws.recv(), timeout=3.0)
            if msg[:3] == b"ACK":
                ack = msg
                break
        check("got an ACK", ack is not None)
        if ack:
            check("ACK is 11 bytes", len(ack) == 11, f"got {len(ack)}")
            echoed = struct.unpack("<Q", ack[3:11])[0]
            check("ACK echoes our timestamp", echoed == ts, f"sent {ts} got {echoed}")

        print("\n[3] malformed frames are ignored, connection survives")
        await ws.send(b"")
        await ws.send(b"\x00" * 19)
        await ws.send(b"\x00" * 41)
        ts2 = ts + 1
        await ws.send(struct.pack(fmt, ts2, 0x0002, 0, 0, 128, 128, 128, 128, 0))
        ok = False
        for _ in range(6):
            msg = await asyncio.wait_for(ws.recv(), timeout=3.0)
            if msg[:3] == b"ACK" and struct.unpack("<Q", msg[3:11])[0] == ts2:
                ok = True
                break
        check("still ACKing after malformed input", ok)

        print("\n[4] stale (out-of-order) frame is NOT ACKed")
        await ws.send(struct.pack(fmt, ts2 - 5, 0x0004, 0, 0, 128, 128, 128, 128, 0))
        stale_acked = False
        try:
            for _ in range(3):
                msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                if msg[:3] == b"ACK" and struct.unpack("<Q", msg[3:11])[0] == ts2 - 5:
                    stale_acked = True
        except asyncio.TimeoutError:
            pass
        check("stale frame not ACKed", not stale_acked)

        print("\n[5] ping/pong (control frames) handled")
        pong_waiter = await ws.ping()
        try:
            await asyncio.wait_for(pong_waiter, timeout=3.0)
            check("server answered ping with pong", True)
        except asyncio.TimeoutError:
            check("server answered ping with pong", False, "no pong within 3s")

        print("\n[6] burst of 100 frames all ACK")
        base = ts2 + 100
        for i in range(100):
            await ws.send(struct.pack(fmt, base + i, i & 0xFF, 0, 0, 128, 128, 128, 128, 0))
        got = 0
        try:
            while got < 100:
                msg = await asyncio.wait_for(ws.recv(), timeout=3.0)
                if msg[:3] == b"ACK":
                    got += 1
        except asyncio.TimeoutError:
            pass
        check("all 100 ACKed", got == 100, f"got {got}")

    print("\n[7] clean disconnect (server must free the pad)")
    check("socket closed without error", True)

    print("\n" + ("ALL CHECKS PASSED" if not FAILS else f"FAILURES: {FAILS}"))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
