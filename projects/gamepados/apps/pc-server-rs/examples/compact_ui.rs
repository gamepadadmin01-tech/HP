//! Visual preview of the real UI without binding ports or creating controllers.
fn main() {
    let status = pc_server_rs::status::Status::new();
    status.set_running(true);
    if std::env::args().any(|arg| arg == "--connected") {
        status.set_devices(1);
    }
    pc_server_rs::ui::run(
        status,
        "192.0.2.1,7777,abcd1234".into(),
        "abcd1234".into(),
        "192.0.2.1".into(),
    ).expect("open UI preview");
}
