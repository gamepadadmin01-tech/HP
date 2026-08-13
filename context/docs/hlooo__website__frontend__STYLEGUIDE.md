# Signal — page construction contract

Every page MUST follow this. The design system lives in `css/style.css` — use its
classes; do not invent new global styles. Page-specific styles go in a `<style>`
block scoped under a page class on `<body>` (e.g. `body.page-home`).

## The look
Dark glass. Near-black stage (`#07080C`) lit by a fixed three-bloom aurora,
light type (`#F4F5F8`), panels made of frosted glass, ONE accent: signal orange
(`#FF5A14`). Orange is rationed — dots, one word per headline, small links.
Never large orange areas. Calm, premium, Apple-keynote confidence. Generous
whitespace. No neon.

This site is DARK-ONLY. There is no light theme; `color-scheme: dark` is
declared so the browser's own scrollbars and native menus follow.

## The aurora — do not remove it
`body::before` paints three soft radial blooms (warm orange, cool violet, low
ambient). It is not decoration: glass is a CONTRAST effect, and against a flat
backdrop `backdrop-filter` returns the same flat colour, so every panel
collapses into grey plastic. The aurora is what the glass picks up. It is
`fixed`, so it costs one paint rather than one per scroll frame, and every
viewport gets the same lighting no matter how long the page is.
`body::after` adds a faint CSS-only grain that kills gradient banding.

## Glass
Two classes in `css/style.css`, and the difference is the whole rule:

- `.glass` — translucent fill + lit top edge, NO blur. For elements sitting on a
  FLAT fill (the phone screen interior) where there is nothing behind worth
  blurring. Same look, none of the compositor cost.
- `.glass-blur` — adds `backdrop-filter: blur() saturate()`. For anything over
  the aurora or over varied content: cards, the nav, the download bar, form
  fields, the monitor banner.

Rules that matter:
- Never blur without `saturate()` — blur alone greys the backdrop into fog. The
  saturation boost is what separates glass from frosted plastic.
- Depth on black comes from the **lit top edge** (`--lit`, an inset white
  highlight) plus the border — not from drop shadows, which are nearly
  invisible against a near-black page.
- Panels that carry text need a fill around 0.6–0.8 alpha; decorative panels can
  go as low as 0.045 (`--surface`).

Tokens: `--glass-blur`, `--glass-sat`, `--glass-fill`, `--glass-edge`,
`--glass-top`, `--lit`, `--surface`, `--surface-2`. Opaque fallbacks for
no-backdrop-filter and for `prefers-reduced-transparency` are already handled.

## Liquid Glass (`data-liquid`)
Add `data-liquid` to a panel and `js/liquid.js` gives it physically-based edge
refraction: a convex squircle bezel profile → surface normal → Snell's law →
an RGBA displacement map → `backdrop-filter: url(#…)`. Method ported from the
verified prototype in `hlooo/iphone liquid display research/refraction-lab.html`.
`css/liquid.css` adds the rim hairline and the pointer-tracked specular blob.

Three rules, all of which come from measurement, not taste:

1. **The DISPLACEMENT is Chromium-only** — SVG-filter-as-backdrop-filter does
   not work in Firefox or Safari, so nothing can bend the backdrop there. Those
   engines get the fallback below instead. Never make layout or legibility
   depend on refraction being present. Note the scope: only the displacement is
   gated. The rim, the specular highlight and the bezel are plain CSS and MUST
   render everywhere — an earlier version gated them on the same check by
   accident and Safari/Firefox got no glass detailing at all.
2. **Maps are built once and cached by SIZE.** One build costs 14–70ms, so a
   grid of equal-sized cards shares a single filter. They are built lazily via
   IntersectionObserver, off the critical path — and never on
   `requestIdleCallback` alone, which never fires in a hidden tab.
3. **Nothing liquid may animate its width or height**, or the map would have to
   be rebuilt mid-frame. Rotation and translation are free; size is not. The
   resize handler deliberately clears and rebuilds after a debounce.

### The Safari / Firefox fallback
When SVG-backdrop is unsupported, `js/liquid.js` puts `no-svg-backdrop` on
`<html>` and injects an `<i class="lq-bezel">` into each panel. That bezel is a
masked ring carrying a HARDER `backdrop-filter: blur()` than the panel centre —
real backdrop sampling (both engines support plain blur), so the lip genuinely
smears what is behind it. Paired with an inset shadow for volume, it reads as
thick glass. It is not refraction and never will be; it is an honest substitute.
No displacement maps are built in that path, so those browsers pay no CPU for a
feature they cannot use.

**Preview it anywhere with `?glass=fallback`.** That flag forces the fallback in
any browser and is shipped deliberately — the path is otherwise untestable
without WebKit or Gecko, and a path nobody can look at is a path that rots.

Two things the build must keep, both previously broken by the minifier:
`mask-composite: exclude` unprefixed (Firefox needs it; `-webkit-…: xor` alone
is not enough), and both prefixed and unprefixed `backdrop-filter`. Lightning
CSS currently expands the `mask` shorthand into dual-prefixed longhands, which
is correct — re-check with `grep "mask-composite" dist/assets/main-*.css` if the
build tooling ever changes.

The backdrop needs **straight lines or detail** for refraction to be visible —
bending a smooth gradient still looks like a smooth gradient. That is what the
faint grid in `body::before` is for. Do not delete it.

## Spatial depth — GSAP owns it, not CSS
Hero parallax (`js/home.js`) and glass-panel tilt (`js/main.js`) run through
GSAP, because GSAP already writes the `transform` of every hero layer and every
`[data-reveal]` element. A CSS `transform` on those same elements is silently
overwritten by GSAP's inline one. Two writers on one property is a bug, so
there is deliberately no CSS `data-depth` system — do not add one.

Hero planes move by different amounts (monitor 0.34 → phone 1.0 → ms pill 1.55).
Differential travel is what reads as space; moving everything equally reads as
a wobble. Panel tilt stays under ~6°, and all of it is gated behind
`(hover: hover) and (pointer: fine)` plus `prefers-reduced-motion`.

## Inverted primaries
On a dark stage the strongest element is a LIGHT one, so `.btn-dark` is now a
light pill with dark text (`--fill-strong` / `--on-light`) and `.btn-ghost` is
the glass one. Do not add inline `style="background:#fff"` to buttons — inline
styles beat every rule here and were the cause of an illegible-button bug.

## Document skeleton (every page)
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>… — GamepadOS</title>
  <meta name="description" content="…">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body class="page-XXX">
  <nav class="nav">…shared nav…</nav>
  <main>…page content…</main>
  <footer class="footer">…shared footer…</footer>
  <div class="dlbar">…shared download bar…</div>
  <script type="module" src="/js/main.js"></script>
  <script type="module" src="/js/PAGE.js"></script>  <!-- only if the page has its own js -->
</body>
</html>
```

## Shared nav (copy exactly; set the `active` class per page)
```html
<nav class="nav">
  <div class="nav-inner">
    <a class="logo" href="/"><span class="logo-mark"></span>GamepadOS</a>
    <button class="nav-burger" aria-label="Menu"><span></span></button>
    <div class="nav-links">
      <a href="/#features">Features</a>
      <a href="/#how">Setup</a>
      <a href="/support.html">Support</a>
      <a href="/contact.html">Contact</a>
      <a class="btn btn-dark btn-sm nav-cta" href="/#download">Download</a>
    </div>
  </div>
</nav>
```

## Shared footer (copy exactly)
```html
<footer class="footer">
  <div class="footer-inner">
    <div class="footer-top">
      <div>
        <a class="logo" href="/"><span class="logo-mark"></span>GamepadOS</a>
        <p class="footer-tag">Your phone is the controller. Free, no account, your input never leaves your network.</p>
      </div>
      <div class="footer-cols">
        <div class="footer-col">
          <h4>Product</h4>
          <a href="/#features">Features</a>
          <a href="/#how">Setup</a>
          <a href="/#download">Download</a>
        </div>
        <div class="footer-col">
          <h4>Help</h4>
          <a href="/support.html">Support center</a>
          <a href="/support.html#troubleshooting">Troubleshooting</a>
          <a href="/support.html#faq">FAQ</a>
          <a href="/contact.html">Contact us</a>
        </div>
        <div class="footer-col">
          <h4>Legal</h4>
          <a href="/privacy.html">Privacy policy</a>
          <a href="/privacy.html#data">Local data policy</a>
          <a href="/privacy.html#attributions">Attributions</a>
        </div>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 GamepadOS. All rights reserved.</span>
      <span>Windows 10/11 · Android 9+ · Free</span>
    </div>
  </div>
</footer>
```

## Shared sticky download bar (copy exactly)
```html
<div class="dlbar">
  <div class="dlbar-inner">
    <span class="dlbar-label"><span class="dot"></span>GamepadOS <span class="dim">— free on Android &amp; Windows</span></span>
    <div class="dlbar-btns">
      <a class="btn btn-dark btn-sm" data-dl="android" href="#">Android APK</a>
      <a class="btn btn-ghost btn-sm" data-dl="windows" href="#">PC Server</a>
    </div>
  </div>
</div>
```

## Download links
NEVER hardcode download URLs. Use `data-dl="android"` / `data-dl="windows"` on
`<a href="#">` — `js/config.js` wires them to the backend.

## Animations
Add `data-reveal` to elements that should fade-rise in on scroll;
`data-reveal-group` on a parent staggers its `data-reveal` children.
`js/main.js` handles it. Respect the calm: no flashy or bouncy motion.

## Product facts (use these, do not invent)
- Phone app: Android 9+, free APK. PC server: Windows 10/11, single .exe.
- Pair over Wi-Fi by scanning a QR code shown by the PC server, or wired USB
  mode (enable USB debugging; the server handles adb automatically).
- Input latency: ~4 ms on a good 5 GHz network (measured on a local network);
  USB is typically even lower. Up to 500 Hz input rate.
- Features: touch controls, gyroscope motion steering, drag-and-drop custom
  layout builder, presets (racing / shooter / emulator), rumble / force
  feedback back to the phone, low-latency engine.
- First run of the PC server installs the ViGEmBus virtual-gamepad driver
  (bundled — one Windows permission prompt). Games see a real Xbox 360 pad.
- Privacy: no account, no cloud, input stays on the local network (LAN).
- Ticket form subjects (exact values): bug, feature, layout, business, other.
- Contact form POSTs to `${API_BASE}/api/support/ticket` (see js/config.js)
  with JSON `{ name, email, subject, message }` → `{ success, ticket | error }`.

## Voice
Short, confident sentences. No exclamation marks. No "amazing/incredible".
Sentence case headlines ("Pair in seconds", not "Pair In Seconds").
The headline orange accent is one word or the final period, never the whole line.
