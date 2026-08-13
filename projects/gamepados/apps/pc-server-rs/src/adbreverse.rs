//! `adb reverse` watcher — the tunnel that makes the USB-debugging transport
//! reachable.
//!
//! The phone dials `ws://127.0.0.1:7777`. That only resolves to us if
//! `adb reverse tcp:7777 tcp:7777` is active for that device, so the server
//! keeps it alive. Ported from `server.py::start_adb_reverse_watcher`.
//!
//! Two behaviours matter:
//! * **Per-serial mapping.** A bare `adb reverse` errors when more than one
//!   device is attached, so each device is mapped by serial — that is what lets
//!   two phones connect over USB simultaneously.
//! * **Gentle cadence.** 5 s while a phone is attached, 10 s when none is (adb
//!   is irrelevant to Wi-Fi pairing), so this costs almost nothing at idle.
//!
//! NOT ported on purpose: Python's `adb kill-server` at exit. That exists only
//! to release the adb binary it unpacks into a PyInstaller temp dir so the temp
//! dir can be deleted — we bundle nothing, and killing the adb server would
//! disrupt any other adb session the user has open (including a debugger).

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

/// Serials of attached, authorised devices from `adb devices` output.
///
/// Only `device` state counts — `unauthorized` (no USB-debugging prompt
/// accepted yet) and `offline` cannot accept a reverse mapping.
pub fn parse_devices(out: &str) -> Vec<String> {
    out.lines()
        .skip(1) // "List of devices attached"
        .filter_map(|line| {
            let mut p = line.split_whitespace();
            let serial = p.next()?;
            let state = p.next()?;
            (state == "device" && !serial.is_empty()).then(|| serial.to_string())
        })
        .collect()
}

/// Locate `adb.exe`: next to our binary, a sibling `platform-tools`, the folder
/// the Python server extracts to, then PATH.
pub fn find_adb() -> Option<PathBuf> {
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            cands.push(dir.join("adb.exe"));
            cands.push(dir.join("platform-tools").join("adb.exe"));
            cands.push(dir.join("..").join("platform-tools").join("adb.exe"));
        }
    }
    // Where the Python server keeps its extracted copy.
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        cands.push(PathBuf::from(&local).join("GamepadServer").join("adb").join("adb.exe"));
    }
    for c in cands {
        if c.exists() {
            return Some(c);
        }
    }
    // Fall back to PATH — probe it rather than assume.
    let probe = new_command(&PathBuf::from("adb")).arg("version").output();
    match probe {
        Ok(o) if o.status.success() => Some(PathBuf::from("adb")),
        _ => None,
    }
}

/// Build a Command that never flashes a console window (this server may run
/// windowless; Python passes CREATE_NO_WINDOW for the same reason).
fn new_command(adb: &PathBuf) -> Command {
    let mut c = Command::new(adb);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// Keep `adb reverse tcp:port tcp:port` alive for every attached device.
/// No-ops (with one log line) if adb isn't available — Wi-Fi/tether are
/// unaffected, only the USB-debugging transport needs this.
pub fn start_adb_reverse_watcher(port: u16) {
    let Some(adb) = find_adb() else {
        println!("  adb     : not found — USB-debugging transport unavailable (Wi-Fi/tether unaffected)");
        return;
    };
    println!("  adb     : {} (reverse tcp:{port} kept alive)", adb.display());

    std::thread::spawn(move || {
        let mut announced: Vec<String> = Vec::new();
        loop {
            let mut serials: Vec<String> = Vec::new();
            if let Ok(out) = new_command(&adb).arg("devices").output() {
                serials = parse_devices(&String::from_utf8_lossy(&out.stdout));
                for serial in &serials {
                    let _ = new_command(&adb)
                        .args(["-s", serial, "reverse", &format!("tcp:{port}"), &format!("tcp:{port}")])
                        .output();
                }
            }
            if serials != announced {
                if serials.is_empty() {
                    println!("adb: no devices attached");
                } else {
                    println!("adb: reverse tunnel active for {serials:?}");
                }
                announced = serials.clone();
            }
            // Only poll often when a phone is actually there.
            std::thread::sleep(if serials.is_empty() {
                Duration::from_secs(10)
            } else {
                Duration::from_secs(5)
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_authorised_devices_only() {
        let out = "List of devices attached\n\
                   DAIFEYGEKB89V4QG\tdevice\n\
                   10BF4Y2T7L008EE\tdevice\n\
                   \n";
        assert_eq!(
            parse_devices(out),
            vec!["DAIFEYGEKB89V4QG", "10BF4Y2T7L008EE"]
        );
    }

    #[test]
    fn ignores_unauthorised_and_offline_devices() {
        // An unauthorised phone (USB-debugging prompt not accepted) cannot take
        // a reverse mapping — trying anyway just logs errors every 5s.
        let out = "List of devices attached\n\
                   AAAA\tunauthorized\n\
                   BBBB\toffline\n\
                   CCCC\tdevice\n";
        assert_eq!(parse_devices(out), vec!["CCCC"]);
    }

    #[test]
    fn handles_empty_and_malformed_output() {
        assert!(parse_devices("List of devices attached\n\n").is_empty());
        assert!(parse_devices("").is_empty());
        assert!(parse_devices("List of devices attached\ngarbage\n").is_empty());
    }
}
