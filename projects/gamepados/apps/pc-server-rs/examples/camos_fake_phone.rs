//! A pretend CamOS phone: streams a raw H.264 file (Annex-B) to Gamepad Server
//! over the real CamOS protocol (handshake + frames), looping, at 30 fps (or the size/fps given).
//! Tests the whole PC path — receive, decode, virtual camera — without a phone.
//!
//!   cargo run --release --example camos_fake_phone -- <file.h264> [ip] [key] [seconds] [w] [h] [fps] [free|premium] [tcp|udp] [loss%]
//!   (key defaults to this PC's pairing key; `udp` = smooth Wi-Fi mode, `loss%` throws that share of UDP packets
//!   away on purpose, resends included, to test the asks-to-resend and skipping)
//!
//! It also plays the phone's side of the PC-window remote: sends its state, applies the window's requests with
//! the same plan rules as the real app (free: no looks/smoothing/low light/1080p), and logs every request.
use pc_server_rs::camera::{proto, udp};
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
    let want_udp = args.get(9).map(|s| s == "udp").unwrap_or(false);
    let loss: f64 = args.get(10).and_then(|s| s.parse().ok()).unwrap_or(0.0) / 100.0;
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
    let h = proto::ClientHello { width, height, fps: fps as u8, name: "Fake phone (test)".into(), check: false, udp: want_udp, rotate: std::env::var("CAMOS_ROTATE").ok().and_then(|v| v.parse().ok()).unwrap_or(0), mirror: false,
        mark: std::env::var("CAMOS_MARK").is_ok(), fit: std::env::var("CAMOS_FIT").ok().and_then(|v| v.parse().ok()).unwrap_or(0) };
    s.write_all(&proto::build_client_hello(&key, &nonce, &h)).unwrap();
    let mut ack = [0u8; 5];
    s.read_exact(&mut ack).unwrap();
    println!("server answered status {}", ack[4]);
    if ack[4] != 0 { return; }
    let mut grant = None;
    if want_udp {
        let mut g = [0u8; proto::UDP_GRANT_LEN];
        s.read_exact(&mut g).unwrap();
        assert_eq!(&g[0..4], b"CAMU");
        if g[4] == 1 {
            let port = u16::from_be_bytes([g[5], g[6]]);
            let token: [u8; 8] = g[7..15].try_into().unwrap();
            grant = Some((port, token));
        }
        println!("UDP mode: {}", if grant.is_some() { "granted" } else { "refused (stays on TCP)" });
    }
    let udp_tx = grant.map(|(port, token)| UdpSender::start(&ip, port, token, loss));

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
        if let Some(u) = &udp_tx {
            u.send_frame(n as u32, *key, n * frame_us, au);
            if n % fps == 0 {
                // "Still here" on TCP once a second.
                let mut ping = Vec::with_capacity(14);
                ping.extend_from_slice(&1u32.to_be_bytes());
                ping.extend_from_slice(&0u64.to_be_bytes());
                ping.push(proto::FLAG_PING);
                ping.push(0);
                if s.write_all(&ping).is_err() { println!("server closed"); return; }
            }
            if dirty.swap(false, std::sync::atomic::Ordering::SeqCst) || n % (fps * 5) == 0 { send_state(&mut s); }
            n += 1;
            let due = start + Duration::from_micros(n * frame_us);
            if let Some(w) = due.checked_duration_since(Instant::now()) { std::thread::sleep(w); }
            continue;
        }
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
    if let Some(u) = &udp_tx {
        let st = u.stats.lock().unwrap();
        println!("UDP: {} packets sent, {} thrown away on purpose, {} resent after asks, PC reported {} received / {} lost / {} skipped",
            st.sent, st.dropped, st.resent, st.rx, st.lost, st.skipped);
    }
}

#[derive(Default)]
struct Stats { sent: u64, dropped: u64, resent: u64, rx: u64, lost: u64, skipped: u64 }

/// The phone's UDP side: cuts pictures into pieces, keeps the last 64 pictures for resends, answers NACKs, reads
/// the PC's reports. `loss` throws packets away on purpose (a pretend bad Wi-Fi).
struct UdpSender {
    sock: std::net::UdpSocket,
    token: [u8; 8],
    loss: f64,
    seq: Arc<Mutex<u32>>,
    recent: Arc<Mutex<Vec<Option<(u32, Vec<Vec<u8>>)>>>>,
    rng: Arc<Mutex<u64>>,
    stats: Arc<Mutex<Stats>>,
}

impl UdpSender {
    fn start(ip: &str, port: u16, token: [u8; 8], loss: f64) -> Arc<UdpSender> {
        let sock = std::net::UdpSocket::bind(("0.0.0.0", 0)).unwrap();
        sock.connect((ip, port)).unwrap();
        let me = Arc::new(UdpSender {
            sock, token, loss,
            seq: Arc::new(Mutex::new(0)),
            recent: Arc::new(Mutex::new(vec![None; 64])),
            rng: Arc::new(Mutex::new(0x2545F4914F6CDD1D)),
            stats: Arc::new(Mutex::new(Stats::default())),
        });
        let r = me.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 2048];
            loop {
                let Ok(n) = r.sock.recv(&mut buf) else { continue };
                if let Some((frame, missing)) = udp::parse_nack(&r.token, &buf[..n]) {
                    let pieces = r.recent.lock().unwrap()[frame as usize % 64].clone();
                    if let Some((f, pkts)) = pieces {
                        if f != frame { continue; }
                        let list: Vec<usize> = if missing.is_empty() { (0..pkts.len()).collect() } else { missing.iter().map(|&i| i as usize).collect() };
                        for i in list {
                            if let Some(p) = pkts.get(i) {
                                r.stats.lock().unwrap().resent += 1;
                                r.send_raw(p.clone());
                            }
                        }
                    }
                } else if let Some(rep) = udp::parse_report(&r.token, &buf[..n]) {
                    let mut st = r.stats.lock().unwrap();
                    st.rx += rep.received as u64; st.lost += rep.lost as u64; st.skipped += rep.skipped as u64;
                }
            }
        });
        me
    }

    fn chance(&self) -> f64 {
        let mut x = self.rng.lock().unwrap();
        *x ^= *x << 13; *x ^= *x >> 7; *x ^= *x << 17;
        (*x % 1_000_000) as f64 / 1_000_000.0
    }

    /// Send with a fresh packet number (resends get one too, like the phone).
    fn send_raw(&self, mut p: Vec<u8>) {
        let seq = { let mut s = self.seq.lock().unwrap(); let v = *s; *s = s.wrapping_add(1); v };
        p[26..30].copy_from_slice(&seq.to_be_bytes());
        self.stats.lock().unwrap().sent += 1;
        if self.chance() < self.loss { self.stats.lock().unwrap().dropped += 1; return; }
        let _ = self.sock.send(&p);
    }

    fn send_frame(&self, frame: u32, key: bool, pts_us: u64, au: &[u8]) {
        let count = au.len().div_ceil(udp::MAX_CHUNK) as u16;
        let pkts: Vec<Vec<u8>> = au.chunks(udp::MAX_CHUNK).enumerate().map(|(i, d)| udp::build_video(&self.token, &udp::Chunk {
            flags: if key { udp::FLAG_KEY } else { 0 }, frame, idx: i as u16, count, pts_us, seq: 0, data: d,
        })).collect();
        self.recent.lock().unwrap()[frame as usize % 64] = Some((frame, pkts.clone()));
        for p in pkts { self.send_raw(p); }
        // Spare pieces (CAMOS_FEC=k): one XOR per group of k, sent after the picture, like the phone does.
        let k: usize = std::env::var("CAMOS_FEC").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
        if k >= 2 {
            let pieces: Vec<&[u8]> = au.chunks(udp::MAX_CHUNK).collect();
            for (g, group) in pieces.chunks(k).enumerate() {
                let xor = udp::xor_pieces(group.iter().copied());
                let p = udp::build_parity(&self.token, &udp::Parity {
                    flags: if key { udp::FLAG_KEY } else { 0 }, frame, group: g as u16, count, pts_us, seq: 0,
                    total: au.len() as u32, k: k as u8, xor: &xor,
                });
                self.send_raw(p);
            }
        }
    }
}
