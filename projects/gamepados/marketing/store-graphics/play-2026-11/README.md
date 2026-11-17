# Play Store graphics — GamepadOS 2.0 (2026-11-17)

Made from the **real 2.0 Google Play build** (`controller-ui/dist-play/index.html`) with a fake phone (no live data,
no prices). Replaces the 1.4.6 set in `../play-2026-10/` (old look, 4 screenshots used).

## Upload — Play Console → Grow users → Store presence → Main store listing → Graphics

| Slot | File (in `out/en/`) |
|---|---|
| Feature graphic | `feature-graphic-1024x500.png` |
| Phone screenshots, **in this order** | `01-controller` · `02-home` · `03-connect` · `04-racing` · `05-editor` · `06-settings` · `07-why` · `08-plans` |
| 7-inch tablet screenshots | the same 8 |
| 10-inch tablet screenshots | the same 8 |
| App icon | unchanged (`../play-icon-512.png`) |

The first screenshot is the one most people see without swiping, so the controller comes first.

## Remake
- `node shoot.mjs` — the bare app screens into `raw/` (needs `npm run build:all` first so `dist-play` is current)
- `node compose.mjs` — adds the headlines from `captions.en.json` → `out/en/`
- `node feature.mjs` — the feature graphic

For 2.1 (translated app): shoot each language into `raw-<lang>/`, add `captions.<lang>.json`, run `node compose.mjs <lang>`.
