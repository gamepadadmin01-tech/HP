//! Live probe of the real update backend. Not a unit test — it needs the
//! network and the production endpoint, so it must never gate `cargo test`.
//! Run: cargo run --example check_update
fn main() {
    let t = std::time::Duration::from_secs(10);
    println!("APP_VERSION = {}", pc_server_rs::http::APP_VERSION);
    let info = pc_server_rs::http::check_for_update(t, 1);
    println!("{info:#?}");
    match &info.error {
        Some((k, m)) => println!("\nRESULT: FAILED [{k:?}] {m}\n  -> user sees: {}", k.message()),
        None => println!(
            "\nRESULT: OK — backend says latest={} available={}",
            info.latest, info.available
        ),
    }
}
