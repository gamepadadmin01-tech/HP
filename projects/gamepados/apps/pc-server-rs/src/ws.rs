//! Minimal WebSocket server for the USB-debugging transport.
//!
//! The phone dials `ws://127.0.0.1:7777`, tunnelled by `adb reverse`, and
//! streams the same 20-byte packets as UDP.
//!
//! ## Why this is hand-rolled rather than a crate
//!
//! The needed subset is tiny and the exposure is small:
//! * Python binds **127.0.0.1 only** — the adb tunnel is the only way in, so no
//!   LAN host can reach this. We bind the same.
//! * Python sets `max_size=64` — frames are 20 bytes; anything larger is
//!   invalid by definition.
//! * Only **binary** frames carry data. No TLS, no fragmentation, no text, no
//!   compression, no ping interval (`ping_interval=None`).
//!
//! Pulling `tungstenite` (+ ~11 transitive crates, or an async runtime) to move
//! 20-byte frames over a loopback socket would work against the one thing that
//! justifies this whole port: a small, dependency-light native binary. The
//! handshake and frame codec below are ~200 lines and are tested against the
//! RFC 6455 vectors.
//!
//! Everything that parses socket input is bounded: oversized frames, oversized
//! headers and unmasked client frames are rejected and close the connection
//! rather than allocating or looping.

use std::io::{Read, Write};
use std::net::TcpStream;

/// RFC 6455 handshake GUID.
const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/// Input frames are 20 bytes. The only larger thing a client may legitimately
/// send is a playtime capability ticket, which is `ticket::TICKET_LEN` (96) —
/// 32 bytes of header plus a 64-byte Ed25519 signature, and that signature size
/// is fixed by the algorithm. Raised from 64 for exactly that reason; a ticket
/// test asserts the two stay in step. Still far below the 125-byte ceiling the
/// 7-bit WebSocket length form imposes below, so this remains a tight bound.
pub const MAX_FRAME: usize = crate::ticket::TICKET_LEN;
/// Bound on the HTTP upgrade request so a garbage client can't grow our buffer.
const MAX_HEADER: usize = 8 * 1024;

// ── SHA-1 (needed only for the handshake accept key) ─────────────────────────
pub fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x6745_2301, 0xEFCD_AB89, 0x98BA_DCFE, 0x1032_5476, 0xC3D2_E1F0];
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A82_7999u32),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let tmp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = tmp;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
    }
    let mut out = [0u8; 20];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

// ── base64 encode (handshake only) ───────────────────────────────────────────
pub fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let b0 = c[0] as u32;
        let b1 = *c.get(1).unwrap_or(&0) as u32;
        let b2 = *c.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// `Sec-WebSocket-Accept` for a given `Sec-WebSocket-Key`.
pub fn accept_key(client_key: &str) -> String {
    base64_encode(&sha1(format!("{client_key}{WS_GUID}").as_bytes()))
}

/// Pull `Sec-WebSocket-Key` out of an HTTP upgrade request (case-insensitive).
pub fn parse_ws_key(request: &str) -> Option<String> {
    for line in request.lines() {
        let mut parts = line.splitn(2, ':');
        let name = parts.next()?.trim();
        if name.eq_ignore_ascii_case("Sec-WebSocket-Key") {
            return Some(parts.next()?.trim().to_string());
        }
    }
    None
}

/// The 101 response completing the handshake.
pub fn handshake_response(client_key: &str) -> String {
    format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Accept: {}\r\n\r\n",
        accept_key(client_key)
    )
}

// ── Framing ──────────────────────────────────────────────────────────────────

#[derive(Debug, PartialEq, Eq)]
pub enum Frame {
    Binary(Vec<u8>),
    Ping(Vec<u8>),
    Pong,
    Close,
    /// A frame we understand but don't act on (e.g. text).
    Ignored,
}

/// Encode a server→client frame. Server frames are never masked (RFC 6455).
/// `opcode` 2 = binary, 10 = pong, 8 = close.
pub fn encode_frame(opcode: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 4);
    out.push(0x80 | (opcode & 0x0F)); // FIN + opcode
    // We only ever send tiny frames, so the 7-bit length form always suffices.
    debug_assert!(payload.len() < 126);
    out.push(payload.len() as u8);
    out.extend_from_slice(payload);
    out
}

/// Read exactly one frame from the stream.
///
/// Returns `Ok(None)` on a clean EOF. Every length is bounded, and a client
/// frame that is not masked is a protocol violation (RFC 6455 §5.1) and is
/// rejected rather than tolerated.
pub fn read_frame(stream: &mut TcpStream) -> std::io::Result<Option<Frame>> {
    let mut hdr = [0u8; 2];
    if let Err(e) = stream.read_exact(&mut hdr) {
        return if e.kind() == std::io::ErrorKind::UnexpectedEof { Ok(None) } else { Err(e) };
    }
    let opcode = hdr[0] & 0x0F;
    let masked = hdr[1] & 0x80 != 0;
    let len7 = (hdr[1] & 0x7F) as usize;

    if !masked {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "client frame not masked (RFC 6455 violation)",
        ));
    }
    // 126/127 mean 16/64-bit extended lengths — always oversized for us.
    if len7 >= 126 || len7 > MAX_FRAME {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "frame too large",
        ));
    }

    let mut mask = [0u8; 4];
    stream.read_exact(&mut mask)?;
    let mut payload = vec![0u8; len7];
    if len7 > 0 {
        stream.read_exact(&mut payload)?;
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= mask[i & 3];
        }
    }

    Ok(Some(match opcode {
        0x2 => Frame::Binary(payload),
        0x9 => Frame::Ping(payload),
        0xA => Frame::Pong,
        0x8 => Frame::Close,
        _ => Frame::Ignored,
    }))
}

/// A read timeout, not a real failure. Windows reports `TimedOut`, Unix
/// `WouldBlock`; both mean "nothing arrived in this window".
pub fn is_timeout(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    )
}

/// Perform the HTTP upgrade. Reads until the header terminator, bounded.
pub fn handshake(stream: &mut TcpStream) -> std::io::Result<()> {
    let mut buf = Vec::with_capacity(1024);
    let mut byte = [0u8; 1];
    loop {
        if buf.len() > MAX_HEADER {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "upgrade request header too large",
            ));
        }
        let n = stream.read(&mut byte)?;
        if n == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "connection closed during handshake",
            ));
        }
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let req = String::from_utf8_lossy(&buf);

    // Reject browser pages BEFORE completing the upgrade (see `origin_allowed`).
    let origin = parse_header(&req, "origin");
    if !origin_allowed(origin) {
        // A 403 rather than a silent drop: this is a real rejection and should be
        // diagnosable from the client side too.
        let _ = stream.write_all(
            b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        let _ = stream.flush();
        eprintln!(
            "WS refused: disallowed Origin {:?} — a web page cannot claim a gamepad",
            origin.unwrap_or("<none>")
        );
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "disallowed Origin",
        ));
    }

    let key = parse_ws_key(&req).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "no Sec-WebSocket-Key")
    })?;
    stream.write_all(handshake_response(&key).as_bytes())?;
    stream.flush()
}

/// The origin the real Android client presents.
///
/// The app loads its UI through `WebViewAssetLoader`, which serves from this
/// fixed virtual host. **Captured from the real phone (1.3.22 / code 46) on
/// 2026-07-21**, not assumed.
const ANDROID_ASSET_ORIGIN: &str = "https://appassets.androidplatform.net";

/// Case-insensitive header lookup out of a raw request.
fn parse_header<'a>(req: &'a str, name: &str) -> Option<&'a str> {
    req.lines()
        .find(|l| {
            l.split_once(':')
                .is_some_and(|(k, _)| k.trim().eq_ignore_ascii_case(name))
        })
        .and_then(|l| l.split_once(':'))
        .map(|(_, v)| v.trim())
}

/// Is this peer allowed to become a controller?
///
/// ## The hole this closes
///
/// The WS bridge listens on loopback and previously trusted **anything** that
/// completed a handshake: no token, no origin check. Because browsers allow
/// WebSocket connections to `127.0.0.1` from any site, **any web page a user
/// visited could open `ws://127.0.0.1:7777`, be handed a virtual Xbox 360 pad,
/// and inject input into whatever they were playing.**
///
/// This was not theoretical — it is how the bug was found. A stale controller-UI
/// preview page (`Origin: http://localhost:5174`) sitting in a desktop app's
/// webview held a pad and streamed ~240 neutral frames/sec with **no phone
/// attached**, which is what made the server window report a phantom
/// "Connected devices: 1". Inherited from Python, where `server.py:1155`
/// acquires the pad on connect and line 1161 unpacks the auth field then
/// discards it.
///
/// ## Why Origin, and not the auth token
///
/// The obvious fix — validate the token like the UDP path does — does not work
/// here: the client sends a **hardcoded `0xABCD1234`** (`controller-ui`
/// `App.tsx:1134`), identical for every user and every install. It is a format
/// marker, not a secret, so checking it would reject nothing while risking every
/// wired user. Fixing that properly means a real per-install token on both ends,
/// which is an Android release, not a server patch.
///
/// `Origin` works today because browsers **set it themselves** — it is a
/// forbidden header that page JavaScript cannot override. So a web page cannot
/// pretend to be the Android WebView.
///
/// ## Deliberately still allowed
///
/// Absent / `null` / `file://` origins pass. Non-browser clients send no Origin,
/// and older app builds loaded their UI from `file://` (the pre-1.3.1 layout).
/// Allowing these costs nothing against the threat being addressed: a web page's
/// Origin is *always* its real http(s) URL, so it can never land in this bucket.
///
/// ## What this does NOT fix
///
/// A **native** local process can forge any header, so this is not authentication.
/// It closes the realistic, remote-triggered vector — a visited web page — and
/// leaves the local-malware case, which already implies an attacker with far more
/// capability than a virtual gamepad. Real auth needs the token work above.
pub fn origin_allowed(origin: Option<&str>) -> bool {
    match origin {
        None => true,
        Some(o) => {
            let o = o.trim();
            if o.is_empty() || o.eq_ignore_ascii_case("null") || o.starts_with("file://") {
                return true;
            }
            // Any real web origin is refused unless it is exactly the Android
            // asset loader. Compared case-insensitively on the whole value:
            // scheme and host are case-insensitive, and there is no path here.
            o.eq_ignore_ascii_case(ANDROID_ASSET_ORIGIN)
        }
    }
}

// ── The bridge ───────────────────────────────────────────────────────────────

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::net::{PadSink, Server};

/// Rumble poll interval — matches `server.py`'s `await asyncio.sleep(0.05)`.
const RUMBLE_POLL: Duration = Duration::from_millis(50);

/// How long the reader blocks before checking liveness. Short enough that a dead
/// peer is noticed promptly, long enough to cost nothing while idle.
const READ_TIMEOUT: Duration = Duration::from_millis(250);

/// Tear the connection down after this long with no *input* frame.
///
/// ⚠️ THIS EXISTS BECAUSE OF A REAL GHOST PAD (2026-07-21). An `adb reverse`
/// tunnel can leave the server's socket **Established** after the phone app is
/// gone — the FIN never arrives. With a plain blocking read the reader thread
/// parks forever, the session is never torn down, and its virtual pad stays
/// plugged into Windows indefinitely. Observed directly: app force-stopped, UDP
/// session correctly reaped, `usb:1` and its pad still alive minutes later.
/// A lingering pad squats an XInput slot and pushes the next real phone to
/// player 2, which games ignore.
///
/// Slightly longer than the session `DROP_AFTER` (3 s) so the normal idle path
/// gets to reap first; this is the backstop for a socket that lies about being
/// open.
const WS_IDLE_TIMEOUT: Duration = Duration::from_secs(5);

static WS_CONN_SEQ: AtomicU64 = AtomicU64::new(0);

/// Live WS connections (handshake completed, not yet torn down). This is the
/// "wired link" count: a phone parked on the dashboard holds a connection but
/// no session, and it must still show as a connected device — see the comment
/// at the `LinkGuard` in `serve_conn`.
static WS_LIVE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Number of live wired links, for the status window. A link that also owns a
/// session is still ONE device — the tick in `main.rs` therefore adds this to
/// the *UDP-only* session count, never to `sessions.count()`.
pub fn live_links() -> usize {
    WS_LIVE.load(Ordering::Relaxed)
}

/// Start the USB-debugging WebSocket bridge on a background thread.
///
/// Binds **127.0.0.1 only** (same as Python): the phone reaches it through
/// `adb reverse tcp:7777`, so no LAN host can connect.
///
/// ⚠️ The server grants a virtual pad **per open socket**. That is exactly where
/// the 2026-07-21 double-pad bug lived — a phone with a live UDP/tether session
/// that also opens a WebSocket gets TWO pads. The client-side transport
/// coordinator is what guarantees only one transport is active at a time; this
/// side must simply free its pad promptly on disconnect, which it does.
pub fn start_ws_bridge<S>(server: Arc<Mutex<Server<S>>>, port: u16)
where
    S: PadSink + Send + 'static,
{
    std::thread::spawn(move || {
        let listener = match std::net::TcpListener::bind(("127.0.0.1", port)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("WS bridge: cannot bind 127.0.0.1:{port} ({e}) — USB-debugging transport disabled");
                return;
            }
        };
        println!("  ws      : listening on 127.0.0.1:{port} (USB-debugging via adb reverse)");
        for conn in listener.incoming() {
            match conn {
                Ok(stream) => {
                    let srv = Arc::clone(&server);
                    std::thread::spawn(move || {
                        if let Err(e) = serve_conn(stream, srv) {
                            let k = e.kind();
                            if k != std::io::ErrorKind::UnexpectedEof
                                && k != std::io::ErrorKind::ConnectionAborted
                                && k != std::io::ErrorKind::ConnectionReset
                            {
                                eprintln!("WS connection ended: {e}");
                            }
                        }
                    });
                }
                Err(e) => eprintln!("WS accept failed: {e}"),
            }
        }
    });
}

fn serve_conn<S>(mut stream: std::net::TcpStream, server: Arc<Mutex<Server<S>>>) -> std::io::Result<()>
where
    S: PadSink + Send + 'static,
{
    // Small frames must not sit in Nagle's buffer — same reason server.py sets
    // TCP_NODELAY on this socket.
    let _ = stream.set_nodelay(true);
    // Bound the handshake too: a peer that connects and then says nothing would
    // otherwise park this thread forever. On loopback, anything that cannot
    // complete an upgrade within this is not a real client.
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    // Writes must be bounded as well. Since sessionless links are now KEPT and
    // probed with pings, a peer that stops reading would otherwise fill both
    // TCP buffers and park this thread inside `write_all` — the A8b thread-park
    // again, just slower. A timed-out write errors out and runs the teardown.
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    handshake(&mut stream)?;

    let seq = WS_CONN_SEQ.fetch_add(1, Ordering::Relaxed) + 1;
    let key = format!("usb:{seq}");
    println!("WS connected: {key}");

    // Count this link for the WHOLE connection lifetime, session or not. The
    // phone keeps this socket open on EVERY screen (the same contract Python
    // documents in server.py:1143-1146) — the standing connection IS the
    // "wired link", and the window's device count must include a phone that is
    // linked but not currently streaming input. The guard decrements on every
    // exit path, panics included.
    WS_LIVE.fetch_add(1, Ordering::Relaxed);
    struct LinkGuard;
    impl Drop for LinkGuard {
        fn drop(&mut self) {
            WS_LIVE.fetch_sub(1, Ordering::Relaxed);
        }
    }
    let _link = LinkGuard;

    // One writer shared by the recv loop (ACK) and the rumble thread (RMB).
    let writer = Arc::new(Mutex::new(stream.try_clone()?));

    // Rumble pump: polls this session's motors and pushes RMB, sustaining while
    // non-zero plus one final zero to stop — same contract as UDP and Python.
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let rumble_handle = {
        let srv = Arc::clone(&server);
        let w = Arc::clone(&writer);
        let stop = Arc::clone(&stop);
        let key = key.clone();
        std::thread::spawn(move || {
            let mut last = (255u8, 255u8); // impossible => first real value always sends
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(RUMBLE_POLL);
                let cur = {
                    let mut s = match srv.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    match s.sessions.get(&key).map(|x| x.slot) {
                        Some(slot) => s.sink.rumble(slot),
                        None => (0, 0),
                    }
                };
                if cur != (0, 0) || last != (0, 0) {
                    last = cur;
                    let frame = encode_frame(0x2, &[b'R', b'M', b'B', cur.0, cur.1]);
                    let mut g = match w.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    if g.write_all(&frame).is_err() {
                        return;
                    }
                }
            }
        })
    };

    // A dead peer must not be able to block here forever (see WS_IDLE_TIMEOUT).
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));

    // Receive loop.
    let mut last_frame = Instant::now();
    // Playtime enforcement for THIS connection. Inert until the phone presents
    // a ticket, which is what lets this version ship ahead of the app that uses
    // it — see the rollout note in ticket.rs.
    let mut gate = crate::ticket::TicketGate::new();
    // Paces the liveness pings sent to an idle-but-sessionless link (see the
    // idle branch below). Without this, once idle the ping would fire on every
    // 250 ms read-timeout tick instead of once per WS_IDLE_TIMEOUT.
    let mut last_ping = Instant::now();
    let result = (|| -> std::io::Result<()> {
        loop {
            // Playtime. Checked every pass rather than only when idle, because a
            // phone that has run out of time is usually still streaming input —
            // waiting for it to go quiet would never cut it off. Returning here
            // runs the normal teardown below, which frees the pad immediately.
            //
            // ⚠️ THIS LOOP CARRIES INPUT FRAMES. `armed()` is a plain bool read
            // and MUST stay first: it short-circuits before Instant::now(),
            // which is a clock syscall (QueryPerformanceCounter on Windows).
            // Written the other way round it cost a syscall on every single
            // button press, for a gate that is inert on every build shipped so
            // far. Order matters here; do not "simplify" it.
            if gate.armed() && gate.expired(Instant::now()) {
                println!("playtime: no fresh ticket — ending session");
                return Ok(());
            }
            let frame = match read_frame(&mut stream) {
                Ok(f) => f,
                Err(e) if is_timeout(&e) => {
                    // No data this window. What idleness means depends on
                    // whether this connection owns a session:
                    //
                    // * **Holds a pad** → silence is the A8b ghost condition (a
                    //   half-open adb socket squatting an XInput slot). Tear
                    //   down and free the pad.
                    // * **No pad** → this is the phone's STANDING link. The app
                    //   keeps the socket open on every screen and only streams
                    //   input from the controller screen — Python documents
                    //   exactly this (server.py:1143-1146). Closing it here was
                    //   the 2026-07-21 churn bug: connect → idle 5 s → close →
                    //   reconnect, forever, and the device count flickered 0.
                    //
                    //   A sessionless link still must not be immortal (the SAME
                    //   half-open adb socket, before any input, would park this
                    //   thread for the life of the process). So probe it with a
                    //   WS ping: a live phone's WebSocket stack auto-answers
                    //   with a pong (refreshing `last_frame` below), while a
                    //   dead tunnel eventually fails the write, and that error
                    //   path runs the normal teardown.
                    if last_frame.elapsed() > WS_IDLE_TIMEOUT {
                        let holds_pad = server
                            .lock()
                            .map(|s| s.sessions.get(&key).is_some())
                            // Poisoned server mutex = the other side panicked;
                            // closing is the only sane option.
                            .unwrap_or(true);
                        if holds_pad {
                            println!(
                                "WS idle {:.0}s with no input — closing (frees the pad)",
                                last_frame.elapsed().as_secs_f32()
                            );
                            return Ok(());
                        }
                        if last_ping.elapsed() >= WS_IDLE_TIMEOUT {
                            last_ping = Instant::now();
                            let frame = encode_frame(0x9, b"lnk");
                            let mut g = writer
                                .lock()
                                .map_err(|_| std::io::Error::other("writer mutex poisoned"))?;
                            g.write_all(&frame)?;
                        }
                    }
                    continue;
                }
                Err(e) => return Err(e),
            };
            match frame {
                None | Some(Frame::Close) => return Ok(()),
                Some(Frame::Binary(payload)) => {
                    last_frame = Instant::now();
                    if payload.len() != crate::wire::PAYLOAD_SIZE {
                        // Not input. Everything here used to be discarded, so a
                        // ticket check costs the input path exactly nothing —
                        // a 20-byte frame never reaches this branch at all.
                        match gate.offer(&payload, Instant::now()) {
                            Ok(t) => {
                                println!(
                                    "playtime: ticket accepted (seq {}, {}s)",
                                    t.seq,
                                    t.ttl.as_secs()
                                );
                            }
                            // Not a ticket either — same as before: ignore it.
                            Err(crate::ticket::Reject::NotATicket) => {}
                            Err(e) => {
                                // A ticket that failed verification is a real
                                // signal, not noise: either a forgery or a
                                // resumed zombie session.
                                println!("playtime: ticket rejected ({e:?})");
                            }
                        }
                        continue; // not an input frame
                    }
                    let replies = {
                        let mut s = server
                            .lock()
                            .map_err(|_| std::io::Error::other("server mutex poisoned"))?;
                        s.handle_ws_frame(&key, &payload, Instant::now())
                    };
                    if let Some(ack) = replies.ack {
                        let frame = encode_frame(0x2, &ack);
                        let mut g = writer
                            .lock()
                            .map_err(|_| std::io::Error::other("writer mutex poisoned"))?;
                        g.write_all(&frame)?;
                    }
                }
                Some(Frame::Ping(p)) => {
                    // A ping proves the peer is alive, so it refreshes liveness —
                    // but it is NOT input, so it must not refresh the session's
                    // last_seen (that would keep a pad alive for an idle phone).
                    last_frame = Instant::now();
                    let frame = encode_frame(0xA, &p); // pong
                    if let Ok(mut g) = writer.lock() {
                        g.write_all(&frame)?;
                    }
                }
                Some(Frame::Pong) | Some(Frame::Ignored) => last_frame = Instant::now(),
            }
        }
    })();

    // Free THIS phone's pad immediately on disconnect — waiting for the idle
    // watchdog would leave a ghost pad squatting an XInput slot, which pushes
    // the next real phone to player 2 (games only read player 1).
    stop.store(true, Ordering::Relaxed);
    if let Ok(mut s) = server.lock() {
        if let Some(sess) = s.sessions.remove(&key) {
            s.sink.release(sess.slot);
            println!("WS disconnected: {key} (active={})", s.sessions.count());
        }
    }
    let _ = rumble_handle.join();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Origin policy (A18) ─────────────────────────────────────────────────
    // Both the allowed and the refused value below were CAPTURED LIVE on
    // 2026-07-21, not invented: the phone (1.3.22/code 46) over adb-reverse, and
    // a stale controller-UI page in a desktop webview.

    #[test]
    fn the_real_phone_origin_is_allowed() {
        assert!(origin_allowed(Some("https://appassets.androidplatform.net")));
    }

    #[test]
    fn a_web_page_cannot_claim_a_gamepad() {
        // The exact origin that was holding a phantom pad when this was found.
        assert!(!origin_allowed(Some("http://localhost:5174")));
        // ...and the general case: any site the user might visit.
        assert!(!origin_allowed(Some("https://example.com")));
        assert!(!origin_allowed(Some("http://127.0.0.1:3000")));
        assert!(!origin_allowed(Some("https://appassets.androidplatform.net.evil.com")));
    }

    #[test]
    fn non_browser_and_legacy_clients_still_connect() {
        // Native clients send no Origin at all.
        assert!(origin_allowed(None));
        assert!(origin_allowed(Some("")));
        // Older app builds served their UI from file:// (pre-1.3.1 layout).
        assert!(origin_allowed(Some("null")));
        assert!(origin_allowed(Some("file://")));
    }

    #[test]
    fn origin_match_is_case_insensitive_on_scheme_and_host() {
        assert!(origin_allowed(Some("HTTPS://AppAssets.AndroidPlatform.NET")));
    }

    #[test]
    fn header_lookup_is_case_insensitive_and_trims() {
        let req = concat!(
            "GET / HTTP/1.1
",
            "Host: x
",
            "OrIgIn:   https://a.b  
",
            "
"
        );
        assert_eq!(parse_header(req, "origin"), Some("https://a.b"));
        assert_eq!(parse_header(req, "missing"), None);
    }

    use super::*;

    /// Standard SHA-1 vectors — if these are wrong the handshake silently fails.
    #[test]
    fn sha1_matches_known_vectors() {
        let hex = |b: [u8; 20]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
        assert_eq!(hex(sha1(b"")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(hex(sha1(b"abc")), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(
            hex(sha1(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
            "84983e441c3bd26ebaae4aa1f95129e5e54670f1"
        );
        // Multi-block input (>64 bytes) exercises the chunk loop.
        assert_eq!(
            hex(sha1(&[b'a'; 1000])),
            "291e9a6c66994949b57ba5e650361e98fc36b1ba"
        );
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    /// THE canonical RFC 6455 §1.3 example. If this passes, real clients connect.
    #[test]
    fn accept_key_matches_rfc6455_example() {
        assert_eq!(
            accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    #[test]
    fn parses_key_from_a_real_upgrade_request() {
        let req = "GET / HTTP/1.1\r\n\
                   Host: 127.0.0.1:7777\r\n\
                   Upgrade: websocket\r\n\
                   Connection: Upgrade\r\n\
                   Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
                   Sec-WebSocket-Version: 13\r\n\r\n";
        assert_eq!(parse_ws_key(req).as_deref(), Some("dGhlIHNhbXBsZSBub25jZQ=="));
        // Header names are case-insensitive per HTTP.
        let lower = req.replace("Sec-WebSocket-Key", "sec-websocket-key");
        assert_eq!(parse_ws_key(&lower).as_deref(), Some("dGhlIHNhbXBsZSBub25jZQ=="));
        assert_eq!(parse_ws_key("GET / HTTP/1.1\r\n\r\n"), None);
        let resp = handshake_response("dGhlIHNhbXBsZSBub25jZQ==");
        assert!(resp.starts_with("HTTP/1.1 101 Switching Protocols\r\n"));
        assert!(resp.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
        assert!(resp.ends_with("\r\n\r\n"));
    }

    #[test]
    fn server_frames_are_unmasked_with_correct_header() {
        // ACK is 11 bytes: "ACK" + u64 timestamp.
        let f = encode_frame(0x2, b"ACK\x01\x02\x03\x04\x05\x06\x07\x08");
        assert_eq!(f[0], 0x82, "FIN + binary opcode");
        assert_eq!(f[1], 11, "length, no mask bit (server must not mask)");
        assert_eq!(&f[2..], b"ACK\x01\x02\x03\x04\x05\x06\x07\x08");
        // RMB is 5 bytes.
        let r = encode_frame(0x2, b"RMB\xC8\x20");
        assert_eq!(r[1], 5);
    }
}
