# CamOS — what is still needed for better picture and smoother frames (research, 2026-11-23)

Owner's ask: "research with your full potential on what is still required for advancing quality of the camera and
frames." Rule from the owner, same day: **be honest** — a phone that can film 60 fps shows 60 (any plan); a phone
that only gives 30 shows 30.

## Where CamOS stands (measured, not guessed)

| Area | Status | Evidence |
|---|---|---|
| 60 fps on phones whose camera only reaches 60 in high-speed mode | Done (direct mode, every plan) | Owner's Xiaomi: 2,700 frames / 45 s at 16.7 ms on "CamOS Camera" |
| 60 fps on phones with a normal 60 fps mode | Done (picture engine, filters stay) | rule in `planCapture` |
| Phones that only give 30 | Honest 30, tip only when 60 was really asked for | 0.5.7 |
| Picture turned upright on the PC in direct mode | Done, tested | test pattern through "CamOS Camera" |
| Free plan in direct mode | PC stamps the watermark, fits to 720p | 0.6.2, fake phone |
| Wi-Fi drops | Reconnects by itself, stall watchdog | 0.4.4 |
| Lossy Wi-Fi | UDP + resend asks + spare pieces (1 per 6 while loss > 2 %) | fake phone 9 % loss: 2/3 rebuilt at once |
| Encoder | CBR, real-time priority, low-latency, **no B-frames** | `startEncoder` |
| PC decoder | Media Foundation H.264, **low-latency mode on** (`MF_LOW_LATENCY`) | `decode.rs` |
| PC load | ~3 % of the PC at 1080p60 | earlier measurement |

## What is still worth doing — ranked by gain for the effort

### A. Quick wins (a few hours each)

1. **Face-priority exposure and focus.** The commonest webcam complaint is a dark face against a bright window.
   Camera2 has `CONTROL_SCENE_MODE_FACE_PRIORITY`: the camera uses its face detection for AE, AWB and AF while those
   modes stay active, and there is a low-light variant that allows higher sensitivity. Turn it on when the camera
   lists it (and `STATISTICS_FACE_DETECT_MODE` ≠ OFF; about 90 % of devices offer at least SIMPLE). CamOS sets no
   scene mode today. *Gain: faces correctly lit in real rooms. Risk: low; fall back if not listed.*
2. **"Video call" camera tuning (Android 13+).** `OutputConfiguration.streamUseCase = VIDEO_CALL` lets the phone
   pick its tuning, sensor mode and settings for long, power-sensitive calls (Android docs). Set it when
   `SCALER_AVAILABLE_STREAM_USE_CASES` lists it. *Gain: OEM call tuning, cooler phone on long calls. Risk: low.*
3. **H.264 High profile.** CamOS doesn't set `KEY_PROFILE`, so many phones encode Baseline. High profile (CABAC,
   8×8 transform) gives noticeably better quality at the same bitrate, and the Windows H.264 decoder supports
   Baseline/Main/High. Ask for High when `MediaCodecInfo` lists it, keep B-frames off. *Gain: sharper at the same
   Wi-Fi load. Risk: low; check the PC decodes it (it should).*
4. **Intra refresh instead of key-frame bursts.** After a loss CamOS asks for a full key frame, a burst that hurts on
   weak Wi-Fi. `KEY_INTRA_REFRESH_PERIOD` (encoder, where `FEATURE_IntraRefresh` is supported) refreshes the picture
   in strips over a few frames, so there is no burst. *Gain: fewer hitches on Wi-Fi. Risk: medium (support varies);
   keep key frames as the fallback.*
5. **Thermal headroom.** On long calls phones heat up and throttle (frame drops). Android's thermal API gives a
   0.0–1.0 headroom with a forecast; poll it every ~10 s and step quality down (bitrate first, then 60 → 30) before
   the phone throttles. *Gain: steady frames in 1-hour calls. Risk: low; API missing → do nothing.*

### B. Medium work (1–3 days each)

6. **Background blur (Premium, was planned).** ML Kit selfie segmentation runs on the CPU, "20 fps+" on modern
   phones, 25–65 ms per frame on a Pixel 4 depending on input size; STREAM_MODE smooths results over frames. To keep
   30/60 fps: run it on a small copy (e.g. 256 px) every 2nd–3rd frame, blur and composite on the GPU in GlPipeline,
   reuse the last mask in between. +4.5 MB app size. Not available in direct-60 mode (no picture engine).
7. **Auto-framing.** Keep the face centred and zoomed (like "Center Stage"), using the camera's face statistics
   and a smooth crop in GlPipeline. Premium-worthy, cheap on CPU.
8. **Optional HEVC (H.265) when the PC can decode it.** About 30–50 % less bitrate for the same quality (vendor
   figures), which matters most on campus Wi-Fi. But most low-latency systems use H.264, and Windows needs the HEVC
   decoder (DXVA, Windows 10+; often a Store extension). Plan: the server reports whether it can create the HEVC
   decoder, the phone uses HEVC only then, H.264 otherwise.
9. **Hardware (DXVA) decoding on the PC.** The decoder supports DXVA2 for Baseline/Main/High. Only worth it for weak
   laptops (we measured ~3 % CPU), so later.
10. **End-to-end delay meter.** Show "delay 85 ms" in the PC window: the phone's capture time vs the PC's display time
    (needs a clock sync over the TCP connection). Lets us prove "as fast as a video call" with numbers.

### C. Larger / later

11. **4K30 over USB** (the owner's phone films 4K30 in its own app; check what it offers apps in the camera dump).
    Needs HEVC or a very high bitrate; USB only.
12. **Adaptive spare-piece ratio** (1 per 4 at 10 % loss, 1 per 8 at 3 %), from the PC's reports.
13. **MediaTek 60 fps for the picture engine** (`hfpsMode`): implemented, off; it may need a recording-type surface
    or vendor keys we don't know. Try again on other MediaTek phones.

## Still to verify on the real phone

- Smooth Wi-Fi mode (UDP + spare pieces): the phone and PC must be on the same network (or the phone's hotspot).
- "Tall" shape in direct 60 by eye (the lens was covered; the PC turn itself is verified with a test pattern).
- The free plan in direct 60 on the phone itself (verified with the fake phone).

## Built 2026-11-23 (CamOS 0.6.3) — A1 to A5, tested on the owner's Xiaomi

| Item | On the owner's phone | Evidence (camos.log "phone camera:" line) |
|---|---|---|
| A1 face priority | **on** in normal mode (camera lists FACE_PRIORITY, face detect SIMPLE); off in high-speed by design | "face priority" |
| A2 video-call tuning | **on** in normal mode (stream use case 5 listed) | "video-call tuning" |
| A3 High profile | **on** in both modes, PC decodes it (0 decode errors) | "High profile" |
| A4 intra refresh | not offered by this phone's encoder → normal key frames (fallback works) | absent |
| A5 heat watch | **on**: 0.64–0.76 during tests (caps start at 0.85) | "heat 0.71" |

Also verified on the real camera the same day: "Tall" in direct 60 matches the normal mode's orientation; the free
plan at 60 fps gets the PC-stamped watermark (camera picks its 1280×720 high-speed size for 720p).
Settings → Light & colour → "Light my face" switches A1 off.

## Built 2026-11-23 (CamOS 0.6.5–0.6.7) — B6 background blur, B7 auto-framing (Premium)

- Vision.kt on its own thread, a 256-px copy every 120 ms: MediaPipe selfie-segmenter model (assets, 250 KB) run by
  MediaPipe Tasks on the GPU (CPU fallback); ML Kit face detection from Play services every 3rd look.
- GlPipeline: quarter-res Gaussian blur mixed by the mask; auto-framing zoom up to 2× (Framing.kt, 7 unit tests).
- Settings → Filters, the live panel and the PC window ("Effects" row) all have both switches.
- Size lesson: ML Kit bundled segmentation +20 MB per CPU type; plain TensorFlow Lite can't run the model (MediaPipe
  custom op, even with its GPU runner); MediaPipe Tasks = +14 MB arm64 / +8.5 MB armv7 (x86 dropped).
- On the owner's phone: blur visible on the phone and the PC, 30 fps steady, ~65 ms per look off the frame path,
  auto-framing correctly stays at 1× with nobody in view. **Not yet tested with a person in front of the camera.**
  The patterned curtain was partly kept sharp (model false positive) — judge again with a person.
- Not in direct-60 mode (no picture engine there), like the other filters.

## Recommended order

A1 face priority → A3 High profile → A2 video-call tuning → A5 thermal → A4 intra refresh, then B6 background blur
and B7 auto-framing (Premium value), then B8 HEVC.

## Sources

- Android camera stream use cases (VIDEO_CALL): [Camera capture sessions and requests](https://developer.android.com/training/camera2/capture-sessions-requests), [AOSP stream configurations](https://source.android.com/docs/core/camera/stream-config)
- Face priority: [CameraMetadata reference](https://developer.android.com/reference/android/hardware/camera2/CameraMetadata.html), [FACE_PRIORITY_LOW_LIGHT commit](https://android.googlesource.com/platform/frameworks/base/+/ee2ebde%5E%21/), [CameraX group on face support levels](https://groups.google.com/a/android.com/g/camerax-developers/c/SKk7bo83LCs)
- Encoder keys: [MediaFormat reference](https://developer.android.com/reference/android/media/MediaFormat), [Android low-latency media](https://source.android.com/docs/core/media/low-latency-media)
- Windows decoders: [H.264 Video Decoder](https://learn.microsoft.com/nl-nl/windows/win32/medfound/h-264-video-decoder), [CODECAPI_AVLowLatencyMode](https://learn.microsoft.com/windows/win32/medfound/codecapi-avlowlatencymode), [MF_LOW_LATENCY](https://learn.microsoft.com/en-ie/Windows/Win32/medfound/mf-low-latency), [H.265/HEVC Video Decoder](https://learn.microsoft.com/en-us/windows/win32/medfound/h-265---hevc-video-decoder), [Mozilla bug on decoder buffering](https://bugzilla.mozilla.org/show_bug.cgi?id=1141139)
- HEVC vs H.264: [Wowza](https://www.wowza.com/?p=17134), [AWS](https://aws.amazon.com/tw/media/tech/high-efficiency-video-coding/)
- Thermal: [Android Thermal API](https://developer.android.com/games/optimize/adpf/thermal?hl=en), [NDK thermal](https://developer.android.com/ndk/reference/group/thermal?hl=in)
- Background segmentation: [ML Kit selfie segmentation (Android)](https://developers.google.com/ml-kit/vision/selfie-segmentation/android?authuser=3)
- Virtual camera: [MFCreateVirtualCamera](https://learn.microsoft.com/en-us/windows/win32/api/mfvirtualcamera/nf-mfvirtualcamera-mfcreatevirtualcamera), [Windows-Camera wiki](https://github.com/microsoft/Windows-Camera/wiki), [VCamSample](https://github-redirect.dependabot.com/smourier/VCamSample)
- Competitors: [GSMArena comparison](https://www.gsmarena.com/best_way_to_use_your_android_phone_as_a_webcam_we_test_the_apps_and_compare_the_results-news-47897.php), [iVCam's comparison page (self-interested)](https://ivcam.pages.dev/alternatives)
