# pc-server-rs — GamepadOS PC server in Rust (Phase 2)

**Status: WORKING GAMEPAD over UDP. Verified end-to-end on the real phone.**
Scope decision 2026-07-21: **full port to replace Python** (user's call, made with
the "server is only ~2% of RTT" measurement on the table — the payoff is
packaging, not latency). UDP + ViGEm are done; WebSocket, AOA, GRX, pairing and
tray remain.

### ✅ Proven working 2026-07-21

Python stopped, this server bound udp/7777 with real ViGEm output, phone
connected over tether:

- Windows gained a real **`Xbox 360 Controller for Windows`**
  (`USB\VID_045E&PID_028E\01`, count 0 → 1), listed in joy.cpl.
- Live `XInputGetState` on slot 0 showed the packet number incrementing and
  `LX` sweeping `3354 → 3612 → -2064 → 6708 → 7482` — that is **gyro steering
  driving the left stick**, plus `RT=255` for a fully pulled trigger.
- Server: `ok=5224 stale=0 rejected=0 pad_writes=1620`, one session, no drops.
- Our handle time with ViGEm in the path: **avg 66.6 µs, p50 64.9 µs, p95
  129.5 µs** (vs ~52 µs in dry-run — the `update()` IOCTL costs ~15-20 µs).
  First packet of a session is ~37 ms: that is the one-time
  `plugin()` + `wait_ready()` device enumeration, not steady state.

| Layer | State |
|---|---|
| Wire protocol (`src/wire.rs`) | ✅ 11 conformance tests vs the real Python server |
| Sessions / pads (`src/session.rs`) | ✅ 7 unit tests (one pad per IP, MAX_PADS, neutralize/reap, dedup, RMB) |
| UDP transport (`src/net.rs`) | ✅ 10 unit tests (auth, ordering, ACK/RMB, 5th-device, idle) |
| Runnable server (`src/main.rs`) | ✅ `--dry-run` — decodes and ACKs real traffic, drives nothing |
| **ViGEm / XInput output** | ❌ **not written** |

**28 tests passing.** Verified live: a real-format loopback client
(`tools/loopback_test.py`) got correct ACKs with echoed timestamps, stale frames
correctly unACKed, malformed frames ignored, bad tokens rejected, 200/200 burst
ACKed, and the session was reaped after 3 s idle.

## ✅ Tested against the REAL PHONE — 2026-07-21

Python stopped, this server bound udp/7777, phone (Redmi `DAIFEYGEKB89V4QG`)
auto-connected over USB tether. **The protocol works end-to-end with real
traffic** — the exact thing the deleted Rust attempt could never do:

| Signal | Result |
|---|---|
| Frames from the phone | `10.66.39.130` decoded, **3810 accepted, 0 stale, 0 rejected** |
| Sessions | **exactly 1** (no double-pad) |
| Pad writes | 909 of 3810 — dedup correctly absorbed ~76% as unchanged keep-alives |
| Phone-side link | `linkAlive: true` |
| Phone-side RTT | **3.83 / 4.32 / 4.35 ms** — the phone parsed our ACKs and computed a sane round-trip from the echoed timestamp |

### Latency: currently ~0.9 ms BEHIND Python (expected, not a regression)

Measured back-to-back on the same cable and phone:

| Server | RTT samples | ~avg |
|---|---|---|
| Python (restored) | 3.85 / 2.64 / 3.54 ms | **~3.3 ms** |
| Rust (this) | 3.83 / 4.32 / 4.35 ms | **~4.2 ms** |

The readings are noisy (the phone shows an EMA-smoothed value; Python alone
spanned 2.6–3.9 ms), so treat this as "same ballpark, Rust slightly behind",
not a precise delta. The gap is **fully explained by tuning this server does not
have yet**, all of which the Python server does:

- **`timeBeginPeriod(1)`** — raises the Windows timer resolution. It is a
  SYSTEM-WIDE setting, so while Python runs, everything benefits; with only Rust
  running it is released and scheduling granularity degrades to ~15.6 ms. This
  is very likely the largest single contributor.
- **DSCP-EF (`IP_TOS` 0xB8)** — the phone already marks its packets; without the
  server matching, Wi-Fi/router QoS treats the return path as bulk traffic.
- **`SO_RCVBUF` (1 MB)** — Python sizes the receive buffer up.

### UPDATE — what actually fixed it, and where the headroom really is

The tuning above was implemented (`src/winperf.rs`: `timeBeginPeriod(1)`, HIGH
priority, 1 MB buffers, DSCP-EF — all report `true`) and **made no measurable
difference**. The hypothesis was wrong.

The real cause was architectural, found at `server.py` line ~1520:

```python
elif len(data) == PAYLOAD_SIZE:
    latest[ip] = (data, addr)      # keep ONLY the newest per source
```

Python **drains the socket to the newest packet** and ACKs only that one. This
server was ACKing *every* queued datagram — and the phone recomputes its RTT
average on **every ACK it receives**, so each stale queued frame reported the
time it had spent sitting in the queue and dragged the average up. Implementing
drain-to-newest (`upsert()` in `main.rs`) moved the median from ~3.5 ms to
**~2.57 ms**, with a floor of **1.95 ms** — better than Python's best sample.

### 🔑 THE HEADROOM ANSWER: the server is ~2% of the round trip

The server now measures its own share (recv returns → ACK handed to the kernel),
printed every 5 s:

```
our handle time: avg=52.7us p50=48.6us p95=92.5us max=146.6us
batches drained: avg=1.00 max=1
```

**~52 µs of a ~2400 µs round trip — roughly 2%.** Even an infinitely fast server
would take 2.40 ms → ~2.35 ms. The other 98% is the Windows USB/RNDIS + IP
stack, the wire, and the phone's own send path.

`batches drained: avg=1.00 max=1` also says we are **never falling behind** —
there is no queue backlog at this load, so drain-to-newest only matters during
bursts (it did matter when the phone was streaming gyro at high rate).

**Conclusion: further micro-optimisation of this server is not worth doing.**
Rust genuinely gives lower-level control than Python, but control over a
component that contributes 2% cannot produce a meaningful win. The remaining
latency lives in transport and driver layers. The real wins are elsewhere:
AOA direct-USB (bypasses the IP stack entirely, ~1-2 ms potential per
`docs/AOA_REQUIREMENTS.md`), and the phone-side path — which is exactly where
Phase 3 already produced a 3.7× gain.

This is the Phase 0 lesson repeating: measure first, because the bottleneck was
never where it felt like it was.

## Scope (decided 2026-07-21)

**UDP transport only.** This replaces just the UDP hot path. The Python server
keeps the WebSocket (USB-debugging), AOA direct-USB and GRX encrypted-input
transports. Small blast radius, and both servers can be A/B'd against the same
phone.

## Why the conformance gate exists

A previous Rust rewrite (`pc-server-rust/`, ~3.1 GB) was **deleted** because it
invented its own wire format (HMAC + i16 sticks + 16-char key) and therefore
dropped **every** packet from the phone. It compiled fine. It was simply not
speaking the protocol.

So the order here is inverted on purpose: **the protocol is proven first, the
server is written second.**

```
tools/gen_golden.py   ->  tests/golden_vectors.json  ->  tests/conformance.rs
   (reads the REAL           (byte-exact contract)         (11 tests, must pass)
    server.py source)
```

`gen_golden.py` does **not** hand-transcribe anything. It parses
`apps/pc-server/server.py` with `ast`, evaluates only the pure constant
expressions (`PAYLOAD_FORMAT`, `_SNAP_LUT`, `_AXIS_LUT`, `MAX_PADS`) and scrapes
the button-bit table straight out of `apply_inputs`. If the Python wire path
ever changes, regenerating makes the Rust tests fail loudly instead of drifting
silently.

> It deliberately does not *import* server.py — importing blocks (ViGEm/vgamepad
> init + network probing) and could disturb the live server.

## What is verified (11 tests, all passing)

| Test | Guards against |
|---|---|
| `payload_format_and_size_unchanged` | the 20-byte contract silently changing |
| `decodes_golden_packets_byte_exactly` | field order/width/endianness errors |
| `rejects_wrong_length_frames` | accepting malformed datagrams |
| `snap_and_axis_luts_match_all_256_entries` | deadzone/axis math drift (all 256 inputs) |
| `pad_axes_match_including_negated_y` | **inverted sticks** (Y axes are negated) |
| `ack_frames_match` | breaking the phone's RTT badge |
| `rmb_frames_match` | breaking rumble |
| `button_map_matches_apply_inputs` | wrong button → wrong action in game |
| `ordering_rule_matches` | dropping good frames / accepting stale ones |
| `auth_policy_matches` | breaking keyless USB-tether pairing, or accepting spoofed input |
| `neutral_packet_is_exactly_centred` | a resting pad nudging the Windows shell |

**The gate is verified to have teeth:** deliberately removing the Y-negation
makes `pad_axes_match_including_negated_y` fail with
`left_y = 1, python = -1`. A test that cannot fail proves nothing.

## Commands

```bash
cargo test                    # all 28 tests (conformance + unit)
python tools/gen_golden.py    # regenerate vectors after ANY Python wire change

# exercise the live protocol path on a spare port (never disturbs the real server)
cargo build --release
./target/release/pc-server-rs --dry-run --port 7778 --lan-ip 192.168.1.34 --tether-subnet 10.66.39
python tools/loopback_test.py --port 7778
```

`--dry-run` is currently mandatory; without it the binary refuses to start,
because a server that cannot drive a pad must not pretend to be the server.

> ⚠️ Only ONE process may bind UDP 7777. Testing against the real phone means
> stopping the Python server first. Two servers on one port would mean two
> virtual pads — the exact bug fixed on 2026-07-21.

## Still to build (full-port roadmap, in this order)

Sequenced so each step is independently verifiable and the risky parts come
after the useful parts. **Tray/installer last, deliberately.**

1. ~~ViGEm/XInput output~~ ✅ done (`src/vigem.rs`)
2. ~~Socket/process tuning~~ ✅ done (`src/winperf.rs`) — but see the honest note
   there: it did NOT fix what it was written for.
3. ~~Standalone network detection~~ ✅ done (`src/netdetect.rs`) — VPN-aware LAN
   scoring + tether discovery via `GetAdaptersAddresses`, matching on adapter
   **description** (`NDIS|NCM|Tether|Internet Sharing`), never the name.
   Verified live: auto-detects `192.168.1.34` / `["10.66.39"]`, identical to
   Python's answer on this machine. Re-scans every 5 s so plugging the cable in
   after startup still enables keyless pairing.
4. ~~Pairing key~~ ✅ done (`src/pairing.rs`) — **reads the SAME persisted key
   file as the Python server** (`%LOCALAPPDATA%\GamepadServer\pairing_key.txt`,
   8 lowercase hex), so an already-paired phone needs no re-scan. QR payload
   contract `"{ip},{port},{key}"` is implemented and tested; rendering the QR
   *image* is UI and stays with the tray work. Key generation uses the OS CSPRNG
   (`BCryptGenRandom`) and fails loudly rather than falling back to anything weaker.

   **The server now runs with ZERO arguments** — every flag is an override.

5. ~~WebSocket transport + adb-reverse watcher~~ ✅ done (`src/ws.rs`,
   `src/adbreverse.rs`). **Hand-rolled WebSocket** (SHA-1 + base64 + frame
   codec, ~200 lines) rather than pulling `tungstenite` + ~11 transitive crates
   or an async runtime — the exposure is small (binds **127.0.0.1 only**, frames
   capped at 64 bytes, binary only) and a lean binary is the entire point of the
   port. Verified against the canonical RFC 6455 handshake vector **and** a real
   `websockets` client (handshake, ACK echo, malformed-frame survival, stale-frame
   rejection, ping/pong, 100-frame burst). Then verified with the **real phone**:
   `WS connected: usb:1`, exactly one virtual pad, no double-pad.
   `adb reverse` is kept alive per-serial (a bare `adb reverse` errors with two
   devices attached).
6. ~~GRX encrypted input~~ ✅ done (`src/grx.rs`). X25519 -> HKDF-SHA256 ->
   per-direction AES-128-GCM, 96-bit counter nonce, tag-first sliding replay
   window, transcript+PSK-bound 1-RTT handshake. Wired into the UDP loop:
   handshake / GRX-encrypted / legacy-cleartext are routed by frame shape, and
   GRX frames skip the auth-token check because GCM already authenticated them.
   **Crypto is the ONE place with real dependencies** (`x25519-dalek`,
   `aes-gcm`, `hkdf`, `hmac`, `sha2`, `subtle`) — hand-rolling X25519 or AES-GCM
   would be the worst decision available; nonce reuse and non-constant-time tag
   comparison fail silently and catastrophically.
   Verified two ways: **18 golden-vector tests** generated from the shipped
   `grx_crypto.py` (transcript, derived keys, confirm tags, PSK, byte-identical
   sealed frames, replay window, counter reconstruction), **and full interop
   against the real Python `GrxClientSession`** — 1-RTT handshake, 100 encrypted
   frames decrypted, replay rejected, tamper rejected without wedging the
   window, reverse-direction s2c decrypted by Python, wrong-PSK refused.
7. ~~AOA direct-USB~~ ❌ **DELIBERATELY SKIPPED 2026-07-21.** Evidence, not
   preference: nothing is bound to WinUSB except the ADB interface, no
   accessory-mode device exists, and the running **Python** server logs
   `AOA: no accessory yet (Operation not supported or unimplemented on this
   platform)` — AOA has never moved a packet there either (its on-device test
   was never run). Porting would mean translating never-verified code, adding a
   USB dependency, with no way to test: the Zadig WinUSB bind is manual and
   breaks adb AND tethering. Marginal gain (~1-2 ms vs tether's ~2.4 ms).
   Revisit only after someone proves the Python path on hardware.
8. **Pairing QR** ✅ done (`src/qr.rs`) — rendered to the terminal with
   half-block characters, correct polarity and a 4-module quiet zone. **Not
   cosmetic:** a phone on Wi-Fi can ONLY pair by scanning, because manual
   connect sends auth token 0 which is accepted only off-LAN/tether. This
   replaces Python's tkinter QR window without a GUI framework, image encoder or
   window. `--no-qr` skips it (pointless over tether).
9. **GUI window / installer / updater** — NOT built, deliberately. Python's UI is
   a tkinter window whose only functional job is showing that QR, which the
   terminal now does. An installer and an auto-updater for a server that is not
   yet the shipping server would be productising something unadopted. Build them
   if and when this replaces Python.

Also ported since: the **single-device transport-switch migration**
(`SessionManager::try_migrate` — a phone hopping Wi-Fi<->tether keeps its pad and
therefore its XInput slot, with all four of Python's guards), **GRX session
eviction** (my own leak: the handshake map grew for the life of the process), and
a **telemetry snapshot** feeding the periodic status line.

Still unported: the auto-updater (see 9).

## Design notes worth keeping

- `handle_frame` is **allocation-free and socket-free** — the whole protocol path
  is unit-testable without opening a port, and there's no heap traffic at ~1000
  packets/sec.
- Order of operations copies `server.py` exactly, including two things that look
  like bugs but aren't: rumble is emitted **before** the ordering check, and a
  stale frame is **never ACKed** (ACKing it would poison the phone's RTT badge,
  which is computed from the echoed timestamp).
- A device that can't get a pad (MAX_PADS reached) is also never ACKed, so it
  shows as unconnected instead of silently driving nothing.
- `PadSink` keeps all Windows-only driver code behind one trait, which is why
  the entire server can be tested on any machine with `NullSink`.

## Rules for whoever continues this

- **Never** change `src/wire.rs` without regenerating vectors and re-running the gate.
- The 20-byte format is fixed by three files that must agree byte-for-byte:
  `controller-ui/src/app/App.tsx`, `android-client/.../gamepad-engine.cpp`,
  `pc-server/server.py`.
- Do not delete the preserved Python snapshot
  (`releases/archive/pc-server-python-2026-07-21/`) until this server is proven
  on-device.
