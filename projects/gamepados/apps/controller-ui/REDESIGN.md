# GamepadOS — Signal / Hardware redesign

## Run and build
The original stack is preserved: React 18, TypeScript, Vite 6, Tailwind 4 and Framer Motion. No new runtime dependencies.

```sh
npm ci
npm run dev
npm run build
npx tsc --noEmit -p tsconfig.check.json
```

`dist/index.html` is the original project's single-file production output for the existing Android WebView host. The illustration and shell fonts are bundled, not fetched at runtime. The original controller font configuration is deliberately unchanged.

## Design boundary
- `ControllerScreen` in `src/app/App.tsx`: byte-for-byte unchanged, including original line endings. See `PROTECTED_SOURCES.json` for verification hashes.
- `src/app/components/Widgets.tsx`: unchanged.
- `src/app/platform/native.ts`: unchanged.
- Original API clients, state stores, gameplay utilities, default controls, input mappings and transport logic: unchanged.
- `src/styles/theme.css`, the original global font imports, and shared `src/app/motion.ts`: unchanged, to avoid changing gameplay rendering.
- New appearance styles are scoped to `.gp-shell`; the actual gameplay screen is outside that boundary.
- Editor chrome is themed independently of the controller canvas. Widget preview rendering and editable geometry are preserved.

## Visual and motion system
Obsidian panels, signal-orange accents, hardware-inspired switches, Space Grotesk display type and IBM Plex Sans body type. Light mode retains the saved shell preference without affecting gameplay. Spring press feedback, shared active-tab motion, screen entrances, pairing pulses, animated switches, skeleton plan loading, form transitions and reduced-motion support.

The hero artwork is decorative, not a replacement for the gameplay controller. Managed original asset:
https://static.prod-images.emergentagent.com/jobs/842c3d5c-7916-49dc-907d-a9dada4898a8/images/f3ad8802a517a59b27048683ede16618a2b1325d35d6a0be0d92b8ad13c77e87.jpeg

## Behavior and verification boundaries
All existing authentication, billing, guest timer, connection and settings callbacks remain wired to the original implementations. Prices are obtained from the existing live catalogue; there are no invented plans, prices or connection telemetry. Public catalogue retrieval has been verified.

The browser can exercise forms, layouts, settings and the guest controller, but cannot validate native Android camera permissions, USB, rumble or real PC pairing. Complete those checks in the original Android host. No successful account login or payment is claimed without a supplied test account or checkout authorization.

The `/app/frontend` preview adapter and `/app/backend` static preview route belong only to the editing workspace. They are not part of this source package and are not required by the Android app.

## Regression checks completed
Mobile widths 320/390/430 and landscape, theme persistence, guest launch/return, dashboard allowance behavior, live plan catalogue, plan-to-sign-in flow, form navigation, layout creation/edit/save, browser scanner fallback, all three USB modes and saved wired preference restoration. Fast navigation was hardened so outgoing surrounding screens cannot intercept taps on incoming screens.

## Professional gaming refinement / direct sign-in
- Header profile icon now opens a dedicated sign-in screen for guests and the existing profile for signed-in players. Plans stay accessible from the bottom Plans tab and the playtime card. No auth-service or store changes.
- Orange remains the main action color; blue identifies connectivity, violet identifies player/profile and membership details. No heavy blur or perpetual hero effects.
- Shell artwork now uses bundled WebP and shell fonts use WOFF2, approximately halving the single-file production output versus the first redesign. Original source JPEG/TTFs are retained as editable originals only, not loaded at runtime.
- A single shared press-feedback listener and incremental selector observer replaces repeated whole-document work. Native settings polling pauses when the document is hidden.
- Production HTML: 886,619 bytes versus 1,758,430 bytes previously (49.6% smaller); this measures delivered build size, not a claim about device frame rate.
- Independent regression verified direct guest sign-in from all tabs, all exit routes, form modes, plans/checkout entry, responsive themes, reduced motion, and USB mode selection. Authenticated navigation/session adoption/sign-out were tested with isolated fixtures, not real login credentials. Protected code integrity passed again.

## Targeted Connect refinement
- Clearly filled blue Connect to PC button with a separate live-status description and subtle press feedback. Actual telemetry still determines connected/warning states.
- Only the opening Connect transition is revised: 80ms outgoing fade, followed by 160ms incoming fade with a 6px lift. Reduced motion removes delay/travel.
- All other animations retain previous behavior. Independent browser regression passed dark/light responsive views, keyboard/touch activation, rapid navigation, USB mode interaction, reduced motion and protected-source integrity.