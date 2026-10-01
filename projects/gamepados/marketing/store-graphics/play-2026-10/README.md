# Play Store graphics — 1.4.6 (2026-10-01)

Made from the **real app** (the 1.4.6 store-ready build's own UI), set up as the Play build:
no prices, a fresh player with the one-time 30 minutes. Regenerate with `node shoot.mjs` (screens)
and `node feature.mjs` (banner). A copy sits in
`releases/mobile/1.4.6/actual/store-ready-2026-10-01/play-store-graphics/`.

Play Console → Grow users → Store presence → Store listings → **Edit default listing** → Graphics:

| Slot | File | Size |
|---|---|---|
| App icon | `play-icon-512.png` | 512×512 |
| Feature graphic | `feature-graphic-1024x500.png` | 1024×500 |
| Phone screenshots, in this order | `02-controller`, `01-home`, `03-connect`, `05-editor`, `06-settings`, `04-time` | 1920×1080 / 1080×1920 |
| 7-inch and 10-inch tablet screenshots | the same six (Play accepts these sizes for tablets too) | |

Order: the controller first. It is what the app *is*, and the first screenshot is the one most
people see without swiping.

Replaces the June/July graphics in `../` (old blue icon, old app look).
