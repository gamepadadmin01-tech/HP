//! Negative control for the safety guards: feed download_update a WRONG sha256
//! and confirm it both rejects AND removes the file. A rejected-but-retained
//! installer would be a poisoned artifact sitting on disk.
fn main() {
    let dest = std::env::args().nth(1).expect("usage: <dest>");
    let t = std::time::Duration::from_secs(120);
    let info = pc_server_rs::http::check_for_update(t, 1);
    let bad = "0000000000000000000000000000000000000000000000000000000000000000";
    let r = pc_server_rs::http::download_update(
        &info.url, std::path::Path::new(&dest), bad, t, |_, _| {});
    println!("result       : {r:?}");
    println!("file remains : {}", std::path::Path::new(&dest).exists());
    assert!(r.is_err(), "BUG: bad checksum was accepted");
    assert!(!std::path::Path::new(&dest).exists(), "BUG: poisoned file left on disk");
    println!("\nRESULT: OK — rejected and cleaned up");
}
