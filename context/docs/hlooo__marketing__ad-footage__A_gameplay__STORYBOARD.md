# STORYBOARD — GamepadOS

## Concept Block

- **Message:** GamepadOS turns your Android phone into a high-performance, ultra-low-latency PC game controller with custom layouts and gyro steering—completely free and with no account.
- **Conceit:** The video acts as a high-tech gaming console interface, where the brand's signature orange glow and deep slate gradients frame smooth, kinetic transitions of virtual controller elements, setup steps, and performance stats.
- **Arc:** Demonstration / Hero-Promise (Hook → Simple Setup → Performance Flex → Feature Showcase → CTA).
- **Audience:** PC gamers, mobile gamers, racing game enthusiasts, and emulator players looking for a free, highly customizable gamepad solution.
- **Brand Voice:** Technical, high-performance, precise, and gaming-focused.
- **Through-line:** A recurring glowing orange accent line and a subtle background grid pattern that pulses in sync with the narration and music.
- **Signature Moment:** Beat 3 (The Latency Flex), where a massive "2.5ms" stat ticks down rapidly and pulses with a bright orange radial glow on a bass drop.
- **Current:** Leftward (neutral forward progress).
- **Pacing:** Total length: 35.5s. 5 distinct beats of varying lengths to create a dynamic rhythm:
  - Beat 1: 6.5s — The Hook (establishes the core promise and shows the phone mockup).
  - Beat 2: 6.5s — The Setup (staggered reveal of the 3 simple steps).
  - Beat 3: 7.5s — The Latency Flex (the signature high-impact stat moment).
  - Beat 4: 7.0s — The Features (detailed showcase of gyro steering and layout builder).
  - Beat 5: 8.0s — The Outro / CTA (strong closing with download buttons).
- **Stillness:** Beat 3 has a brief 0.5s hold right after the "2.5ms" stat hits its final value, creating a dramatic pause before the next transition.
- **Never:** No generic enter-then-freeze slideshows; no floating screensaver elements; no unrounded corners; no solid orange backgrounds.

---

## The Vector Ledger

| Seam | Exit Vector | Entry Vector | Transition In |
| --- | --- | --- | --- |
| 1 → 2 | Throws LEFT | Enters R-to-L | `cut-the-curve` (current) |
| 2 → 3 | Recedes Z-back | Enters Z-forward | `zoom-through` (Z-push) |
| 3 → 4 | Recedes Z-back | Arrives oversized | `inverse-zoom-through` (Z-arrival) |
| 4 → 5 | Rises UP | CTA rises UP in | `cross-warp-morph` (shader transition) |

---

## Asset Audit

### 1. Page Screenshots (000% - 100% scroll)
- `000% scroll` (Hero section with laptop and phone controller) — **USE** in Beat 1 and Beat 4 as visual reference.
- `019% scroll` (Setup steps: Run PC server, Scan QR, Play anything) — **USE** in Beat 2 to ground the 3-step setup.
- `038% scroll` ("2.5ms" latency stat section) — **USE** in Beat 3 to ground the latency claim.
- `057% scroll` (Features grid: Gyro, Layout builder, Presets, Rumble) — **USE** in Beat 4 to ground features.
- `076% scroll` ("Get both. They're free." download page) — **USE** in Beat 5 to ground the CTA.

### 2. Raster Assets
- `og-image.jpg` (Phone controller mockup next to PC screen) — **USE** in Beat 1 (Hook) and Beat 4 (Features/Setup). It is the signature visual of the brand.

### 3. SVG / Icon Assets
- `favicon.svg` (GamepadOS logo: dark rounded square with white circle and orange dot) — **USE** in Beat 1 (Opener) and Beat 5 (CTA) as the primary brand mark.
- `logo-034e6222.svg` (Android logo) — **USE** in Beat 2 and Beat 5 to represent Android app compatibility.
- `logo-0963b2f4.svg` (Windows logo) — **USE** in Beat 2 and Beat 5 to represent Windows PC server compatibility.
- `logo-20f9cd84.svg` (Tuning/sliders icon) — **USE** in Beat 4 to represent custom layout and sensitivity tuning.
- `logo-40a30e90.svg` (Wireless/connection icon) — **USE** in Beat 2 to represent instant Wi-Fi/USB pairing.
- `logo-4ffacf99.svg` (D-pad and buttons) — **USE** in Beat 4 to represent the layout builder and custom presets.
- `logo-cf9fa783.svg` (Phone vibrating/rumble icon) — **USE** in Beat 4 to represent dual rumble/force feedback.

---

## Per-Beat Metadata

### Beat 1 — The Hook
- **Type:** hook
- **Beat (Emotion):** curiosity / excitement
- **Shot:** medium-close
- **Camera:** dolly-in 1.0 → 1.12
- **Seam In:** none (beat 1)
- **Content Type:** captured-asset + composed-visual
- **Assets:** focal=`og-image.jpg` (centered, 60% of frame); `favicon.svg` (top-left, 8% of frame).
- **Text Effect:** title: `kinetic-center-build`; subtitle: `per-word-crossfade`.
- **Timing:** start 0.00s · duration 6.50s · why establishes the core value proposition and introduces the visual metaphor of the phone controller.
- **Visual Primary:** The GamepadOS logo scales up in the top-left, while the high-resolution phone controller mockup (`og-image.jpg`) slides in from the right. A subtle orange glow pulses behind the phone.
- **Composition:** Left-aligned text (headline + subtitle), right-aligned phone mockup, dark slate gradient background (`gradient-3`) with bottom orange glow (`gradient-2`).
- **Shot Phases:** Entrance (logo scales, text builds, phone slides in) → Development (orange glow pulses, camera dollying in) → Settle (subtle grid pattern rotates slowly).
- **SFX:** Deep electronic synth swell starting at 0.0s, peaking at 1.5s (riser into hit).

### Beat 2 — The Setup
- **Type:** product_moment
- **Beat (Emotion):** simplicity / ease
- **Shot:** medium
- **Camera:** pull-back 1.1 → 1.0
- **Seam In:** `cut-the-curve` left → content enters R→L
- **Content Type:** composed-visual
- **Assets:** `logo-40a30e90.svg` (pairing icon), `logo-0963b2f4.svg` (Windows logo), `logo-034e6222.svg` (Android logo).
- **Text Effect:** title: `mask-reveal-up`; cards: `line-by-line-slide`.
- **Timing:** start 6.50s · duration 6.50s · why three setup steps are revealed sequentially (staggered) to show ease of use.
- **Visual Primary:** Three rounded cards (`card` component) slide up sequentially from the bottom. Card 1 shows "1. Run PC Server" with Windows logo; Card 2 shows "2. Scan QR" with pairing icon; Card 3 shows "3. Play Anything" with Android logo.
- **Composition:** Three-column card layout, centered title "Pair in seconds", dark charcoal gradient background (`gradient-4`).
- **Shot Phases:** Entrance (title reveals, Card 1 slides up) → Development (Card 2 slides up, Card 3 slides up, subtle orange connector line draws between them) → Settle (cards hover slightly).
- **SFX:** Soft UI clicks at 7.5s, 8.7s, and 9.9s as each card lands (staggered hits).

### Beat 3 — The Latency Flex (Signature Moment)
- **Type:** proof
- **Beat (Emotion):** awe / confidence
- **Shot:** close-up
- **Camera:** push-forward 1.0 → 1.15
- **Seam In:** `zoom-through` Z-push
- **Content Type:** composed-visual
- **Assets:** none (pure high-impact stat).
- **Text Effect:** stat: `shimmer-sweep`; description: `soft-blur-in`.
- **Timing:** start 13.00s · duration 7.50s · why high-impact stat requires a dedicated beat to land the performance claim.
- **Visual Primary:** A massive, glowing "2.5ms" stat ticks down rapidly from 99ms to 2.5ms, surrounded by a pulsing orange radial glow.
- **Composition:** Centered massive stat, supportive description "Ultra-low latency over USB" below, dark charcoal background with intense orange radial glow (`gradient-2`).
- **Shot Phases:** Entrance (stat scales up rapidly, ticking starts) → Development (stat hits 2.5ms, orange glow pulses outwards, camera pushes in) → Settle (0.5s dramatic hold with subtle background grid pulse).
- **SFX:** Cinematic sub-bass drop at 13.0s, ticking sound from 13.0s to 14.5s, ending with a sharp metallic impact at 14.5s as "2.5ms" locks in.

### Beat 4 — The Features
- **Type:** feature
- **Beat (Emotion):** control / precision
- **Shot:** wide
- **Camera:** parallax-pan left-to-right
- **Seam In:** `inverse-zoom-through` Z-arrival
- **Content Type:** captured-asset + composed-visual
- **Assets:** focal=`og-image.jpg` (centered, 50% of frame); `logo-cf9fa783.svg` (rumble icon), `logo-20f9cd84.svg` (tuning icon), `logo-4ffacf99.svg` (D-pad icon).
- **Text Effect:** title: `kinetic-center-build`; feature-text: `per-word-crossfade`.
- **Timing:** start 20.50s · duration 7.00s · why showcases the two most advanced features (gyro steering and layout builder) with visual support.
- **Visual Primary:** The phone controller mockup (`og-image.jpg`) is centered. Two feature panels slide in from the sides: Left panel shows "Gyro Motion Steering" with rumble icon; Right panel shows "Layout Builder" with tuning and D-pad icons.
- **Composition:** Centered phone mockup, left and right feature panels, deep slate gradient background (`gradient-3`).
- **Shot Phases:** Entrance (phone mockup arrives oversized, feature panels slide in from left/right) → Development (glowing orange lines connect feature panels to active areas on the phone mockup, camera pans slowly) → Settle (subtle glowing pulse on the phone's joysticks).
- **SFX:** Whoosh sound at 20.5s as the phone arrives, soft hum/vibration sound from 21.5s to 24.5s (representing rumble feedback).

### Beat 5 — The Outro / CTA
- **Type:** cta
- **Beat (Emotion):** excitement / action
- **Shot:** medium
- **Camera:** pull-back 1.15 → 1.0
- **Seam In:** `cross-warp-morph` (shader transition)
- **Content Type:** captured-asset + composed-visual
- **Assets:** `favicon.svg` (centered, 15% of frame), `logo-034e6222.svg` (Android logo), `logo-0963b2f4.svg` (Windows logo).
- **Text Effect:** title: `kinetic-center-build`; buttons: `spring-scale-in`.
- **Timing:** start 27.50s · duration 8.00s · why provides a strong, clear closing with actionable download buttons.
- **Visual Primary:** The GamepadOS logo (`favicon.svg`) is centered, with the headline "Get both. They're free." above it. Two large pill buttons (`button-primary-giant`) slide up: "Android APK" (with Android logo) and "PC Server" (with Windows logo).
- **Composition:** Centered logo, headline, and two prominent CTA buttons side-by-side, deep slate gradient background (`gradient-3`) with bottom orange glow (`gradient-2`).
- **Shot Phases:** Entrance (logo and title slide down, buttons slide up) → Development (orange glow pulses behind the buttons, camera pulls back) → Settle (final hold on the brand mark and CTAs).
- **SFX:** Uplifting electronic chime at 27.5s, followed by a warm, resolving synth pad that fades out.

---

## Locked Timings Table

| Beat | Start | End | Duration | Type |
| --- | --- | --- | --- | --- |
| 1 | 0.00s | 6.50s | 6.50s | hook |
| 2 | 6.50s | 13.00s | 6.50s | product_moment |
| 3 | 13.00s | 20.50s | 7.50s | proof (signature) |
| 4 | 20.50s | 27.50s | 7.00s | feature |
| 5 | 27.50s | 35.50s | 8.00s | cta |