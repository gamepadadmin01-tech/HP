//! Test harness (2026-10-05): an ENCRYPTED fake phone that plays, goes silent
//! the way a phone frozen in recents does, then comes back WITHOUT a new
//! handshake. Run against `--dry-run --key abcd1234 --port <P>`:
//!   cargo run --example resume_check -- <port> <silent_secs>
//! Prints the ACK count for each phase. Never part of the shipped binary.

use pc_server_rs::grx::{self, GrxSender};
use std::net::UdpSocket;
use std::time::{Duration, Instant};

fn frame(ts: u64) -> [u8; 20] {
    let mut f = [0u8; 20];
    f[0..8].copy_from_slice(&ts.to_le_bytes());
    f[12..16].copy_from_slice(&[128, 128, 128, 128]);
    f[16..20].copy_from_slice(&0xabcd_1234u32.to_le_bytes());
    f
}

fn acks(sock: &UdpSocket) -> usize {
    let mut n = 0;
    let mut b = [0u8; 128];
    while let Ok(k) = sock.recv(&mut b) {
        if k >= 3 && &b[..3] == b"ACK" {
            n += 1;
        }
    }
    n
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let port: u16 = args.get(1).and_then(|p| p.parse().ok()).unwrap_or(7795);
    let silent: u64 = args.get(2).and_then(|p| p.parse().ok()).unwrap_or(5);
    let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
    sock.connect(("127.0.0.1", port)).unwrap();
    sock.set_read_timeout(Some(Duration::from_millis(300))).unwrap();

    // ── handshake, exactly as GrxClient.kt does it ──
    let psk = grx::psk_from_pairing_key("abcd1234");
    let eph = grx::new_ephemeral().unwrap();
    let my_pub = x25519_dalek::PublicKey::from(&eph).to_bytes();
    let mut hello = vec![grx::T_HELLO];
    hello.extend_from_slice(&my_pub);
    hello.extend_from_slice(&(grx::GRX_LTID.len() as u32).to_le_bytes());
    hello.extend_from_slice(grx::GRX_LTID);
    sock.send(&hello).unwrap();
    let mut b = [0u8; 128];
    let n = sock.recv(&mut b).expect("no SERVER_HELLO");
    assert!(n >= 65 && b[0] == grx::T_SHELLO);
    let mut srv = [0u8; 32];
    srv.copy_from_slice(&b[1..33]);
    let keys = grx::handshake(&eph, &srv, &psk, grx::GRX_LTID, true);
    let mut confirm = vec![grx::T_CONFIRM];
    confirm.extend_from_slice(&grx::confirm_tag(&keys.confirm, &keys.transcript, grx::ROLE_CLIENT));
    sock.send(&confirm).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    sock.set_nonblocking(true).unwrap();
    let mut tx = GrxSender::new(&keys.c2s, grx::DIR_C2S);
    let t0 = Instant::now();

    let mut play = |secs: u64, label: &str| {
        let end = Instant::now() + Duration::from_secs(secs);
        let mut got = 0;
        while Instant::now() < end {
            let ts = t0.elapsed().as_nanos() as u64 + 1;
            sock.send(&tx.seal(&frame(ts)).unwrap()).unwrap();
            std::thread::sleep(Duration::from_millis(30));
            got += acks(&sock);
        }
        println!("{label}: {got} ACKs");
    };
    play(2, "playing          ");
    std::thread::sleep(Duration::from_secs(silent)); // frozen in recents
    let _ = acks(&sock);
    play(3, "back from recents");
}
