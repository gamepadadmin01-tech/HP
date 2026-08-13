---
version: alpha
name: GamepadOS — Your phone is the controller — Frame (video / frame layer)
description: >
  Frame-scale design system generated from a capture of GamepadOS — Your phone is the controller. The unit is the frame
  (1920×1080). Colors, typography, spacing, radii, and components below are extracted
  from the live site and are normative — quote them verbatim.
  Source tagline: Turn your Android phone into a PC game controller. Touch sticks, gyro steering, custom layouts — paired over Wi-Fi or USB with as low as 2.5 ms wired. Free, no account.
unit: the frame — 1920×1080 primary; 9:16 and 1:1 documented
principle: atoms are sacred · composition is free · numbers come from the script

colors:
  canvas: "#FFFFFF"
  surface: "#F6F5F1"
  surface-contrast: "#0C0D10"
  ink: "#1D1D1F"
  ink-muted: "#141417"
  accent: "#FF4D00"

grounds:
  - { bg: "#F6F5F1", on: "#111111", kind: "light" }
  - { bg: "#141417", on: "#FFFFFF", kind: "dark" }
  - { bg: "#FFFFFF", on: "#111111", kind: "canvas" }

radii:
  r1: "13px"
  r2: "24px"
  r3: "999px"

shadows:
  shadow-1: "rgba(20, 20, 23, 0.18) 0px 4px 14px -8px"
  shadow-2: "rgba(20, 20, 23, 0.5) 0px 10px 22px -10px"

gradients:
  gradient-1: "radial-gradient(58% 52% at 52% 40%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0) 70%)"
  gradient-2: "radial-gradient(130% 75% at 50% 100%, rgba(255, 92, 0, 0.42), rgba(255, 92, 0, 0) 58%)"
  gradient-3: "linear-gradient(168deg, rgb(44, 57, 71) 0%, rgb(26, 32, 41) 52%, rgb(16, 20, 27) 100%)"
  gradient-4: "linear-gradient(145deg, rgb(28, 29, 34), rgb(10, 11, 14))"

typography:
  # — reading ramp (captured px → frame-relative cqw) —
  display: { font_family: "Inter", cqw: 5, weight: 800, line_height: 1.05, tracking: "-0.03em", color: "ink-muted" }
  heading: { font_family: "Inter", cqw: 2.5, weight: 800, line_height: 1.05, tracking: "-0.03em", color: "ink-muted" }
  heading-3: { font_family: "Inter", cqw: 2.08, weight: 800, line_height: 1.05, tracking: "-0.02em", color: "ink-muted" }
  body: { font_family: "Inter", cqw: 1.56, weight: 400, line_height: 1.6, color: "ink" }
  link: { font_family: "Inter", cqw: 0.94, weight: 800, line_height: 1.55, tracking: "-0.02em", color: "ink-muted" }
  label: { font_family: "Inter", cqw: 0.94, weight: 400, line_height: 1.55, color: "ink" }
  heading-4: { font_family: "Inter", cqw: 2.08, weight: 700, line_height: 1.05, tracking: "0.08em", color: "ink" }
  # — display / hero ramp (frame-native, video-scale) —
  display-hero: { font_family: "Inter", cqw: 8, weight: 700, line_height: 1, tracking: "-0.02em", color: "ink-muted" }
  wordmark-mega: { font_family: "Inter", cqw: 8.02, weight: 700, line_height: 0.92, tracking: "-0.03em", color: "ink-muted" }

spacing:
  gap-tight: "0.47cqw"
  gap: "0.73cqw"
  pad-region: "1.04cqw"
  pad-edge: "1.35cqw"

components:
  button-primary:
    backgroundColor: "{colors.ink-muted}"
    textColor: "{colors.canvas}"
    typography: "Inter 500"
    rounded: "{radii.r3}"
    padding: "9px 16px"
    shadow: "rgba(20, 20, 23, 0.5) 0px 10px 22px -10px"
    height: "40px"
    description: "Primary solid action button (the site's most prominent filled CTA — accent-colored or a bold neutral pill)."
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "Inter 600"
    rounded: "{radii.r3}"
    padding: "13px 22px"
    border: "1px solid #DDDBD5"
    shadow: "rgba(20, 20, 23, 0.18) 0px 4px 14px -8px"
    height: "51px"
    description: "Secondary / outline button (bordered)."
  button-3:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "Inter 400"
    rounded: "0px"
    height: "51px"
    description: "Additional button variant captured from the site."
  button-4:
    backgroundColor: "{colors.ink-muted}"
    textColor: "{colors.canvas}"
    typography: "Inter 600"
    rounded: "{radii.r3}"
    padding: "13px 22px"
    shadow: "rgba(20, 20, 23, 0.5) 0px 10px 22px -10px"
    height: "49px"
    description: "Additional button variant captured from the site."
  button-primary-giant:
    backgroundColor: "{colors.ink-muted}"
    textColor: "{colors.canvas}"
    typography: "Inter 500"
    fontSize: "2.4cqw"
    rounded: "{radii.r3}"
    padding: "1.5cqw 3.4cqw"
    shadow: "rgba(20, 20, 23, 0.5) 0px 10px 22px -10px"
    description: "Frame-scale primary CTA — button-primary's atoms at video size; compose into hero/plate frames."
  card:
    backgroundColor: "{colors.canvas}"
    rounded: "{radii.r2}"
    border: "1px solid {colors.surface}"
    shadow: "rgba(20, 20, 23, 0.18) 0px 4px 14px -8px"
    description: "Content surface captured from the site (its own radius / border / shadow)."
  nav-bar:
    backgroundColor: "{colors.surface}"
    height: "64px"
    description: "Top-nav ground/height — use sparingly in video (one establishing frame at most)."
  glass-panel:
    backgroundColor: "rgba(246, 245, 241, 0.82)"
    backdropFilter: "blur(14px)"
    rounded: "0px"
    description: "Frosted-glass panel: translucent fill + backdrop blur — composite over a colored ground."
  chip:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "Inter 700"
    rounded: "{radii.r3}"
    padding: "7px 13px"
    border: "1px solid {colors.surface}"
    shadow: "rgba(20, 20, 23, 0.18) 0px 4px 14px -8px"
    height: "35px"
    description: "Pill / badge / tag — small rounded label."
---

# GamepadOS — Your phone is the controller — Frame

## Overview

GamepadOS is a high-performance software utility that turns your phone into a virtual PC game controller. This frame-scale design system is built to translate its sleek, low-latency, high-tech identity into a premium video. The design language is defined by a striking contrast between the clean, structured web layout (light paper `#F6F5F1`) and the dark, immersive, neon-accented product interface (deep slate `#1A2029`, charcoal `#141417`, and vibrant orange `#FF4D00` glow).

## Colors

- `canvas` — `#FFFFFF` (pure white, used for high-contrast text and clean card backgrounds)
- `surface` — `#F6F5F1` (light warm paper, the primary web background)
- `surface-contrast` — `#0C0D10` (ultra-dark charcoal, used for deep dark backgrounds)
- `ink` — `#1D1D1F` (dark gray, primary body text)
- `ink-muted` — `#141417` (near black, primary heading color and solid button background)
- `accent` — `#FF4D00` (vibrant orange, the brand's signature color, representing energy, speed, and gaming precision)

## Typography

The typography uses **Inter Tight** for bold, high-impact headings and **Inter** for clean, highly legible body copy.

- **Display Hero**: `Inter Tight` (8cqw, ExtraBold, tracking -0.03em) — for cover titles and massive claims.
- **Heading**: `Inter Tight` (5cqw, Bold, tracking -0.02em) — for scene titles.
- **Heading 3**: `Inter Tight` (2.5cqw, Bold) — for sub-features and card titles.
- **Body**: `Inter` (1.56cqw, Regular, line-height 1.6) — for descriptions and explanations.
- **Label / Chip**: `Inter` (1cqw, Bold, uppercase) — for technical stats and badges.

## Frame Treatments

These 6 named composition recipes are designed to structure the video's visual narrative:

### 1. Cover / Title Frame (The Hook)
- **Ground**: Deep Slate Gradient (`gradient-3`) with bottom Orange Glow (`gradient-2`).
- **Typography**: `display-hero` (Inter Tight, 8cqw, ExtraBold, color: `#FFFFFF`) centered.
- **Focal Move**: The GamepadOS logo (`favicon.svg`) scales up from 0% to 100% with a subtle rotation, followed by a smooth text reveal of "GamepadOS" and the tagline.
- **Accent Use**: A vibrant orange glowing border around the logo and an orange highlight on the word "OS".

### 2. Statement / Claim Frame (The Promise)
- **Ground**: Dark Charcoal Gradient (`gradient-4`) with a subtle, pulsing orange background glow.
- **Typography**: Centered `heading` (Inter Tight, 5cqw, Bold, color: `#FFFFFF`) with key words highlighted in orange.
- **Focal Move**: Kinetic text reveal using a smooth "word-by-word" slide-up and fade-in animation.
- **Accent Use**: The signature orange `#FF4D00` is used to highlight the core promise (e.g., "Your phone is the controller").

### 3. Stat / Impact Frame (The Latency)
- **Ground**: Dark Charcoal Gradient (`gradient-4`) with a strong radial orange glow behind the stat.
- **Typography**: Massive `wordmark-mega` (Inter Tight, 12cqw, ExtraBold, color: `#FF4D00`) with a text-shadow glow.
- **Focal Move**: A rapid number counter that ticks down from 100ms to "2.5ms", accompanied by a sharp scale-up and a visual pulse wave radiating outwards.
- **Accent Use**: The entire stat is rendered in vibrant orange with an active glow effect to emphasize the ultra-low latency.

### 4. Feature / Grid Frame (The Features)
- **Ground**: Light Warm Paper (`#F6F5F1`) to mirror the clean web layout.
- **Typography**: Dark headings (`ink-muted`, `#141417`) and body text (`ink`, `#1D1D1F`).
- **Focal Move**: A structured grid of 2 or 4 cards (`card` component with `r2` border-radius and subtle shadow) that slide in sequentially from the bottom-up (staggered entrance).
- **Accent Use**: Small orange icons (e.g., Gyro, Layout Builder, Rumble) inside each card, and orange borders on the active/focused card.

### 5. Product / App Surface Frame (The Setup)
- **Ground**: Deep Slate Gradient (`gradient-3`) to create a premium, dark-mode environment.
- **Typography**: White text (`#FFFFFF`) with orange highlights.
- **Focal Move**: A high-resolution mockup of the phone controller (`og-image.jpg`) slides in from the right, while step-by-step setup cards (Run Server, Scan QR, Play) slide in from the left.
- **Accent Use**: A glowing orange line connecting the setup steps to the phone mockup, illustrating instant pairing.

### 6. Closing / CTA Frame (The Download)
- **Ground**: Deep Slate Gradient (`gradient-3`) with bottom Orange Glow (`gradient-2`).
- **Typography**: Centered `heading` (Inter Tight, 5cqw, Bold, color: `#FFFFFF`) and `body` (Inter, 1.56cqw, color: `#F6F5F1`).
- **Focal Move**: The GamepadOS logo and final tagline slide down, while two prominent pill buttons (`button-primary-giant` in dark charcoal with orange hover glow, and a secondary outline button) slide up from the bottom.
- **Accent Use**: An orange glowing pulse behind the primary CTA button to draw immediate focus.

## Composition Rules (Do / Don't)

### Do:
- **Do** maintain a strict contrast ratio of at least 4.5:1 for all text elements.
- **Do** use the deep slate and charcoal gradients for high-tech, product-focused scenes, and the light warm paper background for clean, feature-grid scenes to create a dynamic rhythm.
- **Do** apply the signature orange `#FF4D00` as a high-energy accent (glows, highlights, active buttons, stats) rather than a solid background fill.
- **Do** use the exact border-radius tokens (`r1: 13px` for small chips, `r2: 24px` for cards, `r3: 999px` for pill buttons) to preserve the brand's rounded, friendly-yet-technical aesthetic.

### Don't:
- **Don't** use solid orange `#FF4D00` as a full-frame background color; it is too intense and causes visual fatigue.
- **Don't** mix unrelated fonts; stick strictly to `Inter Tight` (headings) and `Inter` (body/labels).
- **Don't** use harsh, unrounded corners; every card and button must use the brand's rounded tokens.
- **Don't** let text overlap with mockups or icons; maintain generous spacing using the `spacing` tokens.

## Frame Craft Bar (Self-Audit)
- **Squint Test**: Squint your eyes at the frame. Is the visual hierarchy immediately clear? Does the core stat or headline stand out first?
- **Palette Check**: Are the colors strictly limited to the brand palette? Is the orange accent used purposefully to guide the eye?
- **Type Check**: Are headlines at least 64px (or 5cqw) and body text at least 28px (or 1.5cqw) for perfect legibility on video?