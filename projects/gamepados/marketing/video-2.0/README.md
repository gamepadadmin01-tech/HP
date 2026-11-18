# GamepadOS 2.0 videos (2026-11-18)

Made entirely here: no outside footage, no outside music (so no YouTube copyright claims).

| File | What |
|---|---|
| `scene.html` | the whole animation; `render(t)` draws the frame at `t` seconds. Captions are in `CAPTIONS` at the top |
| `render.mjs` | records `scene.html` frame by frame in Chrome and encodes with ffmpeg (NVIDIA encoder) |
| `music.py` | the original 120 BPM track, synthesised in code (numpy/scipy) |

Screens come from `../store-graphics/play-2026-11/raw-4k/` (shoot them with
`RAW_DIR=raw-4k SCALE=5 node shoot.mjs` in that folder; they are git-ignored because they regenerate).

## Remake
```
node render.mjs play                       # 32 s Google Play video, 3840x2160 60 fps, video only (~6.5 min)
python music.py play                       # out/music-play.wav
node render.mjs web  ;  node render.mjs webp   # 15 s website loop, landscape and portrait
node render.mjs play --scale 0.5 --stills 2,5.2,14.8   # single frames to check, fast
```
Then mux (music normalised to -14 LUFS for YouTube):
```
ffmpeg -i out/video-only-en-3840x2160.mp4 -i out/music-play.wav -map 0:v -map 1:a -c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=7 -c:a aac -b:a 320k -shortest GamepadOS-2.0-preview-4k60.mp4
```

## Timeline (Play, 120 BPM, a scene per 2 bars)
0 phone becomes a gamepad · 4 d-pad taps steer the car on the PC · 8 Wi-Fi or USB · 12 scan the QR, Connected ·
16 tilt to steer · 20 layout editor (drag A, make it bigger) · 24 four phones, P1-P4 · 28 end card.

## Translating (2.1)
Add a language to `CAPTIONS` in `scene.html`, then `node render.mjs play --lang ja` and mux again.
The text uses Noto Sans SC / JP / Devanagari when Space Grotesk lacks the letters.

Music: "GamepadOS 2.0 theme", original, made with `music.py`. Owned by GamepadOS; no licence needed.
