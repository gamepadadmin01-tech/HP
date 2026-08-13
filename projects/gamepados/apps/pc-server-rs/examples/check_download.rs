//! Live probe of the installer download + verification path against the REAL
//! artifact the backend advertises. Safety-critical: this file gets executed
//! elevated, so the MZ + SHA-256 guards must be proven on real bytes.
//! Run: cargo run --example check_download -- <dest>
fn main() {
    let dest = std::env::args().nth(1).expect("usage: check_download <dest>");
    let t = std::time::Duration::from_secs(120);
    let info = pc_server_rs::http::check_for_update(t, 1);
    println!("url    = {}", info.url);
    println!("sha256 = {}", info.sha256);
    let mut last = 0u64;
    let r = pc_server_rs::http::download_update(
        &info.url, std::path::Path::new(&dest), &info.sha256, t,
        |done, total| {
            if done - last > 4_000_000 { last = done;
                println!("  .. {done}/{total} ({}%)", if total > 0 { done * 100 / total } else { 0 }); }
        },
    );
    match r {
        Ok(()) => println!("\nRESULT: OK — MZ header + SHA-256 both verified on the real artifact"),
        Err(e) => println!("\nRESULT: REJECTED — {e}"),
    }
    println!("file exists after call: {}", std::path::Path::new(&dest).exists());
}
