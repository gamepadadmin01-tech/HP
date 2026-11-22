//! A pretend CamOS phone: streams a raw H.264 file (Annex-B) to Gamepad Server
//! over the real CamOS protocol (handshake + frames), looping, at 30 fps (or the size/fps given).
//! Tests the whole PC path — receive, decode, virtual camera — without a phone.
//!
//!   cargo run --release --example camos_fake_phone -- <file.h264> [ip] [key] [seconds] [w] [h] [fps] [free|premium]
//!   (key defaults to this PC's pairing key)
//!
//! It also plays the phone's side of the PC-window remote: sends its state, applies the window's requests with
//! the same plan rules as the real app (free: no looks/smoothing/low light/1080p), and logs every request.
use pc_server_rs::camera::proto;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

fn nal_units(data: &[u8]) -> Vec<&[u8]> {
    // Split on 00 00 01 / 00 00 00 01 start codes; each returned slice keeps its start code.
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 <= data.len() {
        if data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
            let s = if i > 0 && data[i - 1] == 0 { i - 1 } else { i };
            starts.push(s);
            i += 3;
        } else {
            i += 1;
        }
    }
    starts.iter().enumerate().map(|(k, &s)| &data[s..*starts.get(k + 1).unwrap_or(&data.len())]).collect()
}

fn nal_type(n: &[u8]) -> u8 {
    let off = if n[2] == 1 { 3 } else { 4 };
    n[off] & 0x1f
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let file = args.get(1).expect("usage: camos_fake_phone <file.h264> [ip] [key] [seconds] [width] [height] [fps]");
    let ip = args.get(2).cloned().unwrap_or_else(|| "127.0.0.1".into());
    let key = args.get(3).cloned().unwrap_or_else(|| pc_server_rs::pairing::load_or_create_key().unwrap());
    let secs: u64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(20);
    let width: u16 = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(1280);
    let height: u16 = args.get(6).and_then(|s| s.parse().ok()).unwrap_or(720);
    let fps: u64 = args.get(7).and_then(|s| s.parse().ok()).unwrap_or(30);
    let frame_us = 1_000_000 / fps;
    let premium = args.get(8).map(|s| s == "premium").unwrap_or(false);
    let data = std::fs::read(file).expect("read h264");

    // Group NAL units into access units: parameter sets/SEI ride with the next picture.
    let mut aus: Vec<(Vec<u8>, bool)> = Vec::new();
    let mut cur = Vec::new();
    let mut key_au = false;
    for n in nal_units(&data) {
        let t = nal_type(n);
        cur.extend_from_slice(n);
        if t == 5 { key_au = true; }
        if t == 1 || t == 5 {
            aus.push((std::mem::take(&mut cur), key_au));
            key_au = false;
        }
    }
    println!("{} access units, {} key frames", aus.len(), aus.iter().filter(|a| a.1).count());

    let mut s = TcpStream::connect((ip.as_str(), pc_server_rs::camera::CAMERA_PORT)).expect("connect");
    s.set_nodelay(true).ok();
    let mut hello = [0u8; proto::SERVER_HELLO_LEN];
    s.read_exact(&mut hello).expect("server hello");
    assert_eq!(&hello[0..4], b"CAMS");
    let nonce: [u8; 16] = hello[5..21].try_into().unwrap();
    let h = proto::ClientHello { width, height, fps: fps as u8, name: "Fake phone (test)".into(), check: false };
    s.write_all(&proto::build_client_hello(&key, &nonce, &h)).unwrap();
    let mut ack = [0u8; 5];
    s.read_exact(&mut ack).unwrap();
    println!("server answered status {}", ack[4]);
    if ack[4] != 0 { return; }

    // The phone's side of the remote. Same rules as CamOSApp.tsx onRemote().
    let state = Arc::new(Mutex::new(json!({
        "quality": height.min(1080), "fps": fps, "portrait": false, "front": false, "zoom": 1.0, "zoomMin": 0.6, "zoomMax": 8.0,
        "ev": 0, "evMin": -12, "evMax": 12, "evStep": 0.1667, "look": "none", "smooth": 0.0, "lowLight": false,
        "torch": false, "premium": premium, "hd": premium, "flash": true, "otherLens": true
    })));
    let dirty = Arc::new(std::sync::atomic::AtomicBool::new(true));
    {
        let mut r = s.try_clone().unwrap();
        let (state, dirty) = (state.clone(), dirty.clone());
        std::thread::spawn(move || loop {
            let mut b = [0u8; 1];
            if r.read_exact(&mut b).is_err() { return; }
            if b[0] != b'C' { continue; }
            let mut l = [0u8; 2];
            if r.read_exact(&mut l).is_err() { return; }
            let mut msg = vec![0u8; u16::from_be_bytes(l) as usize];
            if r.read_exact(&mut msg).is_err() { return; }
            let m: Value = serde_json::from_slice(&msg).unwrap_or(Value::Null);
            let mut st = state.lock().unwrap();
            let prem = st["premium"].as_bool().unwrap_or(false);
            let mut verdict = "applied";
            if let Some(a) = m["action"].as_str() {
                match a {
                    "flip" => { let f = !st["front"].as_bool().unwrap(); st["front"] = json!(f); st["flash"] = json!(!f); st["torch"] = json!(false); }
                    "reshape" => { let p = !st["portrait"].as_bool().unwrap(); st["portrait"] = json!(p); }
                    _ => {}
                }
            }
            if let Some(set) = m["set"].as_object() {
                for (k, v) in set {
                    let locked = matches!(k.as_str(), "look" | "smooth" | "lowLight") && !prem || (k == "quality" && v.as_u64() == Some(1080) && !prem);
                    if locked { verdict = "REFUSED (plan)"; continue; }
                    st[k.as_str()] = v.clone();
                }
            }
            println!("request {} -> {verdict}", String::from_utf8_lossy(&msg));
            dirty.store(true, std::sync::atomic::Ordering::SeqCst);
        });
    }
    let send_state = |s: &mut TcpStream| {
        let body = state.lock().unwrap().to_string();
        let mut hdr = Vec::with_capacity(13);
        hdr.extend_from_slice(&(body.len() as u32).to_be_bytes());
        hdr.extend_from_slice(&0u64.to_be_bytes());
        hdr.push(proto::FLAG_STATE);
        let _ = s.write_all(&hdr).and_then(|_| s.write_all(body.as_bytes()));
    };

    let start = Instant::now();
    let mut n = 0u64;
    while start.elapsed().as_secs() < secs {
        let (au, key) = &aus[(n as usize) % aus.len()];
        let mut hdr = Vec::with_capacity(13);
        hdr.extend_from_slice(&(au.len() as u32).to_be_bytes());
        hdr.extend_from_slice(&(n * frame_us).to_be_bytes());
        hdr.push(if *key { proto::FLAG_KEY } else { 0 });
        if s.write_all(&hdr).and_then(|_| s.write_all(au)).is_err() { println!("server closed"); return; }
        if dirty.swap(false, std::sync::atomic::Ordering::SeqCst) || n % (fps * 5) == 0 { send_state(&mut s); }
        n += 1;
        let due = start + Duration::from_micros(n * frame_us);
        if let Some(w) = due.checked_duration_since(Instant::now()) { std::thread::sleep(w); }
    }
    println!("sent {n} frames in {:.1}s", start.elapsed().as_secs_f32());
}
