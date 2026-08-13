"""Reproduces the 1.1.14 UDP-thread-kill bug and proves 1.1.15 fixes it.

The bug: is_handshake() matched on the FIRST BYTE ONLY. A legacy 20-byte input
frame begins with a little-endian timestamp whose low byte sweeps 0..255, so a
fraction of ordinary input frames were misrouted into the handshake path, where
unpacking 20 bytes as a 37-byte CONFIRM raised an UNCAUGHT struct.error that
killed the UDP loop thread. Port stayed bound, server went deaf.
"""
import struct, sys, time
import grx_session as g

T = {"HELLO": g.T_HELLO, "SHELLO": g.T_SHELLO, "CONFIRM": g.T_CONFIRM}
print("handshake type bytes :", {k: hex(v) for k, v in T.items()})
print("min lengths (1.1.15) :", {hex(k): v for k, v in g._HS_MIN_LEN.items()})
print()


def legacy_input_frame(ts_ms):
    """A real 20-byte legacy input frame: LE uint32 timestamp + 16 bytes state."""
    return struct.pack("<I", ts_ms & 0xFFFFFFFF) + bytes(16)


def is_handshake_1114(frame):
    """The 1.1.14 logic: first byte only."""
    return bool(frame) and frame[0] in _HS_TYPES_1114


_HS_TYPES_1114 = set(T.values())

# Sweep a full timestamp cycle so every possible low byte occurs.
N = 65536
mis_1114 = mis_1115 = 0
first_bad = None
for ts in range(N):
    f = legacy_input_frame(ts)
    if is_handshake_1114(f):
        mis_1114 += 1
        if first_bad is None:
            first_bad = f
    if g.is_handshake(f):
        mis_1115 += 1

print(f"legacy input frames tested : {N}")
print(f"  misrouted by 1.1.14 logic : {mis_1114}  ({mis_1114 / N * 100:.2f}%  =  1 in {N // max(mis_1114,1)})")
print(f"  misrouted by 1.1.15 logic : {mis_1115}")
print()

# Show the consequence: what 1.1.14 did with a misrouted frame.
if first_bad is not None:
    print("consequence in 1.1.14 — feeding a misrouted 20-byte frame to the CONFIRM parser:")
    try:
        struct.unpack("<B32s", first_bad)          # what the CONFIRM path expected
        print("   (no error — unexpected)")
    except struct.error as e:
        print(f"   struct.error: {e}")
        print("   -> UNCAUGHT in 1.1.14 (only HandshakeError was caught) -> UDP thread dies")
print()

# And prove real handshake frames are still routed correctly in 1.1.15.
ok = True
for name, tb in T.items():
    good = bytes([tb]) + b"\x00" * (g._HS_MIN_LEN[tb] - 1)
    short = bytes([tb]) + b"\x00" * 5
    if not g.is_handshake(good):
        print(f"   REGRESSION: valid {name} rejected"); ok = False
    if g.is_handshake(short):
        print(f"   REGRESSION: runt {name} accepted"); ok = False
print("real handshakes still accepted, runts rejected :", "PASS" if ok else "FAIL")
print()
print("VERDICT:", "1.1.15 IMMUNE — 1.1.14 misroutes and dies" if (mis_1115 == 0 and mis_1114 > 0 and ok)
      else "UNEXPECTED — investigate")
