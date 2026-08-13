# Gamepad App — Architecture & Design Intuition

> **Who is this for?**  
> Any developer (or AI assistant) picking up this project for the first time. This document explains **why** the system is designed the way it is, not just **what** it does.

---

## 1. The Big Picture

The goal of this project is to turn an Android phone into a full wireless game controller for a Windows PC, with no extra hardware. Here is the complete end-to-end data path:

```
[Phone Screen Touch / Gyroscope]
        │
        ▼
[React UI  ─  App.tsx  (TypeScript)]
        │
        │  ArrayBuffer (20 bytes) via JSI
        ▼
[gamepad-engine.cpp  (C++ NDK)]
        │
        │  UDP packet  →  LAN (Wi-Fi)
        ▼
[server.py  (Python, running on Windows PC)]
        │
        │  ViGEmBus driver call
        ▼
[Virtual DualShock 4 Controller  →  any game]
```

Everything is designed for **ultra-low latency**. The NDK (C++) layer bypasses Java/Kotlin to write and flush the UDP socket in a tight, SCHED_FIFO real-time thread. The React UI fires `sendGamepadTelemetry` at the polling rate (default 60 Hz, up to 1000 Hz).

---

## 2. The 20-Byte Packet Format

This is the most critical shared contract between the phone and the PC. **Both sides must agree exactly.** It is defined in C++ as a `#pragma pack(1)` struct and in Python using `struct.unpack`.

```
Offset  Size   Type         Field            Notes
──────  ─────  ───────────  ───────────────  ─────────────────────────────────────
 0      8 B    uint64 LE    timestamp        ms since epoch; used for out-of-order
                                             packet rejection (stale packets drop)
 8      2 B    uint16 LE    buttons          bitmask — see Button Bit Assignments
10      1 B    uint8        leftTrigger      0 = released, 255 = fully pressed
11      1 B    uint8        rightTrigger     0 = released, 255 = fully pressed
12      1 B    uint8        leftStickX       0=left, 127=center, 255=right
13      1 B    uint8        leftStickY       0=up,   127=center, 255=down
14      1 B    uint8        rightStickX      same scale
15      1 B    uint8        rightStickY      same scale
16      4 B    uint32 LE    authToken        0xABCD1234 (default) or QR-issued key
                                             0x00000000 = unauthenticated / USB
──────  ─────  ───────────  ───────────────  ─────────────────────────────────────
Total:  20 bytes exactly
```

The struct is validated at compile time:
```cpp
// android-client/app/src/main/cpp/gamepad-engine.cpp
static_assert(sizeof(GamepadPayload) == 20, "FATAL: Payload struct is not exactly 20 bytes!");
```

### Button Bit Assignments (`BTN_MAP` in `App.tsx`)

```
Bit 0   →  A / Cross          Bit  7  →  Share / Back
Bit 1   →  B / Circle         Bit  8  →  L3 (Left Stick Click)
Bit 2   →  X / Square         Bit  9  →  R3 (Right Stick Click)
Bit 3   →  Y / Triangle       Bit 10  →  D-Pad Up
Bit 4   →  LB / L1            Bit 11  →  D-Pad Down
Bit 5   →  RB / R1            Bit 12  →  D-Pad Left
Bit 6   →  Options / Menu     Bit 13  →  D-Pad Right
```

---

## 3. Directory Structure

```
hlooo/
├── ARCHITECTURE.md          ← YOU ARE HERE
├── README-Gamepad.md        ← Quick-start build guide
│
├── App Interface Design/    ← React/TypeScript frontend (the controller UI)
│   └── src/app/App.tsx      ← Single-file monolith: ALL UI, logic, and data
│
├── android-client/          ← Kotlin Android app (the WebView shell)
│   └── app/src/main/
│       ├── cpp/
│       │   └── gamepad-engine.cpp   ← C++ NDK: UDP socket + real-time thread
│       ├── java/com/...
│       │   └── MainActivity.kt      ← WebView setup + JSI bridge registration
│       └── assets/dist/             ← Compiled React app lives here
│
└── pc-server/
    └── server.py            ← Python UDP receiver + ViGEmBus virtual gamepad
```

---

## 4. The React Frontend (`App.tsx`)

`App.tsx` is a **single-file React monolith** (~3800 lines). This is intentional: the entire controller UI, all state, all rendering, and all communication logic is colocated so you can reason about the full system in one place.

### 4.1 Screen Navigation

There are three screens, controlled by a `view` state string:

```typescript
type View = "scanner" | "dashboard" | "controller";
```

Navigation uses `navigateTo()` which:
1. Triggers a CSS transition out-animation (`SCREEN_EASE`, 380ms)
2. Requests screen orientation change via `AndroidBridge`
3. Switches the `view` state

> **Why the delay?** Orientation changes cause the WebView to briefly show white during resize. The `navigateTo` timing is carefully tuned (100ms for flag, 350ms for view switch) to mask this behind the transition animation.

### 4.2 Custom Pad Data Model

The custom pad system is the core design innovation. It lets users build their own controller layouts from scratch.

**Type definitions:**
```typescript
type WidgetType = "button" | "thumbstick" | "trigger" | "macro";
type WidgetShape = "circle" | "rect";

type CustomBtnDef = {
  uid: string;       // unique ID (random, e.g. "cb3f9a2b1c")
  type: WidgetType;
  shape: WidgetShape;
  opacity: number;   // 0.0–1.0
  haptic: number;    // vibration duration in ms (0 = off)
  macroBits: string[];  // for type="macro": array of BtnId strings to fire together
  label: string;     // display text on the button
  x: number;         // center X in landscape pixels (0–1263)
  y: number;         // center Y in landscape pixels (0–540)
  r: number;         // radius in pixels
  normColor: string; // hex color when not pressed
  heldColor: string; // hex color when pressed
};

type CustomPad = {
  padId: string;    // unique pad ID
  name: string;     // user-facing name
  color: string;    // accent color for the card
  buttons: CustomBtnDef[];
};
```

**Persistence:** `customPads` is serialized to `localStorage` as JSON. On startup, it is deserialized and hydrated from storage. This means custom pads survive app restarts.

**Templates (`makeDefaultPad`):** When a user creates a new pad, they pick a template:
- `"standard"` — Classic gamepad layout (D-pad, ABXY, two sticks)
- `"fps"` — Optimized for shooters (two big triggers, two sticks, fewer buttons)
- `"fighter"` — Arcade stick layout (one stick + 6 face buttons)
- `"blank"` — Empty canvas

### 4.3 Custom Pad Builder (`CustomPadBuilder` component)

The builder is the drag-and-drop editor for custom pads. Key design decisions:

- **Canvas is locked to landscape.** The editor always runs in landscape because the controller itself runs in landscape. Screen rotation is forced via `AndroidBridge.setOrientation("landscape")`.
- **Position = pixel coordinates**, not percentages. This was chosen to make rendering deterministic. When rendering on the controller screen, coordinates are the same pixel values.
- **Snap-to-grid is optional** (configurable in the builder).
- **An `editorCurtain`** (a full-screen black overlay) is shown briefly during orientation change to hide the WebView resize flash.

### 4.4 How Custom Buttons Are Rendered (`ControllerScreen`)

On the controller screen, each `CustomBtnDef` is rendered as an SVG element at its exact `(x, y)` coordinates. The SVG viewport is set to match the screen dimensions.

- `type === "button"` → SVG `<circle>` or `<rect>`
- `type === "thumbstick"` → `useStick` hook attaches touch tracking; the knob moves within the `r` radius
- `type === "trigger"` → `TriggerPill` component with vertical fill animation using a local `clipPath`
- `type === "macro"` → renders as a button, but fires multiple `BTN_MAP` bits on press

**Color fallback logic:** If a button's `normColor`/`heldColor` is missing or white (rendering artifact), the code falls back to defined constants:
```typescript
const RED_NORM = "#14143a";  // dark navy — safe default
const RED_HELD = "#3a3a9e";  // bright purple — visible when pressed
```

### 4.5 `sendGamepadTelemetry` — Packet Construction

Called by `useInterval` at the configured polling rate (Hz). It:
1. Allocates a fresh 20-byte `ArrayBuffer`
2. Writes `Date.now()` as a 64-bit little-endian uint at offset 0
3. Computes the button bitmask by checking `heldCustom` (custom pad) or `held` (standard pad)
4. Applies **hair-trigger rescaling** to LT/RT (default 15% threshold → full 0–255 range)
5. Applies **gyroscope tilt** additively to the left stick X/Y
6. Applies **circular deadzone** (8%) to both sticks before converting to byte range
7. Writes the fixed auth token `0xABCD1234` at offset 16
8. Calls `window.sendGamepadPacket(buffer)` — the JSI bridge into C++

**Critical: Custom pad stick routing:**
```typescript
// Custom pads have two independent thumbstick widgets (LS and RS).
// Each widget drives its OWN posRef. They must NOT be cross-wired.
const finalLs = isCustom
  ? processStick(lx, ly)   // lx/ly = lstick.posRef.current
  : (stickModeRef.current === "L" ? processStick(lx, ly) : { x: 0, y: 0 });

const finalRs = isCustom
  ? processStick(rx, ry)   // rx/ry = rstick.posRef.current
  : (stickModeRef.current === "R" ? processStick(lx, ly) : { x: 0, y: 0 });
```
> In standard (non-custom) mode, one physical touch area drives both sticks with a mode toggle. In custom mode, LS and RS widgets each have their own independent touch tracking.

---

## 5. The Android Shell (`android-client`)

The Android app is a **thin WebView wrapper**. It does the minimum amount of native work necessary to bridge the web UI to hardware.

### 5.1 JSI Bridge

The C++ engine is exposed to JavaScript via a custom `JavascriptInterface`. Two key methods are injected into the WebView's `window` object:

| JS Function               | What it does |
|---------------------------|---|
| `window.sendGamepadPacket(buffer)` | Receives the 20-byte `ArrayBuffer` from JS, copies it into the C++ payload struct, and enqueues it for the UDP thread |
| `window.AndroidBridge.setOrientation(mode)` | Calls the Kotlin `Activity` to lock/unlock screen rotation |
| `window.AndroidBridge.scanQR()` | Opens the device camera for QR code scanning |

### 5.2 C++ NDK Engine (`gamepad-engine.cpp`)

This is where the performance-critical work happens:

- **Real-time POSIX thread** (`pthread`) with `SCHED_FIFO` scheduling policy. This gives the UDP send loop the highest possible priority, minimizing jitter.
- **Non-blocking UDP socket** with `sendto()` to the PC's IP address and port (received via QR code scan).
- **Packet deduplication**: a `last_timestamp` variable ensures out-of-order or replayed packets are silently dropped.
- **Gyroscope sensor fusion**: The native `SensorManager` feeds tilt data into `nativeGyroRightStickX/Y` which are merged into the payload before each send.

### 5.3 Connection Flow (QR Code)

1. PC server starts → generates a random 4-byte hex key → encodes `{ip},{port},{key}` as a QR code.
2. User taps "Scan QR" in the app → `AndroidBridge.scanQR()` → camera opens.
3. QR decoded → `ip`, `port`, `key` parsed → stored in app state.
4. `key` is parsed as a hex integer and written to `authToken` field in every packet (`uint32`).
5. Server validates `authToken` on every received packet (ignores packets with wrong token).
6. After the first valid packet, server sends back `b"ACK"` so the phone locks its send target to unicast (stops broadcasting).

---

## 6. The PC Server (`pc-server/server.py`)

A single-file Python application using:

| Library  | Purpose |
|----------|---|
| `socket` | Raw UDP server, non-blocking with `selectors` |
| `vgamepad` | Wraps **ViGEmBus** driver to create a virtual DS4 controller |
| `qrcode` | Generates the connection QR shown in the Tkinter GUI |
| `struct`  | Unpacks the 20-byte binary payload |
| `tkinter` | Minimal dark-themed desktop GUI |

**Packet handling logic:**
1. Drain all queued UDP packets — only process the **latest** one (avoids input lag from backlog).
2. Reject out-of-order packets (timestamp < last seen timestamp).
3. Reject packets with wrong `authToken` (unless token is `0`, which allows manual/USB connections).
4. Map bitmask bits to `vgamepad.DS4_BUTTONS` calls.
5. Map D-pad bits — handles all 8 diagonal combinations correctly.
6. Call `gamepad.update()` once per loop iteration.
7. If no packet received for >500ms → reset gamepad to neutral (prevents stuck inputs).

---

## 7. Design Decisions & Trade-offs

| Decision | Reason |
|---|---|
| **Single `App.tsx` monolith** | All controller state is deeply interconnected. Splitting into files created prop-drilling nightmares. Colocating everything makes the data flow obvious. |
| **Pixel coordinates (not %)** | Percentages would require recalculation for every screen size. The landscape canvas is a fixed 1263×540 virtual space. |
| **C++ NDK for UDP** | Java/Kotlin have GC pauses that cause packet jitter. The C++ thread bypasses this entirely. |
| **UDP over TCP** | TCP adds head-of-line blocking. For real-time input, a dropped packet is better than a delayed one. The server only processes the latest packet anyway. |
| **Auth token in every packet** | Prevents other devices on the same Wi-Fi from accidentally sending input to the PC. |
| **`#pragma pack(1)` struct** | Guarantees exactly 20 bytes regardless of compiler padding. The `static_assert` is a compile-time safety net. |
| **Hair-trigger rescaling** | Lets players who only partially depress triggers still reach full throttle. The threshold is configurable (default 15%). |
| **Circular deadzone** | A square deadzone causes diagonal drift. A circular deadzone provides consistent behavior in all directions. |
| **`localStorage` for custom pads** | No backend needed. Custom pad data is tiny (< 10 KB). Survives app restarts without a server. |

---

## 8. Key Functions Quick Reference

| Symbol | File | Lines | What it does |
|---|---|---|---|
| `makeDefaultPad()` | `App.tsx` | ~38–94 | Creates a new `CustomPad` from a named template |
| `sendGamepadTelemetry()` | `App.tsx` | ~890–1010 | Builds the 20-byte buffer and fires it via JSI |
| `CustomPadBuilder` | `App.tsx` | ~2479–2930 | Drag-and-drop canvas editor component |
| `TriggerPill` | `App.tsx` | ~394–465 | Trigger widget with vertical fill and local `clipPath` |
| `useStick()` | `App.tsx` | ~100–200 | Custom hook: touch tracking for thumbstick widgets |
| `navigateTo()` | `App.tsx` | ~3589–3617 | Screen transition with orientation change and curtain |
| `run_udp_loop()` | `server.py` | ~85–183 | Main packet receive/decode/apply loop |
| `Java_..._sendGamepadPacket` | `gamepad-engine.cpp` | ~200+ | JNI function: receives buffer from JS, copies to payload |
| `GamepadPayload` struct | `gamepad-engine.cpp` | ~48–59 | The 20-byte wire format definition |

---

## 9. How to Extend This

### Add a new button type
1. Add a new `WidgetType` value to the union in `App.tsx` (line 24).
2. Add rendering logic in the `ControllerScreen` SVG render loop.
3. Add editor controls in `CustomPadBuilder`.

### Add a new standard button (e.g., Share/PS button)
1. Add the `BtnId` value to the union (line 7–11).
2. Add the bit assignment in `BTN_MAP`.
3. Add the corresponding `vg.DS4_BUTTONS` call in `server.py` (lines 146–155).

### Change the polling rate
The `PollingHz` type and a settings UI dropdown already exist. The interval is passed to `useInterval(sendGamepadTelemetry, 1000 / hz)`.

### Add a new template
Add a new `else if (templateKey === "...")` branch inside `makeDefaultPad()` in `App.tsx`. Define buttons using the `btn()` helper.

---

## 10. Build & Run Summary

```bash
# 1. Build the React frontend
cd "App Interface Design"
npm install
npm run build
# Copy dist/ → android-client/app/src/main/assets/dist/

# 2. Build & deploy the Android APK
# Open android-client/ in Android Studio → Install Debug

# 3. Run the PC server
cd pc-server
pip install -r requirements.txt
python server.py
# OR run the pre-built .exe from pc-server/dist/
```

> **Prerequisite for server.py:** [ViGEmBus driver](https://github.com/nefarius/ViGEmBus/releases) must be installed on Windows for `vgamepad` to create a virtual controller.
