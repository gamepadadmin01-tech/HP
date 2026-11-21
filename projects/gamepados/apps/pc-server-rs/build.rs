//! Embeds the Windows exe icon.
//!
//! The icon is the SAME `app_icon.ico` the Python server and its Inno installer
//! use (`installer/GamepadServer.iss` → `SetupIconFile`), copied into `assets/`.
//! It must match: this build replaces the Python server in place, under the same
//! shortcut and the same Start-menu entry. A different icon there reads to the
//! user as a different — or worse, an untrusted — application.
fn main() {
    println!("cargo:rerun-if-changed=assets/app_icon.ico");
    // CamOS camera (src/camera/) uses Windows' media library, mfplat.dll. "Windows N"
    // editions (Europe/Korea) ship WITHOUT it until the Media Feature Pack is
    // installed, and a normal import would stop Gamepad Server from starting there
    // at all. Delay-loading means Windows only looks for it the first time the
    // camera code runs; the gamepad never touches it.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg=/DELAYLOAD:mfplat.dll");
        println!("cargo:rustc-link-arg=delayimp.lib");
    }
    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/app_icon.ico");
        res.set("FileDescription", "Gamepad Server");
        res.set("ProductName", "Gamepad Server");
        res.set("CompanyName", "GamepadOS");
        // Keep in step with http::APP_VERSION and the installer's AppVersion.
        // `installer/build-installer.ps1` now FAILS the build if these three
        // disagree, so a missed edit here is caught before an installer ships.
        res.set("FileVersion", "2.1.5.0");
        res.set("ProductVersion", "2.1.5.0");
        if let Err(e) = res.compile() {
            // Never fail the build over cosmetics — but say so loudly, because a
            // shipped exe with the default Rust icon looks like malware to users.
            println!("cargo:warning=could not embed exe icon: {e}");
        }
    }
}
