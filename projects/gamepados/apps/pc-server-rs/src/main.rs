//! GamepadOS PC server (Rust) — the full server: UDP + WebSocket + GRX,
//! ViGEm output, pairing QR, and the status window (v2.0.1).
//!
//! Proven in real use 2026-07-21: several hours of continuous F1 gameplay
//! against a real phone. The Python server is the documented rollback,
//! preserved byte-verified at `releases/archive/pc-server-python-2026-07-21/`.
//!
//! Default launch (no flags) opens the window and drives real pads. `--dry-run`
//! is the test harness mode: headless, no ViGEm, exempt from the singleton
//! guard — see `parse_args`.
//!
//! ⚠️ Only ONE process may bind UDP 7777 — two servers on one port would mean
//! two virtual pads (the exact 2026-07-21 double-pad bug). The singleton mutex
//! (`singleton.rs`) enforces this against both Rust and Python instances.

// GUI subsystem: launching from a shortcut/Explorer must open ONLY the server
// window — a console flashing up next to it reads as broken to users. The
// consequences are handled explicitly:
//   * Dev terminal: `attach_parent_console()` below re-attaches stdout/stderr,
//     so `cargo run`-style use still prints.
//   * Redirected launches (regression-check.sh, Start-Process with
//     -RedirectStandardOutput): the inherited handles are non-NULL, so prints
//     land in the file exactly as before — the test harness is unaffected.
//   * Plain Explorer launch: prints go nowhere (Rust discards writes to the
//     NULL handle), which is why every FATAL path below ALSO raises a
//     MessageBox — an error a user can't see is an app that "just doesn't open".
#![cfg_attr(windows, windows_subsystem = "windows")]

use std::net::UdpSocket;
use std::time::{Duration, Instant};

use pc_server_rs::net::{AuthConfig, NullSink, Server};

const DEFAULT_PORT: u16 = 7777;
const IDLE_TICK: Duration = Duration::from_secs(1);
/// Read timeout — bounds how long we block before servicing the idle tick.
const READ_TIMEOUT: Duration = Duration::from_millis(200);

#[derive(Clone)]
struct Args {
    port: u16,
    /// None = load/create the persisted pairing key (the normal path).
    key: Option<u32>,
    lan_ip: Option<String>,
    tether_subnets: Vec<String>,
    dry_run: bool,
    verbose: bool,
    /// Disable the USB-debugging WebSocket bridge (UDP only).
    no_ws: bool,
    /// Skip printing the pairing QR (pointless over USB tether).
    no_qr: bool,
    /// Show the server window. Default ON — that is how the shipped exe is
    /// launched (a shortcut, no console). `--dry-run` forces it OFF, because
    /// every automated test drives that mode and must not spawn windows.
    gui: bool,
}

fn usage() -> ! {
    eprintln!(
        "\
GamepadOS PC server (Rust) — UDP transport, Phase 2

USAGE:
  pc-server-rs --dry-run [OPTIONS]

OPTIONS:
All options are OPTIONAL — with no arguments the server auto-detects its LAN
IP and USB-tether adapters, and reuses the persisted pairing key.

  --port <N>           UDP port to bind (default {DEFAULT_PORT})
  --key <HEX>          override the pairing token (default: the persisted key
                       shared with the Python server, so paired phones keep
                       working without a re-scan)
  --lan-ip <IP>        override LAN IPv4 detection
  --tether-subnet <P>  override USB-tether detection, e.g. 10.66.39 (repeatable)
  --no-ws              disable the USB-debugging WebSocket bridge
  --no-qr              don't print the pairing QR (unnecessary over USB tether)
  --no-gui             run headless, with no server window (implied by
                       --dry-run; the window is otherwise shown by default)
  --dry-run            exercise the protocol WITHOUT creating a virtual pad
  --verbose            log every accepted frame
  -h, --help           this text

Without --dry-run this drives a real virtual Xbox 360 pad via ViGEmBus.
UDP transport only: the Python server still owns WebSocket/AOA/GRX, and only
one process may bind udp/7777 at a time."
    );
    std::process::exit(2)
}

fn parse_args() -> Args {
    let mut a = Args {
        port: DEFAULT_PORT,
        key: None,
        lan_ip: None,
        tether_subnets: Vec::new(),
        dry_run: false,
        verbose: false,
        no_ws: false,
        no_qr: false,
        gui: true,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--port" => {
                a.port = it.next().and_then(|v| v.parse().ok()).unwrap_or_else(|| usage())
            }
            "--key" => {
                let v = it.next().unwrap_or_else(|| usage());
                a.key = Some(
                    u32::from_str_radix(v.trim_start_matches("0x"), 16)
                        .unwrap_or_else(|_| usage()),
                )
            }
            "--lan-ip" => a.lan_ip = it.next(),
            "--tether-subnet" => a.tether_subnets.push(it.next().unwrap_or_else(|| usage())),
            "--dry-run" => a.dry_run = true,
            "--no-ws" => a.no_ws = true,
            "--no-qr" => a.no_qr = true,
            "--no-gui" => a.gui = false,
            "--verbose" => a.verbose = true,
            "-h" | "--help" => usage(),
            other => {
                eprintln!("unknown argument: {other}");
                usage()
            }
        }
    }
    // `--dry-run` ALWAYS implies headless, regardless of flag order. Every
    // automated test drives dry-run (tools/regression-check.sh starts three of
    // them), and a test run that opens windows — or worse, blocks waiting for an
    // event loop on a headless CI box — is useless.
    if a.dry_run {
        a.gui = false;
    }
    a
}

/// Keep only the NEWEST input frame per source address. Non-20-byte datagrams
/// (GRX handshake/encrypted frames) are ignored here — the Python server still
/// owns those transports.
/// Largest frame the drain carries: a GRX-encrypted input frame (41 B).
/// Handshake frames are bigger but are never coalesced — see below.
const MAX_INPUT_FRAME: usize = pc_server_rs::grx::WIRE_LEN;

/// One coalesced input frame: peer address, payload, payload length, and the
/// **local address it arrived on**.
///
/// That last field is what makes the reply leave by the same interface the
/// request came in on. Without it a wildcard-bound socket answers from whatever
/// source the route table picks, which a VPN or a second adapter can get wrong —
/// and the phone drops ACKs that do not come from the address it dialled. See
/// `pktinfo` for the whole story.
type Frame = (
    std::net::SocketAddr,
    [u8; MAX_INPUT_FRAME],
    usize,
    Option<pc_server_rs::pktinfo::LocalAddr>,
);

/// Keep only the NEWEST input frame per source.
///
/// Accepts both the 20-byte cleartext frame and the 41-byte GRX frame, since
/// both are "current input" and only the newest matters. **Handshake frames are
/// deliberately excluded** — they are a state machine, not a sample, so
/// coalescing them would drop a HELLO or CONFIRM and stall the session forever.
fn upsert(
    latest: &mut Vec<Frame>,
    addr: std::net::SocketAddr,
    data: &[u8],
    local: Option<pc_server_rs::pktinfo::LocalAddr>,
) {
    let n = data.len();
    if n != pc_server_rs::wire::PAYLOAD_SIZE && n != pc_server_rs::grx::WIRE_LEN {
        return;
    }
    let mut b = [0u8; MAX_INPUT_FRAME];
    b[..n].copy_from_slice(data);
    // Match on IP (not full addr): a phone's source PORT can change, but it is
    // still the same device and must not occupy two entries in one batch.
    if let Some(e) = latest.iter_mut().find(|(a, _, _, _)| a.ip() == addr.ip()) {
        e.0 = addr;
        e.1 = b;
        e.2 = n;
        // Refresh the arrival address too: a phone that roams between adapters
        // (Wi-Fi -> tether) keeps its IP for a moment but must be answered on
        // the interface the NEWEST frame came in on.
        e.3 = local;
    } else {
        latest.push((addr, b, n, local));
    }
}

/// Re-attach to the parent process's console, if there is one.
///
/// A `windows_subsystem = "windows"` binary starts with NULL std handles. When
/// launched from a terminal, AttachConsole(ATTACH_PARENT_PROCESS) wires them to
/// that terminal so println!/eprintln! appear. When launched from Explorer there
/// is no parent console and the call fails — silently, by design. Crucially it
/// does NOT clobber handles that are already valid, so output redirected by a
/// parent (the regression runner) keeps flowing to the redirect target.
#[cfg(windows)]
fn attach_parent_console() {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn AttachConsole(dwProcessId: u32) -> i32;
    }
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

/// Modal error box for the paths a windowless launch would otherwise swallow.
/// Mirrors the Python server, which used tkinter messageboxes for the same two
/// cases (already-running, driver missing).
#[cfg(windows)]
fn message_box(title: &str, text: &str) {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, utype: u32) -> i32;
    }
    const MB_ICONINFORMATION: u32 = 0x40;
    let wide = |s: &str| -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() };
    let (t, c) = (wide(text), wide(title));
    // SAFETY: both buffers are valid null-terminated UTF-16 for the call's duration.
    unsafe {
        MessageBoxW(0, t.as_ptr(), c.as_ptr(), MB_ICONINFORMATION);
    }
}

#[cfg(not(windows))]
fn message_box(_title: &str, _text: &str) {}

fn main() -> std::io::Result<()> {
    #[cfg(windows)]
    attach_parent_console();

    let args = parse_args();

    // Single-instance guard FIRST — before the bind, so a duplicate launch gets
    // the real reason instead of a confusing "port in use". This also shares its
    // mutex name with the Python server and the Inno installer; see
    // `singleton.rs` before changing anything about it.
    //
    // `--dry-run` is deliberately EXEMPT. The guard exists to stop two servers
    // fighting over a virtual pad and udp/7777; a dry-run server creates no pad
    // and binds a spare port. Without this exemption `tools/regression-check.sh`
    // — which starts dry-run servers on 7788/7789/7794 — would fail outright
    // whenever the real server happened to be running, turning the regression
    // suite into something you can only run on an idle machine.
    if !args.dry_run
        && pc_server_rs::singleton::claim() == pc_server_rs::singleton::Claim::AlreadyRunning
    {
        let msg = "Gamepad Server is already running.\n\n\
                   Find its existing window (the one showing the QR code) — there's \
                   no need to open it a second time.";
        eprintln!("{msg}");
        // A shortcut launch has no console, so the eprintln above is invisible
        // there — without this box a second double-click looks like the app
        // silently refusing to open.
        message_box("Gamepad Server", msg);
        // Exit 0, not an error: this is the guard working as designed, and a
        // non-zero code would make the installer's post-install launch look
        // like a failed install.
        return Ok(());
    }

    let sock = UdpSocket::bind(("0.0.0.0", args.port)).map_err(|e| {
        eprintln!(
            "bind 0.0.0.0:{} failed: {e}\n\
             Is the Python server already running? Only one process may own this port.",
            args.port
        );
        e
    })?;
    sock.set_read_timeout(Some(READ_TIMEOUT))?;

    // ── Socket/process tuning (see winperf.rs) ───────────────────────────────
    // NOTE: this did NOT fix the RTT jitter it was written for — drain-to-newest
    // did (see `upsert`). What remains is kept for robustness (buffer sizing,
    // priority) and for untested Wi-Fi QoS (DSCP), not for latency.
    let prio_ok = pc_server_rs::winperf::set_high_priority();
    let (rcv_ok, snd_ok, tos_ok) = pc_server_rs::winperf::tune_socket(&sock);

    // Auto-detect what wasn't passed explicitly, so the server runs with no
    // flags at all. An explicit flag always wins (useful for testing).
    let auto_detect_tether = args.tether_subnets.is_empty();
    let lan_ip = args
        .lan_ip
        .clone()
        .unwrap_or_else(pc_server_rs::netdetect::lan_ip);
    let tether_subnets = if auto_detect_tether {
        pc_server_rs::netdetect::tether_subnets()
    } else {
        args.tether_subnets.clone()
    };

    // Pairing key: reuse the SAME persisted key the Python server uses, so a
    // phone that is already paired keeps working with no re-scan.
    let (key_hex, key_hash) = match args.key {
        Some(k) => (format!("{k:08x}"), k),
        None => {
            let k = pc_server_rs::pairing::load_or_create_key().unwrap_or_else(|e| {
                eprintln!("FATAL: {e}");
                std::process::exit(1);
            });
            let h = pc_server_rs::pairing::expected_hash(&k).unwrap_or_else(|| {
                eprintln!("FATAL: pairing key {k} is not valid hex");
                std::process::exit(1);
            });
            (k, h)
        }
    };

    // Ask the OS for the mask on OUR LAN address instead of assuming /24. On a
    // wider LAN (a /20 campus range, say) the /24 guess declares same-wire peers
    // "off-LAN", and off-LAN is the branch that accepts auth token 0 — see
    // `net::is_offlan`. None here simply restores the old /24 behaviour.
    let lan_prefix_len = pc_server_rs::netdetect::prefix_len_for(&lan_ip);

    let auth = AuthConfig {
        expected_hash: key_hash,
        lan_ip: Some(lan_ip.clone()),
        lan_prefix_len,
        tether_subnets: tether_subnets.clone(),
    };

    println!(
        "GamepadOS Rust server ({}) on udp/{}",
        if args.dry_run { "DRY RUN — no virtual pad" } else { "ViGEm virtual pad" },
        args.port
    );
    println!(
        "  pairing : {} {}",
        if args.key.is_some() { "(from --key)".to_string() } else { pc_server_rs::pairing::key_path().display().to_string() },
        if args.key.is_some() { String::new() } else { format!("[{} chars]", key_hex.len()) }
    );
    let qr_payload = pc_server_rs::pairing::qr_payload(&lan_ip, args.port, &key_hex);
    println!("  qr      : {qr_payload}");
    println!(
        "  lan-ip  : {lan_ip} {}",
        if args.lan_ip.is_some() { "(from --lan-ip)" } else { "(auto-detected)" }
    );
    println!(
        "  tether  : {:?} {}",
        tether_subnets,
        if auto_detect_tether { "(auto-detected)" } else { "(from --tether-subnet)" }
    );
    println!(
        "  tuning  : highprio={} rcvbuf={} sndbuf={} dscp={}",
        prio_ok, rcv_ok, snd_ok, tos_ok
    );

    // GRX bootstraps off the EXISTING pairing key — both ends already hold it
    // (it's in the QR), so enabling encrypted input needs no pairing change.
    // A phone without GRX simply never handshakes and the legacy cleartext path
    // runs unchanged, so this is safe to leave on.
    let grx_psk = pc_server_rs::grx::psk_from_pairing_key(&key_hex);
    println!("  grx     : enabled (encrypted input; legacy cleartext still accepted)");

    // Print the scannable code unless suppressed. A phone on Wi-Fi CANNOT pair
    // any other way: manual connect sends auth token 0, which is only accepted
    // from an off-LAN or tether source. Over USB tether this is unnecessary,
    // which is why it can be turned off.
    if !args.no_qr {
        match pc_server_rs::qr::render(&qr_payload) {
            Some(code) => {
                println!("\nScan with GamepadOS on your phone (Wi-Fi pairing):\n");
                println!("{code}");
            }
            None => eprintln!("warn: could not render the pairing QR"),
        }
    }

    // Status bridge: written by the server loop, read by the window. Lock-free
    // by design — see `status.rs`.
    let status = pc_server_rs::status::Status::new();

    if !args.gui {
        // Headless: the server owns the main thread, exactly as before the GUI
        // existed. This is the path every test and script uses.
        return start_server(sock, auth, grx_psk, args, auto_detect_tether, status);
    }

    // GUI mode. eframe must own the main thread (platform event loops require
    // it), so the server moves to a worker.
    {
        let status_srv = std::sync::Arc::clone(&status);
        let args_srv = args.clone();
        std::thread::Builder::new()
            .name("gamepad-server".into())
            .spawn(move || {
                if let Err(e) =
                    start_server(sock, auth, grx_psk, args_srv, auto_detect_tether, status_srv)
                {
                    eprintln!("server thread stopped: {e}");
                }
            })
            .expect("could not start the server thread");
    }

    if let Err(e) = pc_server_rs::ui::run(status, qr_payload, key_hex, lan_ip) {
        // A window failure must NOT take the server down — a running gamepad
        // with no window still works, and is far better than no gamepad. This
        // is the headless fallback rather than an exit.
        eprintln!("{e}\nContinuing without a window; the server is still running.");
        loop {
            std::thread::sleep(Duration::from_secs(3600));
        }
    }

    // The window closed. Exit the PROCESS, not just the event loop: the server
    // runs on a detached thread that would otherwise keep the process (and the
    // singleton mutex, and udp/7777) alive invisibly. That leak is the 1.1.17
    // "already running" bug, and with the mutex in place it would now block the
    // next launch outright.
    std::process::exit(0);
}

/// Build the output sink and run the receive loop.
///
/// Split out of `main` so the GUI and headless paths share ONE implementation —
/// the alternative is two copies of the sink selection that silently drift.
fn start_server(
    sock: UdpSocket,
    auth: AuthConfig,
    grx_psk: [u8; 32],
    args: Args,
    auto_detect_tether: bool,
    status: std::sync::Arc<pc_server_rs::status::Status>,
) -> std::io::Result<()> {
    // `run` is generic over the sink, so each variant is monomorphised — no
    // dynamic dispatch on the packet path.
    if args.dry_run {
        println!("  NOTE    : decodes + ACKs real phone traffic; drives nothing.");
        let mut srv = Server::new(NullSink::default(), auth);
        srv.grx_psk = Some(grx_psk);
        run(sock, srv, &args, auto_detect_tether, status)
    } else {
        #[cfg(windows)]
        {
            let sink = match pc_server_rs::vigem::ViGEmSink::connect() {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("FATAL: {e}");
                    eprintln!("Install ViGEmBus, or pass --dry-run to test the protocol only.");
                    // Windowless launch would otherwise just... not open. The
                    // installer normally installs ViGEmBus, so a user seeing
                    // this either declined the driver or removed it.
                    message_box(
                        "Gamepad Server",
                        "The controller driver (ViGEmBus) is not installed, so no \
                         virtual gamepad can be created.\n\nReinstall Gamepad Server \
                         to restore the driver, then launch again.",
                    );
                    std::process::exit(1);
                }
            };
            println!("  ViGEmBus : connected — a virtual Xbox 360 pad appears per phone.");
            let mut srv = Server::new(sink, auth);
            srv.grx_psk = Some(grx_psk);
            run(sock, srv, &args, auto_detect_tether, status)
        }
        #[cfg(not(windows))]
        {
            eprintln!("FATAL: virtual pads require Windows + ViGEmBus. Use --dry-run.");
            std::process::exit(1);
        }
    }
}

/// The receive loop. Generic over the sink so the dry-run and ViGEm builds
/// share exactly one implementation — no risk of the tested path and the real
/// path drifting apart.
fn run<S: pc_server_rs::net::PadSink + Send + 'static>(
    sock: UdpSocket,
    server: Server<S>,
    args: &Args,
    auto_detect_tether: bool,
    status: std::sync::Arc<pc_server_rs::status::Status>,
) -> std::io::Result<()> {
    // UDP and the WebSocket bridge MUST share one Server: `MAX_PADS` is global
    // and a phone can switch transports, so two independent pad managers would
    // hand out two virtual pads for one device — the double-pad bug.
    // The mutex is uncontended in practice (~20 ns) and is taken once per drained
    // batch, not per datagram, so it does not show up in the handle-time figures.
    let shared = std::sync::Arc::new(std::sync::Mutex::new(server));
    if !args.no_ws {
        // The tunnel must exist before the phone can dial ws://127.0.0.1.
        pc_server_rs::adbreverse::start_adb_reverse_watcher(args.port);
        pc_server_rs::ws::start_ws_bridge(std::sync::Arc::clone(&shared), args.port);
    }
    run_udp(sock, shared, args, auto_detect_tether, status)
}

fn run_udp<S: pc_server_rs::net::PadSink + Send + 'static>(
    sock: UdpSocket,
    shared: std::sync::Arc<std::sync::Mutex<Server<S>>>,
    args: &Args,
    auto_detect_tether: bool,
    status: std::sync::Arc<pc_server_rs::status::Status>,
) -> std::io::Result<()> {
    // The loop is bound and about to serve; the window can stop saying so.
    status.set_running(true);
    // Re-scan tether adapters periodically so plugging the cable in AFTER the
    // server started still enables keyless pairing. 5 s matches the cache
    // interval the Python server uses; doing it on the 1 Hz tick would just be
    // needless syscalls.
    const DETECT_EVERY: Duration = Duration::from_secs(5);
    let mut last_detect = Instant::now();
    let mut buf = [0u8; 2048];
    let mut last_tick = Instant::now();
    let mut last_report = Instant::now();
    // ── Self-instrumentation (the Phase 0 lesson applied to the server) ──────
    // Measures OUR share of the round-trip: from the moment recv_from returns a
    // packet to the moment the ACK has been handed to the kernel. If this is
    // tens of microseconds, the remaining RTT is USB/IP stack + phone, and
    // further server micro-optimisation buys nothing — better to know than to
    // guess. `drained` tracks how many datagrams were queued behind the newest,
    // which is the direct signal of whether we are falling behind.
    let mut handle_ns: Vec<u64> = Vec::with_capacity(8192);
    let mut drained_total: u64 = 0;
    let mut drained_max: usize = 0;
    // Reused across batches — no per-packet allocation on the hot path.
    let mut latest: Vec<Frame> = Vec::with_capacity(8);
    // Handshake frames collected during a drain. They are a state machine, not a
    // sample, so they are processed individually and never coalesced.
    let mut handshakes: Vec<(
        std::net::SocketAddr,
        Vec<u8>,
        Option<pc_server_rs::pktinfo::LocalAddr>,
    )> = Vec::new();

    // Capture each datagram's arrival address so every reply can leave from it.
    // Falls back to plain recv_from/send_to if the OS will not play along, so
    // this can only make the reply path more correct, never less.
    let replier = pc_server_rs::pktinfo::Replier::new(&sock);
    println!(
        "  replies : {}",
        if replier.active() {
            "pinned to the arrival address (VPN/multi-adapter safe)"
        } else {
            "route-chosen source — a VPN or second adapter may break the phone's ACK path"
        }
    );

    loop {
        match replier.recv_from(&sock, &mut buf) {
            Ok((n, addr, local)) => {
                // ── DRAIN TO NEWEST (matches server.py `latest[ip] = ...`) ────
                // CRITICAL FOR LATENCY, measured 2026-07-21: processing and
                // ACKing every queued datagram made the phone's RTT read ~3.5 ms
                // with bumps to 4.5, versus ~2.45 ms solid for the Python server.
                // The phone recomputes its RTT EMA on EVERY ack it receives, so
                // ACKing a backlog of already-stale packets drags that average
                // up — each old frame reports the time it spent queued.
                // Only the newest frame per source is real "current input"
                // anyway, so we keep that and silently discard the rest.
                latest.clear();
                handshakes.clear();
                if pc_server_rs::grx::is_handshake(&buf[..n]) {
                    handshakes.push((addr, buf[..n].to_vec(), local));
                } else {
                    upsert(&mut latest, addr, &buf[..n], local);
                }
                sock.set_nonblocking(true).ok();
                loop {
                    match replier.recv_from(&sock, &mut buf) {
                        Ok((n2, a2, l2)) => {
                            if pc_server_rs::grx::is_handshake(&buf[..n2]) {
                                handshakes.push((a2, buf[..n2].to_vec(), l2));
                            } else {
                                upsert(&mut latest, a2, &buf[..n2], l2);
                            }
                        }
                        Err(_) => break, // WouldBlock: queue drained
                    }
                }
                sock.set_nonblocking(false).ok();

                let t_start = Instant::now();
                let now = t_start;
                let drained = latest.len();
                let mut server = shared
                    .lock()
                    .map_err(|_| std::io::Error::other("server mutex poisoned"))?;
                // Handshakes first: a CONFIRM in the same batch as input must be
                // applied before that input, or the session isn't established yet
                // and the frames are dropped.
                for (a, hsdata, local) in handshakes.iter() {
                    let r = server.handle_datagram(hsdata, *a, now);
                    if let Some(hs) = &r.hs {
                        let _ = replier.send_to(&sock, hs, *a, *local);
                    }
                }
                for (a, data, len, local) in latest.iter() {
                    let data = &data[..*len];
                    let replies = server.handle_datagram(data, *a, now);
                    // Rumble first, ACK last — same order as the Python server,
                    // so the pad write is never delayed behind the ACK syscall.
                    //
                    // Every reply goes back out from `local`, the address this
                    // phone's frame arrived on. The phone drops anything from a
                    // different source (its anti-spoof guard), so answering from
                    // a route-chosen address is the same as not answering.
                    if let Some(hs) = &replies.hs {
                        let _ = replier.send_to(&sock, hs, *a, *local);
                    }
                    if let Some(rmb) = replies.rmb {
                        let _ = replier.send_to(&sock, &rmb, *a, *local);
                    }
                    if let Some(ack) = replies.ack {
                        let _ = replier.send_to(&sock, &ack, *a, *local);
                    }
                    if args.verbose && replies.ack.is_some() {
                        println!("frame from {a} -> ACK (batch of {drained})");
                    }
                }
                drop(server);
                if handle_ns.len() < 8192 {
                    handle_ns.push(t_start.elapsed().as_nanos() as u64);
                }
                drained_total += drained as u64;
                if drained > drained_max {
                    drained_max = drained;
                }
            }
            Err(e) => {
                // Read timeout is the normal idle path, not an error.
                let k = e.kind();
                if k != std::io::ErrorKind::WouldBlock && k != std::io::ErrorKind::TimedOut {
                    eprintln!("recv error: {e}");
                }
            }
        }

        let now = Instant::now();
        if now.duration_since(last_tick) >= IDLE_TICK {
            last_tick = now;
            if let Ok(mut s) = shared.lock() {
                s.idle_tick(now);
                // Publish the live device count for the window. Done HERE, on
                // the tick we already hold the lock for, so the GUI costs the
                // input path nothing.
                //
                // Devices = UDP sessions + live wired links. A wired phone is
                // its standing WS connection (open on every app screen), NOT
                // its session — a phone parked on the dashboard has a link but
                // no session yet, and must still count. Using sessions.count()
                // here was the "phone connected but window shows 0" bug: it
                // both missed linked-idle phones and would double-count a
                // streaming one against live_links().
                status.set_devices(s.sessions.udp_count() + pc_server_rs::ws::live_links());
            }
        }
        if auto_detect_tether && now.duration_since(last_detect) >= DETECT_EVERY {
            last_detect = now;
            let fresh = pc_server_rs::netdetect::tether_subnets();
            if let Ok(mut s) = shared.lock() {
                if fresh != s.auth.tether_subnets {
                    println!("tether adapters changed: {:?}", fresh);
                    s.auth.tether_subnets = fresh;
                }
            }
        }
        if now.duration_since(last_report) >= Duration::from_secs(5) {
            last_report = now;
            let snap = shared.lock().ok().map(|s| s.telemetry());
            if let Some(t) = snap {
              if t.packets_ok > 0 || t.packets_rejected > 0 {
                let grx = if t.grx_established > 0 || t.grx_ok > 0 {
                    format!(" grx=[established={} ok={} dropped={}]",
                            t.grx_established, t.grx_ok, t.grx_dropped)
                } else {
                    String::new()
                };
                println!(
                    "sessions={} {:?} ok={} stale={} rejected={} pad_writes={}{}",
                    t.sessions, t.clients, t.packets_ok, t.packets_stale,
                    t.packets_rejected, t.pad_writes, grx
                );
                if !handle_ns.is_empty() {
                    handle_ns.sort_unstable();
                    let n = handle_ns.len();
                    let pct = |q: f64| handle_ns[((n as f64 * q) as usize).min(n - 1)];
                    let sum: u64 = handle_ns.iter().sum();
                    println!(
                        "  our handle time: n={} avg={:.1}us p50={:.1}us p95={:.1}us max={:.1}us  \
                         | batches drained: avg={:.2} max={}",
                        n,
                        sum as f64 / n as f64 / 1000.0,
                        pct(0.50) as f64 / 1000.0,
                        pct(0.95) as f64 / 1000.0,
                        *handle_ns.last().unwrap() as f64 / 1000.0,
                        drained_total as f64 / n as f64,
                        drained_max
                    );
                    handle_ns.clear();
                    drained_total = 0;
                    drained_max = 0;
                }
              }
            }
        }
    }
}
