# Signal — page construction contract

Every page MUST follow this. The design system lives in `css/style.css` — use its
classes; do not invent new global styles. Page-specific styles go in a `<style>`
block scoped under a page class on `<body>` (e.g. `body.page-home`).

## The look
Warm paper-white (`#F6F5F1`) stage, ink-black (`#141417`) type, ONE accent:
signal orange (`#FF4D00`). Orange is rationed — dots, one word per headline,
small links. Never large orange areas. Calm, premium, Apple-store confidence.
Generous whitespace. No neon, no glassmorphism, no dark sections except the footer.

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
