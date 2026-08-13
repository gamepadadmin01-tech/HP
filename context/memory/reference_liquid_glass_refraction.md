---
name: liquid-glass-refraction
description: "How to actually reproduce Apple Liquid Glass refraction on the web — method, browser limits, and measured build costs"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 038e8782-61c6-41e2-ba27-083e0e981379
  modified: 2026-07-29T06:45:09.532Z
---

Researched + prototyped 2026-07-28. Lab lives at
`hlooo/iphone liquid display research/refraction-lab.html` (serve it — `file://` renders
static; there is a `glass-lab` entry in `.claude/launch.json` on port 8896).

## Two competing web approaches — they are NOT equivalent
- **feTurbulence + feDisplacementMap** (most popular libs, e.g. dpawlikowski/liquid-glass):
  noise-driven wobble. Looks glassy, is **not** lensing. Params that matter: baseFrequency
  ~0.008, numOctaves 2, scale 12–18 (>18 artifacts in Safari).
- **Physically-based displacement map** (kube.io method): real Snell's-law refraction.
  This is what Apple actually does. Implemented from scratch in the lab and verified.

## The physical method (verified working)
1. Bezel height profile = convex **squircle** `y = (1-(1-x)^4)^(1/4)`, NOT a circle —
   circle gives a visible kink where flat meets curve.
2. Surface normal = numerical derivative of that height function.
3. Snell: `n1·sin(t1) = n2·sin(t2)`, n_air=1, n_glass≈1.5; lateral offset = `thickness·tan(t1-t2)`.
4. Encode to RGBA: **R = x offset, G = y offset, 128 = neutral**, ±127 spans ±maxDisplacement.
5. `feImage` (the map) → `feDisplacementMap` with **`scale` = maxDisplacement**,
   `xChannelSelector="R" yChannelSelector="G"`, then `backdrop-filter: url(#id)`.
Verified correct on the generated map: centre exactly `[128,128]`, every edge displaces
INWARD (left `[151,128]`, right `[105,128]`, top `[128,151]`), only ~28% of the panel
(the bezel ring) is non-neutral. Chromatic aberration = displace R and B at slightly
different `scale` values and recombine with `feBlend mode="screen"`.

## 🚨 Browser constraint that decides everything
**SVG filters used as `backdrop-filter` are Chromium-only.** Firefox/Safari can only use
them via `filter`, which does not sample the backdrop. **Android WebView is Chromium, so
this IS viable in the app even though it is not viable on the open web.** Confirmed
supported in this session's Chromium: `backdrop-filter: url(#x)` ✓ and
`corner-shape: squircle` ✓. Still needs confirming on the real device / minSdk 24 WebView.

## Measured map-build cost (DESKTOP, warm, median of 5 — phone will be several× slower)
| surface | CPU | +PNG encode | total | vs 16.7ms frame |
|---|---|---|---|---|
| HUD pill 200×36 | 2.9 | 3.1 | **6.0** | fits |
| panel 280×170 | 9.5 | 4.3 | **13.8** | fits, barely |
| sheet 380×520 | 24.9 | 7.9 | **32.8** | **blows the frame** |
| full 412×900 | 21.3 | 6.5 | **27.8** | **blows the frame** |

→ **Build the map ONCE at mount and cache the data URL. Never rebuild per frame.** This
empirically confirms the CLAUDE.md rule "no glass element may animate position or size" —
any size/shape change forces a full rebuild. The cheap escape hatch is animating the
filter's **`scale` attribute only**, which just changes a multiplier.

## ✅ ON-DEVICE VERDICT (Redmi Note 13 / mt6897 / Android 16 / WebView 150, 2026-07-28)
Measured over adb + CDP (`tools/webview-cdp.mjs`, `adb reverse tcp:8896`, `adb forward
tcp:9223 localabstract:chrome_devtools_remote`).
- **Refraction is FREE.** no-filter 61fps, blur2 62, blur24 61, **full Snell refraction 62** —
  all pinned at the 60Hz ceiling. **10 simultaneous animating refracting panels still 60fps.**
  Contradicts CLAUDE.md §7's "max 6" on this chipset (but that test page had no gameplay
  scene / multi-touch / native engine competing — don't relax the rule blindly).
- Gyro specular + 3 glass panels: 61fps. Free.
- Device feature support: SVG-url backdrop-filter ✓, corner-shape squircle ✓, linear() ✓,
  mask-composite ✓, var() in rgba() ✓. All 5 spring easings parse with 43 stops.
- **The real cost is CPU map build, 2–4× desktop:** HUD 23.4ms, panel 35.2ms, sheet 54.2ms,
  full-screen 69.9ms. Even the smallest blows a frame → build once at mount, never again.
  **`toDataURL` PNG encode is 18–28ms of that** — try `toBlob`+`createObjectURL` instead.
- ⚠️ **Web DeviceOrientation fires at only ~17Hz** (43 events / 2.5s) → visibly steppy.
  Use the app's NATIVE gyro bridge, not the web API. Now evidence, not preference.

## ✅ PAD GLASS MEASURED UNDER TOUCH (2026-07-29, same device)
Pad screen, 61-shape SVG, **6 backdrop-filter layers of which 4 are FULL-SCREEN**
(407×808 @ dpr3 = 1221×2424 device px), blur(16px) saturate(160%), while dispatching
continuous dual-pointer moves:
| | glass ON | glass OFF |
|---|---|---|
| fps | 61 | 61 |
| median frame | 16.6ms | 16.6ms |
| p95 / p99 / max | 16.7 / 16.7 / 16.7 | same |
| frames >20ms | **0** | 0 |
**Zero measurable cost. No jank, not just a good average.** A/B validated — the off-pass
asserted `stillGlassed:0` before measuring (an earlier run silently compared glass-to-glass
because the element list was grabbed at the wrong moment; always re-assert the off state).
⚠️ STILL NOT COVERED: the native engine (UDP + gyro + native touch overlay) was NOT running
— app wasn't connected to a PC. Synthetic PointerEvents also bypass the native touch path.
So this clears the WebView, not the full gameplay stack.

## 🚨 `data-no-press` IS A MYTH IN THIS CODEBASE
theme.css claims the on-screen controller and pad editor set it. **They do not.** It appears
exactly ONCE in app source: `TabAccount.tsx:283`. Any CSS guard written as
`:not([data-no-press])` protects NOTHING on the pad. Fix theme.css's comment or actually add
the attribute before relying on it.

## Pad widgets: per-widget backdrop-filter is IMPOSSIBLE
The whole controller is ONE `<svg>` (61 circle/rect). `backdrop-filter` needs a backdrop
root; SVG child shapes don't create one — the declaration parses and is silently ignored.
Glass on the pad must come from (a) backdrop-filter on the CONTAINER div, and (b) the glass
*look* per widget via translucent fill + bright stroke rim. Also: 20 of 61 shapes carry
inline `style="fill:…"` which is the PRESS-STATE colour — overriding it with `!important`
re-skins them but **kills button press feedback**. Fix properly in Widgets.tsx constants.

## Not yet measured
Per-frame GPU compositing cost. **rAF is frozen in the Browser pane** (`document.hidden`
is true there), so FPS benchmarks silently never complete — they time out. Must be
measured on the real phone.

## Motion — iOS animates on SPRINGS, not beziers
`cubic-bezier` is monotonic so it CANNOT overshoot-and-settle, which is the whole feel of
iOS. **CSS `linear()` can** — solve the damped-oscillator ODE, sample it, emit `linear(...)`;
still compositor-run. Built in `motion-lab.html`, generated by `gen-motion.mjs` → `motion.css`
(regenerate, never hand-edit). Apple PUBLISHED: `.spring` response 0.55 / damping 0.825
(1.0% overshoot, 758ms); `.interactiveSpring` 0.15 / 0.86 (210ms). `.smooth`/`.snappy`/`.bouncy`
have documented BEHAVIOUR only (none / slight / visible overshoot) — our values are **fitted**
and labelled as such, not spec. Verified peaks: spring 1.0102, bouncy 1.0679, smooth exactly
1.0000. `@supports not (transition-timing-function: linear(0,1))` falls back to
`cubic-bezier(.32,.72,0,1)`. Scroll-linked header shadow (alpha 0→0.42 over 60px) is the
cheapest polish win and is done.

## GOTCHA that wasted three debug cycles
In the Browser pane `document.hidden` is TRUE → rAF frozen AND **CSS transitions never
advance**. `getComputedStyle` then returns the pre-transition value, so press states,
`var()`-in-`rgba()` substitution, and scroll shadows all read as broken when they are fine.
Always inject `*{transition:none !important}` before asserting a computed style in that pane.

## Unexplored, and unique to this app
Real Liquid Glass tracks **device motion** for its specular highlight. GamepadOS already
streams gyro through the native bridge, so the highlight could genuinely follow device
tilt — something virtually no web implementation can do. Not prototyped yet.

Related: [[c-drive-disk-audit]] for the browser-pane gotchas; the design-system rules live
in `hlooo/iphone liquid display research/CLAUDE.md`.
