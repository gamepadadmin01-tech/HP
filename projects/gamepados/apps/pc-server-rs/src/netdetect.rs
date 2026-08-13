//! Standalone network detection — removes the need for `--lan-ip` and
//! `--tether-subnet` flags.
//!
//! Two jobs, both ported faithfully from `server.py`:
//!
//! 1. **`lan_ip()`** — which IPv4 goes in the pairing QR. Must prefer a real
//!    private LAN address over a VPN tunnel or virtual adapter, otherwise QR
//!    pairing breaks whenever a VPN is connected (the real bug that produced
//!    "USB works but QR doesn't" on this machine).
//! 2. **`tether_subnets()`** — the `/24`s belonging to our USB-tether adapters.
//!    A tether link is point-to-point (just the phone and this PC), so a
//!    token-0 client on it is as trustworthy as loopback — unlike Wi-Fi, where
//!    strangers may live. This is what makes keyless USB pairing safe.
//!
//! ⚠️ Adapters are matched by **DESCRIPTION, not name**. OEM tether adapters get
//! generic names like "Ethernet 5", which is exactly why the June 2026 tether
//! bug happened (detection keyed on the name found nothing, so tethering
//! silently never connected).

use std::net::UdpSocket;

/// Rank an IPv4 by how likely it is the address a phone should dial.
/// Mirrors `server.py::_lan_score` exactly — the ordering is load-bearing:
/// home Wi-Fi is almost always 192.168.x while VPN tunnels are almost always
/// 10.x, so 192.168 must outrank 10.x or the QR points down the tunnel.
pub fn lan_score(ip: &str) -> i32 {
    if ip.starts_with("192.168.56.") {
        return 20; // VirtualBox host-only
    }
    if ip.starts_with("192.168.") {
        return 100; // typical home LAN / Wi-Fi
    }
    for n in 16..32 {
        if ip.starts_with(&format!("172.{n}.")) {
            return 80; // private /12
        }
    }
    if ip.starts_with("10.") {
        return 60; // private, but also the common VPN tunnel range
    }
    if ip.starts_with("169.254.") {
        return 5; // APIPA / link-local
    }
    if ip == "127.0.0.1" {
        return 0;
    }
    10
}

/// True when an adapter description looks like a phone-as-network-card.
/// Mirrors `server.py::_TETHER_DESC_RE` = `NDIS|NCM|Tether|Internet Sharing`.
/// ("RNDIS" contains "NDIS", so it matches too.)
pub fn is_tether_desc(desc: &str) -> bool {
    let d = desc.to_ascii_lowercase();
    d.contains("ndis") || d.contains("ncm") || d.contains("tether") || d.contains("internet sharing")
}

/// Whole-word search, for needles too short to match as a bare substring.
///
/// "tap" must match `TAP-Windows Adapter V9` but must not fire inside an
/// unrelated word in a localised driver description. `hay` must already be
/// lowercase. Byte indexing is safe here because every needle is ASCII, so a
/// match start is always a char boundary.
fn has_word(hay: &str, needle: &str) -> bool {
    let bytes = hay.as_bytes();
    let mut from = 0usize;
    while let Some(i) = hay[from..].find(needle) {
        let s = from + i;
        let e = s + needle.len();
        let before_ok = s == 0 || !bytes[s - 1].is_ascii_alphanumeric();
        let after_ok = e == hay.len() || !bytes[e].is_ascii_alphanumeric();
        if before_ok && after_ok {
            return true;
        }
        from = s + 1;
    }
    false
}

/// True when an adapter description is a **VPN tunnel or pseudo-tunnel**.
///
/// ## Why this exists (the bug it replaces)
///
/// `lan_score` guesses "is this a tunnel?" from the IP range, on the assumption
/// that home LANs are `192.168.x` and tunnels are `10.x`. **That assumption is
/// simply false on plenty of real networks**, and it fails in the dangerous
/// direction: this very machine's Wi-Fi is `10.0.6.194/20`, so a VPN handing out
/// a `192.168.x` address *outranks the real LAN* and the pairing QR sends the
/// phone down the tunnel. If instead the VPN also lands on `10.x` the two tie,
/// and the tie-break goes to whoever holds the default route — which, with a VPN
/// up, is the VPN. The tunnel wins both ways.
///
/// The knock-on effect is not only a bad QR: `lan_ip` also feeds
/// `AuthConfig::lan_ip`, so `net::is_offlan` would compare a phone against the
/// *tunnel's* subnet, call same-wire peers off-LAN, and open the token-0 keyless
/// branch to the whole Wi-Fi. That is the hole 2.0.1 closed, re-opened by having
/// a VPN connected.
///
/// Matching on the **description** is how tether adapters are already detected
/// (`is_tether_desc`) and for the same reason: the IP tells you nothing reliable
/// about what kind of link it is, and the description does.
///
/// Tether adapters are checked first by callers and are never tunnels — a
/// USB-tethered phone is a legitimate target.
pub fn is_tunnel_desc(desc: &str) -> bool {
    let d = desc.to_ascii_lowercase();
    // A tether is a real point-to-point link to the phone, not a tunnel. Checked
    // first so no tether adapter can ever be demoted by a coincidental match.
    if is_tether_desc(&d) {
        return false;
    }
    // Generic markers. "vpn" is safe as a bare substring — it appears in
    // NordVPN/ExpressVPN/ProtonVPN and in no real NIC description.
    if d.contains("vpn")
        || d.contains("tunnel")
        // The Windows built-in VPN transports (SSTP/IKEv2/L2TP/PPTP) are all
        // "WAN Miniport (...)", as are several pseudo-adapters. None is ever a
        // valid pairing target.
        || d.contains("wan miniport")
        || d.contains("teredo")
        || d.contains("ip-https")
    {
        return true;
    }
    // Named clients, in the form they appear in Windows adapter descriptions.
    const PRODUCTS: &[&str] = &[
        "wireguard",
        "nordlynx",
        "openvpn",
        "anyconnect",
        "globalprotect",
        // Palo Alto's adapter is named for the acronym, NOT the product: the
        // string is "PANGP Virtual Ethernet Adapter" with no "GlobalProtect" in
        // it. Caught by the real-strings test, which is the argument for using
        // real strings.
        "pangp",
        "pulse secure",
        "ivanti",
        "netextender",
        "juniper",
        "forticlient",
        "fortissl",
        "check point",
        "checkpoint",
        "sonicwall",
        "zerotier",
        "tailscale",
        "hamachi",
        "softether",
        "lightway",
        "mullvad",
        "surfshark",
        "windscribe",
        "astrill",
        "proton",
        "hotspot shield",
        "private internet access",
    ];
    if PRODUCTS.iter().any(|p| d.contains(p)) {
        return true;
    }
    // Too short to be safe as substrings — "tap" would otherwise fire inside
    // ordinary words in localised descriptions.
    has_word(&d, "tap") || has_word(&d, "tun") || has_word(&d, "isatap")
}

/// True when an adapter is **virtual** — a hypervisor switch, a host-only
/// network, or a software pseudo-adapter.
///
/// Distinct from a tunnel because the failure is the same but the cause differs,
/// and because the ordering matters: a virtual adapter is a *better* fallback
/// than a VPN tunnel (at least it is local), but it must still lose to any real
/// NIC.
///
/// ⚠️ `Microsoft Wi-Fi Direct Virtual Adapter` is present on most laptops and
/// contains "Wi-Fi" — never treat "wi-fi" in a description as evidence of a real
/// wireless LAN.
///
/// The Hyper-V/WSL `vEthernet` switches are the quietly dangerous ones: they sit
/// on `172.x`, which `lan_score` ranks at 80 — **above** a real `10.x` LAN at 60.
pub fn is_virtual_desc(desc: &str) -> bool {
    let d = desc.to_ascii_lowercase();
    if is_tether_desc(&d) {
        return false;
    }
    d.contains("virtual")
        || d.contains("vethernet")
        || d.contains("hyper-v")
        || d.contains("vmware")
        || d.contains("virtualbox")
        || d.contains("host-only")
        || d.contains("loopback")
        || d.contains("npcap")
        || d.contains("kernel debug")
        || has_word(&d, "wsl")
}

/// Penalties applied on top of `lan_score`. Large enough that class always
/// dominates IP range, while ordering *within* a class still follows the
/// familiar private-range preference.
const TUNNEL_PENALTY: i32 = 1000;
const VIRTUAL_PENALTY: i32 = 500;

/// Rank an adapter by how likely its address is the one a phone should dial,
/// using the description as well as the IP.
///
/// This is what `lan_score` should have been. `lan_score` stays as the
/// documented `server.py` mirror and the fallback for when no description is
/// available (non-Windows, or the adapter enumeration failed) — degrading to the
/// old guess is fine; silently preferring a tunnel is not.
pub fn adapter_score(desc: &str, ip: &str) -> i32 {
    let base = lan_score(ip);
    if is_tether_desc(desc) {
        return base;
    }
    if is_tunnel_desc(desc) {
        return base - TUNNEL_PENALTY;
    }
    if is_virtual_desc(desc) {
        return base - VIRTUAL_PENALTY;
    }
    base
}

/// The local address the OS would use to reach the internet.
///
/// Uses the classic UDP-connect trick: `connect()` on a datagram socket only
/// selects a route, it sends nothing, so this touches the network stack but not
/// the network. No FFI, no DNS, no packets.
pub fn route_ip() -> Option<String> {
    let sock = UdpSocket::bind(("0.0.0.0", 0)).ok()?;
    sock.connect(("8.8.8.8", 80)).ok()?;
    Some(sock.local_addr().ok()?.ip().to_string())
}

/// `/24` prefix of a dotted IPv4 ("10.66.39.130" -> "10.66.39").
///
/// ⚠️ ONLY valid for genuinely-/24 networks. Prefer `same_subnet` with a real
/// prefix length; this remains for the tether case, where a phone-as-network-card
/// really is a small point-to-point /24, and as the fallback when the OS won't
/// tell us a prefix length.
pub fn slash24(ip: &str) -> Option<&str> {
    ip.rsplit_once('.').map(|(head, _)| head)
}

/// Parse a dotted IPv4 into a u32, or `None` if it isn't one.
pub fn ipv4_to_u32(ip: &str) -> Option<u32> {
    let mut n: u32 = 0;
    let mut parts = 0;
    for oct in ip.split('.') {
        let v: u32 = oct.parse().ok()?;
        if v > 255 {
            return None;
        }
        n = (n << 8) | v;
        parts += 1;
    }
    (parts == 4).then_some(n)
}

/// Are two IPv4s on the same subnet, given the prefix length in bits?
///
/// ## Why this exists
///
/// Everything here used to compare the first three octets — a hardcoded `/24`.
/// That is correct for a home router and WRONG for any larger network, and the
/// failure is silent. On a `/20` campus LAN (`10.0.0.0/20`, i.e. `10.0.0.x`
/// through `10.0.15.x`) two machines on the SAME wire routinely differ in the
/// third octet, so `/24` logic calls them strangers to each other.
///
/// That mattered in two places, in opposite directions:
///   * `is_offlan` — a phone at `10.0.9.5` and a PC at `10.0.6.194` were judged
///     "off-LAN", which is the branch that accepts auth **token 0**. So keyless
///     pairing, meant to be reachable only from loopback or a point-to-point USB
///     tether, became reachable from any peer on a big LAN. That is a real
///     weakening of the pairing check, not a cosmetic bug.
///   * session migration — "different /24" is read as "same phone changed
///     transport", so a DHCP lease that moves a phone across a /24 boundary
///     inside one LAN looks like a transport switch.
///
/// `prefix_len` of 0 matches everything and 32 matches only the exact host;
/// both are handled without shifting by 32 (which is UB in C and a panic in
/// debug Rust).
pub fn same_subnet(a: &str, b: &str, prefix_len: u8) -> bool {
    let (Some(x), Some(y)) = (ipv4_to_u32(a), ipv4_to_u32(b)) else {
        return false;
    };
    if prefix_len == 0 {
        return true;
    }
    if prefix_len >= 32 {
        return x == y;
    }
    let mask: u32 = u32::MAX << (32 - prefix_len);
    (x & mask) == (y & mask)
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;

    // Only the LEADING fields we actually walk are declared. The API fills a
    // buffer we merely read and we follow `next` explicitly, so trailing fields
    // may be omitted — but every offset up to `description` must be exact.
    // (Same approach, same field order, as the ctypes definition in server.py.)
    #[repr(C)]
    struct SockaddrIn {
        sin_family: u16,
        sin_port: u16,
        sin_addr: [u8; 4],
        sin_zero: [u8; 8],
    }

    #[repr(C)]
    struct SocketAddress {
        lp_sockaddr: *const SockaddrIn,
        i_sockaddr_length: i32,
    }

    // IP_ADAPTER_UNICAST_ADDRESS_LH. The trailing fields after `address` are
    // declared ONLY so `on_link_prefix_length` lands at the right offset — it is
    // the subnet mask the OS actually assigned, and guessing /24 instead is the
    // bug this exists to kill. Every field up to it must be exact:
    //   union{ULONGLONG}=8 | Next=8 | SOCKET_ADDRESS=16 | 3 enums (4 each)
    //   | 3 ULONG lifetimes (4 each) | UINT8 OnLinkPrefixLength
    #[repr(C)]
    struct IpAdapterUnicastAddress {
        length: u32,
        flags: u32,
        next: *const IpAdapterUnicastAddress,
        address: SocketAddress,
        prefix_origin: i32,
        suffix_origin: i32,
        dad_state: i32,
        valid_lifetime: u32,
        preferred_lifetime: u32,
        lease_lifetime: u32,
        on_link_prefix_length: u8,
    }

    #[repr(C)]
    struct IpAdapterAddresses {
        length: u32,
        if_index: u32,
        next: *const IpAdapterAddresses,
        adapter_name: *const u8,
        first_unicast: *const IpAdapterUnicastAddress,
        first_anycast: *const c_void,
        first_multicast: *const c_void,
        first_dns: *const c_void,
        dns_suffix: *const u16,
        description: *const u16,
        friendly_name: *const u16,
    }

    #[link(name = "iphlpapi")]
    unsafe extern "system" {
        fn GetAdaptersAddresses(
            family: u32,
            flags: u32,
            reserved: *const c_void,
            addresses: *mut c_void,
            size: *mut u32,
        ) -> u32;
    }

    const AF_INET: u32 = 2;
    /// skip anycast | multicast | dns. NEVER pass 0x1 — that skips UNICAST,
    /// which is the only thing we want.
    const GAA_SKIP: u32 = 0x2 | 0x4 | 0x8;
    const ERROR_BUFFER_OVERFLOW: u32 = 111;

    /// Read a NUL-terminated UTF-16 string.
    unsafe fn wide_to_string(p: *const u16) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut len = 0usize;
        while unsafe { *p.add(len) } != 0 && len < 512 {
            len += 1;
        }
        let slice = unsafe { std::slice::from_raw_parts(p, len) };
        String::from_utf16_lossy(slice)
    }

    /// Every IPv4 adapter as `(description, ip, on_link_prefix_len)`, loopback
    /// excluded. The prefix length is what the OS actually assigned — see
    /// `same_subnet` for why assuming /24 instead was a bug.
    pub fn ipv4_adapters_with_prefix() -> Vec<(String, String, u8)> {
        let mut out = Vec::new();
        let mut size: u32 = 16 * 1024;
        let mut buf: Vec<u8> = Vec::new();

        // Grow-and-retry, exactly like the Python version.
        let mut ok = false;
        for _ in 0..3 {
            buf.clear();
            buf.resize(size as usize, 0u8);
            let ret = unsafe {
                GetAdaptersAddresses(
                    AF_INET,
                    GAA_SKIP,
                    std::ptr::null(),
                    buf.as_mut_ptr() as *mut c_void,
                    &mut size,
                )
            };
            if ret == ERROR_BUFFER_OVERFLOW {
                continue; // `size` now holds the required length
            }
            if ret != 0 {
                return out;
            }
            ok = true;
            break;
        }
        if !ok {
            return out;
        }

        unsafe {
            let mut cur = buf.as_ptr() as *const IpAdapterAddresses;
            while !cur.is_null() {
                let a = &*cur;
                let mut desc = wide_to_string(a.description);
                if desc.is_empty() {
                    desc = wide_to_string(a.friendly_name);
                }
                let mut ua = a.first_unicast;
                while !ua.is_null() {
                    let u = &*ua;
                    let sa = u.address.lp_sockaddr;
                    if !sa.is_null() && (*sa).sin_family == AF_INET as u16 {
                        let o = (*sa).sin_addr;
                        let ip = format!("{}.{}.{}.{}", o[0], o[1], o[2], o[3]);
                        if !ip.starts_with("127.") {
                            // 0 or >32 means the API gave us nothing usable; the
                            // caller falls back to /24 rather than trusting it.
                            let plen = u.on_link_prefix_length;
                            out.push((desc.clone(), ip, if plen == 0 || plen > 32 { 0 } else { plen }));
                        }
                    }
                    ua = u.next;
                }
                cur = a.next;
            }
        }
        out
    }

    /// Back-compat view for callers that don't care about the prefix.
    pub fn ipv4_adapters() -> Vec<(String, String)> {
        ipv4_adapters_with_prefix().into_iter().map(|(d, i, _)| (d, i)).collect()
    }
}

#[cfg(not(windows))]
mod win {
    pub fn ipv4_adapters_with_prefix() -> Vec<(String, String, u8)> {
        Vec::new()
    }
    pub fn ipv4_adapters() -> Vec<(String, String)> {
        Vec::new()
    }
}

/// Every IPv4 adapter as `(description, ip, prefix_len)`; `prefix_len` is 0 when
/// the OS didn't report a usable one. Public so `examples/check_prefix.rs` can
/// cross-check the FFI offset against `Get-NetIPAddress`.
pub fn adapters_with_prefix() -> Vec<(String, String, u8)> {
    win::ipv4_adapters_with_prefix()
}

/// The prefix length the OS assigned to whichever adapter owns `ip`.
///
/// `None` when the address isn't found or the OS didn't report a usable prefix
/// — callers then fall back to the historical /24 behaviour, so a detection
/// failure degrades to the old semantics rather than to "everything matches".
pub fn prefix_len_for(ip: &str) -> Option<u8> {
    win::ipv4_adapters_with_prefix()
        .into_iter()
        .find(|(_d, a, p)| a == ip && *p > 0)
        .map(|(_d, _a, p)| p)
}

/// Every IPv4 the host has, best-effort.
pub fn all_ipv4() -> Vec<String> {
    let mut ips: Vec<String> = Vec::new();
    for (_desc, ip) in win::ipv4_adapters() {
        if !ips.contains(&ip) {
            ips.push(ip);
        }
    }
    // Fallback only if the adapter enumeration gave us nothing (non-Windows, or
    // the API failed) — resolving our own hostname can hit DNS, so it is not
    // worth doing when we already have the authoritative list.
    if ips.is_empty() {
        if let Some(r) = route_ip() {
            ips.push(r);
        }
    }
    ips
}

/// `/24` prefixes of our USB-tether adapters.
///
/// Called from the ~1 Hz idle tick, not per packet: the Python version needs an
/// internal 5-second cache because it is consulted on every inbound datagram,
/// but refreshing on a tick we already run is simpler and cheaper than carrying
/// a mutex-guarded global.
pub fn tether_subnets() -> Vec<String> {
    let mut out = Vec::new();
    for (desc, ip) in win::ipv4_adapters() {
        if is_tether_desc(&desc) {
            if let Some(p) = slash24(&ip) {
                let p = p.to_string();
                if !out.contains(&p) {
                    out.push(p);
                }
            }
        }
    }
    out
}

/// The IPv4 a phone on the same Wi-Fi should send UDP to (the pairing-QR
/// address).
///
/// Ranks by `adapter_score`, so a VPN tunnel or a hypervisor switch always loses
/// to a real NIC **whatever address it holds** — see `is_tunnel_desc` for why
/// ranking by IP range alone was wrong, and wrong in the permissive direction.
///
/// Ties go to the default-route address, which is right in the ordinary no-VPN
/// case where the route already IS the LAN address. Note this tie-break is only
/// reached *within* a class: with a VPN up the route belongs to the tunnel, and
/// the tunnel has already lost on class. That is deliberate — the route was the
/// signal that used to hand the tunnel the win.
pub fn lan_ip() -> String {
    let route = route_ip();

    // (description, ip). The description is the whole point, so entries that
    // have one must survive de-duplication against entries that don't.
    let mut cands: Vec<(String, String)> = Vec::new();
    for (desc, ip) in win::ipv4_adapters() {
        if ip.is_empty() || ip == "0.0.0.0" {
            continue;
        }
        if !cands.iter().any(|(_, existing)| existing == &ip) {
            cands.push((desc, ip));
        }
    }
    // The route address is a useful candidate when enumeration missed it — but
    // only then. Adding it unconditionally would re-introduce a description-less
    // duplicate of an address we already classified, and on a VPN machine that
    // duplicate would be the tunnel, scoring as if it were a real NIC.
    if let Some(r) = &route {
        if !r.is_empty() && r != "0.0.0.0" && !cands.iter().any(|(_, ip)| ip == r) {
            cands.push((String::new(), r.clone()));
        }
    }
    // Non-Windows, or the enumeration failed: fall back to bare addresses and
    // the old IP-only heuristic rather than returning nothing.
    if cands.is_empty() {
        for ip in all_ipv4() {
            if !ip.is_empty() && ip != "0.0.0.0" {
                cands.push((String::new(), ip));
            }
        }
    }
    if cands.is_empty() {
        return route.unwrap_or_else(|| "127.0.0.1".to_string());
    }

    cands.sort_by_key(|(desc, ip)| {
        let is_route = if Some(ip) == route.as_ref() { 1 } else { 0 };
        // Negated for descending order.
        (-adapter_score(desc, ip), -is_route)
    });
    cands[0].1.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real adapter descriptions, taken verbatim from `Get-NetAdapter
    /// -IncludeHidden` on the dev machine plus the VPN clients we care about.
    /// Guessing at these strings is how you ship a classifier that matches
    /// nothing.
    #[test]
    fn tunnel_descriptions_match_real_vpn_adapters() {
        for d in [
            "TAP-Windows Adapter V9",
            "TAP-NordVPN Windows Adapter V9",
            "NordLynx Tunnel",
            "WireGuard Tunnel",
            "OpenVPN Wintun Userspace Tunnel",
            "Cisco AnyConnect Secure Mobility Client Virtual Miniport Adapter",
            "PANGP Virtual Ethernet Adapter",
            "GlobalProtect virtual ethernet adapter",
            "FortiClient Virtual Ethernet Adapter",
            "ProtonVPN TUN",
            "Mullvad Tunnel",
            "TailScale Tunnel",
            "ZeroTier Virtual Port",
            "Teredo Tunneling Pseudo-Interface",
            // Present and Up on this very machine.
            "WAN Miniport (SSTP)",
            "WAN Miniport (IKEv2)",
            "WAN Miniport (L2TP)",
            "WAN Miniport (PPTP)",
            "WAN Miniport (Network Monitor)",
        ] {
            assert!(is_tunnel_desc(d), "should be a tunnel: {d}");
        }
    }

    /// The other half, which matters just as much: a classifier that demotes the
    /// real NIC is worse than no classifier.
    #[test]
    fn real_adapters_are_not_mistaken_for_tunnels() {
        for d in [
            // The actual Wi-Fi and Ethernet on this machine.
            "Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter",
            "Realtek PCIe GbE Family Controller",
            "Intel(R) Wi-Fi 6E AX211 160MHz",
            "Intel(R) Ethernet Connection (2) I219-V",
            "Killer E3100G 2.5 Gigabit Ethernet Controller",
        ] {
            assert!(!is_tunnel_desc(d), "real NIC misread as tunnel: {d}");
            assert!(!is_virtual_desc(d), "real NIC misread as virtual: {d}");
        }
    }

    /// A tethered phone is a legitimate pairing target and must never be
    /// demoted, whatever else its description happens to contain.
    #[test]
    fn tether_is_never_classified_as_tunnel_or_virtual() {
        for d in [
            "Remote NDIS based Internet Sharing Device",
            "Samsung Mobile USB Remote NDIS Network Device",
            "Apple Mobile Device Ethernet (NCM)",
            "Android USB Tethering Adapter",
        ] {
            assert!(is_tether_desc(d), "should be a tether: {d}");
            assert!(!is_tunnel_desc(d), "tether misread as tunnel: {d}");
            assert!(!is_virtual_desc(d), "tether misread as virtual: {d}");
            // and it must keep the full, unpenalised score
            assert_eq!(adapter_score(d, "10.66.39.1"), lan_score("10.66.39.1"));
        }
    }

    #[test]
    fn virtual_adapters_are_detected_including_the_wifi_direct_trap() {
        for d in [
            // Up on this machine, and its description contains "Wi-Fi".
            "Microsoft Wi-Fi Direct Virtual Adapter",
            "Microsoft Wi-Fi Direct Virtual Adapter #2",
            "VirtualBox Host-Only Ethernet Adapter",
            "VMware Virtual Ethernet Adapter for VMnet8",
            "Hyper-V Virtual Ethernet Adapter",
            "Microsoft Kernel Debug Network Adapter",
        ] {
            assert!(is_virtual_desc(d), "should be virtual: {d}");
        }
    }

    /// **The bug this fix exists for.** This machine's Wi-Fi is `10.0.6.194/20`,
    /// so the old IP-only ranking put any `192.168.x` VPN *above* the real LAN
    /// (100 vs 60) and the pairing QR pointed down the tunnel.
    #[test]
    fn vpn_loses_to_the_real_lan_even_when_it_holds_the_nicer_address() {
        let real = ("Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter", "10.0.6.194");
        let vpn = ("TAP-NordVPN Windows Adapter V9", "192.168.3.2");

        // The old heuristic, for the record: it gets this exactly backwards.
        assert!(
            lan_score(vpn.1) > lan_score(real.1),
            "precondition: this is the inversion being fixed"
        );
        // The new one does not.
        assert!(
            adapter_score(real.0, real.1) > adapter_score(vpn.0, vpn.1),
            "a real 10.x LAN must outrank a 192.168.x tunnel"
        );
    }

    /// The quieter version of the same bug, present on any machine with Hyper-V
    /// or WSL: the `vEthernet` switch sits on `172.x`, which `lan_score` ranks at
    /// 80 — above a real `10.x` LAN at 60.
    #[test]
    fn hyperv_and_wsl_switches_lose_to_a_real_lan() {
        let real = ("Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter", "10.0.6.194");
        for v in [
            ("Hyper-V Virtual Ethernet Adapter", "172.20.128.1"),
            ("Hyper-V Virtual Ethernet Adapter (vEthernet (WSL))", "172.28.16.1"),
        ] {
            assert!(lan_score(v.1) > lan_score(real.1), "precondition for {}", v.0);
            assert!(
                adapter_score(real.0, real.1) > adapter_score(v.0, v.1),
                "{} must lose to the real LAN",
                v.0
            );
        }
    }

    /// Class dominates IP range, but ordering *within* a class still follows the
    /// familiar preference — the fix must not flatten everything.
    #[test]
    fn ordering_within_a_class_is_unchanged() {
        let nic = "Realtek PCIe GbE Family Controller";
        assert!(adapter_score(nic, "192.168.1.34") > adapter_score(nic, "10.0.0.5"));
        assert!(adapter_score(nic, "10.0.0.5") > adapter_score(nic, "169.254.1.1"));
        // A virtual adapter beats a tunnel: at least it is local.
        assert!(
            adapter_score("Hyper-V Virtual Ethernet Adapter", "192.168.9.1")
                > adapter_score("WireGuard Tunnel", "192.168.9.1")
        );
    }

    #[test]
    fn has_word_does_not_fire_inside_longer_words() {
        assert!(has_word("tap-windows adapter v9", "tap"));
        assert!(has_word("protonvpn tun", "tun"));
        // The false positives this guard exists to prevent.
        assert!(!has_word("realtek gaming 2.5gbe", "tap"));
        assert!(!has_word("fortune network device", "tun"));
        assert!(!has_word("adaptateur reseau", "tap"));
    }

    /// On the machine this actually runs on, whatever it is: the address chosen
    /// for the QR must not belong to an adapter we classify as a tunnel or a
    /// virtual switch. Machine-independent, and it exercises the real
    /// enumeration rather than synthetic strings.
    #[cfg(windows)]
    #[test]
    fn chosen_lan_ip_is_not_a_tunnel_or_virtual_adapter() {
        let chosen = lan_ip();
        let adapters = adapters_with_prefix();
        if adapters.is_empty() {
            eprintln!("SKIP: no adapters enumerated");
            return;
        }
        let Some((desc, _, _)) = adapters.iter().find(|(_, ip, _)| ip == &chosen) else {
            // Fell back to the route address, which has no description to check.
            eprintln!("SKIP: chosen {chosen} not in the adapter list");
            return;
        };
        assert!(
            !is_tunnel_desc(desc),
            "lan_ip() picked tunnel {desc} ({chosen})"
        );
        assert!(
            !is_virtual_desc(desc),
            "lan_ip() picked virtual adapter {desc} ({chosen})"
        );
    }

    #[test]
    fn lan_score_prefers_home_lan_over_vpn_tunnel() {
        // The whole point: a Surfshark/OpenVPN 10.x tunnel must NOT outrank the
        // real 192.168 LAN, or the pairing QR sends the phone down the tunnel.
        assert!(lan_score("192.168.1.34") > lan_score("10.8.0.2"));
        // VirtualBox host-only must lose to a real LAN.
        assert!(lan_score("192.168.1.34") > lan_score("192.168.56.1"));
        // Link-local is nearly last, loopback is last.
        assert!(lan_score("169.254.1.1") > lan_score("127.0.0.1"));
        assert!(lan_score("10.0.0.5") > lan_score("169.254.1.1"));
        // private /12
        assert_eq!(lan_score("172.16.0.1"), 80);
        assert_eq!(lan_score("172.31.255.1"), 80);
        // 172.32 is NOT private
        assert_eq!(lan_score("172.32.0.1"), 10);
        assert_eq!(lan_score("8.8.8.8"), 10);
    }

    #[test]
    fn tether_descriptions_match_real_adapter_names() {
        // Strings taken from real adapters; RNDIS contains "NDIS".
        assert!(is_tether_desc("Remote NDIS based Internet Sharing Device"));
        assert!(is_tether_desc("Remote NDIS Compatible Device"));
        assert!(is_tether_desc("Samsung Mobile USB NCM Device"));
        assert!(is_tether_desc("Android USB Tethering"));
        // Must NOT match ordinary adapters, or Wi-Fi would become a trusted
        // keyless subnet and any LAN host could drive the pad.
        assert!(!is_tether_desc("Intel(R) Wi-Fi 6E AX211 160MHz"));
        assert!(!is_tether_desc("Realtek PCIe GbE Family Controller"));
        assert!(!is_tether_desc("VirtualBox Host-Only Ethernet Adapter"));
        assert!(!is_tether_desc(""));
    }

    #[test]
    fn slash24_splits_correctly() {
        assert_eq!(slash24("10.66.39.130"), Some("10.66.39"));
        assert_eq!(slash24("192.168.1.1"), Some("192.168.1"));
        assert_eq!(slash24("nonsense"), None);
    }

    /// Live smoke test: on this machine the enumeration must actually work.
    /// Not asserting specific addresses — just that we get a sane answer rather
    /// than silently falling back to loopback (which is how the FFI would fail).
    #[test]
    fn lan_ip_returns_something_plausible() {
        let ip = lan_ip();
        assert!(!ip.is_empty());
        assert_eq!(ip.split('.').count(), 4, "not a dotted IPv4: {ip}");
    }

    #[test]
    fn ipv4_parsing_rejects_garbage() {
        assert_eq!(ipv4_to_u32("10.0.6.194"), Some(0x0A_00_06_C2));
        assert_eq!(ipv4_to_u32("0.0.0.0"), Some(0));
        assert_eq!(ipv4_to_u32("255.255.255.255"), Some(u32::MAX));
        assert_eq!(ipv4_to_u32("10.0.6"), None, "three octets is not an IPv4");
        assert_eq!(ipv4_to_u32("10.0.6.256"), None, "octet out of range");
        assert_eq!(ipv4_to_u32("10.0.6.x"), None);
        assert_eq!(ipv4_to_u32(""), None);
    }

    #[test]
    fn same_subnet_honours_the_real_prefix() {
        // /24 — the historical assumption, still correct for a home router.
        assert!(same_subnet("192.168.1.5", "192.168.1.200", 24));
        assert!(!same_subnet("192.168.1.5", "192.168.2.200", 24));

        // /20 — the case the hardcoded /24 got wrong. 10.0.0.0/20 spans
        // 10.0.0.0 - 10.0.15.255, so these differ in the third octet yet are on
        // the same wire.
        assert!(same_subnet("10.0.6.194", "10.0.9.5", 20));
        assert!(same_subnet("10.0.0.1", "10.0.15.254", 20));
        assert!(!same_subnet("10.0.6.194", "10.0.16.1", 20), "just past the /20 edge");

        // /16 and /8 widen as expected.
        assert!(same_subnet("10.0.6.194", "10.0.200.1", 16));
        assert!(!same_subnet("10.1.6.194", "10.0.200.1", 16));
        assert!(same_subnet("10.1.6.194", "10.99.200.1", 8));

        // Edges: /32 is host-exact, /0 matches everything. Neither may shift by 32.
        assert!(same_subnet("10.0.6.194", "10.0.6.194", 32));
        assert!(!same_subnet("10.0.6.194", "10.0.6.195", 32));
        assert!(same_subnet("10.0.6.194", "8.8.8.8", 0));

        // Garbage never silently matches.
        assert!(!same_subnet("nonsense", "10.0.6.194", 20));
    }
}
