//! CamOS — the phone-as-webcam side of Gamepad Server.
//!
//! The path a picture takes:
//!
//! ```text
//! phone camera → phone's H.264 chip → TCP :7780 (stream.rs)
//!   → Windows' H.264 decoder (decode.rs) → NV12 picture
//!   → named pipe → camos_vcam.dll inside Windows' camera service (vcam.rs)
//!   → "CamOS Camera" in Zoom / Meet / Teams / Camera app
//! ```
//!
//! Completely separate from the gamepad path: different port, different
//! threads, nothing shared but the pairing key. A camera problem can never
//! delay a gamepad packet.

#[cfg(windows)]
pub mod decode;
pub mod preview;
pub mod proto;
pub mod remote;
pub mod turn;
pub mod udp;
#[cfg(windows)]
pub mod stream;
#[cfg(windows)]
pub mod vcam;

/// TCP port the CamOS phone app connects to. The installer's firewall rule
/// already allows Gamepad Server on any TCP port.
pub const CAMERA_PORT: u16 = 7780;

/// Is Windows' media library (mfplat.dll) present? It is DELAY-loaded (build.rs),
/// so calling any media function without it would crash the whole server.
/// "Windows N" editions lack it until the Media Feature Pack is installed.
/// Every camera entry point checks this first.
#[cfg(windows)]
pub fn media_available() -> Result<(), String> {
    use windows::Win32::System::LibraryLoader::LoadLibraryW;
    unsafe { LoadLibraryW(windows::core::w!("mfplat.dll")) }
        .map(|_| ())
        .map_err(|_| "Windows media features are missing (Windows N: install the Media Feature Pack)".to_string())
}
