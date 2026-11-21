//! "CamOS Camera" — creating the Windows 11 virtual camera and feeding it.
//!
//! Two jobs:
//!
//! 1. **Create the camera.** `MFCreateVirtualCamera` tells Windows "there is a
//!    webcam called CamOS Camera, and the DLL with this ID draws its pictures".
//!    *Session* lifetime: the camera exists while this program runs and Windows
//!    removes it when we exit, so a crash never leaves a dead camera behind.
//!    *Current user* access: no admin rights needed at run time. (Registering the
//!    DLL once does need admin — the installer does that.)
//!
//! 2. **Feed the camera.** The DLL runs inside Windows' camera service, in a
//!    different session and account, so we hand it pictures through a named pipe,
//!    `\\.\pipe\CamOSFrames`. Each message is `"CAMF" | w | h | len | NV12 bytes`
//!    (little-endian u32s). **NV12** is the picture layout every webcam app
//!    understands natively: a full-size black-and-white image followed by a
//!    quarter-size colour layer — 1.5 bytes per pixel.

use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use windows::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::Storage::FileSystem::{FILE_FLAGS_AND_ATTRIBUTES, PIPE_ACCESS_OUTBOUND, WriteFile};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
use windows::Win32::System::Pipes::*;
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::core::{Interface, w};

/// Must match `vcam/src/lib.rs::CLSID_CAMOS_SOURCE`.
pub const CAMOS_SOURCE_CLSID: &str = "{6F3C2A71-4B8E-4D2A-9C15-8E0B7D3A5C42}";
pub const CAMERA_NAME: &str = "CamOS Camera";

struct Latest {
    seq: u64,
    w: u32,
    h: u32,
    nv12: Option<Arc<Vec<u8>>>,
}

static LATEST: Mutex<Latest> = Mutex::new(Latest { seq: 0, w: 0, h: 0, nv12: None });
static NEW_FRAME: Condvar = Condvar::new();

/// Hand one decoded picture to every connected camera DLL. Never blocks on them.
pub fn publish(w: u32, h: u32, nv12: Vec<u8>) {
    if let Ok(mut g) = LATEST.lock() {
        g.seq += 1;
        g.w = w;
        g.h = h;
        g.nv12 = Some(Arc::new(nv12));
    }
    NEW_FRAME.notify_all();
}

/// Start the virtual camera and the frame pipe on their own threads.
///
/// Returns once Windows has accepted (or refused) the camera, so the caller can
/// show a clear status line instead of guessing.
pub fn start() -> Result<(), String> {
    super::media_available()?;
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    std::thread::Builder::new()
        .name("camos-vcam".into())
        .spawn(move || {
            let r = create_camera();
            match r {
                Ok(cam) => {
                    let _ = tx.send(Ok(()));
                    // Hold the camera for the life of the process. Dropping it
                    // would remove "CamOS Camera" from every app.
                    let _keep = cam;
                    loop {
                        std::thread::park();
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    std::thread::Builder::new()
        .name("camos-pipe".into())
        .spawn(pipe_server)
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(15)).map_err(|_| "virtual camera did not answer in 15 s".to_string())?
}

fn create_camera() -> Result<IMFVirtualCamera, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).map_err(|e| format!("MFStartup: {e}"))?;
        let name: Vec<u16> = CAMERA_NAME.encode_utf16().chain(Some(0)).collect();
        let id: Vec<u16> = CAMOS_SOURCE_CLSID.encode_utf16().chain(Some(0)).collect();
        // ⚠️ Looked up at run time, NOT linked. MFCreateVirtualCamera exists only on
        // Windows 11; a normal (load-time) import of it would stop Gamepad Server
        // from STARTING AT ALL on Windows 10 ("entry point not found"), taking the
        // gamepad down with it. Looked up like this, Windows 10 just gets a clear
        // "Windows 11 needed" line and the gamepad runs as before.
        type CreateFn = unsafe extern "system" fn(
            MFVirtualCameraType,
            MFVirtualCameraLifetime,
            MFVirtualCameraAccess,
            windows::core::PCWSTR,
            windows::core::PCWSTR,
            *const windows::core::GUID,
            u32,
            *mut *mut core::ffi::c_void,
        ) -> windows::core::HRESULT;
        let lib = LoadLibraryW(w!("mfsensorgroup.dll")).map_err(|_| "the Windows virtual camera needs Windows 11".to_string())?;
        let proc = GetProcAddress(lib, windows::core::s!("MFCreateVirtualCamera"))
            .ok_or_else(|| "the Windows virtual camera needs Windows 11".to_string())?;
        let create: CreateFn = std::mem::transmute(proc);
        let mut raw: *mut core::ffi::c_void = std::ptr::null_mut();
        create(
            MFVirtualCameraType_SoftwareCameraSource,
            MFVirtualCameraLifetime_Session,
            MFVirtualCameraAccess_CurrentUser,
            windows::core::PCWSTR(name.as_ptr()),
            windows::core::PCWSTR(id.as_ptr()),
            std::ptr::null(),
            0,
            &mut raw,
        )
        .ok()
        .map_err(|e| format!("MFCreateVirtualCamera: {e}"))?;
        if raw.is_null() {
            return Err("MFCreateVirtualCamera returned nothing".into());
        }
        let cam = IMFVirtualCamera::from_raw(raw);
        cam.Start(None).map_err(|e| {
            format!("starting the virtual camera failed: {e} — is camos_vcam.dll registered (regsvr32)?")
        })?;
        Ok(cam)
    }
}

/// Accept camera-DLL connections forever; one writer thread per connection.
fn pipe_server() {
    loop {
        let h = unsafe {
            CreateNamedPipeW(
                w!(r"\\.\pipe\CamOSFrames"),
                FILE_FLAGS_AND_ATTRIBUTES(PIPE_ACCESS_OUTBOUND.0),
                PIPE_TYPE_BYTE | PIPE_WAIT,
                PIPE_UNLIMITED_INSTANCES,
                4 * 1024 * 1024,
                0,
                0,
                // Default security: full control for us, READ for everyone —
                // exactly what the camera service (LocalService) needs.
                None,
            )
        };
        if h == INVALID_HANDLE_VALUE || h.is_invalid() {
            eprintln!("camos: could not create the frame pipe; retrying");
            std::thread::sleep(Duration::from_secs(2));
            continue;
        }
        // Blocks until a camera DLL opens the pipe. "Already connected" is also success.
        let ok = unsafe { ConnectNamedPipe(h, None) };
        if ok.is_err() && windows::core::Error::from_win32().code() != windows::Win32::Foundation::ERROR_PIPE_CONNECTED.to_hresult() {
            unsafe {
                let _ = CloseHandle(h);
            }
            continue;
        }
        println!("camos: camera service connected (an app opened CamOS Camera)");
        let raw = h.0 as isize;
        let _ = std::thread::Builder::new().name("camos-pipe-writer".into()).spawn(move || {
            serve(HANDLE(raw as *mut _));
        });
    }
}

fn serve(h: HANDLE) {
    let mut sent = 0u64;
    loop {
        let (seq, w, hh, data) = {
            let Ok(mut g) = LATEST.lock() else { break };
            while g.seq == sent {
                match NEW_FRAME.wait_timeout(g, Duration::from_millis(1000)) {
                    Ok((ng, _)) => g = ng,
                    Err(_) => return,
                }
            }
            match &g.nv12 { Some(d) => (g.seq, g.w, g.h, Arc::clone(d)), None => continue }
        };
        sent = seq;
        let mut hdr = [0u8; 16];
        hdr[0..4].copy_from_slice(b"CAMF");
        hdr[4..8].copy_from_slice(&w.to_le_bytes());
        hdr[8..12].copy_from_slice(&hh.to_le_bytes());
        hdr[12..16].copy_from_slice(&(data.len() as u32).to_le_bytes());
        if !write_all(h, &hdr) || !write_all(h, &data) {
            break;
        }
    }
    unsafe {
        let _ = DisconnectNamedPipe(h);
        let _ = CloseHandle(h);
    }
    println!("camos: camera service disconnected");
}

fn write_all(h: HANDLE, mut buf: &[u8]) -> bool {
    while !buf.is_empty() {
        let mut n = 0u32;
        if unsafe { WriteFile(h, Some(buf), Some(&mut n), None) }.is_err() || n == 0 {
            return false;
        }
        buf = &buf[n as usize..];
    }
    true
}
