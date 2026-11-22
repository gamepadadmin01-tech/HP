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

use super::{CAMERA_PORT, decode::H264Decoder, preview, proto, remote, vcam};

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
    eprintln!("camos: {e}");
    if let Ok(mut s) = STATUS.lock() {
        s.last_error = e;
    }
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
                        Ok(()) => println!("camos: phone {peer} stopped streaming"),
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
    println!("camos: {} streaming {}x{} @{}", hello.name, hello.width, hello.height, hello.fps);
    if let Ok(mut s) = STATUS.lock() {
        *s = CamStatus { live: true, device: hello.name.clone(), width: hello.width as u32, height: hello.height as u32, fps: 0.0, last_error: String::new() };
    }

    // 3. Frames.
    let mut dec = H264Decoder::new().map_err(|e| format!("H.264 decoder: {e}"))?;
    // From here on everything sent to the phone goes through remote::write_raw (one lock), because the window can
    // send requests on the same socket at any moment.
    remote::attach(c);
    if let (Ok(peer), Ok(handle), Ok(mut g)) = (c.peer_addr(), c.try_clone(), CURRENT.lock()) {
        *g = Some((peer.ip(), handle));
    }
    remote::write_raw(&[proto::REQUEST_KEYFRAME]);
    // Key-frame asks after broken frames are limited to one a second: asking on every broken frame made the phone
    // send full pictures back to back on weak Wi-Fi, which is what kept 1080p from ever recovering.
    let mut last_key_ask = Instant::now();
    let (w, h) = (hello.width as u32, hello.height as u32);
    let mut hdr = [0u8; proto::FRAME_HEADER_LEN];
    let mut payload = Vec::new();
    let mut frames = 0u32;
    let mut window = Instant::now();
    let mut errors = 0u32;
    loop {
        match c.read_exact(&mut hdr) {
            Ok(()) => {}
            // The phone closing the connection (Stop, app closed, Wi-Fi gone) is a normal end.
            Err(e) if matches!(e.kind(), std::io::ErrorKind::UnexpectedEof | std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted) => return Ok(()),
            Err(e) => return Err(format!("stream: {e}")),
        }
        let fh = proto::parse_frame_header(&hdr)?;
        if fh.flags & proto::FLAG_STATE != 0 && fh.len > proto::MAX_STATE {
            return Err(format!("state message too large ({} bytes)", fh.len));
        }
        payload.resize(fh.len, 0);
        c.read_exact(&mut payload).map_err(|e| format!("frame: {e}"))?;
        if fh.flags & proto::FLAG_STATE != 0 {
            // The phone's settings and what its plan allows, for the window's controls. Not video.
            remote::on_state(&payload);
            continue;
        }
        let mut on_frame = |fw: u32, fh2: u32, nv12: Vec<u8>| {
            frames += 1;
            preview::offer(fw, fh2, &nv12);
            vcam::publish(fw, fh2, nv12);
        };
        if let Err(e) = dec.decode(&payload, fh.pts_us, w, h, &mut on_frame) {
            errors += 1;
            eprintln!("camos: decode error {e} (#{errors})");
            // A broken frame poisons everything until the next key frame.
            if last_key_ask.elapsed() >= Duration::from_secs(1) {
                remote::write_raw(&[proto::REQUEST_KEYFRAME]);
                last_key_ask = Instant::now();
            }
            // Only broken frames IN A ROW end the stream (30 = about a second of nothing usable). The old total
            // count never reset, so a long call on weak Wi-Fi eventually stopped for no current reason.
            if errors > 30 {
                return Err(format!("decoder keeps failing: {e}"));
            }
        } else {
            errors = 0;
        }
        if window.elapsed() >= Duration::from_secs(1) {
            let fps = frames as f32 / window.elapsed().as_secs_f32();
            if let Ok(mut s) = STATUS.lock() {
                s.fps = fps;
            }
            frames = 0;
            window = Instant::now();
        }
    }
}
