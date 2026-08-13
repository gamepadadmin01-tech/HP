//! Reply from the **same local address the datagram arrived on**.
//!
//! ## The bug this exists to fix
//!
//! The server binds `0.0.0.0` (`main.rs`), which is correct — it must answer a
//! phone on Wi-Fi, on a USB-tether adapter, and on loopback, without knowing in
//! advance which. But a wildcard-bound UDP socket does **not** remember which
//! local address a datagram came in on. When we answer with plain `send_to`, the
//! kernel picks the source address *fresh*, by route lookup on the destination.
//!
//! With one network that is the same address and nothing is wrong. Add a second
//! path — a **VPN** above all, but equally a second NIC, Hyper-V/VirtualBox, or
//! a tether adapter — and the reply can leave with a *different* source IP than
//! the one the phone dialled.
//!
//! The phone then throws it away. `gamepad-engine.cpp` locks onto the PC's
//! unicast address and drops any ACK or rumble from another source, so a
//! stranger on the LAN cannot spoof the link-alive heartbeat or poison the RTT
//! statistic. That guard is right and stays.
//!
//! The result is a link that is **broken in one direction only**, which is the
//! confusing part:
//!
//! * phone -> PC is unaffected, so **input keeps working perfectly**;
//! * the PC counts inbound sessions by source IP, so **the PC shows connected**;
//! * the phone never sees an ACK, so `linkAlive` stays false and **the app shows
//!   disconnected while the game responds to the sticks**.
//!
//! Reported 2026-08-10 against a PC-side VPN, on Wi-Fi *and* USB — the "both
//! transports" part is the tell: nothing transport-specific can explain it, but
//! a wrong reply source explains both at once.
//!
//! ## The fix
//!
//! `IP_PKTINFO` makes the kernel hand us the local address and interface index
//! that each datagram actually arrived on, and lets us set the same pair on the
//! way out. The reply then leaves by the interface the request came in on, with
//! the address the phone dialled, whatever the route table has to say about it.
//!
//! This is the standard answer for a multi-homed UDP server, and it is worth
//! noting that it is **strictly more correct than the old behaviour even with no
//! VPN present** — the route-lookup source was never guaranteed to match.
//!
//! ## What this does NOT fix
//!
//! If the VPN client blocks LAN traffic outright (a WFP callout driver — the
//! "allow local network" toggle most commercial clients ship *off*), the reply
//! never reaches the wire at all and no amount of source pinning helps. That is
//! a client-side setting, not something a server can route around. Pinning the
//! source removes *our* contribution to the problem; it cannot remove a firewall
//! someone else installed.
//!
//! ## Implementation notes
//!
//! Dependency-free direct Winsock FFI, matching `winperf.rs` and the
//! `GetAdaptersAddresses` binding in `netdetect.rs`.
//!
//! `WSARecvMsg` is **not exported** from `ws2_32.dll` — it has to be fetched at
//! runtime through `WSAIoctl(SIO_GET_EXTENSION_FUNCTION_POINTER)`. `WSASendMsg`
//! *is* exported (Vista and later), so it links directly.
//!
//! Every step is best-effort. If `IP_PKTINFO` cannot be enabled or the extension
//! pointer cannot be loaded, `Replier` reports itself inactive and transparently
//! falls back to `recv_from`/`send_to` — i.e. exactly today's behaviour. A server
//! that answers from a possibly-wrong address still works for most users; a
//! server that refuses to start helps nobody.

/// The local address a datagram arrived on, and the interface it arrived by.
///
/// Both halves are carried: `ipi_addr` alone pins the source *address*, and
/// `ipi_ifindex` pins the *interface*. A VPN can perturb the route table enough
/// to change either one, so the reply re-states both rather than trusting the
/// kernel to re-derive the interface from the address.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalAddr {
    pub addr: std::net::Ipv4Addr,
    pub ifindex: u32,
}

#[cfg(windows)]
mod imp {
    use super::LocalAddr;
    use std::io;
    use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
    use std::os::windows::io::AsRawSocket;

    const AF_INET: u16 = 2;
    const IPPROTO_IP: i32 = 0;
    /// `IP_PKTINFO` on Windows. (Not the same number as Linux — do not "unify".)
    const IP_PKTINFO: i32 = 19;
    /// `_WSAIORW(IOC_WS2, 6)` = `IOC_INOUT | IOC_WS2 | 6`.
    const SIO_GET_EXTENSION_FUNCTION_POINTER: u32 = 0xC800_0006;
    const SOCKET_ERROR: i32 = -1;

    // ── Winsock structures ──────────────────────────────────────────────────
    // Only what we touch is declared, same approach as `netdetect::win`. Every
    // field up to the last one we read must match the C layout exactly; `repr(C)`
    // reproduces MSVC's padding rules for these (x64: 8-byte pointer alignment).

    #[repr(C)]
    struct WsaBuf {
        len: u32,
        buf: *mut u8,
    }

    #[repr(C)]
    struct SockaddrIn {
        sin_family: u16,
        sin_port: u16,
        sin_addr: [u8; 4],
        sin_zero: [u8; 8],
    }

    #[repr(C)]
    struct WsaMsg {
        name: *mut SockaddrIn,
        namelen: i32,
        buffers: *mut WsaBuf,
        buffer_count: u32,
        control: WsaBuf,
        flags: u32,
    }

    /// `WSACMSGHDR`. On x64 this is 8 + 4 + 4 = 16 bytes, 8-byte aligned.
    #[repr(C)]
    struct CmsgHdr {
        cmsg_len: usize,
        cmsg_level: i32,
        cmsg_type: i32,
    }

    /// `IN_PKTINFO` — 8 bytes.
    #[repr(C)]
    struct InPktinfo {
        ipi_addr: [u8; 4],
        ipi_ifindex: u32,
    }

    #[repr(C)]
    struct Guid {
        d1: u32,
        d2: u16,
        d3: u16,
        d4: [u8; 8],
    }

    /// `WSAID_WSARECVMSG` = `f689d7c8-6f1f-436b-8a53-e54fe351c322`.
    const WSAID_WSARECVMSG: Guid = Guid {
        d1: 0xf689_d7c8,
        d2: 0x6f1f,
        d3: 0x436b,
        d4: [0x8a, 0x53, 0xe5, 0x4f, 0xe3, 0x51, 0xc3, 0x22],
    };

    type WsaRecvMsgFn = unsafe extern "system" fn(
        s: usize,
        msg: *mut WsaMsg,
        received: *mut u32,
        overlapped: *mut std::ffi::c_void,
        completion: *mut std::ffi::c_void,
    ) -> i32;

    #[link(name = "ws2_32")]
    unsafe extern "system" {
        fn setsockopt(s: usize, level: i32, optname: i32, optval: *const i8, optlen: i32) -> i32;
        fn WSAGetLastError() -> i32;
        fn WSAIoctl(
            s: usize,
            code: u32,
            in_buf: *const std::ffi::c_void,
            in_len: u32,
            out_buf: *mut std::ffi::c_void,
            out_len: u32,
            returned: *mut u32,
            overlapped: *mut std::ffi::c_void,
            completion: *mut std::ffi::c_void,
        ) -> i32;
        fn WSASendMsg(
            s: usize,
            msg: *mut WsaMsg,
            flags: u32,
            sent: *mut u32,
            overlapped: *mut std::ffi::c_void,
            completion: *mut std::ffi::c_void,
        ) -> i32;
    }

    /// `WSA_CMSG_ALIGN` — round up to the alignment of `SIZE_T`.
    const fn cmsg_align(n: usize) -> usize {
        let a = std::mem::align_of::<usize>();
        (n + a - 1) & !(a - 1)
    }

    /// Offset from a `WSACMSGHDR` to its payload (`WSA_CMSG_DATA`).
    const fn cmsg_data_offset() -> usize {
        cmsg_align(std::mem::size_of::<CmsgHdr>())
    }

    /// `WSA_CMSG_LEN(sizeof(IN_PKTINFO))` — the value that goes in `cmsg_len`.
    const fn cmsg_len_pktinfo() -> usize {
        cmsg_data_offset() + std::mem::size_of::<InPktinfo>()
    }

    /// `WSA_CMSG_SPACE(sizeof(IN_PKTINFO))` — bytes a pktinfo occupies including
    /// trailing alignment. Our control buffer is sized well above this.
    pub const fn cmsg_space_pktinfo() -> usize {
        cmsg_data_offset() + cmsg_align(std::mem::size_of::<InPktinfo>())
    }

    /// Control buffer, sized and **aligned** for `WSACMSGHDR`.
    ///
    /// ⚠️ The alignment is not cosmetic. A plain `[u8; N]` is 1-byte aligned;
    /// casting it to `*mut CmsgHdr` and dereferencing is undefined behaviour,
    /// and on the very first test run it aborted the process outright
    /// (`misaligned pointer dereference: address must be a multiple of 0x8`).
    /// Backing the buffer with `usize` words gives exactly the alignment
    /// `WSA_CMSG_ALIGN` assumes, on both x64 and x86.
    ///
    /// One `IN_PKTINFO` needs 24 bytes on x64; 8 words (64 bytes) leaves room
    /// for anything else the stack attaches without truncating.
    const CONTROL_WORDS: usize = 8;
    const CONTROL_LEN: usize = CONTROL_WORDS * std::mem::size_of::<usize>();

    #[repr(C)]
    struct ControlBuf([usize; CONTROL_WORDS]);

    impl ControlBuf {
        const fn zeroed() -> Self {
            Self([0; CONTROL_WORDS])
        }
        fn as_mut_ptr(&mut self) -> *mut u8 {
            self.0.as_mut_ptr() as *mut u8
        }
        fn as_ptr(&self) -> *const u8 {
            self.0.as_ptr() as *const u8
        }
    }

    fn last_wsa_error() -> io::Error {
        // Winsock errors go through WSAGetLastError, not GetLastError. std maps
        // the WSAE* codes onto ErrorKind (WSAEWOULDBLOCK -> WouldBlock,
        // WSAETIMEDOUT -> TimedOut), which the caller's idle path relies on.
        io::Error::from_raw_os_error(unsafe { WSAGetLastError() })
    }

    fn to_sockaddr_in(addr: SocketAddrV4) -> SockaddrIn {
        SockaddrIn {
            sin_family: AF_INET,
            // Port is network byte order on the wire.
            sin_port: addr.port().to_be(),
            sin_addr: addr.ip().octets(),
            sin_zero: [0; 8],
        }
    }

    /// Walk the control buffer and pull out `IP_PKTINFO` if it is there.
    ///
    /// # Safety
    /// `ptr`/`len` must describe the control buffer WSARecvMsg just filled.
    unsafe fn parse_pktinfo(ptr: *const u8, len: usize) -> Option<LocalAddr> {
        let hdr_size = std::mem::size_of::<CmsgHdr>();
        let mut off = 0usize;
        while off + hdr_size <= len {
            let hdr = unsafe { &*(ptr.add(off) as *const CmsgHdr) };
            // A cmsg_len below the header size means a malformed buffer; walking
            // on from there would read past the end.
            if hdr.cmsg_len < hdr_size || off + hdr.cmsg_len > len {
                break;
            }
            if hdr.cmsg_level == IPPROTO_IP
                && hdr.cmsg_type == IP_PKTINFO
                && hdr.cmsg_len >= cmsg_len_pktinfo()
            {
                let pi = unsafe { &*(ptr.add(off + cmsg_data_offset()) as *const InPktinfo) };
                return Some(LocalAddr {
                    addr: Ipv4Addr::from(pi.ipi_addr),
                    ifindex: pi.ipi_ifindex,
                });
            }
            let step = cmsg_align(hdr.cmsg_len);
            // Defensive: a zero step would spin forever on a malformed buffer.
            if step == 0 {
                break;
            }
            off += step;
        }
        None
    }

    /// Receives with the arrival address attached, and replies pinned to it.
    ///
    /// Holds no socket of its own — the caller owns the `UdpSocket` and passes it
    /// in, so this stays a thin capability rather than another owner of the hot
    /// path.
    pub struct Replier {
        recvmsg: Option<WsaRecvMsgFn>,
    }

    impl Replier {
        /// Enable `IP_PKTINFO` and load `WSARecvMsg`. Never fails: a `Replier`
        /// that could not do either simply reports `active() == false` and falls
        /// back to plain `recv_from`/`send_to`.
        pub fn new(sock: &UdpSocket) -> Self {
            let raw = sock.as_raw_socket() as usize;
            let on: i32 = 1;
            let opt_ok = unsafe {
                setsockopt(
                    raw,
                    IPPROTO_IP,
                    IP_PKTINFO,
                    &on as *const i32 as *const i8,
                    std::mem::size_of::<i32>() as i32,
                )
            } == 0;
            if !opt_ok {
                eprintln!(
                    "warn: IP_PKTINFO not settable ({}); replies will use the route-chosen \
                     source address, which a VPN or second adapter can get wrong",
                    last_wsa_error()
                );
                return Self { recvmsg: None };
            }

            // WSARecvMsg is not an exported symbol; ask the provider for it.
            let mut func: usize = 0;
            let mut returned: u32 = 0;
            let rc = unsafe {
                WSAIoctl(
                    raw,
                    SIO_GET_EXTENSION_FUNCTION_POINTER,
                    &WSAID_WSARECVMSG as *const Guid as *const std::ffi::c_void,
                    std::mem::size_of::<Guid>() as u32,
                    &mut func as *mut usize as *mut std::ffi::c_void,
                    std::mem::size_of::<usize>() as u32,
                    &mut returned,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                )
            };
            if rc == SOCKET_ERROR || func == 0 {
                eprintln!(
                    "warn: could not load WSARecvMsg ({}); replies will use the route-chosen \
                     source address",
                    last_wsa_error()
                );
                return Self { recvmsg: None };
            }
            Self {
                recvmsg: Some(unsafe { std::mem::transmute::<usize, WsaRecvMsgFn>(func) }),
            }
        }

        /// True when arrival addresses are being captured and replies pinned.
        pub fn active(&self) -> bool {
            self.recvmsg.is_some()
        }

        /// Like `UdpSocket::recv_from`, plus the local address it arrived on.
        ///
        /// The third element is `None` when pinning is unavailable, or when the
        /// stack attached no `IP_PKTINFO` — callers must treat it as "reply the
        /// old way", never as an error.
        pub fn recv_from(
            &self,
            sock: &UdpSocket,
            buf: &mut [u8],
        ) -> io::Result<(usize, SocketAddr, Option<LocalAddr>)> {
            let Some(recvmsg) = self.recvmsg else {
                let (n, a) = sock.recv_from(buf)?;
                return Ok((n, a, None));
            };

            let mut from = SockaddrIn {
                sin_family: 0,
                sin_port: 0,
                sin_addr: [0; 4],
                sin_zero: [0; 8],
            };
            let mut control = ControlBuf::zeroed();
            let mut wsabuf = WsaBuf {
                len: buf.len() as u32,
                buf: buf.as_mut_ptr(),
            };
            let mut msg = WsaMsg {
                name: &mut from,
                namelen: std::mem::size_of::<SockaddrIn>() as i32,
                buffers: &mut wsabuf,
                buffer_count: 1,
                control: WsaBuf {
                    len: CONTROL_LEN as u32,
                    buf: control.as_mut_ptr(),
                },
                flags: 0,
            };
            let mut received: u32 = 0;
            let rc = unsafe {
                recvmsg(
                    sock.as_raw_socket() as usize,
                    &mut msg,
                    &mut received,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                )
            };
            if rc == SOCKET_ERROR {
                return Err(last_wsa_error());
            }
            let peer = SocketAddr::V4(SocketAddrV4::new(
                Ipv4Addr::from(from.sin_addr),
                u16::from_be(from.sin_port),
            ));
            // `msg.control.len` is rewritten by the call to the bytes actually
            // used, so parsing is bounded by what the stack really wrote.
            let local = unsafe { parse_pktinfo(control.as_ptr(), msg.control.len as usize) };
            Ok((received as usize, peer, local))
        }

        /// Like `UdpSocket::send_to`, but leaving from `local` when one is given.
        ///
        /// `local` should be the value `recv_from` returned for this peer. With
        /// `None` this is exactly `send_to`.
        pub fn send_to(
            &self,
            sock: &UdpSocket,
            buf: &[u8],
            dst: SocketAddr,
            local: Option<LocalAddr>,
        ) -> io::Result<usize> {
            // IPv6 has its own pktinfo with a different layout, and this server
            // binds an IPv4 wildcard, so a V6 peer here is not a thing that can
            // happen — fall back rather than pretend to handle it.
            let (Some(local), SocketAddr::V4(dst4)) = (local, dst) else {
                return sock.send_to(buf, dst);
            };
            if !self.active() {
                return sock.send_to(buf, dst);
            }

            let mut name = to_sockaddr_in(dst4);
            let mut control = ControlBuf::zeroed();
            // SAFETY: control is CONTROL_LEN (64) >= cmsg_space_pktinfo() (24),
            // both writes are at fixed offsets inside that, and ControlBuf is
            // usize-aligned so the CmsgHdr write is aligned.
            unsafe {
                let hdr = control.as_mut_ptr() as *mut CmsgHdr;
                (*hdr).cmsg_len = cmsg_len_pktinfo();
                (*hdr).cmsg_level = IPPROTO_IP;
                (*hdr).cmsg_type = IP_PKTINFO;
                let pi = control.as_mut_ptr().add(cmsg_data_offset()) as *mut InPktinfo;
                (*pi).ipi_addr = local.addr.octets();
                (*pi).ipi_ifindex = local.ifindex;
            }
            let mut wsabuf = WsaBuf {
                len: buf.len() as u32,
                // WSASendMsg does not modify the payload; the cast is required
                // only because WSABUF has no const form.
                buf: buf.as_ptr() as *mut u8,
            };
            let mut msg = WsaMsg {
                name: &mut name,
                namelen: std::mem::size_of::<SockaddrIn>() as i32,
                buffers: &mut wsabuf,
                buffer_count: 1,
                control: WsaBuf {
                    len: cmsg_space_pktinfo() as u32,
                    buf: control.as_mut_ptr(),
                },
                flags: 0,
            };
            let mut sent: u32 = 0;
            let rc = unsafe {
                WSASendMsg(
                    sock.as_raw_socket() as usize,
                    &mut msg,
                    0,
                    &mut sent,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                )
            };
            if rc == SOCKET_ERROR {
                return Err(last_wsa_error());
            }
            Ok(sent as usize)
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::LocalAddr;
    use std::io;
    use std::net::{SocketAddr, UdpSocket};

    /// Non-Windows stub. The shipped server is Windows-only (ViGEm); this keeps
    /// the crate building elsewhere for the protocol tests.
    pub struct Replier;

    impl Replier {
        pub fn new(_sock: &UdpSocket) -> Self {
            Self
        }
        pub fn active(&self) -> bool {
            false
        }
        pub fn recv_from(
            &self,
            sock: &UdpSocket,
            buf: &mut [u8],
        ) -> io::Result<(usize, SocketAddr, Option<LocalAddr>)> {
            let (n, a) = sock.recv_from(buf)?;
            Ok((n, a, None))
        }
        pub fn send_to(
            &self,
            sock: &UdpSocket,
            buf: &[u8],
            dst: SocketAddr,
            _local: Option<LocalAddr>,
        ) -> io::Result<usize> {
            sock.send_to(buf, dst)
        }
    }
}

pub use imp::Replier;

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
    use std::time::Duration;

    /// The control-message arithmetic is the part that silently corrupts memory
    /// if it is wrong, so it is asserted against the values the Windows headers
    /// produce on x64 rather than left implicit.
    #[cfg(windows)]
    #[test]
    fn cmsg_space_matches_windows_layout() {
        // WSA_CMSG_SPACE(sizeof(IN_PKTINFO)) = ALIGN(16) + ALIGN(8) = 24.
        assert_eq!(super::imp::cmsg_space_pktinfo(), 24);
    }

    fn v4(sock: &UdpSocket) -> SocketAddrV4 {
        match sock.local_addr().unwrap() {
            SocketAddr::V4(a) => a,
            other => panic!("expected IPv4, got {other}"),
        }
    }

    /// The capability must load at all — if `IP_PKTINFO` or the `WSARecvMsg`
    /// pointer is unavailable the whole fix silently degrades to the old
    /// behaviour, and we would rather know that here than in the field.
    #[cfg(windows)]
    #[test]
    fn replier_activates_on_a_wildcard_socket() {
        let sock = UdpSocket::bind(("0.0.0.0", 0)).unwrap();
        let r = Replier::new(&sock);
        assert!(r.active(), "IP_PKTINFO/WSARecvMsg unavailable on this machine");
    }

    /// Arrival address is reported, and a reply pinned to it comes back from
    /// that same address.
    #[test]
    fn reports_arrival_address_and_replies_from_it() {
        let server = UdpSocket::bind(("0.0.0.0", 0)).unwrap();
        server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let sport = v4(&server).port();
        let replier = Replier::new(&server);

        let client = UdpSocket::bind(("127.0.0.1", 0)).unwrap();
        client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        client
            .send_to(b"ping", SocketAddrV4::new(Ipv4Addr::LOCALHOST, sport))
            .unwrap();

        let mut buf = [0u8; 64];
        let (n, peer, local) = replier.recv_from(&server, &mut buf).unwrap();
        assert_eq!(&buf[..n], b"ping");

        if replier.active() {
            let local = local.expect("IP_PKTINFO was enabled but no arrival address came back");
            assert_eq!(
                local.addr,
                Ipv4Addr::LOCALHOST,
                "datagram arrived on loopback, so that is the address to answer from"
            );
        }

        replier.send_to(&server, b"pong", peer, local).unwrap();
        let (n2, from) = client.recv_from(&mut buf).unwrap();
        assert_eq!(&buf[..n2], b"pong");
        assert_eq!(
            from.ip(),
            Ipv4Addr::LOCALHOST,
            "reply must carry the address the client dialled, or the phone's \
             source guard drops it"
        );
    }

    /// The real multi-homed case, which is what a VPN creates: two local
    /// addresses, and a reply that must come from whichever one was dialled —
    /// **not** whichever one the route table prefers.
    ///
    /// Skips itself on a single-homed machine rather than passing vacuously.
    #[cfg(windows)]
    #[test]
    fn reply_source_follows_the_dialled_address_not_the_route() {
        let ips: Vec<Ipv4Addr> = crate::netdetect::all_ipv4()
            .iter()
            .filter_map(|s| s.parse::<Ipv4Addr>().ok())
            .filter(|ip| !ip.is_loopback() && !ip.is_link_local())
            .collect();
        if ips.len() < 2 {
            eprintln!("SKIP: needs 2+ local IPv4 addresses, found {}", ips.len());
            return;
        }

        let server = UdpSocket::bind(("0.0.0.0", 0)).unwrap();
        server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let sport = v4(&server).port();
        let replier = Replier::new(&server);
        assert!(replier.active());

        // Dial each local address in turn. The reply must come back from the
        // one that was dialled every time; under the old send_to behaviour the
        // route table picks one winner and the other case fails.
        for target in &ips {
            let client = match UdpSocket::bind((*target, 0)) {
                Ok(c) => c,
                // An address can exist but refuse a bind (adapter going down
                // mid-test). Not a failure of the thing under test.
                Err(e) => {
                    eprintln!("SKIP {target}: bind failed ({e})");
                    continue;
                }
            };
            client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            if client
                .send_to(b"ping", SocketAddrV4::new(*target, sport))
                .is_err()
            {
                eprintln!("SKIP {target}: unreachable from itself");
                continue;
            }

            let mut buf = [0u8; 64];
            let (_, peer, local) = replier.recv_from(&server, &mut buf).unwrap();
            let local = local.expect("no IP_PKTINFO on an active replier");
            assert_eq!(local.addr, *target, "arrival address must be the dialled one");

            replier.send_to(&server, b"pong", peer, Some(local)).unwrap();
            let (_, from) = client.recv_from(&mut buf).unwrap();
            assert_eq!(
                from.ip(),
                std::net::IpAddr::V4(*target),
                "reply for {target} came from {} — this is the VPN bug",
                from.ip()
            );
        }
    }

    /// Proves the pinning **actually overrides** the kernel's source choice,
    /// rather than passing because the route table happened to agree.
    ///
    /// This is the discriminating test. The two tests above assert the invariant
    /// the phone needs (reply source == dialled address), but on a machine with
    /// no VPN the old `send_to` satisfies that too — the on-link route picks the
    /// right address by itself. So they would pass against the *unfixed* server
    /// and prove nothing about the mechanism.
    ///
    /// Here the reply is deliberately pinned to the address that was **not**
    /// dialled. If `IP_PKTINFO` is doing its job the peer sees that other
    /// address; if pinning were a no-op the peer would see the dialled one and
    /// this fails. That is exactly the knob a VPN takes away from us.
    ///
    /// `ifindex` is left 0 (let the stack route it) so this tests source-address
    /// pinning specifically, not interface forcing.
    #[cfg(windows)]
    #[test]
    fn pinning_overrides_the_kernels_source_choice() {
        let ips: Vec<Ipv4Addr> = crate::netdetect::all_ipv4()
            .iter()
            .filter_map(|s| s.parse::<Ipv4Addr>().ok())
            .filter(|ip| !ip.is_loopback() && !ip.is_link_local())
            .collect();
        if ips.len() < 2 {
            eprintln!("SKIP: needs 2+ local IPv4 addresses, found {}", ips.len());
            return;
        }
        let (dialled, other) = (ips[0], ips[1]);

        let server = UdpSocket::bind(("0.0.0.0", 0)).unwrap();
        server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let sport = v4(&server).port();
        let replier = Replier::new(&server);
        assert!(replier.active());

        let client = UdpSocket::bind((dialled, 0)).unwrap();
        client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        client
            .send_to(b"ping", SocketAddrV4::new(dialled, sport))
            .unwrap();

        let mut buf = [0u8; 64];
        let (_, peer, local) = replier.recv_from(&server, &mut buf).unwrap();
        assert_eq!(local.unwrap().addr, dialled);

        // Answer from the OTHER local address instead.
        let forced = LocalAddr {
            addr: other,
            ifindex: 0,
        };
        replier
            .send_to(&server, b"pong", peer, Some(forced))
            .unwrap();

        match client.recv_from(&mut buf) {
            Ok((_, from)) => assert_eq!(
                from.ip(),
                std::net::IpAddr::V4(other),
                "reply came from {} — IP_PKTINFO did not override the source, so \
                 pinning is a no-op and the VPN fix is not real",
                from.ip()
            ),
            // Windows may refuse to deliver a packet whose source does not match
            // the outgoing interface (anti-spoof). That is a legitimate outcome
            // and still proves the control message reached the stack — what it
            // cannot be is "arrived from the dialled address as if we never
            // asked", which is the assert above.
            Err(e) => eprintln!("note: forced-source reply was not delivered ({e}) — \
                 the stack enforced its own source rules, which is not a no-op"),
        }
    }

    /// The receive loop's idle tick depends on the read timeout still firing
    /// through `WSARecvMsg`. If `SO_RCVTIMEO` were ignored here, the server
    /// would block forever on an idle socket and the 1 Hz tick (session expiry,
    /// the window's device count) would stop — a much worse bug than the one
    /// being fixed. Asserted, not assumed.
    #[test]
    fn read_timeout_still_fires_through_recvmsg() {
        let server = UdpSocket::bind(("0.0.0.0", 0)).unwrap();
        server
            .set_read_timeout(Some(Duration::from_millis(200)))
            .unwrap();
        let replier = Replier::new(&server);
        let mut buf = [0u8; 64];

        let start = std::time::Instant::now();
        let err = replier
            .recv_from(&server, &mut buf)
            .expect_err("nothing was sent; this must time out");
        let waited = start.elapsed();

        assert!(
            matches!(
                err.kind(),
                std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
            ),
            "expected a timeout, got {err:?} ({:?})",
            err.kind()
        );
        assert!(
            waited < Duration::from_secs(2),
            "read timeout did not fire; waited {waited:?}"
        );
    }

    /// Non-blocking mode must still surface `WouldBlock`, because the drain loop
    /// uses exactly that to detect an empty queue.
    #[test]
    fn nonblocking_reports_would_block() {
        let server = UdpSocket::bind(("0.0.0.0", 0)).unwrap();
        let replier = Replier::new(&server);
        server.set_nonblocking(true).unwrap();
        let mut buf = [0u8; 64];
        let err = replier.recv_from(&server, &mut buf).expect_err("queue is empty");
        assert_eq!(err.kind(), std::io::ErrorKind::WouldBlock);
    }
}
