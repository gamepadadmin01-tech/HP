//! Prints every IPv4 adapter with the prefix length read out of
//! `IP_ADAPTER_UNICAST_ADDRESS.OnLinkPrefixLength`.
//!
//! Exists to VALIDATE THE FFI OFFSET. That field sits behind six declared-only
//! filler fields; if any offset is wrong the read silently returns a plausible
//! garbage number rather than failing, and the off-LAN auth test would then be
//! decided by noise. Cross-check this output against
//! `Get-NetIPAddress -AddressFamily IPv4 | Select IPAddress, PrefixLength`.
//!
//! Run: cargo run --example check_prefix

fn main() {
    println!("{:<18} {:>6}  {}", "IPv4", "prefix", "adapter");
    println!("{}", "-".repeat(70));
    for (desc, ip, plen) in pc_server_rs::netdetect::adapters_with_prefix() {
        let shown = if plen == 0 { "?".to_string() } else { format!("/{plen}") };
        println!("{ip:<18} {shown:>6}  {desc}");
    }

    let lan = pc_server_rs::netdetect::lan_ip();
    let p = pc_server_rs::netdetect::prefix_len_for(&lan);
    println!("\nchosen LAN ip : {lan}");
    println!("prefix length : {p:?}   (None => falls back to /24)");
    if let Some(p) = p {
        // The practical consequence: is a same-wire peer that differs in the
        // third octet still judged on-LAN? Under the old /24 logic it was not,
        // and that is the branch which accepts auth token 0.
        println!(
            "on-LAN test   : 10.0.9.5 vs {lan} -> same subnet? {}",
            pc_server_rs::netdetect::same_subnet("10.0.9.5", &lan, p)
        );
    }
}
