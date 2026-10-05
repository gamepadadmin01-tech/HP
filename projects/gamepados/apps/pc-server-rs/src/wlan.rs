//! Wi-Fi "streaming mode" while a phone is connected (added 2026-10-05, 2.1.4).
//!
//! ## Why
//!
//! With the PC on Wi-Fi (typically joined to the controller phone's own
//! hotspot), Windows does two things that wreck a game controller:
//!
//!   * **Background scans.** About once a minute the Wi-Fi card leaves the
//!     channel to look for other networks. Nothing arrives for 100-300 ms, then
//!     everything that was held arrives at once.
//!   * **Power save.** Between packets the card naps; the access point (here:
//!     the phone) keeps our packets until it wakes.
//!
//! Both turn a steady 125 Hz input stream into silence-then-a-pile, which is
//! what made taps go missing and a held throttle stutter. Windows has a
//! documented per-interface switch for each: `wlan_intf_opcode_background_scan_enabled`
//! (FALSE) and `wlan_intf_opcode_media_streaming_mode` (TRUE) — the same knobs
//! game-streaming tools use. We set them only while at least one UDP phone is
//! connected, and put the ORIGINAL values back afterwards.
//!
//! ## Safety rules
//!
//!   * **wlanapi.dll is loaded at runtime**, never linked: a PC without the Wi-Fi
//!     API (some Windows Server / N installs) must still start the server.
//!   * **Never on the receive thread.** Every call here can take tens of ms; a
//!     worker thread does the work, the receive loop only flips a flag.
//!   * **Always restore.** Microsoft does not document whether closing the
//!     handle undoes these settings, so we restore the values we read first,
//!     ourselves. The originals are also written to `wlan_restore.txt` before
//!     anything is changed; if the server is killed mid-session, the next start
//!     finds that file and restores them.
//!   * **Best effort.** A refusal (ERROR_ACCESS_DENIED, a driver that ignores the
//!     hint) is logged once and otherwise ignored. On this project's dev PC the
//!     default permissions grant both to normal users (checked 2026-10-05 with
//!     WlanGetSecuritySettings: Builtin Users have WLAN_WRITE_ACCESS).
//!   * **Dry-run never touches Wi-Fi** (it is the automated test mode) unless
//!     `GAMEPAD_WLAN=1` is set, which exists only to verify this module.

use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;

/// The receive loop's handle on the worker. `set_wanted` is cheap: it only
/// sends when the wanted state actually changes.
pub struct WlanTuner {
    tx: Option<Sender<bool>>,
    last: std::cell::Cell<bool>,
}

impl WlanTuner {
    /// Start the worker. `enabled = false` (dry-run) gives an inert tuner.
    pub fn start(enabled: bool) -> WlanTuner {
        if !enabled || !cfg!(windows) {
            return WlanTuner { tx: None, last: std::cell::Cell::new(false) };
        }
        let (tx, rx) = channel::<bool>();
        let spawned = std::thread::Builder::new().name("wlan-tuner".into()).spawn(move || {
            // A previous run that was killed mid-session left its originals.
            imp::restore_leftover();
            while let Ok(on) = rx.recv() {
                if on {
                    imp::apply();
                } else {
                    imp::restore();
                }
            }
            imp::restore();
        });
        WlanTuner {
            tx: spawned.ok().map(|_| tx),
            last: std::cell::Cell::new(false),
        }
    }

    /// `true` while at least one UDP phone is connected.
    pub fn set_wanted(&self, on: bool) {
        if self.last.get() == on {
            return;
        }
        self.last.set(on);
        if let Some(tx) = &self.tx {
            let _ = tx.send(on);
        }
    }
}

/// Put the original Wi-Fi settings back NOW, from any thread. Called on the
/// window-close path just before `process::exit`, which would otherwise kill
/// the worker before it could restore.
pub fn restore_now() {
    #[cfg(windows)]
    imp::restore();
}

/// Settings currently changed by us: the client handle and, per interface,
/// (guid, original background-scan, original streaming-mode).
struct Applied {
    handle: isize,
    changed: Vec<([u8; 16], Option<u32>, Option<u32>)>,
}

static APPLIED: Mutex<Option<Applied>> = Mutex::new(None);

fn restore_file() -> std::path::PathBuf {
    crate::pairing::config_dir().join("wlan_restore.txt")
}

fn hex(g: &[u8; 16]) -> String {
    g.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<[u8; 16]> {
    if s.len() != 32 {
        return None;
    }
    let mut g = [0u8; 16];
    for (i, b) in g.iter_mut().enumerate() {
        *b = u8::from_str_radix(s.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(g)
}

fn opt(v: Option<u32>) -> String {
    v.map_or("-".to_string(), |x| x.to_string())
}

fn unopt(s: &str) -> Option<u32> {
    s.parse().ok()
}

#[cfg(windows)]
mod imp {
    use super::{hex, opt, restore_file, unhex, unopt, Applied, APPLIED};
    use core::ffi::c_void;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LoadLibraryW(name: *const u16) -> isize;
        fn GetProcAddress(module: isize, name: *const u8) -> *const c_void;
    }

    const OP_BACKGROUND_SCAN: i32 = 2; // wlan_intf_opcode_background_scan_enabled
    const OP_MEDIA_STREAMING: i32 = 3; // wlan_intf_opcode_media_streaming_mode
    const STATE_CONNECTED: u32 = 1; // wlan_interface_state_connected

    type OpenHandle = unsafe extern "system" fn(u32, *const c_void, *mut u32, *mut isize) -> u32;
    type CloseHandle = unsafe extern "system" fn(isize, *const c_void) -> u32;
    type EnumInterfaces = unsafe extern "system" fn(isize, *const c_void, *mut *mut u8) -> u32;
    type QueryInterface = unsafe extern "system" fn(
        isize,
        *const [u8; 16],
        i32,
        *const c_void,
        *mut u32,
        *mut *mut c_void,
        *mut i32,
    ) -> u32;
    type SetInterface =
        unsafe extern "system" fn(isize, *const [u8; 16], i32, u32, *const c_void, *const c_void) -> u32;
    type FreeMemory = unsafe extern "system" fn(*mut c_void);

    struct Api {
        open: OpenHandle,
        close: CloseHandle,
        enum_if: EnumInterfaces,
        query: QueryInterface,
        set: SetInterface,
        free: FreeMemory,
    }

    fn api() -> Option<&'static Api> {
        static API: std::sync::OnceLock<Option<Api>> = std::sync::OnceLock::new();
        API.get_or_init(|| unsafe {
            let name: Vec<u16> = "wlanapi.dll\0".encode_utf16().collect();
            let m = LoadLibraryW(name.as_ptr());
            if m == 0 {
                return None;
            }
            let f = |n: &[u8]| {
                let p = GetProcAddress(m, n.as_ptr());
                if p.is_null() { None } else { Some(p) }
            };
            Some(Api {
                open: std::mem::transmute::<*const c_void, OpenHandle>(f(b"WlanOpenHandle\0")?),
                close: std::mem::transmute::<*const c_void, CloseHandle>(f(b"WlanCloseHandle\0")?),
                enum_if: std::mem::transmute::<*const c_void, EnumInterfaces>(f(b"WlanEnumInterfaces\0")?),
                query: std::mem::transmute::<*const c_void, QueryInterface>(f(b"WlanQueryInterface\0")?),
                set: std::mem::transmute::<*const c_void, SetInterface>(f(b"WlanSetInterface\0")?),
                free: std::mem::transmute::<*const c_void, FreeMemory>(f(b"WlanFreeMemory\0")?),
            })
        })
        .as_ref()
    }

    fn open(a: &Api) -> Option<isize> {
        let mut ver = 0u32;
        let mut h: isize = 0;
        let rc = unsafe { (a.open)(2, std::ptr::null(), &mut ver, &mut h) };
        (rc == 0).then_some(h)
    }

    /// GUIDs of Wi-Fi interfaces that are currently connected.
    fn connected(a: &Api, h: isize) -> Vec<[u8; 16]> {
        let mut out = Vec::new();
        let mut list: *mut u8 = std::ptr::null_mut();
        if unsafe { (a.enum_if)(h, std::ptr::null(), &mut list) } != 0 || list.is_null() {
            return out;
        }
        // WLAN_INTERFACE_INFO_LIST: u32 count, u32 index, then items of
        // { GUID (16), WCHAR[256] description (512), u32 state } = 532 bytes.
        unsafe {
            let n = (list as *const u32).read_unaligned() as usize;
            for i in 0..n.min(16) {
                let item = list.add(8 + i * 532);
                let mut g = [0u8; 16];
                std::ptr::copy_nonoverlapping(item, g.as_mut_ptr(), 16);
                let state = (item.add(528) as *const u32).read_unaligned();
                if state == STATE_CONNECTED {
                    out.push(g);
                }
            }
            (a.free)(list as *mut c_void);
        }
        out
    }

    fn query(a: &Api, h: isize, g: &[u8; 16], op: i32) -> Option<u32> {
        let mut size = 0u32;
        let mut data: *mut c_void = std::ptr::null_mut();
        let rc = unsafe {
            (a.query)(h, g, op, std::ptr::null(), &mut size, &mut data, std::ptr::null_mut())
        };
        if rc != 0 || data.is_null() {
            return None;
        }
        let v = if size >= 4 { unsafe { (data as *const u32).read_unaligned() } } else { 0 };
        unsafe { (a.free)(data) };
        Some(v)
    }

    fn set(a: &Api, h: isize, g: &[u8; 16], op: i32, v: u32) -> u32 {
        unsafe { (a.set)(h, g, op, 4, &v as *const u32 as *const c_void, std::ptr::null()) }
    }

    /// Phone connected: stop background scans, ask for streaming mode.
    pub fn apply() {
        let Some(a) = api() else {
            println!("wifi    : Wi-Fi API not available on this PC — nothing to tune");
            return;
        };
        let mut guard = APPLIED.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            return;
        }
        let Some(h) = open(a) else { return };
        let ifs = connected(a, h);
        if ifs.is_empty() {
            unsafe { (a.close)(h, std::ptr::null()) };
            return; // PC on a cable: nothing to do
        }
        let originals: Vec<([u8; 16], Option<u32>, Option<u32>)> = ifs
            .iter()
            .map(|g| (*g, query(a, h, g, OP_BACKGROUND_SCAN), query(a, h, g, OP_MEDIA_STREAMING)))
            .collect();
        // Write the originals down BEFORE changing anything, so a crash between
        // here and the restore can still be undone by the next start.
        let text: String = originals
            .iter()
            .map(|(g, b, m)| format!("{} {} {}\n", hex(g), opt(*b), opt(*m)))
            .collect();
        let _ = std::fs::create_dir_all(crate::pairing::config_dir());
        let _ = std::fs::write(restore_file(), text);
        for (g, b, m) in &originals {
            let scan = set(a, h, g, OP_BACKGROUND_SCAN, 0);
            let stream = set(a, h, g, OP_MEDIA_STREAMING, 1);
            println!(
                "wifi    : phone connected -> background scan off ({}), streaming mode on ({}) [was scan={} stream={}]",
                if scan == 0 { "ok".to_string() } else { format!("refused, error {scan}") },
                if stream == 0 { "ok".to_string() } else { format!("refused, error {stream}") },
                opt(*b),
                opt(*m),
            );
        }
        *guard = Some(Applied { handle: h, changed: originals });
    }

    /// Phone gone / server closing: put every original value back.
    pub fn restore() {
        let Some(a) = api() else { return };
        let mut guard = APPLIED.lock().unwrap_or_else(|e| e.into_inner());
        let Some(applied) = guard.take() else { return };
        for (g, b, m) in &applied.changed {
            if let Some(v) = b {
                set(a, applied.handle, g, OP_BACKGROUND_SCAN, *v);
            }
            if let Some(v) = m {
                set(a, applied.handle, g, OP_MEDIA_STREAMING, *v);
            }
        }
        unsafe { (a.close)(applied.handle, std::ptr::null()) };
        let _ = std::fs::remove_file(restore_file());
        println!("wifi    : no phone connected -> original Wi-Fi settings restored");
    }

    /// The server was killed while a phone was connected: undo it now.
    pub fn restore_leftover() {
        let Ok(text) = std::fs::read_to_string(restore_file()) else { return };
        let Some(a) = api() else { return };
        let Some(h) = open(a) else { return };
        for line in text.lines() {
            let mut it = line.split_whitespace();
            let (Some(g), Some(b), Some(m)) = (it.next(), it.next(), it.next()) else { continue };
            let Some(g) = unhex(g) else { continue };
            if let Some(v) = unopt(b) {
                set(a, h, &g, OP_BACKGROUND_SCAN, v);
            }
            if let Some(v) = unopt(m) {
                set(a, h, &g, OP_MEDIA_STREAMING, v);
            }
        }
        unsafe { (a.close)(h, std::ptr::null()) };
        let _ = std::fs::remove_file(restore_file());
        println!("wifi    : restored Wi-Fi settings left by a previous run that did not close cleanly");
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn apply() {}
    pub fn restore() {}
    pub fn restore_leftover() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guid_hex_round_trips() {
        let g: [u8; 16] = [0, 1, 2, 0xab, 0xcd, 0xef, 9, 10, 11, 12, 13, 14, 15, 0xfe, 0x7f, 0x80];
        assert_eq!(unhex(&hex(&g)), Some(g));
        assert_eq!(unhex("zz"), None);
    }

    #[test]
    fn unknown_original_is_left_alone() {
        assert_eq!(unopt(&opt(None)), None, "an unreadable original must not be 'restored' to 0");
        assert_eq!(unopt(&opt(Some(1))), Some(1));
    }

    #[test]
    fn inert_tuner_does_nothing() {
        let t = WlanTuner::start(false);
        t.set_wanted(true);
        t.set_wanted(false);
    }
}
