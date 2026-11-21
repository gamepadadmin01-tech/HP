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

use super::{CAMERA_PORT, decode::H264Decoder, proto, vcam};

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
    std::thread::Builder::new()
        .name("camos-listen".into())
        .spawn(move || {
            for conn in l.incoming() {
                let Ok(mut c) = conn else { continue };
                if BUSY.swap(true, Ordering::SeqCst) {
                    let _ = c.write_all(&proto::server_ack(proto::STATUS_BUSY));
                    continue;
                }
                let key = key.clone();
                let _ = std::thread::Builder::new().name("camos-phone".into()).spawn(move || {
                    let peer = c.peer_addr().map(|a| a.to_string()).unwrap_or_default();
                    match serve(&mut c, &key) {
                        Ok(()) => println!("camos: phone {peer} stopped streaming"),
                        Err(e) => set_error(format!("phone {peer}: {e}")),
                    }
                    if let Ok(mut s) = STATUS.lock() {
                        s.live = false;
                        s.fps = 0.0;
                    }
                    BUSY.store(false, Ordering::SeqCst);
                });
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
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
    let hello = match proto::verify_client_hello(key, &nonce, &fixed, &name) {
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
    let _ = c.write_all(&[proto::REQUEST_KEYFRAME]);
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
        payload.resize(fh.len, 0);
        c.read_exact(&mut payload).map_err(|e| format!("frame: {e}"))?;
        let mut on_frame = |fw: u32, fh2: u32, nv12: Vec<u8>| {
            frames += 1;
            vcam::publish(fw, fh2, nv12);
        };
        if let Err(e) = dec.decode(&payload, fh.pts_us, w, h, &mut on_frame) {
            errors += 1;
            eprintln!("camos: decode error {e} (#{errors})");
            // A broken frame poisons everything until the next key frame.
            let _ = c.write_all(&[proto::REQUEST_KEYFRAME]);
            if errors > 30 {
                return Err(format!("decoder keeps failing: {e}"));
            }
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
