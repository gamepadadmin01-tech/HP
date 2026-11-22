# CamOS architecture review — 2026-11-23

Owner's question: "when I connect over Wi-Fi the PC server keeps disconnecting… analyze the architecture and
everything needed on the internet so we can see where we are wrong. WhatsApp video calls are fast, why is ours slow?"

## 1. What we built (the path one picture takes)

```
PHONE                                                     PC
camera (Camera2) → picture engine (OpenGL: turn, filters,  TCP 7780 → H.264 decoder (Media Foundation)
watermark) → H.264 video chip (MediaCodec, CBR, no         → "CamOS Camera" add-on (camos_vcam.dll, fed through
B-frames) → queue (45 frames) → TCP socket ─────────────→    a named pipe) → Windows camera service → Zoom/Meet/…
                                                           → small copy for the server window preview
```

USB works the same way: USB debugging tunnels the same TCP connection through the cable (`adb reverse`), USB
tethering makes the cable a tiny network of its own.

## 2. What was measured today

| Check | Result | Meaning |
|---|---|---|
| PC's Wi-Fi | `IIITS_Student`, **2.4 GHz**, channel 11, signal 70 %, network type *Public* | A campus network shared by many students on the slowest, most crowded band |
| Ping from the PC to the Wi-Fi router, 40 times | **3 ms best, 32 ms average, 299 ms worst**, no loss | The air is congested: some packets wait 100× longer than others |
| Phone → PC path | phone → access point → (campus switches) → access point → PC | **Two radio hops** on that crowded air, often through the campus controller |
| Server alone, fake phone, 720p30 for 60 s | 1,801 frames, no drop | The Rust server itself does not disconnect |
| Server CPU at 1080p60 (earlier) | 2.7 % of the PC | The server is not the slow part |
| Firewall | the test server is allowed on Public networks | Not a firewall problem |

## 3. Why a WhatsApp call feels faster than CamOS on the same Wi-Fi

1. **One radio hop vs two.** WhatsApp goes phone → access point → wired internet. CamOS goes phone → access point →
   access point → PC: twice the time in the crowded air, and campus networks often route it through a central
   controller and/or limit device-to-device traffic (vendors call it "client isolation"/"peer-to-peer blocking").
2. **Much less data.** A video call adapts down to well under 1–2 Mbit/s and a small picture. CamOS sends 3 Mbit/s
   (720p) to 5 Mbit/s (1080p) — what a webcam needs to look sharp, but 3–5× more than a call on the same air.
3. **UDP + delay-based control vs TCP.** Calls use WebRTC: UDP packets plus a controller (GCC) that watches the
   *delay* growing and slows down before anything is lost; a late frame is simply skipped. TCP — what CamOS, scrcpy
   and most phone-webcam apps use — never skips: one lost packet holds back everything behind it until it is resent,
   which shows up as a freeze and then a rush. Research says it plainly: TCP's reliability and in-order delivery add
   too much delay for live video.
4. **Calls hide problems; we gave up.** A call that loses the network freezes for a second and carries on. Until
   0.4.4, CamOS threw the whole camera away on any network error and sent you to the home screen.

## 4. Where we were wrong — and status

| # | Problem | Effect the owner saw | Status |
|---|---|---|---|
| 1 | **No automatic reconnect.** Any network error stopped the camera and showed an error | "keeps disconnecting" | **Fixed in 0.4.4**: camera stays on, "Reconnecting…", retries up to 30 s |
| 2 | **A stalled link was never noticed.** Android can take minutes to declare a dead Wi-Fi connection | long freezes, then a drop | **Fixed in 0.4.4**: a send stuck 4 s → reconnect |
| 3 | **Socket not pinned to the PC's network.** On a Wi-Fi Android thinks has "no internet" (campus login networks), Android may send traffic over mobile data, where the PC can't be reached | "no answer" / drops on campus Wi-Fi | **Fixed in 0.4.4**: the stream and the "is my PC ready?" check are bound to the network that contains the PC's address |
| 4 | **Quality collapsed after every hiccup.** A backed-up queue halved the bitrate, and it climbed back 10 % every 3 s (~45 s to recover) | blurry for a long time after a freeze | **Improved in 0.4.4**: no queuing while disconnected, recovery 15 % every 2 s (~20 s), reconnect starts at ⅔ quality |
| 5 | **No record of why a stream ended.** A shortcut-started server has no console | we were guessing | **Fixed**: `%LOCALAPPDATA%\GamepadServer\camos.log` (time, phone, reason, how long it streamed) |
| 6 | Adaptive bitrate reacts to the *queue length* only — it notices trouble late, after frames are already stuck | stutter before it settles | **Next**: delay-based control (watch how long each send takes, like GCC) |
| 7 | **TCP on Wi-Fi.** Fine on the cable (scrcpy proves it), but on busy Wi-Fi every lost packet freezes the picture | jerky motion on Wi-Fi | **Next, the big one**: a UDP mode for Wi-Fi with resend-only-if-still-useful (NACK) and skipping late frames; TCP stays for USB |
| 8 | Recovery from a broken picture asks for a full key frame — one big burst on an already struggling link | a hitch after each loss | **Next**: "intra refresh" (the picture is refreshed in strips, no big burst), where the phone's video chip supports it |
| 9 | 30 fps over USB too | owner thought the cable was slow | **Not the transport**: the phone's camera gives CamOS 30 fps at that size (see the Camera report). A cable carries 60 easily |

## 5. What to tell users (and what the owner should test with)

- **USB is the best path** (Iriun says the same: USB for the most stable, lowest-latency video).
- On Wi-Fi: **5 GHz**, near the router, start at **720p/30**, go to 1080p only if it stays smooth (Iriun's advice too).
- **Campus / office / hotel Wi-Fi is the worst case** (crowded 2.4 GHz, two radio hops, may block device-to-device).
  A phone hotspot with the PC joined to it is often far better than campus Wi-Fi.

## 6. Plan

1. **0.4.4 (built now):** reconnect, stall watchdog, network pinning, faster quality recovery; server log.
2. **Delay-based bitrate** (small): measure send time per frame; slow down when it grows, before the queue builds.
3. **UDP mode for Wi-Fi — built 2026-11-23 (CamOS 0.5.0 test).** `pc-server-rs/src/camera/udp.rs` (format,
   reassembly, NACK/give-up rules, 6 tests) + `camos-android/.../UdpLink.kt`. Settings → Video quality → "Smooth
   Wi-Fi mode" (on by default). The USB cable stays on TCP; a Wi-Fi that blocks UDP (no report within 3 s) falls back
   to TCP by itself. Fake-phone results on the PC: 5 % packets thrown away → all 261 resent, 0 pictures skipped;
   20 % → 1,139 resent, 1 picture skipped, no decode errors. Each stream's totals go to camos.log
   ("UDP: N packets, M lost (x %), K asks to resend, S pictures skipped").
4. **Intra refresh** where supported, so a lost packet doesn't need a full key frame.

## Sources

- WebRTC uses UDP/RTP and delay-based congestion control; TCP is unsuitable for conferencing —
  [Carlucci et al., GCC (cs538 reading)](https://cs538.github.io/readings/carlucci16.pdf),
  [WebRTC performance study, Columbia](https://wimnet.ee.columbia.edu/wp-content/uploads/2017/10/WebRTC-Performance.pdf),
  [WebRTC + BBR, Stony Brook](https://www3.cs.stonybrook.edu/~anshul/comsnets25_webrtcbbr.pdf)
- scrcpy: MediaCodec H.264 over a socket, frames shown with no buffering —
  [scrcpy develop.md](https://GitHub.com/Genymobile/scrcpy/blob/master/doc/develop.md)
- Iriun: USB for stable low-latency video, 5 GHz on Wi-Fi, start at 720p/30 —
  [USB vs Wi-Fi](https://iriun.github.io/usb-vs-wifi.html), [FAQ](https://iriun.github.io/faq.html)
- DroidCam: Wi-Fi & USB — [DroidCam help](https://droidcam.app/help/)
- Android Wi-Fi low-latency lock (CamOS already holds it while streaming) —
  [AOSP: Wi-Fi low latency](https://source.android.com/docs/core/connect/wifi-low-latency)
- Campus Wi-Fi client isolation / 2.4 GHz congestion —
  [Meraki client isolation](https://documentation.meraki.com/Wireless/Operate_and_Maintain/How_Tos/Firewall_and_Traffic_Shaping/Wireless_Client_Isolation),
  [Ubiquiti: broadcast traffic](https://help.ui.com/hc/en-us/articles/27384925962647-Managing-Broadcast-Traffic-with-UniFi),
  [Cisco 9800 recommendations](https://www.cisco.com/c/en/us/support/docs/wireless/catalyst-9800-series-wireless-controllers/225587-review-and-recommendations-for.pdf)
- Android routing when Wi-Fi has no internet (why sockets must be bound to the Wi-Fi network) —
  [golang/go#52702](https://github.com/golang/go/issues/52702),
  [Android local network permission](https://developer.android.com/privacy-and-security/local-network-permission)
