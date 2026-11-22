//! CamOS virtual camera — the small helper file Windows 11 loads.
//!
//! ## How the pieces fit (plain words)
//!
//! Windows 11 can add a "pretend webcam" without a driver (`MFCreateVirtualCamera`,
//! called by GamepadServer.exe). But Windows does not take frames from our program
//! directly: a Windows background service, the **Frame Server**, loads THIS DLL and
//! asks it for one picture at a time. Zoom, Meet, Teams and the Camera app then see
//! "CamOS Camera" exactly like a USB webcam.
//!
//! The Frame Server runs as a locked-down service account (LocalService) in another
//! Windows session, so it cannot see GamepadServer's memory. GamepadServer therefore
//! publishes decoded pictures on a **named pipe** (`\\.\pipe\CamOSFrames`) — a pipe is
//! visible across sessions and its default permissions already let every account
//! READ, which is all this side needs. We never write to it.
//!
//! When the phone is not streaming, this DLL shows a calm placeholder picture
//! instead of freezing, so apps keep the camera open and pick the phone up the
//! moment it starts.
//!
//! ## COM in one paragraph
//!
//! Windows talks to this DLL through **COM**: it asks `DllGetClassObject` for a
//! factory, the factory makes a `MediaSource`, the source hands out one
//! `MediaStream`, and the stream answers `RequestSample` with a frame. Every reply
//! goes through an *event queue* (MF's mailbox) rather than a return value.
//!
//! Registered under HKLM by `regsvr32` (the installer, elevated), because the Frame
//! Server cannot read the current user's registry hive.

#![allow(non_snake_case)]

use std::ffi::c_void;
use std::io::Write as _;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use windows::Win32::Foundation::*;
use windows::Win32::Media::KernelStreaming::*;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::Storage::FileSystem::*;
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::*;
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::System::Registry::*;
use windows::Win32::System::SystemServices::DLL_PROCESS_ATTACH;
use windows::core::*;
use windows_core::IUnknownImpl;

/// The identity GamepadServer passes to `MFCreateVirtualCamera`. Must match
/// `pc-server-rs/src/camera/vcam.rs::CAMOS_SOURCE_CLSID` exactly.
pub const CLSID_CAMOS_SOURCE: GUID = GUID::from_u128(0x6f3c2a71_4b8e_4d2a_9c15_8e0b7d3a5c42);

const PIPE_NAME: PCWSTR = w!(r"\\.\pipe\CamOSFrames");

/// Picture modes offered to apps (width, height, frames per second), default first. The server can send any
/// size; this DLL fits it into whatever the app picked. 60 fps modes are for phones streaming at 60.
const MODES: [(u32, u32, u32); 5] = [(1280, 720, 30), (1920, 1080, 30), (640, 480, 30), (1280, 720, 60), (1920, 1080, 60)];
const DEFAULT_FPS: u32 = 30;

/// A picture older than this is treated as "phone gone" and the placeholder shows.
const STALE_AFTER: Duration = Duration::from_millis(1500);

static MODULE: AtomicIsize = AtomicIsize::new(0);

// ───────────────────────────── logging ─────────────────────────────

/// Best-effort log at C:\ProgramData\CamOS\vcam.log. The Frame Server is a
/// service — no console, no debugger by default — so this file is the only
/// practical way to see what Windows asked us to do.
fn log(msg: &str) {
    let dir = std::path::Path::new(r"C:\ProgramData\CamOS");
    let _ = std::fs::create_dir_all(dir);
    let who: String = std::env::var("USERNAME").unwrap_or_default().chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join(format!("vcam-{who}.log"))) {
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let _ = writeln!(f, "{t:.3} pid={} {msg}", std::process::id());
    }
}

// ───────────────────────────── frames from the server ─────────────────────────────

struct Frame {
    w: u32,
    h: u32,
    nv12: Vec<u8>,
    at: Instant,
}

static LATEST: Mutex<Option<Frame>> = Mutex::new(None);
static READER_STARTED: AtomicBool = AtomicBool::new(false);
static FRAMES_IN: AtomicU64 = AtomicU64::new(0);
/// Bumped for every new phone frame, so a waiting app request wakes the moment one arrives.
static FRAME_SEQ: Mutex<u64> = Mutex::new(0);
static NEW_FRAME: Condvar = Condvar::new();
/// Smoothed time between phone frames (microseconds), to tell a phone slower than the app's rate from a faster one.
static PHONE_INTERVAL_US: AtomicU64 = AtomicU64::new(0);

/// Pacing rule. A phone at least as fast as the app's chosen rate: keep the app's steady rhythm and always hand
/// over the newest frame (smooth, never faster than asked). A phone slower than that rate (e.g. 30 fps into a
/// 60 fps mode): follow the phone's frames, so the app doesn't get uneven repeats.
fn follow_phone(phone_live: bool, phone_interval: Duration, period: Duration) -> bool {
    phone_live && phone_interval > period * 23 / 20
}

/// One background thread per process: connect to the server's pipe, read
/// `"CAMF" | w u32 | h u32 | len u32 | NV12 bytes`, keep only the newest.
fn start_reader() {
    if READER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = std::thread::Builder::new().name("camos-pipe".into()).spawn(|| {
        log("pipe reader started");
        loop {
            let h = unsafe {
                CreateFileW(PIPE_NAME, GENERIC_READ.0, FILE_SHARE_NONE, None, OPEN_EXISTING, FILE_FLAGS_AND_ATTRIBUTES(0), None)
            };
            let Ok(h) = h else {
                std::thread::sleep(Duration::from_millis(500));
                continue;
            };
            log("connected to GamepadServer pipe");
            let mut buf: Vec<u8> = Vec::new();
            let mut last_frame_at: Option<Instant> = None;
            loop {
                let mut hdr = [0u8; 16];
                if !read_exact(h, &mut hdr) || &hdr[0..4] != b"CAMF" {
                    break;
                }
                let w = u32::from_le_bytes(hdr[4..8].try_into().unwrap_or_default());
                let hh = u32::from_le_bytes(hdr[8..12].try_into().unwrap_or_default());
                let len = u32::from_le_bytes(hdr[12..16].try_into().unwrap_or_default()) as usize;
                let expect = (w as usize) * (hh as usize) * 3 / 2;
                if w == 0 || hh == 0 || w > 4096 || hh > 4096 || len != expect {
                    log(&format!("bad frame header {w}x{hh} len={len}"));
                    break;
                }
                buf.resize(len, 0);
                if !read_exact(h, &mut buf) {
                    break;
                }
                FRAMES_IN.fetch_add(1, Ordering::Relaxed);
                if let Ok(mut g) = LATEST.lock() {
                    // Swap buffers instead of copying: the old one becomes our next read buffer.
                    let old = g.replace(Frame { w, h: hh, nv12: std::mem::take(&mut buf), at: Instant::now() });
                    if let Some(o) = old {
                        buf = o.nv12;
                    }
                }
                let now = Instant::now();
                if let Some(prev) = last_frame_at.replace(now) {
                    let us = now.duration_since(prev).as_micros().min(1_000_000) as u64;
                    let old = PHONE_INTERVAL_US.load(Ordering::Relaxed);
                    PHONE_INTERVAL_US.store(if old == 0 { us } else { (old * 7 + us) / 8 }, Ordering::Relaxed);
                }
                if let Ok(mut g) = FRAME_SEQ.lock() {
                    *g += 1;
                    NEW_FRAME.notify_all();
                }
            }
            unsafe {
                let _ = CloseHandle(h);
            }
            log("pipe closed; waiting for GamepadServer");
            std::thread::sleep(Duration::from_millis(300));
        }
    });
}

fn read_exact(h: HANDLE, out: &mut [u8]) -> bool {
    let mut off = 0usize;
    while off < out.len() {
        let mut got = 0u32;
        let ok = unsafe { ReadFile(h, Some(&mut out[off..]), Some(&mut got), None) };
        if ok.is_err() || got == 0 {
            return false;
        }
        off += got as usize;
    }
    true
}

/// Fill `dst` (NV12, `dw`×`dh`, stride = width) from the newest server frame,
/// scaled to fit, or with the placeholder when there is none.
fn fill_frame(dst: &mut [u8], dw: u32, dh: u32, tick: u64) {
    if let Ok(g) = LATEST.lock() {
        if let Some(f) = g.as_ref() {
            if f.at.elapsed() < STALE_AFTER {
                scale_nv12(&f.nv12, f.w, f.h, dst, dw, dh);
                return;
            }
        }
    }
    placeholder(dst, dw, dh, tick);
}

/// Nearest-neighbour NV12 scale that keeps the picture's shape. Same size is a plain copy. When the phone's shape
/// differs from what the app asked for (a phone held upright sends a tall picture, apps ask for a wide one), the
/// picture is fitted inside with black bars instead of being squashed.
fn scale_nv12(src: &[u8], sw: u32, sh: u32, dst: &mut [u8], dw: u32, dh: u32) {
    let (sw, sh, dw, dh) = (sw as usize, sh as usize, dw as usize, dh as usize);
    if sw == 0 || sh == 0 || dw == 0 || dh == 0 || src.len() < sw * sh * 3 / 2 || dst.len() < dw * dh * 3 / 2 {
        return;
    }
    if sw == dw && sh == dh {
        let n = dst.len().min(src.len());
        dst[..n].copy_from_slice(&src[..n]);
        return;
    }
    // Fitted rectangle, even-aligned so the half-size chroma plane lines up.
    let (mut rw, mut rh) = if sw * dh > dw * sh { (dw, dw * sh / sw) } else { (dh * sw / sh, dh) };
    rw = (rw.min(dw)) & !1;
    rh = (rh.min(dh)) & !1;
    let rx = ((dw - rw) / 2) & !1;
    let ry = ((dh - rh) / 2) & !1;
    if rw != dw || rh != dh {
        dst[..dw * dh].fill(16);
        dst[dw * dh..dw * dh * 3 / 2].fill(128);
    }
    if rw == 0 || rh == 0 {
        return;
    }
    let xmap: Vec<usize> = (0..rw).map(|x| x * sw / rw).collect();
    for y in 0..rh {
        let sy = y * sh / rh;
        let s = &src[sy * sw..sy * sw + sw];
        let d = &mut dst[(ry + y) * dw + rx..(ry + y) * dw + rx + rw];
        for (dx, &sx) in d.iter_mut().zip(xmap.iter()) {
            *dx = s[sx];
        }
    }
    // Chroma plane: interleaved U,V pairs at half resolution.
    let (suv, duv) = (sw * sh, dw * dh);
    let (scw, sch, rcw, rch) = (sw / 2, sh / 2, rw / 2, rh / 2);
    for y in 0..rch {
        let sy = y * sch / rch.max(1);
        let srow = suv + sy * sw;
        let drow = duv + (ry / 2 + y) * dw + rx;
        for x in 0..rcw {
            let sx = x * scw / rcw.max(1);
            dst[drow + 2 * x] = src[srow + 2 * sx];
            dst[drow + 2 * x + 1] = src[srow + 2 * sx + 1];
        }
    }
}

/// The "waiting for your phone" picture: GamepadOS's warm dark brown with a soft
/// lighter band that slowly breathes, so a viewer can tell the camera is alive.
fn placeholder(dst: &mut [u8], w: u32, h: u32, tick: u64) {
    let (w, h) = (w as usize, h as usize);
    let phase = ((tick % 90) as f32 / 90.0 * std::f32::consts::TAU).sin() * 0.5 + 0.5;
    let band_y = 40.0 + 14.0 * phase;
    let (y0, y1) = (h * 2 / 5, h * 3 / 5);
    let (x0, x1) = (w / 3, w * 2 / 3);
    for y in 0..h {
        let row = &mut dst[y * w..y * w + w];
        for (x, p) in row.iter_mut().enumerate() {
            *p = if y >= y0 && y < y1 && x >= x0 && x < x1 { band_y as u8 } else { 30 };
        }
    }
    // Warm brown chroma (U below neutral, V above).
    let uv = &mut dst[w * h..w * h + w * h / 2];
    for pair in uv.chunks_exact_mut(2) {
        pair[0] = 118;
        pair[1] = 140;
    }
}

// ───────────────────────────── helpers ─────────────────────────────

fn hr_win32(code: u32) -> HRESULT {
    HRESULT::from_win32(code)
}

fn video_type(w: u32, h: u32, fps: u32) -> Result<IMFMediaType> {
    unsafe {
        let t = MFCreateMediaType()?;
        t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        t.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
        t.SetUINT64(&MF_MT_FRAME_SIZE, ((w as u64) << 32) | h as u64)?;
        t.SetUINT64(&MF_MT_FRAME_RATE, ((fps as u64) << 32) | 1)?;
        t.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
        t.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        t.SetUINT32(&MF_MT_ALL_SAMPLES_INDEPENDENT, 1)?;
        t.SetUINT32(&MF_MT_DEFAULT_STRIDE, w)?;
        t.SetUINT32(&MF_MT_AVG_BITRATE, w * h * 12 * fps)?;
        Ok(t)
    }
}

fn frame_rate(t: &IMFMediaType) -> u32 {
    let v = unsafe { t.GetUINT64(&MF_MT_FRAME_RATE) }.unwrap_or(((DEFAULT_FPS as u64) << 32) | 1);
    let (num, den) = ((v >> 32) as u32, (v as u32).max(1));
    (num / den).clamp(1, 120)
}

fn frame_size(t: &IMFMediaType) -> (u32, u32) {
    let v = unsafe { t.GetUINT64(&MF_MT_FRAME_SIZE) }.unwrap_or(((1280u64) << 32) | 720);
    ((v >> 32) as u32, v as u32)
}

// ───────────────────────────── the stream ─────────────────────────────

struct StreamState {
    state: MF_STREAM_STATE,
    shutdown: bool,
    w: u32,
    h: u32,
    tick: u64,
    fps: u32,
    /// When the next picture is due — apps get 30 per second, not as many as the CPU can make.
    next_due: Option<Instant>,
    /// Frame-driven pacing: the last phone frame handed to the app, and when.
    last_seq: u64,
    last_out: Option<Instant>,
}

#[implement(IMFMediaStream2, IKsControl)]
struct MediaStream {
    source: Mutex<Option<IMFMediaSource>>,
    sd: IMFStreamDescriptor,
    queue: IMFMediaEventQueue,
    st: Mutex<StreamState>,
}

impl MediaStream {
    fn set_running(&self, start: *const PROPVARIANT, w: u32, h: u32, fps: u32) -> Result<()> {
        if let Ok(mut s) = self.st.lock() {
            s.state = MF_STREAM_STATE_RUNNING;
            s.w = w;
            s.h = h;
            s.fps = fps;
            s.next_due = None;
            s.last_out = None;
        }
        unsafe { self.queue.QueueEventParamVar(MEStreamStarted.0 as u32, &GUID::zeroed(), S_OK, start) }
    }
    fn set_stopped(&self) -> Result<()> {
        if let Ok(mut s) = self.st.lock() {
            s.state = MF_STREAM_STATE_STOPPED;
        }
        unsafe { self.queue.QueueEventParamVar(MEStreamStopped.0 as u32, &GUID::zeroed(), S_OK, std::ptr::null()) }
    }
    fn shutdown(&self) {
        if let Ok(mut s) = self.st.lock() {
            s.shutdown = true;
            s.state = MF_STREAM_STATE_STOPPED;
        }
        unsafe {
            let _ = self.queue.Shutdown();
        }
        if let Ok(mut src) = self.source.lock() {
            *src = None; // break the source <-> stream cycle
        }
    }
    fn check(&self) -> Result<()> {
        match self.st.lock() {
            Ok(s) if s.shutdown => Err(MF_E_SHUTDOWN.into()),
            _ => Ok(()),
        }
    }
}

impl IMFMediaEventGenerator_Impl for MediaStream_Impl {
    fn GetEvent(&self, flags: MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS) -> Result<IMFMediaEvent> {
        self.check()?;
        unsafe { self.queue.GetEvent(flags.0 as u32) }
    }
    fn BeginGetEvent(&self, cb: Ref<'_, IMFAsyncCallback>, state: Ref<'_, IUnknown>) -> Result<()> {
        self.check()?;
        unsafe { self.queue.BeginGetEvent(cb.as_ref(), state.as_ref()) }
    }
    fn EndGetEvent(&self, result: Ref<'_, IMFAsyncResult>) -> Result<IMFMediaEvent> {
        self.check()?;
        unsafe { self.queue.EndGetEvent(result.as_ref()) }
    }
    fn QueueEvent(&self, met: u32, ext: *const GUID, hr: HRESULT, v: *const PROPVARIANT) -> Result<()> {
        self.check()?;
        unsafe { self.queue.QueueEventParamVar(met, ext, hr, v) }
    }
}

impl IMFMediaStream_Impl for MediaStream_Impl {
    fn GetMediaSource(&self) -> Result<IMFMediaSource> {
        self.check()?;
        self.source.lock().ok().and_then(|s| s.clone()).ok_or_else(|| MF_E_SHUTDOWN.into())
    }
    fn GetStreamDescriptor(&self) -> Result<IMFStreamDescriptor> {
        self.check()?;
        Ok(self.sd.clone())
    }
    fn RequestSample(&self, token: Ref<'_, IUnknown>) -> Result<()> {
        let (w, h, tick, due_at, fps) = {
            let mut s = self.st.lock().map_err(|_| Error::from(E_FAIL))?;
            if s.shutdown {
                return Err(MF_E_SHUTDOWN.into());
            }
            if s.state != MF_STREAM_STATE_RUNNING {
                return Err(MF_E_MEDIA_SOURCE_WRONGSTATE.into());
            }
            s.tick += 1;
            (s.w, s.h, s.tick, s.last_out, s.fps)
        };
        let period = Duration::from_nanos(1_000_000_000 / fps.max(1) as u64);
        let phone_live = LATEST.lock().ok().and_then(|g| g.as_ref().map(|f| f.at.elapsed() < STALE_AFTER)).unwrap_or(false);
        let phone_interval = Duration::from_micros(PHONE_INTERVAL_US.load(Ordering::Relaxed));
        let last_seq = self.st.lock().map(|s| s.last_seq).unwrap_or(0);
        let mut seq = last_seq;
        if follow_phone(phone_live, phone_interval, period) {
            // Phone slower than the app's rate: hand over each new phone frame as it arrives (never faster than
            // the app's rate), repeating the last picture only if the phone is late.
            if let Some(last) = due_at {
                let wait = (last + period * 4 / 5).saturating_duration_since(Instant::now());
                if !wait.is_zero() {
                    std::thread::sleep(wait);
                }
            }
            let deadline = due_at.map(|t| t + phone_interval * 3 / 2).unwrap_or_else(Instant::now).max(Instant::now());
            if let Ok(mut g) = FRAME_SEQ.lock() {
                while *g == last_seq {
                    let now = Instant::now();
                    if now >= deadline {
                        break;
                    }
                    match NEW_FRAME.wait_timeout(g, deadline - now) {
                        Ok((ng, _)) => g = ng,
                        Err(_) => return Err(E_FAIL.into()),
                    }
                }
                seq = *g;
            }
        } else {
            // Steady rhythm at the app's rate with the newest frame (or the waiting picture when no phone).
            let due = {
                let mut st = self.st.lock().map_err(|_| Error::from(E_FAIL))?;
                let now = Instant::now();
                let due = st.next_due.unwrap_or(now);
                let next = if due + Duration::from_millis(200) < now { now } else { due };
                st.next_due = Some(next + period);
                next
            };
            let wait = due.saturating_duration_since(Instant::now());
            if !wait.is_zero() {
                std::thread::sleep(wait);
            }
            seq = FRAME_SEQ.lock().map(|g| *g).unwrap_or(seq);
        }
        if let Ok(mut s) = self.st.lock() {
            s.last_seq = seq;
            s.last_out = Some(Instant::now());
        }
        unsafe {
            let size = w * h * 3 / 2;
            let buffer = MFCreateMemoryBuffer(size)?;
            let mut p: *mut u8 = std::ptr::null_mut();
            buffer.Lock(&mut p, None, None)?;
            if !p.is_null() {
                let dst = std::slice::from_raw_parts_mut(p, size as usize);
                fill_frame(dst, w, h, tick);
            }
            buffer.Unlock()?;
            buffer.SetCurrentLength(size)?;

            let sample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(MFGetSystemTime())?;
            sample.SetSampleDuration(10_000_000 / fps.max(1) as i64)?;
            sample.SetUINT32(&MFSampleExtension_CleanPoint, 1)?;
            if let Some(t) = token.as_ref() {
                sample.SetUnknown(&MFSampleExtension_Token, t)?;
            }
            if tick % 300 == 1 {
                log(&format!("sample #{tick} {w}x{h} frames_from_server={}", FRAMES_IN.load(Ordering::Relaxed)));
            }
            let unk: IUnknown = sample.cast()?;
            self.queue.QueueEventParamUnk(MEMediaSample.0 as u32, &GUID::zeroed(), S_OK, &unk)
        }
    }
}

impl IMFMediaStream2_Impl for MediaStream_Impl {
    fn SetStreamState(&self, value: MF_STREAM_STATE) -> Result<()> {
        self.check()?;
        log(&format!("stream SetStreamState {}", value.0));
        if let Ok(mut s) = self.st.lock() {
            s.state = value;
        }
        Ok(())
    }
    fn GetStreamState(&self) -> Result<MF_STREAM_STATE> {
        self.check()?;
        Ok(self.st.lock().map(|s| s.state).unwrap_or(MF_STREAM_STATE_STOPPED))
    }
}

impl IKsControl_Impl for MediaStream_Impl {
    fn KsProperty(&self, _: *const KSIDENTIFIER, _: u32, _: *mut c_void, _: u32, _: *mut u32) -> Result<()> {
        Err(hr_win32(ERROR_SET_NOT_FOUND.0).into())
    }
    fn KsMethod(&self, _: *const KSIDENTIFIER, _: u32, _: *mut c_void, _: u32, _: *mut u32) -> Result<()> {
        Err(hr_win32(ERROR_SET_NOT_FOUND.0).into())
    }
    fn KsEvent(&self, _: *const KSIDENTIFIER, _: u32, _: *mut c_void, _: u32, _: *mut u32) -> Result<()> {
        Err(hr_win32(ERROR_SET_NOT_FOUND.0).into())
    }
}

// ───────────────────────────── the source ─────────────────────────────

struct SourceState {
    shutdown: bool,
    stream: Option<ComObject<MediaStream>>,
    announced: bool,
}

#[implement(IMFMediaSourceEx, IMFGetService, IKsControl)]
struct MediaSource {
    queue: IMFMediaEventQueue,
    pd: IMFPresentationDescriptor,
    sd: IMFStreamDescriptor,
    attrs: IMFAttributes,
    st: Mutex<SourceState>,
}

impl MediaSource {
    fn new() -> Result<Self> {
        unsafe {
            let types: Vec<Option<IMFMediaType>> =
                MODES.iter().map(|&(w, h, f)| video_type(w, h, f).ok()).collect();
            let sd = MFCreateStreamDescriptor(0, &types)?;
            sd.SetGUID(&MF_DEVICESTREAM_STREAM_CATEGORY, &PINNAME_VIDEO_CAPTURE)?;
            sd.SetUINT32(&MF_DEVICESTREAM_STREAM_ID, 0)?;
            sd.SetUINT32(&MF_DEVICESTREAM_FRAMESERVER_SHARED, 1)?;
            sd.SetUINT32(&MF_DEVICESTREAM_ATTRIBUTE_FRAMESOURCE_TYPES, MFFrameSourceTypes_Color.0 as u32)?;
            if let Some(Some(first)) = types.first() {
                sd.GetMediaTypeHandler()?.SetCurrentMediaType(first)?;
            }
            let pd = MFCreatePresentationDescriptor(Some(&[Some(sd.clone())]))?;
            pd.SelectStream(0)?;
            let mut attrs: Option<IMFAttributes> = None;
            MFCreateAttributes(&mut attrs, 4)?;
            let attrs = attrs.ok_or_else(|| Error::from(E_OUTOFMEMORY))?;
            Ok(Self {
                queue: MFCreateEventQueue()?,
                pd,
                sd,
                attrs,
                st: Mutex::new(SourceState { shutdown: false, stream: None, announced: false }),
            })
        }
    }
    fn check(&self) -> Result<()> {
        match self.st.lock() {
            Ok(s) if s.shutdown => Err(MF_E_SHUTDOWN.into()),
            _ => Ok(()),
        }
    }
}

impl IMFMediaEventGenerator_Impl for MediaSource_Impl {
    fn GetEvent(&self, flags: MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS) -> Result<IMFMediaEvent> {
        self.check()?;
        unsafe { self.queue.GetEvent(flags.0 as u32) }
    }
    fn BeginGetEvent(&self, cb: Ref<'_, IMFAsyncCallback>, state: Ref<'_, IUnknown>) -> Result<()> {
        self.check()?;
        unsafe { self.queue.BeginGetEvent(cb.as_ref(), state.as_ref()) }
    }
    fn EndGetEvent(&self, result: Ref<'_, IMFAsyncResult>) -> Result<IMFMediaEvent> {
        self.check()?;
        unsafe { self.queue.EndGetEvent(result.as_ref()) }
    }
    fn QueueEvent(&self, met: u32, ext: *const GUID, hr: HRESULT, v: *const PROPVARIANT) -> Result<()> {
        self.check()?;
        unsafe { self.queue.QueueEventParamVar(met, ext, hr, v) }
    }
}

impl IMFMediaSource_Impl for MediaSource_Impl {
    fn GetCharacteristics(&self) -> Result<u32> {
        self.check()?;
        Ok(MFMEDIASOURCE_IS_LIVE.0 as u32)
    }
    fn CreatePresentationDescriptor(&self) -> Result<IMFPresentationDescriptor> {
        self.check()?;
        unsafe { self.pd.Clone() }
    }
    fn Start(&self, pd: Ref<'_, IMFPresentationDescriptor>, _fmt: *const GUID, start: *const PROPVARIANT) -> Result<()> {
        self.check()?;
        // Which size did the app choose? Read it from the descriptor Windows hands back.
        let (w, h, fps) = unsafe {
            let pd = pd.as_ref().cloned().unwrap_or_else(|| self.pd.clone());
            let mut selected = BOOL(0);
            let mut sd: Option<IMFStreamDescriptor> = None;
            pd.GetStreamDescriptorByIndex(0, &mut selected, &mut sd)?;
            let sd = sd.unwrap_or_else(|| self.sd.clone());
            match sd.GetMediaTypeHandler().and_then(|hd| hd.GetCurrentMediaType()) {
                Ok(t) => { let (w, h) = frame_size(&t); (w, h, frame_rate(&t)) }
                Err(_) => (MODES[0].0, MODES[0].1, MODES[0].2),
            }
        };
        log(&format!("source Start {w}x{h} @{fps}"));
        start_reader();

        let (stream, first) = {
            let mut s = self.st.lock().map_err(|_| Error::from(E_FAIL))?;
            if s.stream.is_none() {
                let me: IMFMediaSource = self.to_interface::<IMFMediaSourceEx>().cast()?;
                let stream = ComObject::new(MediaStream {
                    source: Mutex::new(Some(me)),
                    sd: self.sd.clone(),
                    queue: unsafe { MFCreateEventQueue()? },
                    st: Mutex::new(StreamState { state: MF_STREAM_STATE_STOPPED, shutdown: false, w, h, tick: 0, fps, next_due: None, last_seq: 0, last_out: None }),
                });
                s.stream = Some(stream);
            }
            let first = !s.announced;
            s.announced = true;
            (s.stream.clone().ok_or_else(|| Error::from(E_FAIL))?, first)
        };
        let unk: IUnknown = stream.to_interface();
        unsafe {
            let met = if first { MENewStream } else { MEUpdatedStream };
            self.queue.QueueEventParamUnk(met.0 as u32, &GUID::zeroed(), S_OK, &unk)?;
        }
        stream.set_running(start, w, h, fps)?;
        unsafe { self.queue.QueueEventParamVar(MESourceStarted.0 as u32, &GUID::zeroed(), S_OK, start) }
    }
    fn Stop(&self) -> Result<()> {
        self.check()?;
        log("source Stop");
        let stream = self.st.lock().ok().and_then(|s| s.stream.clone());
        if let Some(st) = stream {
            st.set_stopped()?;
        }
        unsafe { self.queue.QueueEventParamVar(MESourceStopped.0 as u32, &GUID::zeroed(), S_OK, std::ptr::null()) }
    }
    fn Pause(&self) -> Result<()> {
        // A live camera cannot pause; MF never asks a source without CAN_PAUSE.
        Err(MF_E_INVALIDREQUEST.into())
    }
    fn Shutdown(&self) -> Result<()> {
        log("source Shutdown");
        let stream = {
            let mut s = self.st.lock().map_err(|_| Error::from(E_FAIL))?;
            if s.shutdown {
                return Ok(());
            }
            s.shutdown = true;
            s.stream.take()
        };
        if let Some(st) = stream {
            st.shutdown();
        }
        unsafe { self.queue.Shutdown() }
    }
}

impl IMFMediaSourceEx_Impl for MediaSource_Impl {
    fn GetSourceAttributes(&self) -> Result<IMFAttributes> {
        self.check()?;
        Ok(self.attrs.clone())
    }
    fn GetStreamAttributes(&self, id: u32) -> Result<IMFAttributes> {
        self.check()?;
        if id != 0 {
            return Err(MF_E_INVALIDSTREAMNUMBER.into());
        }
        self.sd.cast()
    }
    fn SetD3DManager(&self, _: Ref<'_, IUnknown>) -> Result<()> {
        // We hand out system-memory frames; the Frame Server copies them to the GPU if it wants.
        self.check()
    }
}

impl IMFGetService_Impl for MediaSource_Impl {
    fn GetService(&self, _: *const GUID, _: *const GUID, _: *mut *mut c_void) -> Result<()> {
        Err(MF_E_UNSUPPORTED_SERVICE.into())
    }
}

impl IKsControl_Impl for MediaSource_Impl {
    fn KsProperty(&self, _: *const KSIDENTIFIER, _: u32, _: *mut c_void, _: u32, _: *mut u32) -> Result<()> {
        Err(hr_win32(ERROR_SET_NOT_FOUND.0).into())
    }
    fn KsMethod(&self, _: *const KSIDENTIFIER, _: u32, _: *mut c_void, _: u32, _: *mut u32) -> Result<()> {
        Err(hr_win32(ERROR_SET_NOT_FOUND.0).into())
    }
    fn KsEvent(&self, _: *const KSIDENTIFIER, _: u32, _: *mut c_void, _: u32, _: *mut u32) -> Result<()> {
        Err(hr_win32(ERROR_SET_NOT_FOUND.0).into())
    }
}

// ───────────────────────────── activator ─────────────────────────────

/// Windows asks the factory for an **activator**, not the camera itself: a small
/// object that carries settings (attributes) and creates the real `MediaSource`
/// only when the camera service actually needs it. Everything attribute-related
/// is passed straight through to a standard MF attribute store.
#[implement(IMFActivate)]
struct Activator {
    attrs: IMFAttributes,
    source: Mutex<Option<IMFMediaSourceEx>>,
}

impl Activator {
    fn new() -> Result<Self> {
        let mut a: Option<IMFAttributes> = None;
        unsafe { MFCreateAttributes(&mut a, 8)? };
        Ok(Self { attrs: a.ok_or_else(|| Error::from(E_OUTOFMEMORY))?, source: Mutex::new(None) })
    }
}

impl IMFActivate_Impl for Activator_Impl {
    fn ActivateObject(&self, riid: *const GUID, ppv: *mut *mut c_void) -> Result<()> {
        log(&format!("activator ActivateObject riid={:?}", unsafe { *riid }));
        let mut g = self.source.lock().map_err(|_| Error::from(E_FAIL))?;
        if g.is_none() {
            let src = MediaSource::new().inspect_err(|e| log(&format!("MediaSource::new failed: {e}")))?;
            let ex: IMFMediaSourceEx = ComObject::new(src).into_interface();
            *g = Some(ex);
        }
        let src = g.as_ref().ok_or_else(|| Error::from(E_FAIL))?;
        unsafe { src.query(riid, ppv).ok() }
    }
    fn ShutdownObject(&self) -> Result<()> {
        log("activator ShutdownObject");
        if let Some(s) = self.source.lock().ok().and_then(|mut g| g.take()) {
            unsafe {
                let _ = s.Shutdown();
            }
        }
        Ok(())
    }
    fn DetachObject(&self) -> Result<()> {
        if let Ok(mut g) = self.source.lock() {
            *g = None;
        }
        Ok(())
    }
}

impl IMFAttributes_Impl for Activator_Impl {
    fn GetItem(&self, k: *const GUID, v: *mut PROPVARIANT) -> Result<()> { unsafe { self.attrs.GetItem(k, Some(v)) } }
    fn GetItemType(&self, k: *const GUID) -> Result<MF_ATTRIBUTE_TYPE> { unsafe { self.attrs.GetItemType(k) } }
    fn CompareItem(&self, k: *const GUID, v: *const PROPVARIANT) -> Result<BOOL> { unsafe { self.attrs.CompareItem(k, v) } }
    fn Compare(&self, t: Ref<'_, IMFAttributes>, m: MF_ATTRIBUTES_MATCH_TYPE) -> Result<BOOL> { unsafe { self.attrs.Compare(t.as_ref(), m) } }
    fn GetUINT32(&self, k: *const GUID) -> Result<u32> { unsafe { self.attrs.GetUINT32(k) } }
    fn GetUINT64(&self, k: *const GUID) -> Result<u64> { unsafe { self.attrs.GetUINT64(k) } }
    fn GetDouble(&self, k: *const GUID) -> Result<f64> { unsafe { self.attrs.GetDouble(k) } }
    fn GetGUID(&self, k: *const GUID) -> Result<GUID> { unsafe { self.attrs.GetGUID(k) } }
    fn GetStringLength(&self, k: *const GUID) -> Result<u32> { unsafe { self.attrs.GetStringLength(k) } }
    fn GetString(&self, k: *const GUID, buf: PWSTR, cch: u32, len: *mut u32) -> Result<()> {
        unsafe { self.attrs.GetString(k, std::slice::from_raw_parts_mut(buf.0, cch as usize), Some(len)) }
    }
    fn GetAllocatedString(&self, k: *const GUID, out: *mut PWSTR, len: *mut u32) -> Result<()> { unsafe { self.attrs.GetAllocatedString(k, out, len) } }
    fn GetBlobSize(&self, k: *const GUID) -> Result<u32> { unsafe { self.attrs.GetBlobSize(k) } }
    fn GetBlob(&self, k: *const GUID, buf: *mut u8, cb: u32, size: *mut u32) -> Result<()> {
        unsafe { self.attrs.GetBlob(k, std::slice::from_raw_parts_mut(buf, cb as usize), Some(size)) }
    }
    fn GetAllocatedBlob(&self, k: *const GUID, buf: *mut *mut u8, size: *mut u32) -> Result<()> { unsafe { self.attrs.GetAllocatedBlob(k, buf, size) } }
    fn GetUnknown(&self, k: *const GUID, riid: *const GUID, ppv: *mut *mut c_void) -> Result<()> {
        unsafe {
            let u: IUnknown = self.attrs.GetUnknown(k)?;
            u.query(riid, ppv).ok()
        }
    }
    fn SetItem(&self, k: *const GUID, v: *const PROPVARIANT) -> Result<()> { unsafe { self.attrs.SetItem(k, v) } }
    fn DeleteItem(&self, k: *const GUID) -> Result<()> { unsafe { self.attrs.DeleteItem(k) } }
    fn DeleteAllItems(&self) -> Result<()> { unsafe { self.attrs.DeleteAllItems() } }
    fn SetUINT32(&self, k: *const GUID, v: u32) -> Result<()> { unsafe { self.attrs.SetUINT32(k, v) } }
    fn SetUINT64(&self, k: *const GUID, v: u64) -> Result<()> { unsafe { self.attrs.SetUINT64(k, v) } }
    fn SetDouble(&self, k: *const GUID, v: f64) -> Result<()> { unsafe { self.attrs.SetDouble(k, v) } }
    fn SetGUID(&self, k: *const GUID, v: *const GUID) -> Result<()> { unsafe { self.attrs.SetGUID(k, v) } }
    fn SetString(&self, k: *const GUID, v: &PCWSTR) -> Result<()> { unsafe { self.attrs.SetString(k, *v) } }
    fn SetBlob(&self, k: *const GUID, buf: *const u8, cb: u32) -> Result<()> {
        unsafe { self.attrs.SetBlob(k, std::slice::from_raw_parts(buf, cb as usize)) }
    }
    fn SetUnknown(&self, k: *const GUID, u: Ref<'_, IUnknown>) -> Result<()> { unsafe { self.attrs.SetUnknown(k, u.as_ref()) } }
    fn LockStore(&self) -> Result<()> { unsafe { self.attrs.LockStore() } }
    fn UnlockStore(&self) -> Result<()> { unsafe { self.attrs.UnlockStore() } }
    fn GetCount(&self) -> Result<u32> { unsafe { self.attrs.GetCount() } }
    fn GetItemByIndex(&self, i: u32, k: *mut GUID, v: *mut PROPVARIANT) -> Result<()> { unsafe { self.attrs.GetItemByIndex(i, k, Some(v)) } }
    fn CopyAllItems(&self, d: Ref<'_, IMFAttributes>) -> Result<()> { unsafe { self.attrs.CopyAllItems(d.as_ref()) } }
}

// ───────────────────────────── factory + DLL exports ─────────────────────────────

#[implement(IClassFactory)]
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, outer: Ref<'_, IUnknown>, riid: *const GUID, ppv: *mut *mut c_void) -> Result<()> {
        if !outer.is_null() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        log(&format!("factory CreateInstance riid={:?}", unsafe { *riid }));
        let act: IUnknown = ComObject::new(Activator::new()?).into_interface();
        let r = unsafe { act.query(riid, ppv) };
        if r.is_ok() {
            return Ok(());
        }
        // Someone asked for the source directly — give them one.
        let src = MediaSource::new().inspect_err(|e| log(&format!("MediaSource::new failed: {e}")))?;
        let unk: IUnknown = ComObject::new(src).into_interface();
        unsafe { unk.query(riid, ppv).ok() }
    }
    fn LockServer(&self, _: BOOL) -> Result<()> {
        Ok(())
    }
}

#[unsafe(no_mangle)]
extern "system" fn DllMain(hinst: HINSTANCE, reason: u32, _: *mut c_void) -> BOOL {
    if reason == DLL_PROCESS_ATTACH {
        MODULE.store(hinst.0 as isize, Ordering::SeqCst);
    }
    TRUE
}

#[unsafe(no_mangle)]
extern "system" fn DllGetClassObject(clsid: *const GUID, riid: *const GUID, ppv: *mut *mut c_void) -> HRESULT {
    unsafe {
        if ppv.is_null() || clsid.is_null() {
            return E_POINTER;
        }
        *ppv = std::ptr::null_mut();
        if *clsid != CLSID_CAMOS_SOURCE {
            return CLASS_E_CLASSNOTAVAILABLE;
        }
        let f: IClassFactory = Factory.into();
        f.query(riid, ppv)
    }
}

/// Never unload: the pipe reader thread lives in this DLL. The Frame Server is a
/// long-lived service, so keeping ~1 MB resident costs nothing.
#[unsafe(no_mangle)]
extern "system" fn DllCanUnloadNow() -> HRESULT {
    S_FALSE
}

fn module_path() -> Option<String> {
    let mut buf = [0u16; 1024];
    let n = unsafe { GetModuleFileNameW(Some(HMODULE(MODULE.load(Ordering::SeqCst) as *mut c_void)), &mut buf) } as usize;
    (n > 0).then(|| String::from_utf16_lossy(&buf[..n]))
}

fn clsid_key() -> String {
    format!("SOFTWARE\\Classes\\CLSID\\{{{:?}}}", CLSID_CAMOS_SOURCE)
}

fn set_str(key: HKEY, name: Option<&str>, value: &str) -> Result<()> {
    let wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = unsafe { std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2) };
    let name_w: Option<Vec<u16>> = name.map(|n| n.encode_utf16().chain(std::iter::once(0)).collect());
    let pname = name_w.as_ref().map(|v| PCWSTR(v.as_ptr())).unwrap_or(PCWSTR::null());
    unsafe { RegSetValueExW(key, pname, None, REG_SZ, Some(bytes)).ok() }
}

fn create_key(path: &str) -> Result<HKEY> {
    let w: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut k = HKEY::default();
    unsafe {
        RegCreateKeyExW(HKEY_LOCAL_MACHINE, PCWSTR(w.as_ptr()), None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut k, None)
            .ok()?;
    }
    Ok(k)
}

#[unsafe(no_mangle)]
extern "system" fn DllRegisterServer() -> HRESULT {
    let r = (|| -> Result<()> {
        let path = module_path().ok_or_else(|| Error::from(E_FAIL))?;
        let base = clsid_key();
        let k = create_key(&base)?;
        set_str(k, None, "CamOS Camera Source")?;
        unsafe {
            let _ = RegCloseKey(k);
        }
        let k = create_key(&format!("{base}\\InprocServer32"))?;
        set_str(k, None, &path)?;
        set_str(k, Some("ThreadingModel"), "Both")?;
        unsafe {
            let _ = RegCloseKey(k);
        }
        Ok(())
    })();
    match r {
        Ok(()) => S_OK,
        Err(e) => e.code(),
    }
}

#[unsafe(no_mangle)]
extern "system" fn DllUnregisterServer() -> HRESULT {
    let w: Vec<u16> = clsid_key().encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let _ = RegDeleteTreeW(HKEY_LOCAL_MACHINE, PCWSTR(w.as_ptr()));
    }
    S_OK
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clsid_key_has_braces() {
        assert_eq!(clsid_key(), "SOFTWARE\\Classes\\CLSID\\{6F3C2A71-4B8E-4D2A-9C15-8E0B7D3A5C42}");
    }

    #[test]
    fn scale_same_size_is_copy_and_down_scale_fits() {
        let src: Vec<u8> = (0..(8 * 4 * 3 / 2)).map(|i| i as u8).collect();
        let mut dst = vec![0u8; src.len()];
        scale_nv12(&src, 8, 4, &mut dst, 8, 4);
        assert_eq!(src, dst);
        let mut small = vec![0u8; 4 * 2 * 3 / 2];
        scale_nv12(&src, 8, 4, &mut small, 4, 2);
        assert_eq!(small[0], src[0]);
    }

    #[test]
    fn tall_picture_is_fitted_with_black_bars() {
        // 4x8 tall source of white (Y=235) into an 8x4 wide frame: centred 2x4 column, black either side.
        let (sw, sh) = (4usize, 8usize);
        let mut src = vec![235u8; sw * sh * 3 / 2];
        src[sw * sh..].fill(128);
        let (dw, dh) = (8usize, 4usize);
        let mut dst = vec![0u8; dw * dh * 3 / 2];
        scale_nv12(&src, sw as u32, sh as u32, &mut dst, dw as u32, dh as u32);
        assert_eq!(dst[0], 16);
        assert_eq!(dst[dw - 1], 16);
        assert_eq!(dst[2], 235); // fitted column starts at x = 2 (even-aligned)
        assert!(dst[dw * dh..].iter().all(|&v| v == 128));
    }

    #[test]
    fn pacing_follows_a_slow_phone_and_keeps_rhythm_for_a_fast_one() {
        let p30 = Duration::from_micros(33_333);
        let p60 = Duration::from_micros(16_667);
        assert!(!follow_phone(true, p60, p30), "60 fps phone into a 30 fps app: steady 30, newest frame");
        assert!(!follow_phone(true, p30, p30), "same rate: steady rhythm");
        assert!(follow_phone(true, p30, p60), "30 fps phone into a 60 fps app: follow the phone");
        assert!(!follow_phone(false, p30, p60), "no phone: steady clock for the waiting picture");
    }

    #[test]
    fn placeholder_fills_whole_buffer() {
        let (w, h) = (64u32, 36u32);
        let mut b = vec![0u8; (w * h * 3 / 2) as usize];
        placeholder(&mut b, w, h, 5);
        assert!(b[(w * h) as usize..].chunks(2).all(|p| p == [118, 140]));
    }
}
