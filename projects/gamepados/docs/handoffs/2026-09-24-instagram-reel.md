# 2026-09-24 — Instagram reel (motion graphics, Montagem Alquimia edit)

## UPDATE (later the same day) — v3 is the current master
- **`marketing/instagram/GamepadOS-Reel-v3.mp4`** (35.52 s, 1080x1920 native, 60 fps CFR, H.264 High, ~30 Mbps, AAC 48 kHz 320k, -10.6 LUFS, -1.7 dBTP) + `GamepadOS-Reel-v3-cover.jpg`.
- Source `reel-motion/reel5.html`, renderer + QA `render5.mjs` (`--qa`, `--stills … --guides`), finished-video QA `qa_video.py`, audio `audio/build_audio5.py`.
- Why 35.5 s instead of 30: at one phrase per beat every drop phrase was readable for ~19 frames (needs 24–36). v3 builds phrases progressively and moves the CTA into the song's break; every line now has ≥ 32 stable frames and lands exactly on its beat frame.
- Lesson: `will-change: transform` on text makes Chrome bitmap-scale it — any scale ≠ 1 goes soft. Text elements must not be layer-promoted.
- v2 (`reel4.html`, 30 s) is untouched and still renders.

## Where everything is (v1/v2)
- Final video: `marketing/instagram/GamepadOS-Reel-Alquimia-Edit-v2.mp4` (30.07 s, 1080x1920, 60 fps, ~27.6 Mbps, song mixed in)
- Cover: `marketing/instagram/GamepadOS-Reel-v2-cover.jpg` (the 2.5 ms frame; fits the 3:4 grid crop)
- Source: `marketing/instagram/reel-motion/`
  - `reel4.html` = the v2 edit (every frame is `renderAt(t)`); `render4.mjs` renders it (~10 min, 4 Chrome workers, 6 sub-frame motion blur, 30 Mbps)
  - `reel3.html` / `render3.mjs` = v1 of the same edit (kept so it can still be re-rendered)
  - `audio/build_audio3.py` = slowed song (107.7 BPM) + bass push + SFX + master → `reel3_audio.wav`, `features3.js`
  - Measured beat grid: `B(k) = -0.002 + k * 0.55510 s`, drop at 8.880 s, bass hole from 8.251 s
- New device screenshots (adb screencap, 2712x1220, no personal info): `marketing/screenshots/2026-09-24/`
- Tools used: FFmpeg from `D:\AKHIL\JDownloader\tools\Windows\ffmpeg\x64\`, puppeteer-core from `apps/controller-ui/node_modules`, system Chrome; pip installed numpy/scipy/librosa/soundfile/opencv-python-headless.

## Decisions
- Latency claim stays **2.5 ms (measured, wired USB)**. Live badge on the phone showed 2.1 / 1.9 ms, so the claim is conservative. Do not use 2.8 ms.
- Dashboard screenshots show Akhil's name — never use them uncropped.

## Open items
1. Akhil posts tomorrow — the caption/hashtags/first-comment/DM kit was given in chat.
2. **Music rights**: the song is commercial (℗ Black 17 Media). If Instagram mutes it, export an SFX-only version and add "Montagem Alquimia (Slowed)" from Instagram's library, aligning the drop to 8.9 s.
3. Nothing listened to by Claude — Akhil to check the audio on his phone.
4. Nothing committed yet (videos are 38–105 MB; ask before committing them).
5. After 48 h: review 3-sec hold, avg watch time, shares, profile visits.
