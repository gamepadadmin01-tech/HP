//! Windows socket tuning. Dependency-free (direct `extern "system"` to
//! ws2_32/kernel32) so the server pulls in no crates for this.
//!
//! ## ⚠️ HONEST RESULT: this module did NOT fix what it was written for
//!
//! It was added on 2026-07-21 to chase RTT jitter (bumps to 3.5-4.6 ms against
//! a ~2.4 ms floor). **Measured: no difference.** The real cause was
//! architectural — the server was ACKing every queued datagram instead of
//! draining to the newest, and the phone recomputes its RTT average on every
//! ACK it receives. See `upsert()` in `main.rs`.
//!
//! `timeBeginPeriod(1)` was therefore **REMOVED**, not kept "just in case": it
//! is a SYSTEM-WIDE setting that raises the timer interrupt rate for the whole
//! machine (a real power cost on a laptop) and it bought us nothing measurable.
//! Do not re-add it without a measurement that justifies it.
//!
//! What remains is kept for reasons **independent of that failed latency
//! hypothesis** — each is justified below on its own terms. Nothing here is
//! retained on a vague "might help".
//!
//! Each call is best-effort: a failure is logged and ignored, never fatal.

#[cfg(windows)]
mod imp {
    use std::net::UdpSocket;
    use std::os::windows::io::AsRawSocket;

    // NOTE: winmm/timeBeginPeriod(1) deliberately absent — see the module docs.
    // It changed nothing measurable and costs the whole machine a higher timer
    // interrupt rate. Removed rather than carried as cargo cult.

    // ── kernel32: process priority ──────────────────────────────────────────
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentProcess() -> isize;
        fn SetPriorityClass(hProcess: isize, dwPriorityClass: u32) -> i32;
        fn GetCurrentThread() -> isize;
        fn SetThreadPriority(hThread: isize, nPriority: i32) -> i32;
        fn SetProcessInformation(
            hProcess: isize,
            class: i32,
            info: *const core::ffi::c_void,
            size: u32,
        ) -> i32;
    }
    const ABOVE_NORMAL_PRIORITY_CLASS: u32 = 0x0000_8000;
    const THREAD_PRIORITY_HIGHEST: i32 = 2;
    /// PROCESS_INFORMATION_CLASS::ProcessPowerThrottling.
    const PROCESS_POWER_THROTTLING: i32 = 4;
    const PROCESS_POWER_THROTTLING_CURRENT_VERSION: u32 = 1;
    const PROCESS_POWER_THROTTLING_EXECUTION_SPEED: u32 = 0x1;

    #[repr(C)]
    struct PowerThrottlingState {
        version: u32,
        control_mask: u32,
        state_mask: u32,
    }

    // ── ws2_32: socket options ──────────────────────────────────────────────
    #[link(name = "ws2_32")]
    unsafe extern "system" {
        fn setsockopt(s: usize, level: i32, optname: i32, optval: *const i8, optlen: i32) -> i32;
    }
    const SOL_SOCKET: i32 = 0xffff;
    const SO_SNDBUF: i32 = 0x1001;
    const SO_RCVBUF: i32 = 0x1002;
    const IPPROTO_IP: i32 = 0;
    const IP_TOS: i32 = 3;

    /// Run at ABOVE_NORMAL priority.
    ///
    /// JUSTIFICATION (not latency): this is a soft-realtime input path. Under heavy
    /// background load a normal-priority receive loop can be preempted mid-burst,
    /// which drops datagrams rather than merely delaying them.
    ///
    /// WAS HIGH_PRIORITY_CLASS, and that was too aggressive. HIGH sits ABOVE a
    /// foreground game — games generally run at NORMAL, and Windows' foreground boost
    /// does not close a whole priority class — so a background input server was
    /// outranking the very game it exists to feed. Users reported the server
    /// interfering with the PC while gaming, and that is the mechanism.
    ///
    /// It was never load-bearing anyway: the call site in main.rs records that this
    /// did NOT fix the RTT jitter it was written for (drain-to-newest did) and is kept
    /// "for robustness, not for latency". ABOVE_NORMAL still keeps the receive loop
    /// ahead of ordinary background work, which is all the justification above asks
    /// for, without competing with the foreground.
    pub fn set_high_priority() -> bool {
        let ok = unsafe { SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS) } != 0;
        if !ok {
            eprintln!("warn: SetPriorityClass(ABOVE_NORMAL) failed; expect RTT jitter under load");
        }
        ok
    }

    /// Opt this process OUT of Windows 11's background power throttling
    /// ("EcoQoS"), added 2026-10-05.
    ///
    /// The server spends almost all its time minimised or hidden behind the
    /// game, which is exactly when Windows may decide it is background work and
    /// run it on slow, power-saving cores at low clock. For a process whose
    /// whole job is to pass a button press on within a millisecond, that is the
    /// wrong call. Setting EXECUTION_SPEED in the control mask with the state
    /// bit OFF is Microsoft's documented way to say "never throttle me". This is
    /// per-process, not a system setting, and ends with the process.
    pub fn disable_power_throttling() -> bool {
        let state = PowerThrottlingState {
            version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            control_mask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            state_mask: 0,
        };
        let ok = unsafe {
            SetProcessInformation(
                GetCurrentProcess(),
                PROCESS_POWER_THROTTLING,
                &state as *const PowerThrottlingState as *const core::ffi::c_void,
                std::mem::size_of::<PowerThrottlingState>() as u32,
            )
        } != 0;
        if !ok {
            eprintln!("note: could not opt out of power throttling (older Windows?)");
        }
        ok
    }

    /// Raise the CALLING thread (the UDP receive loop) to HIGHEST, added
    /// 2026-10-05. The process stays ABOVE_NORMAL (see `set_high_priority` for
    /// why it must not be HIGH): this thread sleeps in recv almost all the
    /// time, so raising it costs the game nothing, but when a packet lands it
    /// runs at once instead of queueing behind other background threads.
    pub fn raise_receive_thread() -> bool {
        unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST) != 0 }
    }

    fn set_opt(sock: &UdpSocket, level: i32, name: i32, val: i32) -> bool {
        let raw = sock.as_raw_socket() as usize;
        let rc = unsafe {
            setsockopt(
                raw,
                level,
                name,
                &val as *const i32 as *const i8,
                std::mem::size_of::<i32>() as i32,
            )
        };
        rc == 0
    }

    /// Socket tuning. Both kept for reasons independent of the failed latency
    /// hypothesis:
    ///
    /// * **1 MB receive buffer — ROBUSTNESS, not latency.** The phone bursts up
    ///   to ~1000 packets/sec. With the small default buffer, datagrams that
    ///   arrive while we are between `recv_from` calls are *dropped by the
    ///   kernel*, which is silent input loss. Python sizes this up for the same
    ///   reason. Justified even though it did not move RTT.
    /// * **DSCP EF (0xB8) — for Wi-Fi, which we have NOT tested.** All latency
    ///   measurements so far were over USB tether, where there is no contention
    ///   and QoS marking is irrelevant. The phone already marks its uplink; on a
    ///   congested access point an unmarked return path is treated as bulk
    ///   traffic. Cheap and one line — but note it is currently an *untested*
    ///   justification, not a measured one.
    pub fn tune_socket(sock: &UdpSocket) -> (bool, bool, bool) {
        const BUF: i32 = 1024 * 1024;
        let rcv = set_opt(sock, SOL_SOCKET, SO_RCVBUF, BUF);
        let snd = set_opt(sock, SOL_SOCKET, SO_SNDBUF, BUF);
        // DSCP EF (46) << 2 = 0xB8, matching applyLowLatencyTos() on the phone.
        let tos = set_opt(sock, IPPROTO_IP, IP_TOS, 0xB8);
        if !rcv || !snd {
            eprintln!("warn: socket buffer sizing failed (rcv={rcv} snd={snd})");
        }
        if !tos {
            // Windows often blocks IP_TOS unless a QoS policy is configured.
            // Harmless: the phone still marks its own uplink.
            eprintln!("note: IP_TOS/DSCP not settable (normal on Windows without a QoS policy)");
        }
        (rcv, snd, tos)
    }
}

#[cfg(not(windows))]
mod imp {
    use std::net::UdpSocket;
    
    pub fn set_high_priority() -> bool { false }
    pub fn disable_power_throttling() -> bool { false }
    pub fn raise_receive_thread() -> bool { false }
    pub fn tune_socket(_s: &UdpSocket) -> (bool, bool, bool) { (false, false, false) }
}

pub use imp::{disable_power_throttling, raise_receive_thread, set_high_priority, tune_socket};
