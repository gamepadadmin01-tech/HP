//! Receiving the phone's video on TCP :7780.
//!
//! One phone at a time (a webcam has one picture). A second phone gets a polite
//! "busy" and the app says so. The handshake is in `proto.rs`; after it, every
//! message is one squeezed H.264 frame, handed straight to the decoder and then
//! to the virtual camera.
//!
//! Runs on its own threads — nothing here can slow the gamepad path.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use super::{CAMERA_PORT, decode::H264Decoder, preview, proto, remote, turn, udp, vcam};

/// What the server window shows on the "Phone camera" card.
#[derive(Clone, Debug, Default)]
pub struct CamStatus {
    pub live: bool,
    pub device: String,
    pub width: u32,
    pub height: u32,
    pub fps: f32,
    pub last_error: String,
}

static STATUS: Mutex<CamStatus> = Mutex::new(CamStatus {
    live: false,
    device: String::new(),
    width: 0,
    height: 0,
    fps: 0.0,
    last_error: String::new(),
});
static BUSY: AtomicBool = AtomicBool::new(false);
/// The phone that is streaming now (its address, and a handle to close its connection). When the SAME phone
/// connects again while its old stream is still closing (Stop → home screen check, or a Wi-Fi blip), the old one
/// is closed and the phone is let in, instead of being told "busy with another phone" (owner, 2026-11-22).
static CURRENT: Mutex<Option<(std::net::IpAddr, TcpStream)>> = Mutex::new(None);

pub fn status() -> CamStatus {
    STATUS.lock().map(|s| s.clone()).unwrap_or_default()
}

fn set_error(e: impl Into<String>) {
    let e = e.into();
    log(&e);
    if let Ok(mut s) = STATUS.lock() {
        s.last_error = e;
    }
}

/// Every CamOS connect, stop and error also goes to `%LOCALAPPDATA%\GamepadServer\camos.log` (kept under 1 MB,
/// the previous one as camos.old.log). A server started from its shortcut has no console, so before this a dropped
/// stream left no reason behind (owner, 2026-11-23: "keeps on disconnecting, I don't know why").
pub fn log(line: &str) {
    eprintln!("camos: {line}");
    let Some(dir) = std::env::var_os("LOCALAPPDATA").map(|d| std::path::PathBuf::from(d).join("GamepadServer")) else { return };
    let path = dir.join("camos.log");
    if std::fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("camos.old.log"));
    }
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} {line}", local_time());
    }
}

#[cfg(windows)]
fn local_time() -> String {
    #[repr(C)]
    #[derive(Default)]
    struct SystemTime { y: u16, mo: u16, _dow: u16, d: u16, h: u16, mi: u16, s: u16, ms: u16 }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetLocalTime(t: *mut SystemTime);
    }
    let mut t = SystemTime::default();
    // SAFETY: GetLocalTime only fills the struct we pass; it has the SYSTEMTIME layout (eight u16).
    unsafe { GetLocalTime(&mut t) };
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}", t.y, t.mo, t.d, t.h, t.mi, t.s, t.ms)
}

#[cfg(not(windows))]
fn local_time() -> String {
    format!("{:?}", std::time::SystemTime::now())
}

/// Start listening for the CamOS phone app. `key` is the same 8-character
/// pairing key GamepadOS uses, so one QR scan pairs both apps.
pub fn start(key: String) -> Result<(), String> {
    super::media_available()?;
    let l = TcpListener::bind(("0.0.0.0", CAMERA_PORT)).map_err(|e| format!("tcp/{CAMERA_PORT}: {e}"))?;
    start_discovery(key.clone());
    std::thread::Builder::new()
        .name("camos-listen".into())
        .spawn(move || {
            for conn in l.incoming() {
                let Ok(mut c) = conn else { continue };
                if BUSY.load(Ordering::SeqCst) {
                    let ip = c.peer_addr().map(|a| a.ip()).ok();
                    let same_phone = CURRENT.lock().ok().and_then(|g| g.as_ref().map(|(cur, _)| Some(*cur) == ip)).unwrap_or(false);
                    if same_phone {
                        log(&format!("{} came back (reconnect): closing its old stream", ip.map(|i| i.to_string()).unwrap_or_default()));
                        if let Ok(g) = CURRENT.lock() {
                            if let Some((_, old)) = g.as_ref() {
                                let _ = old.shutdown(std::net::Shutdown::Both);
                            }
                        }
                        // Give the old stream a moment to finish closing.
                        let t0 = Instant::now();
                        while BUSY.load(Ordering::SeqCst) && t0.elapsed() < Duration::from_millis(1500) {
                            std::thread::sleep(Duration::from_millis(20));
                        }
                    }
                }
                if BUSY.swap(true, Ordering::SeqCst) {
                    let _ = c.write_all(&proto::server_ack(proto::STATUS_BUSY));
                    continue;
                }
                let key = key.clone();
                let _ = std::thread::Builder::new().name("camos-phone".into()).spawn(move || {
                    let peer = c.peer_addr().map(|a| a.to_string()).unwrap_or_default();
                    match serve(&mut c, &key) {
                        Ok(()) => log(&format!("phone {peer} stopped streaming")),
                        // A phone that only knocks (reads our greeting, then hangs up) is the CamOS app checking
                        // the USB-debugging tunnel: normal, not an error.
                        Err(e) if e.starts_with("hello:") && e.contains("fill") => {}
                        Err(e) => set_error(format!("phone {peer}: {e}")),
                    }
                    if let Ok(mut s) = STATUS.lock() {
                        s.live = false;
                        s.fps = 0.0;
                    }
                    preview::clear();
                    remote::detach();
                    if let Ok(mut g) = CURRENT.lock() {
                        *g = None;
                    }
                    BUSY.store(false, Ordering::SeqCst);
                });
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// A phone on the USB cable: the adb tunnel (arrives as 127.0.0.1) or a USB-tether address. Like GamepadOS, the
/// cable itself is the trust: no pairing key needed.
pub fn on_the_cable(ip: std::net::IpAddr) -> bool {
    if ip.is_loopback() {
        return true;
    }
    let std::net::IpAddr::V4(v4) = ip else { return false };
    let o = v4.octets();
    let prefix = format!("{}.{}.{}", o[0], o[1], o[2]);
    crate::netdetect::tether_subnets().iter().any(|p| *p == prefix)
}

/// Answer "where is my PC?" broadcasts on UDP 7780 (proto.rs). A phone that proves the pairing key gets an answer
/// from any network (Wi-Fi after the PC's address changed); a phone without the key only on the USB cable.
fn start_discovery(key: String) {
    let sock = match std::net::UdpSocket::bind(("0.0.0.0", CAMERA_PORT)) {
        Ok(s) => s,
        Err(e) => { eprintln!("camos: discovery off (udp/{CAMERA_PORT}: {e})"); return; }
    };
    let name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".into());
    let _ = std::thread::Builder::new().name("camos-discover".into()).spawn(move || {
        let mut buf = [0u8; 64];
        loop {
            let Ok((n, from)) = sock.recv_from(&mut buf) else { continue };
            let answer = match proto::check_discover(&key, &buf[..n]) {
                Some(proto::Discover::Keyed(nonce)) => Some(nonce),
                Some(proto::Discover::Keyless(nonce)) if on_the_cable(from.ip()) => Some(nonce),
                _ => None,
            };
            if let Some(nonce) = answer {
                let _ = sock.send_to(&proto::build_discover_reply(&nonce, CAMERA_PORT, &name), from);
            }
        }
    });
}

fn serve(c: &mut TcpStream, key: &str) -> Result<(), String> {
    c.set_nodelay(true).ok();
    c.set_read_timeout(Some(Duration::from_secs(5))).ok();

    // 1. Challenge.
    let mut nonce = [0u8; 16];
    crate::pairing::os_random(&mut nonce)?;
    c.write_all(&proto::server_hello(&nonce)).map_err(|e| e.to_string())?;

    // 2. The phone's answer.
    let mut fixed = [0u8; proto::CLIENT_HELLO_FIXED];
    c.read_exact(&mut fixed).map_err(|e| format!("hello: {e}"))?;
    let mut name = vec![0u8; proto::name_len(&fixed)];
    c.read_exact(&mut name).map_err(|e| format!("hello name: {e}"))?;
    let cable = c.peer_addr().map(|a| on_the_cable(a.ip())).unwrap_or(false);
    let hello = match proto::verify_client_hello_from(key, &nonce, &fixed, &name, cable) {
        Ok(h) => h,
        Err(st) => {
            let _ = c.write_all(&proto::server_ack(st));
            return Err(if st == proto::STATUS_BAD_KEY {
                "wrong pairing key — scan the QR again".into()
            } else {
                "bad hello".into()
            });
        }
    };
    c.write_all(&proto::server_ack(proto::STATUS_OK)).map_err(|e| e.to_string())?;
    if hello.check {
        // The phone's "is this PC ready?" check after pairing: key proven, nothing to stream.
        println!("camos: {} checked this PC (ready)", hello.name);
        return Ok(());
    }
    // Smooth Wi-Fi mode (udp.rs): the phone asked, and it is not on the USB cable (the cable stays on TCP).
    let udp = if hello.udp && !cable { open_udp() } else { None };
    if hello.udp {
        let grant = udp.as_ref().and_then(|(s, t)| s.local_addr().ok().map(|a| (a.port(), *t)));
        c.write_all(&proto::udp_grant(grant)).map_err(|e| e.to_string())?;
    }
    log(&format!("{} ({}) streaming {}x{} @{}{}", hello.name, c.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default(),
        hello.width, hello.height, hello.fps,
        if cable { " over the USB cable" } else if udp.is_some() { " over Wi-Fi (UDP)" } else { " over Wi-Fi (TCP)" }));
    // Direct 60 fps (Premium): the picture arrives as the camera sensor sees it and is turned upright here.
    let turning = (hello.rotate, hello.mirror);
    if turning != (0, false) {
        log(&format!("direct mode: turning the picture {}° clockwise{}", hello.rotate as u32 * 90, if hello.mirror { ", mirrored" } else { "" }));
    }
    let (up_w, up_h) = if hello.rotate % 2 == 1 { (hello.height, hello.width) } else { (hello.width, hello.height) };
    if let Ok(mut s) = STATUS.lock() {
        *s = CamStatus { live: true, device: hello.name.clone(), width: up_w as u32, height: up_h as u32, fps: 0.0, last_error: String::new() };
    }

    // 3. Frames.
    // From here on everything sent to the phone goes through remote::write_raw (one lock), because the window can
    // send requests on the same socket at any moment.
    remote::attach(c);
    if let (Ok(peer), Ok(handle), Ok(mut g)) = (c.peer_addr(), c.try_clone(), CURRENT.lock()) {
        *g = Some((peer.ip(), handle));
    }
    remote::write_raw(&[proto::REQUEST_KEYFRAME]);
    let (w, h) = (hello.width as u32, hello.height as u32);
    let started = Instant::now();
    let Some((sock, token)) = udp else {
        let mut dec = H264Decoder::new().map_err(|e| format!("H.264 decoder: {e}"))?;
        return control_loop(c, started, Some((&mut dec, w, h)), turning);
    };
    // UDP mode: the video arrives on its own thread; this one keeps the TCP connection (settings, "still here"
    // pings) and notices when the phone leaves.
    let phone = c.peer_addr().map_err(|e| e.to_string())?.ip();
    let tcp = c.try_clone().map_err(|e| e.to_string())?;
    let stop = std::sync::Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let video = std::thread::Builder::new()
        .name("camos-udp".into())
        .spawn(move || udp_loop(sock, token, phone, w, h, &stop2, tcp, turning))
        .map_err(|e| e.to_string())?;
    let r = control_loop(c, started, None, turning);
    stop.store(true, Ordering::SeqCst);
    let v = video.join().unwrap_or_else(|_| Err("video thread stopped unexpectedly".into()));
    // A video-side reason (UDP silent, decoder failing) explains the end better than "connection closed".
    v.and(r)
}

/// The phone adds a line about its camera to every state message ("cam": which mode, size, frame-rate range, what
/// the camera really gives). Written to camos.log when it changes, at most every 5 s, so a "60 fps shows 30"
/// report can be explained from the log alone (owner, 2026-11-23).
fn log_camera_facts(payload: &[u8], last: &mut Option<(String, Instant)>) {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(payload) else { return };
    let Some(line) = v.get("cam").and_then(|c| c.as_str()) else { return };
    let line: String = line.chars().filter(|c| !c.is_control()).take(240).collect();
    let due = last.as_ref().is_none_or(|(prev, at)| *prev != line && at.elapsed() >= Duration::from_secs(5));
    if due {
        log(&format!("phone camera: {line}"));
        *last = Some((line, Instant::now()));
    }
}

/// A UDP socket for one phone's video, and the token its packets must carry.
fn open_udp() -> Option<(std::net::UdpSocket, [u8; 8])> {
    let sock = std::net::UdpSocket::bind(("0.0.0.0", 0)).map_err(|e| log(&format!("UDP mode off: {e}"))).ok()?;
    crate::winperf::tune_socket(&sock); // 1 MB buffers: a 1080p key frame arrives as ~300 packets at once
    sock.set_read_timeout(Some(Duration::from_millis(10))).ok()?;
    let mut token = [0u8; 8];
    crate::pairing::os_random(&mut token).ok()?;
    Some((sock, token))
}

/// Frames delivered: to the window preview and to "CamOS Camera", with the frame rate the window shows.
struct Sink {
    frames: u32,
    window: Instant,
    errors: u32,
    last_key_ask: Instant,
    /// Quarter turns + mirror to make the picture upright (direct 60 fps mode; (0, false) = nothing to do).
    turning: (u8, bool),
}

impl Sink {
    fn new(turning: (u8, bool)) -> Self {
        Sink { frames: 0, window: Instant::now(), errors: 0, last_key_ask: Instant::now(), turning }
    }

    fn decode(&mut self, dec: &mut H264Decoder, data: &[u8], pts_us: u64, w: u32, h: u32) -> Result<(), String> {
        let frames = &mut self.frames;
        let (quarters, mirror) = self.turning;
        let mut on_frame = |fw: u32, fh: u32, nv12: Vec<u8>| {
            *frames += 1;
            let (fw, fh, nv12) = if (quarters, mirror) == (0, false) {
                (fw, fh, nv12)
            } else {
                match turn::turn_nv12(fw, fh, &nv12, quarters, mirror) {
                    Some(t) => t,
                    None => (fw, fh, nv12),
                }
            };
            preview::offer(fw, fh, &nv12);
            vcam::publish(fw, fh, nv12);
        };
        if let Err(e) = dec.decode(data, pts_us, w, h, &mut on_frame) {
            self.errors += 1;
            eprintln!("camos: decode error {e} (#{})", self.errors);
            // A broken frame poisons everything until the next key frame.
            self.ask_key();
            // Only broken frames IN A ROW end the stream (30 = about a second of nothing usable). The old total
            // count never reset, so a long call on weak Wi-Fi eventually stopped for no current reason.
            if self.errors > 30 {
                return Err(format!("decoder keeps failing: {e}"));
            }
        } else {
            self.errors = 0;
        }
        Ok(())
    }

    /// Key-frame asks are limited to one a second: asking on every broken frame made the phone send full pictures
    /// back to back on weak Wi-Fi, which is what kept 1080p from ever recovering.
    fn ask_key(&mut self) {
        if self.last_key_ask.elapsed() >= Duration::from_secs(1) {
            remote::write_raw(&[proto::REQUEST_KEYFRAME]);
            self.last_key_ask = Instant::now();
        }
    }

    fn tick(&mut self) {
        if self.window.elapsed() >= Duration::from_secs(1) {
            let fps = self.frames as f32 / self.window.elapsed().as_secs_f32();
            if let Ok(mut s) = STATUS.lock() {
                s.fps = fps;
            }
            self.frames = 0;
            self.window = Instant::now();
        }
    }
}

/// The TCP side: video frames (TCP mode, `video` = decoder + size), the phone's state, "still here" pings.
fn control_loop(c: &mut TcpStream, started: Instant, mut video: Option<(&mut H264Decoder, u32, u32)>, turning: (u8, bool)) -> Result<(), String> {
    let mut sink = Sink::new(turning);
    let mut hdr = [0u8; proto::FRAME_HEADER_LEN];
    let mut payload = Vec::new();
    let mut last_cam: Option<(String, Instant)> = None;
    loop {
        match c.read_exact(&mut hdr) {
            Ok(()) => {}
            // The phone closing the connection (Stop, app closed, Wi-Fi gone) is a normal end.
            Err(e) if matches!(e.kind(), std::io::ErrorKind::UnexpectedEof | std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted) => {
                log(&format!("connection closed ({:?}) after {:.0} s", e.kind(), started.elapsed().as_secs_f32()));
                return Ok(());
            }
            Err(e) if matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) => {
                return Err(format!("nothing arrived from the phone for 5 s (Wi-Fi stalled) after {:.0} s of streaming", started.elapsed().as_secs_f32()));
            }
            Err(e) => return Err(format!("stream: {e}")),
        }
        let fh = proto::parse_frame_header(&hdr)?;
        if fh.flags & (proto::FLAG_STATE | proto::FLAG_PING) != 0 && fh.len > proto::MAX_STATE {
            return Err(format!("state message too large ({} bytes)", fh.len));
        }
        payload.resize(fh.len, 0);
        c.read_exact(&mut payload).map_err(|e| format!("frame: {e}"))?;
        if fh.flags & proto::FLAG_STATE != 0 {
            // The phone's settings and what its plan allows, for the window's controls. Not video.
            remote::on_state(&payload);
            log_camera_facts(&payload, &mut last_cam);
            continue;
        }
        if fh.flags & proto::FLAG_PING != 0 {
            continue;
        }
        if let Some((dec, w, h)) = video.as_mut() {
            sink.decode(dec, &payload, fh.pts_us, *w, *h)?;
            sink.tick();
        }
    }
}

/// UDP mode: receive the pieces, put pictures back together (udp.rs), ask for missing pieces, report losses to
/// the phone twice a second, decode. Ends when told to, or after 5 s without video (then it also closes the TCP
/// connection so the phone reconnects).
#[allow(clippy::too_many_arguments)]
fn udp_loop(sock: std::net::UdpSocket, token: [u8; 8], phone: std::net::IpAddr, w: u32, h: u32, stop: &AtomicBool, tcp: TcpStream, turning: (u8, bool)) -> Result<(), String> {
    crate::winperf::raise_receive_thread();
    let mut dec = H264Decoder::new().map_err(|e| format!("H.264 decoder: {e}"))?;
    let mut re = udp::Reassembler::new();
    let mut sink = Sink::new(turning);
    let mut buf = vec![0u8; 2048];
    let mut phone_addr: Option<std::net::SocketAddr> = None;
    let started = Instant::now();
    let mut last_rx = Instant::now();
    let mut last_report = Instant::now();
    let (mut total_rx, mut total_lost, mut total_skipped, mut nacks) = (0u64, 0u64, 0u64, 0u64);
    let result = loop {
        if stop.load(Ordering::SeqCst) {
            break Ok(());
        }
        match sock.recv_from(&mut buf) {
            Ok((n, from)) if from.ip() == phone => {
                if let Some(chunk) = udp::parse_video(&token, &buf[..n]) {
                    re.push(&chunk);
                    last_rx = Instant::now();
                    phone_addr = Some(from);
                }
            }
            Ok(_) => {} // someone else: ignored
            Err(e) if matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) => {}
            // Windows reports "the phone's port is closed" (an ICMP answer to our NACK/report) as an error on
            // the NEXT receive; that is not fatal, the phone may simply be reconnecting.
            Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => {}
            Err(e) => break Err(format!("udp: {e}")),
        }
        let now = Instant::now();
        let mut failed = None;
        for ev in re.poll(now) {
            match ev {
                udp::Event::Frame { data, pts_us, .. } => {
                    if let Err(e) = sink.decode(&mut dec, &data, pts_us, w, h) {
                        failed = Some(e);
                        break;
                    }
                }
                udp::Event::Nack { frame, missing } => {
                    if let Some(a) = phone_addr {
                        nacks += 1;
                        if missing.is_empty() {
                            let _ = sock.send_to(&udp::build_nack(&token, frame, &[]), a);
                        }
                        for part in missing.chunks(udp::NACK_MAX) {
                            let _ = sock.send_to(&udp::build_nack(&token, frame, part), a);
                        }
                    }
                }
                udp::Event::NeedKey => sink.ask_key(),
            }
        }
        if let Some(e) = failed {
            break Err(e);
        }
        if now.duration_since(last_report) >= Duration::from_millis(500) {
            last_report = now;
            let r = re.take_report();
            total_rx += r.received as u64;
            total_lost += r.lost as u64;
            total_skipped += r.skipped as u64;
            if let Some(a) = phone_addr {
                let _ = sock.send_to(&udp::build_report(&token, &r), a);
            }
        }
        if now.duration_since(last_rx) > Duration::from_secs(5) {
            let _ = tcp.shutdown(std::net::Shutdown::Both);
            break Err(if phone_addr.is_none() {
                "no video arrived over UDP (Wi-Fi may block it; the phone falls back to TCP)".into()
            } else {
                format!("no video over UDP for 5 s (Wi-Fi stalled) after {:.0} s", started.elapsed().as_secs_f32())
            });
        }
        sink.tick();
    };
    let sent = total_rx + total_lost;
    log(&format!(
        "UDP: {total_rx} packets, {total_lost} lost ({:.1} %), {nacks} asks to resend, {total_skipped} pictures skipped",
        if sent > 0 { total_lost as f64 * 100.0 / sent as f64 } else { 0.0 }
    ));
    result
}
