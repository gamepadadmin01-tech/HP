# Uptodown resubmission package — GamepadOS

Everything below is ready to paste/upload. Items marked ✅ are fixed; do the manual paste/upload steps in the Developer Console, then **Submit for Review**.

---

## 1. Icon  ✅ (the likely #1 rejection cause)

- **Problem:** the previous icon was exactly **128×128** — Uptodown requires *larger than 128×128* (min 256×256 square PNG).
- **Fix:** new **512×512** square PNG generated → `uptodown_icon_512.png` (project root).
- **Action:** Information tab → **SELECT ICON FILE** → upload `uptodown_icon_512.png`.

## 2. Official website

- Use: `https://gamepad.space/`  (this is correct — it was only visually truncated in the form field)

## 3. Short description  (≤ 70 chars) — paste into "Short description"

```
Turn your Android phone into a low-latency PC game controller
```

## 4. Full description  (≥ 50 words) — paste into "Full body text description"

```
GamepadOS turns your Android phone into a fully featured game controller for your Windows PC — no extra hardware required.

Install the free GamepadOS PC server from https://gamepad.space, then connect your phone over Wi-Fi or USB. Your phone instantly becomes a responsive gamepad with on-screen sticks, buttons, triggers and a D-pad, with wired latency as low as 2.5 ms for a near-native feel.

Key features:
🎮 On-screen dual sticks, buttons, triggers and D-pad
📐 Gyro / motion steering using your phone's gyroscope and accelerometer
🛠️ Custom layout builder — place every control exactly where your thumbs want it
📶 Connect over Wi-Fi or wired USB; USB mode works anywhere, no network needed
⚡ Ultra-low latency — as low as 2.5 ms wired
🆓 Completely free, no account and no ads

Note: GamepadOS is a PC companion app. It pairs with the free GamepadOS desktop server (download at gamepad.space) — once the server is running on your PC, the app connects to it and works as your controller.
```

> The last "Note" paragraph is deliberate: it tells the reviewer the app needs the PC
> server, so the "waiting to connect" screen they see on a bare test device is expected
> behavior — not a broken/non-functional app.

## 5. Featured image (optional, boosts approval + visibility) — exactly 1024×500

- ✅ New custom banner generated → **`featured_image_1024x500.jpg`** (logo + tagline +
  feature chips on brand background; replaces the old AI-looking promo image).
- Screenshots tab → upload it into the Featured image slot (1024×500 spec).

## 6. New version file

- Build/use an APK with **versionCode > 10** (gradle is already at `versionCode = 11`,
  `versionName = "1.1.9"` per RELEASE.md), **same package** `com.gamepad.client`.
- Files tab → **+ Add New Version** → upload the new APK.

---

## Submit checklist
- [ ] Icon replaced with `uptodown_icon_512.png` (512×512)
- [ ] Website = `https://gamepad.space/`
- [ ] Short description pasted (≤70 chars)
- [ ] Full description pasted (≥50 words)
- [ ] Featured image 1024×500 uploaded
- [ ] New APK (versionCode 11) added under Files
- [ ] Click **SUBMIT FOR REVIEW**
