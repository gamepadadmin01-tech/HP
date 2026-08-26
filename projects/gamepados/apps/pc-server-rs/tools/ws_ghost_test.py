#!/usr/bin/env python3
"""
Regression test for the WebSocket GHOST PAD bug (found 2026-07-21).

THE BUG: an `adb reverse` tunnel can leave the server's socket **Established**
after the phone app is gone — the FIN never arrives. With a plain blocking read,
the reader thread parked forever, the session was never torn down, and its
virtual pad stayed plugged into Windows indefinitely. Observed live: app
force-stopped, UDP session correctly reaped, `usb:1` and its pad still alive
minutes later. A lingering pad squats an XInput slot and pushes the next real
phone to player 2, which games ignore.

THE TEST: connect, handshake, send one input frame so a session exists, then go
SILENT while holding the socket open — exactly what a half-open tunnel looks
like. The server must free the session's PAD.

WHAT COUNTS AS A PASS (updated 2026-07-21, second revision):
The protected property is "no ghost PAD", not "no lingering socket". Since the
churn fix, the server deliberately KEEPS sessionless connections open — the
phone holds its socket on every app screen, and closing it every 5 s was a
connect/reconnect loop (see REGRESSION_CHECKLIST A8b). So during our silence
the server does one of two things, and BOTH prove the pad was freed:

  * CLOSES the connection — the teardown path, which frees the pad; or
  * sends a WS PING — the server only pings a connection it has checked and
    found sessionless, and the session is what owns the pad. The session is
    reaped by the normal 3 s idle path; the 5 s check then finds no pad and
    switches to link-probing instead of closing.

Receiving NEITHER within the window is the ghost: a silent connection still
holding its session, and therefore its pad.

Usage:
    cargo build --release
    ./target/release/pc-server-rs --dry-run --port 7793 &
    python tools/ws_ghost_test.py --port 7793
"""
import argparse
import base64
import hashlib
import os
import socket
import struct
import sys
import time

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def handshake(sock, port):
    key = base64.b64encode(os.urandom(16)).decode()
    req = (
        f"GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
        f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(req.encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        chunk = sock.recv(1024)
        if not chunk:
            raise SystemExit("FAIL: server closed during handshake")
        resp += chunk
    expect = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    if expect.encode() not in resp:
        raise SystemExit("FAIL: bad Sec-WebSocket-Accept")
    return True


def masked_binary(payload: bytes) -> bytes:
    """Client frames MUST be masked (RFC 6455 §5.1)."""
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return bytes([0x82, 0x80 | len(payload)]) + mask + masked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7793)
    # Must exceed the server's WS_IDLE_TIMEOUT (5s) with margin.
    ap.add_argument("--wait", type=float, default=9.0)
    args = ap.parse_args()

    s = socket.create_connection(("127.0.0.1", args.port), timeout=5)
    handshake(s, args.port)
    print("  PASS  handshake completed")

    pkt = struct.pack("<Q H B B B B B B I", 1234, 1, 0, 0, 128, 128, 128, 128, 0)
    s.sendall(masked_binary(pkt))
    s.settimeout(3.0)
    try:
        ack = s.recv(64)
        print(f"  PASS  session established (server ACKed, {len(ack)} bytes)")
    except socket.timeout:
        print("  FAIL  no ACK — session may not exist")
        return 1

    print(f"\n  going SILENT for {args.wait}s while HOLDING the socket open")
    print("  (this is exactly what a half-open adb tunnel looks like)")

    # Do NOT close. Just stop sending, and watch for either teardown signal.
    s.settimeout(args.wait + 3)
    t0 = time.time()
    seen = b""
    try:
        while True:
            data = s.recv(4096)
            if not data:
                elapsed = time.time() - t0
                print(f"\n  PASS  server closed the connection after {elapsed:.1f}s")
                print("        -> the stale session and its pad are freed")
                return 0
            seen += data
            # A server PING is only sent to a connection the server has
            # verified holds NO session — i.e. the pad is already freed and the
            # socket is being kept as the phone's standing link. Match the
            # exact frame (opcode 0x89, len 3, payload "lnk") so a stray 0x89
            # byte inside some other frame's payload can never false-positive.
            if b"\x89\x03lnk" in seen:
                elapsed = time.time() - t0
                print(f"\n  PASS  server pinged after {elapsed:.1f}s of silence")
                print("        -> session reaped (pad freed); socket kept as a standing link")
                return 0
            # RMB frames may still arrive; keep waiting.
            if time.time() - t0 > args.wait + 2:
                break
    except socket.timeout:
        pass

    elapsed = time.time() - t0
    print(f"\n  FAIL  no close and no ping after {elapsed:.1f}s")
    print("        -> ghost pad: the session and its virtual pad never freed")
    return 1


if __name__ == "__main__":
    sys.exit(main())
