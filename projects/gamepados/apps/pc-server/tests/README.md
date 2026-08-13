# pc-server tests

Recovered on 2026-08-13 from a scratch folder (`D:\AKHIL\HP\_test-pc-1.1.15\`) that was about to
be cleaned up. These two scripts existed **only** there — nowhere in the tracked tree — and both
document real, shipped bugs. Renamed from `_t1_update.py` / `_t2_misroute.py`; contents unchanged.

Run them from the `pc-server` directory, with its dependencies available.

## `test_update_check.py`

Calls the shipped `check_for_update()` verbatim against the live backend and prints the version,
manifest URL, elapsed time and verdict. Use it when the self-updater is suspected of being broken
— it separates "the server is unreachable" from "the client logic is wrong."

Related: `UPDATE_TROUBLESHOOTING.md` in the parent folder.

## `test_handshake_misroute.py`

Reproduces the **1.1.14 UDP-thread-kill bug** and proves 1.1.15 fixes it. Worth reading even if you
never run it, because the failure mode was genuinely subtle:

`is_handshake()` matched on the **first byte only**. A legacy 20-byte input frame begins with a
little-endian timestamp whose low byte sweeps 0–255, so a predictable fraction of *ordinary input
frames* were misrouted into the handshake path. There, unpacking 20 bytes as a 37-byte CONFIRM
raised an uncaught `struct.error` that killed the UDP loop thread.

The symptom was nasty: **the port stayed bound, so the server looked alive, but it had gone deaf.**
The test sweeps a full timestamp cycle so every possible low byte occurs, then compares the 1.1.14
matching logic against the current `_HS_MIN_LEN` length checks.

If you ever touch handshake detection or the frame layout, run this first.
