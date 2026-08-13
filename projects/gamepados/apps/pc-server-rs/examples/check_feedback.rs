//! One live probe of the feedback endpoint, clearly marked as a test.
//! Run: cargo run --example check_feedback
fn main() {
    let r = pc_server_rs::http::submit_feedback(
        "akhilpitchuka@gmail.com",
        "[TEST — please ignore] Feedback pipeline check from the new Rust v2.0.0 PC server.",
        std::time::Duration::from_secs(12),
    );
    match r {
        Ok(()) => println!("RESULT: OK — ticket accepted by the backend (check the admin portal, source=pc)"),
        Err(e) => println!("RESULT: FAILED — {e}"),
    }
}
