# Apple iOS Design System — Complete Reference

> Recovered 2026-07-26 from the shared chat
> `https://claude.ai/share/e904eb4a-dbe6-40df-93f5-b0608207a0ec`
> (artifact "Apple ios design system reference"). Text extracted from the rendered
> share page; tables reformatted to Markdown, wording preserved.

**Scope:** iOS 26 / 27 (Liquid Glass era). Compiled July 2026.

Sourcing convention used throughout:

- **[HIG]** — stated in Apple's Human Interface Guidelines or a WWDC session. Authoritative.
- **[MEASURED]** — sampled from a running device by the community. Accurate to the eye, but Apple does not publish these and explicitly says not to assume fixed values.
- **[UNPUBLISHED]** — Apple has no public API or documentation for this. Anything you find is reverse-engineered.

---

## 1. The single rule that matters most: two layers

Every iOS 26+ interface is split into exactly two layers:

| Layer | What lives there | Material |
|---|---|---|
| **Content layer** | The thing the user came for — list, photo, document, game view | Standard materials (opaque backgrounds, thin/regular blur). **Never Liquid Glass.** |
| **Functional layer** | Controls, tab bars, toolbars, sidebars, transient overlays, HUDs | Liquid Glass |

**[HIG]** Don't use Liquid Glass in the content layer — it works best when it draws a clear
distinction between interactive elements and content; putting it in the content layer produces
unnecessary complexity and confusing hierarchy.

**[HIG]** One exception: a content-layer control with a transient interactive moment (slider,
toggle) takes on a glass appearance *while being touched*.

**[HIG]** Use the effect sparingly. Overusing it across many custom controls degrades the
experience. Limit it to the most important functional elements.

> Why this separates "premium" from "childish": amateur glassmorphism puts glass on everything.
> Apple puts glass on ~3 elements that float above the app and leaves everything else flat and
> opaque. **Restraint is the entire effect.**

---

## 2. The Liquid Glass material

**[HIG]** A digital meta-material that dynamically bends and shapes light, moves organically like
a lightweight liquid, and responds to touch. It reflects and refracts its surroundings; its colour
is informed by surrounding content. Real-time rendering, specular highlights on device movement.

**Consequence: it has no fixed colour and no fixed hex value.** Any "Liquid Glass palette" online
is someone's approximation.

### 2.2 The two variants (never mix them)

- **Regular** — the default. Adapts to whatever is beneath and guarantees legibility. Use ~95% of the time.
- **Clear** — far more transparent. **[HIG]** Only when *all three* hold: (1) sits over media-rich
  content, (2) content layer tolerates a dimming layer beneath, (3) controls on top are large and
  bold enough to stay legible. Otherwise use Regular. This is a rule, not taste.

### 2.3 Hard prohibitions **[HIG]**

- **Never stack glass on glass.** Give the inner element a plain fill / transparency / vibrancy instead.
- **Never put glass on a table view / list.** Keep lists in the content layer.
- **Tint only primary actions.** One tinted button per screen, maximum.

### 2.4 Standard (non-glass) materials

Blur scale, lightest → heaviest: `ultraThin → thin → regular → thick → ultraThick`

**[HIG]** Text on any material must use **vibrancy, not solid colours**. A solid grey label goes
muddy or invisible depending on the backdrop.

---

## 3. Corner radius

### 3.1 Three shape types

- **Fixed** — a specific unchanging radius.
- **Capsule** — fully rounded ends. Buttons, pills, tab bars, toolbars, search fields. **The iOS 26
  default for controls.** Small/medium buttons are rounded rects; large/x-large become capsules.
- **Concentric** — radius derived from the parent. New in iOS 26.

### 3.2 The concentricity formula — the fastest visual upgrade available

```
inner_radius = outer_radius − padding
```

**[HIG]** WWDC25: aligning radii and margins around a shared centre lets shapes nest comfortably
inside each other.

```
Device screen (rounded)
└─ Sheet        (concentric to screen)
   └─ Card      (concentric to sheet)
      └─ Button (concentric to card)
```

Worked example: card radius 24px, card padding 12px → **inner button radius = 12px, not 24px.**
Reusing the parent's radius on a child is the **#1 amateur tell** — the corners visibly "double up".

SwiftUI does this automatically via `ConcentricRectangle` + `.containerShape(...)`.
**There is no CSS equivalent — compute it yourself with explicit `--radius-*` steps.**

### 3.3 Continuous curvature (the squircle)

**[HIG/MEASURED]** Apple uses a superellipse, not circular arcs — the straight edge flows into the
curve with no curvature discontinuity. Plain `border-radius` jumps from zero to full curvature at
the join; the eye reads that as a "kink".

**[MEASURED]** iOS app icon: corner radius ≈ **22.37% of icon width**, corner smoothing ≈ **60%**.

Web options, best → worst:
1. `corner-shape: squircle` — real superellipse, Chromium-only. Progressive enhancement.
2. SVG `clip-path` from the superellipse equation. Accurate, costs a clip per element.
3. Plain `border-radius`. **Fine — 90% of the benefit.**

### 3.4 Device screen radii — **[UNPUBLISHED]**

No public API, no published values. Everything circulating is reverse-engineered.
Reported figures cluster **39–55pt**. Don't hardcode; **28–36px** reads correct for a bottom sheet.

### 3.5 The radius scale to actually use

| Element | Radius |
|---|---|
| Small chip, badge, inline tag | 8px |
| Input field, small button | 12px |
| Card, list group, panel | 16–22px |
| Sheet, modal, large surface | 28–36px |
| Button, tab bar, toolbar, pill | capsule (999px) |
| App-icon-style tile | 22.37% of width |

> The "cool" comes from capsule controls and **correctly decreasing radii as you nest inward** —
> not from bigger numbers. Huge uniform radii on everything is exactly what reads as childish.

---

## 4. Colour — exact values

**[HIG]** Apple hands you **semantic roles**, not a palette: `label`, `secondaryLabel`,
`systemBackground`, `systemBlue`, `separator` — all auto-adapting to light/dark, Increase Contrast,
and vibrancy. **Design to the role, not the hex.** Apple states the values "may vary between
different contexts and releases".

### 4.2 Text (labels) — [MEASURED]

Hierarchy is built by **fading one colour**, not by picking four greys. This is a big reason iOS looks calm.

| Role | Light | Dark | Use |
|---|---|---|---|
| label | `#000000` @ 100% | `#FFFFFF` @ 100% | Primary text |
| secondaryLabel | `rgba(60,60,67,0.60)` | `rgba(235,235,245,0.60)` | Supporting text |
| tertiaryLabel | `rgba(60,60,67,0.30)` | `rgba(235,235,245,0.30)` | Disabled / placeholder |
| quaternaryLabel | `rgba(60,60,67,0.18)` | `rgba(235,235,245,0.18)` | Barely-there text |
| placeholderText | `rgba(60,60,67,0.30)` | `rgba(235,235,245,0.30)` | Field placeholders |

**Neither base is pure grey** — light tints blue-violet `(60,60,67)`, dark tints cool white
`(235,235,245)`. Deliberate: it stops the UI looking dead.

### 4.3 Backgrounds — [MEASURED]

| Role | Light | Dark |
|---|---|---|
| systemBackground | `#FFFFFF` | `#000000` |
| secondarySystemBackground | `#F2F2F7` | `#1C1C1E` |
| tertiarySystemBackground | `#FFFFFF` | `#2C2C2E` |
| systemGroupedBackground | `#F2F2F7` | `#000000` |
| secondarySystemGroupedBackground | `#FFFFFF` | `#1C1C1E` |
| tertiarySystemGroupedBackground | `#F2F2F7` | `#2C2C2E` |

**[HIG]** Primary for the overall view, secondary for groups within it, tertiary for groups within those.
Note the inversion — in light mode the page is white and cards are grey; in *grouped* mode the page
is grey and cards are white. Getting this backwards is a common tell.

### 4.4 Fills — [MEASURED]

Translucent fills for control surfaces — use these instead of picking a grey.

| Role | Light | Dark | Use |
|---|---|---|---|
| systemFill | `rgba(120,120,128,0.20)` | `rgba(120,120,128,0.36)` | Thin/small shapes — slider track |
| secondarySystemFill | `rgba(120,120,128,0.16)` | `rgba(120,120,128,0.32)` | Medium — switch background |
| tertiarySystemFill | `rgba(118,118,128,0.12)` | `rgba(118,118,128,0.24)` | Large — inputs, search bars, buttons |
| quaternarySystemFill | `rgba(116,116,128,0.08)` | `rgba(118,118,128,0.18)` | Large areas, complex content |

### 4.5 Separators — [MEASURED]

| Role | Light | Dark |
|---|---|---|
| separator (translucent) | `rgba(60,60,67,0.29)` | `rgba(84,84,88,0.60)` |
| opaqueSeparator | `#C6C6C8` | `#38383A` |

Hairlines only — 1px (0.5px on retina). **A solid mid-grey 1px line is the single most dated-looking
element in UI design.**

### 4.6 System accent colours — [MEASURED]

| Name | Light | Dark |
|---|---|---|
| systemBlue | `#007AFF` | `#0A84FF` |
| systemGreen | `#34C759` | `#30D158` |
| systemIndigo | `#5856D6` | `#5E5CE6` |
| systemOrange | `#FF9500` | `#FF9F0A` |
| systemPink | `#FF2D55` | `#FF375F` |
| systemPurple | `#AF52DE` | `#BF5AF2` |
| systemRed | `#FF3B30` | `#FF453A` |
| systemYellow | `#FFCC00` | `#FFD60A` |
| link | `#007AFF` | `#0984FF` |

**Version caution:** `systemTeal`, `systemCyan`, `systemMint`, `systemBrown` are unstable across
releases — sample them yourself rather than trusting a table.

### 4.7 Greys — [MEASURED]

| Name | Light | Dark |
|---|---|---|
| systemGray | `#8E8E93` | `#8E8E93` |
| systemGray2 | `#AEAEB2` | `#636366` |
| systemGray3 | `#C7C7CC` | `#48484A` |
| systemGray4 | `#D1D1D6` | `#3A3A3C` |
| systemGray5 | `#E5E5EA` | `#2C2C2E` |
| systemGray6 | `#F2F2F7` | `#1C1C1E` |

`systemGray` is identical in both modes — it's the pivot. The numbered variants walk toward the
background colour in each mode, which is why the same token works in both.

---

## 5. Colour grading — why Apple looks adult

**None of this is about finding better hexes.**

1. **One accent colour. Total.** **[HIG]** Use colour sparingly in non-game apps; overuse makes
   communication less clear and is distracting. Red = destructive, green = success, nothing else.
   **[HIG]** Avoid using the same colour to mean different things.
2. **Colour lives on ~5% of the screen.** Count the coloured pixels in iOS Settings — toggles and
   icon tiles. Everything else is white, grey, black.
   **Childish UI colours surfaces; mature UI colours actions.**
3. **Never pure grey.** Tint neutrals ~2–5% toward the accent's hue. Pure `#808080` reads flat and cheap.
4. **Hierarchy via opacity, not hue.** 100% → 60% → 30% → 18% on a single label colour.
5. **Dark mode is not `#000000` everywhere.** `#000000 → #1C1C1E → #2C2C2E`. A flat black app with
   white text looks unfinished. **The elevation ladder creates depth without shadows.**
6. **Saturate the backdrop, don't saturate the fill.** `backdrop-filter: blur(24px) saturate(180%)`.
   **Skipping `saturate()` is the most common mistake** — it's why CSS glassmorphism looks like
   frosted plastic.
7. **Gradients: one hue, small range.** Vary luminance, not hue. Purple-to-orange rainbow gradients
   are the loudest amateur signal there is.
8. **Contrast is non-negotiable.** **[HIG]** WCAG AA 4.5:1 for body text — matters most on tinted and
   translucent backgrounds, exactly where glass puts you. Never use colour alone to communicate state.

---

## 6. Typography and spacing

| Style | Size | Typical weight |
|---|---|---|
| Large Title | 34 | Regular/Bold |
| Title 1 | 28 | Regular |
| Title 2 | 22 | Regular |
| Title 3 | 20 | Regular |
| Headline | 17 | Semibold |
| Body | 17 | Regular |
| Callout | 16 | Regular |
| Subhead | 15 | Regular |
| Footnote | 13 | Regular |
| Caption 1 | 12 | Regular |
| Caption 2 | 11 | Regular |

**Headline and Body are the same size — only the weight differs.** That's how iOS creates emphasis
without size jumps.

**Font licensing:** SF Pro is not licensed for web or Android distribution. `-apple-system` picks it
up free on Apple devices; **Inter** is the closest legally usable substitute everywhere else.

**Spacing [HIG]:** 4, 8, 12, 16, 20, 24pt — 8pt grid with 4pt subdivisions.
**Minimum touch target: 44 × 44pt. Hard accessibility rule.**

**Icons [HIG]:** SF Symbols are Apple-platform-only. On Android/web use **Lucide** or Phosphor.
The important part is **one set at one stroke weight throughout**.

---

## 7. Web / Android implementation notes

- `backdrop-filter` needs the `-webkit-` prefix for older WebViews.
- `backdrop-filter` forces an offscreen composite of everything behind the element **every frame**.
  Budget: **under ~6 glass surfaces on screen, never on an element that animates position/size at
  60fps, never nested.**
- Honour `prefers-reduced-transparency` and `prefers-reduced-motion`. On web it's on you; shipping
  without it is an accessibility bug.
- Specular highlight: `box-shadow: inset 0 1px 0 rgba(255,255,255,0.85)` — cheap, and it's what makes
  a rectangle read as a sheet of glass rather than a blurred div.
- Press feedback: `cubic-bezier(0.32, 0.72, 0, 1)` over ~0.22s, scale-down ≈ 0.96.

---

## 8. Primary sources

- Apple Newsroom, "Apple introduces a delightful and elegant new software design" (June 2025)
- Apple HIG — Materials, Color, Layout, Foundations
- WWDC25 session 219, "Meet Liquid Glass"
- Community-measured system colour tables (Noah Gilmore's iOS 13 system colour reference)
- Apple Developer Forums — `ConcentricRectangle`, unpublished device corner radii
