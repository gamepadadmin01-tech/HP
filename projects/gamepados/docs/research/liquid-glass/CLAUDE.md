# CLAUDE.md — Remote Gamepad UI rules

Design system: Apple iOS 26 "Liquid Glass", adapted for a React/TypeScript
app running in an Android WebView.

Read this file fully before touching any styling. These are constraints,
not suggestions. When a rule here conflicts with something that "looks
cooler", the rule wins.

---

## 0. What this app is (why the rules are stricter than normal)

A phone acts as a wireless Xbox-style controller. Touch and gyro data go
out over UDP to a PC. The pad surface is under continuous multi-touch at
60fps while a game is running on the other end.

Two consequences that override normal web styling instincts:

1. **Input latency is the product.** Any style that costs frames costs the
   user a dropped input. A dropped input in a game is a lost fight.
2. **The pad is not a webpage.** It is a control surface. Styling decisions
   that are harmless on a marketing page are defects here.

---

## 1. Layer map — MEMORIZE THIS

Apple's HIG splits every interface into a content layer and a functional
layer, and forbids glass in the content layer. In this app the split is:

### NEVER glass (interaction layer)

The pad surface and every widget on it:

`button` · `thumbstick` · `trigger` · `dpad` · `abxy` · `ltrt` · `macro`

These are touched continuously. They get **flat opaque or solid-alpha
fills only**. No `backdrop-filter`, ever, under any circumstance,
including "just a little bit" and including on the pressed state.

### Glass allowed (functional layer)

- Settings sheet
- Pad builder chrome: widget palette, inspector panel, top toolbar
- Connection status HUD
- Modals, alerts, confirmation sheets
- Any transient overlay that floats above the pad

These are static, low in number, and not under continuous touch.

### Decision rule for anything new

> Is this element under the user's finger during gameplay?
> Yes → flat. No → glass allowed.

---

## 2. MUST / NEVER

### MUST

- `MUST` use CSS custom properties from `tokens.css` for every colour,
  radius, and blur value. No raw hex in components.
- `MUST` compute nested radii as `inner = outer − padding`.
- `MUST` include `saturate(180%)` in every `backdrop-filter`. Blur alone
  looks like frosted plastic, not glass.
- `MUST` pair every `backdrop-filter` with a `-webkit-backdrop-filter`.
- `MUST` give every interactive element a minimum 44×44px hit area.
- `MUST` handle `prefers-reduced-transparency` and `prefers-reduced-motion`
  with a solid-surface fallback.
- `MUST` animate with `transform` and `opacity` only.

### NEVER

- `NEVER` apply `backdrop-filter` to a pad widget.
- `NEVER` nest one glass surface inside another. If an element sits on
  glass, give it a plain fill or raised alpha instead — it should read as
  part of the material, not a second pane.
- `NEVER` apply glass to a list or scrolling collection.
- `NEVER` animate `width`, `height`, `top`, `left`, `filter`, or
  `backdrop-filter`.
- `NEVER` use more than one accent colour per screen.
- `NEVER` use pure grey (`#808080`, `#CCC`, `#333`). Every neutral in this
  system is tinted.
- `NEVER` use `localStorage` for pad layouts inside artifacts/previews —
  use in-memory state or the app's existing persistence layer.

---

## 3. Tokens

Single source of truth. Do not redefine these inline.

```css
:root{
  /* text — one colour, four opacities */
  --label:        #000000;
  --label-2:      rgba(60,60,67,.60);
  --label-3:      rgba(60,60,67,.30);
  --label-4:      rgba(60,60,67,.18);

  /* surfaces */
  --bg:           #FFFFFF;
  --bg-2:         #F2F2F7;
  --bg-3:         #FFFFFF;
  --separator:    rgba(60,60,67,.29);
  --fill-3:       rgba(118,118,128,.12);

  /* accent — pick ONE as the app accent */
  --blue:   #007AFF;
  --green:  #34C759;   /* connected / success only */
  --red:    #FF3B30;   /* destructive / disconnected only */
  --orange: #FF9500;   /* warning only */

  /* glass */
  --glass-fill:      rgba(255,255,255,.55);
  --glass-border:    rgba(255,255,255,.60);
  --glass-highlight: rgba(255,255,255,.85);
  --glass-shadow:    0 8px 32px rgba(0,0,0,.12);
  --glass-blur:      24px;

  /* radii */
  --r-chip:  8px;
  --r-input: 12px;
  --r-card:  22px;
  --r-sheet: 32px;
  --r-pill:  999px;

  /* spacing — 8pt grid, 4pt subdivisions */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px;
  --s-4: 16px; --s-5: 20px; --s-6: 24px;

  --tap-min: 44px;
  --ease:    cubic-bezier(.32,.72,0,1);
}

[data-theme="dark"]{
  --label:        #FFFFFF;
  --label-2:      rgba(235,235,245,.60);
  --label-3:      rgba(235,235,245,.30);
  --label-4:      rgba(235,235,245,.18);
  --bg:           #000000;
  --bg-2:         #1C1C1E;
  --bg-3:         #2C2C2E;
  --separator:    rgba(84,84,88,.60);
  --fill-3:       rgba(118,118,128,.24);
  --blue:   #0A84FF;
  --green:  #30D158;
  --red:    #FF453A;
  --orange: #FF9F0A;
  --glass-fill:      rgba(30,30,32,.55);
  --glass-border:    rgba(255,255,255,.14);
  --glass-highlight: rgba(255,255,255,.28);
  --glass-shadow:    0 8px 32px rgba(0,0,0,.45);
}
```

Dark mode is the default for the pad screen. A controller overlay is used
in dark rooms; white surfaces are hostile there.

---

## 4. Component specs

Fixed numbers. Do not invent alternatives.

| Component | Radius | Padding | Height | Type |
|---|---|---|---|---|
| Toolbar (builder) | pill | `--s-1` | 52px | glass |
| Sheet / modal | `--r-sheet` | `--s-4` | — | glass |
| Card / inspector panel | `--r-card` | `--s-3` | — | glass |
| List row | 0 (inside card) | `--s-3` vertical | min 44px | flat |
| Text input | `--r-input` | `--s-3` | 44px | flat, `--fill-3` |
| Segmented control | pill | 3px | 40px | glass |
| Chip / widget-type tag | `--r-chip` | `--s-2` | 32px | flat |
| Connection HUD | pill | `--s-2` `--s-3` | 36px | glass |
| Pad widget (all 7) | per widget | — | — | **flat, never glass** |

Nesting check: card is `--r-card` (22px) with `--s-3` (12px) padding →
children inside it get **10px**, not 22px.

Type scale: Headline 17/600 · Body 17/400 · Subhead 15/400 ·
Footnote 13/400 · Caption 12/400. Headline and Body are the same size —
weight alone carries emphasis.

---

## 5. Code patterns

### The glass surface

```css
.glass{
  background: var(--glass-fill);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(180%);
          backdrop-filter: blur(var(--glass-blur)) saturate(180%);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow),
              inset 0 1px 0 0 var(--glass-highlight);
  color: var(--label);
}
@supports (corner-shape: squircle){ .glass{ corner-shape: squircle; } }
```

The `inset` highlight is what makes it read as a *sheet of glass* rather
than a blurred div. It is not optional.

### Pad widget — the correct pattern

```css
/* CORRECT — flat, zero composite cost */
.widget{
  background: rgba(255,255,255,.14);
  border: 1px solid rgba(255,255,255,.22);
  border-radius: var(--r-pill);
  transition: background .1s linear;
  touch-action: none;
}
.widget[data-pressed="true"]{ background: rgba(255,255,255,.32); }
```

```css
/* WRONG — will drop frames under multi-touch */
.widget{
  backdrop-filter: blur(20px) saturate(180%);
  transition: all .3s ease;
}
```

Two defects in the wrong version: the backdrop filter recomposites the
scene every frame while the finger moves, and `transition: all` means the
browser watches every animatable property including layout ones.

### Press feedback (functional layer only)

```css
.press{ transition: transform .22s var(--ease); }
.press:active{ transform: scale(.96); }
```

### React specifics

```tsx
// WRONG — new object identity every render, defeats memoisation
<div style={{ backdropFilter: 'blur(24px)' }} />

// CORRECT — class, tokens, stable identity
<div className="glass g-card" />
```

Style objects belong in CSS, not in render. This codebase already has
stale-closure and memory-leak issues; inline style objects in
frequently-re-rendering pad components make both harder to trace.

---

## 6. Radius and hit-area must agree

Project-specific, and it connects to the known orphan-touch-hit-area bug.

If a widget renders at `border-radius: 999px` but its touch handler tests
a rectangular bounding box, the corners are dead visually but live
functionally — the user presses "outside" the button and it fires. The
inverse leaves visible surface that does nothing.

`MUST`: whenever a widget's radius changes, the hit test changes with it.
Circular/pill widgets get a radial distance test, not a bounding-box test.
Rounded rects get a rounded-rect test. Radius is a functional property in
this app, not decoration.

---

## 7. Performance budget

- Max **6** `backdrop-filter` surfaces composited at once. The builder
  toolbar + inspector + one sheet is already 3.
- Zero `backdrop-filter` on the pad screen during an active session.
- No glass element may animate position or size.
- Anything that must be both glassy and moving uses a pre-rendered blurred
  background image instead of a live filter.
- Profile on a mid-range Android device, not on desktop Chrome. Desktop
  will happily render what the target device cannot.

---

## 8. Accessibility (non-negotiable)

```css
@media (prefers-reduced-transparency: reduce){
  .glass{
    -webkit-backdrop-filter: none; backdrop-filter: none;
    background: var(--bg-2);
    border-color: var(--separator);
  }
}
@media (prefers-reduced-motion: reduce){
  .press{ transition: none; }
  .press:active{ transform: none; }
}
```

- Body text: 4.5:1 contrast minimum. This matters most on glass, which is
  exactly where it is easiest to fail.
- Never signal state by colour alone. Connected/disconnected needs an icon
  or a label, not just green vs red.
- 44×44px minimum hit area on every control, glass or flat.

---

## 9. Working style for agents on this repo

One component per task. Do not attempt a whole-app restyle in a single
pass — this codebase has known stale-closure and lifecycle issues, and
broad refactors here have failed before.

Order of operations for restyling any component:

1. State which layer it belongs to (§1) before writing code.
2. Read the matching golden reference and follow its patterns:
   - functional layer → `src/components/GlassSheet.tsx` + `.css`
   - interaction layer → `src/widgets/PadButton.tsx` + `.css`
3. Import values from `src/styles/tokens.css`. Never redeclare them.
4. Apply the component spec (§4) and verify nested radii arithmetic.
5. **Run the checker and paste its output:**
   ```
   node scripts/check-design.mjs src
   ```
   Exit code 1 means errors. Do not report a task as complete while the
   checker exits non-zero. Do not silence a rule to make it pass.
6. Stop. Report what changed and the checker output. Wait for review.

### Enforcement

`scripts/check-design.mjs` is the ground truth, not this document. It
catches: glass on pad widgets, `blur()` without `saturate()`, missing
`-webkit-` prefix, `transition: all`, layout-property animation, raw hex
outside tokens, pure greys, stacked glass classes, inline style objects,
and `.glass` defined without a reduced-transparency fallback.

Wire it in so it can't be skipped:

```json
"scripts": { "lint:design": "node scripts/check-design.mjs src" }
```

It is regex-based, not a parser — it catches the common failures cheaply
and will miss exotic ones. Concentric radius arithmetic in particular
cannot be checked statically. Verify that by eye.

If a request would require breaking a `NEVER` rule, say so and stop rather
than finding a workaround.

---

## 10. Out of scope

The Remote Gamepad **marketing website** does not use this system. It is
deliberately editorial — white background, no glass. Do not apply these
rules to it.
