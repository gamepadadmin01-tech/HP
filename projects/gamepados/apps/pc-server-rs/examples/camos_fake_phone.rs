//! A pretend CamOS phone: streams a raw H.264 file (Annex-B) to Gamepad Server
//! over the real CamOS protocol (handshake + frames), looping, at 30 fps.
//! Tests the whole PC path — receive, decode, virtual camera — without a phone.
//!
//!   cargo run --release --example camos_fake_phone -- <file.h264> [ip] [key] [seconds]
//!   (key defaults to this PC's pairing key)
use pc_server_rs::camera::proto;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

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
    let file = args.get(1).expect("usage: camos_fake_phone <file.h264> [ip] [key] [seconds]");
    let ip = args.get(2).cloned().unwrap_or_else(|| "127.0.0.1".into());
    let key = args.get(3).cloned().unwrap_or_else(|| pc_server_rs::pairing::load_or_create_key().unwrap());
    let secs: u64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(20);
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
    let h = proto::ClientHello { width: 1280, height: 720, fps: 30, name: "Fake phone (test)".into() };
    s.write_all(&proto::build_client_hello(&key, &nonce, &h)).unwrap();
    let mut ack = [0u8; 5];
    s.read_exact(&mut ack).unwrap();
    println!("server answered status {}", ack[4]);
    if ack[4] != 0 { return; }

    let start = Instant::now();
    let mut n = 0u64;
    while start.elapsed().as_secs() < secs {
        let (au, key) = &aus[(n as usize) % aus.len()];
        let mut hdr = Vec::with_capacity(13);
        hdr.extend_from_slice(&(au.len() as u32).to_be_bytes());
        hdr.extend_from_slice(&(n * 33_333).to_be_bytes());
        hdr.push(if *key { proto::FLAG_KEY } else { 0 });
        if s.write_all(&hdr).and_then(|_| s.write_all(au)).is_err() { println!("server closed"); return; }
        n += 1;
        let due = start + Duration::from_micros(n * 33_333);
        if let Some(w) = due.checked_duration_since(Instant::now()) { std::thread::sleep(w); }
    }
    println!("sent {n} frames in {:.1}s", start.elapsed().as_secs_f32());
}
