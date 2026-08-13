//! Pairing key + QR payload.
//!
//! Ported from `server.py::_load_or_create_key`. Two properties matter and both
//! are contracts, not preferences:
//!
//! * **Same file, same format.** The key lives at
//!   `%LOCALAPPDATA%\GamepadServer\pairing_key.txt` as 8 lowercase hex chars.
//!   Reading the *existing* file is what makes this server a drop-in
//!   replacement — a phone already paired with the Python server keeps working
//!   with no re-scan. Writing a different format would silently un-pair every
//!   existing user.
//! * **Persisted, not per-run.** A fresh key every launch would force a QR
//!   re-scan after every restart.
//!
//! The QR payload is `"{ip},{port},{key}"` — parsed by the phone's scanner, so
//! it is a wire contract too. Rendering the QR image is UI and deliberately
//! deferred to the tray work.

use std::path::PathBuf;

/// `%LOCALAPPDATA%\GamepadServer`, falling back to the home directory.
pub fn config_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .or_else(|_| std::env::var("USERPROFILE"))
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join("GamepadServer")
}

pub fn key_path() -> PathBuf {
    config_dir().join("pairing_key.txt")
}

/// A key is exactly 8 lowercase hex characters (4 random bytes).
pub fn is_valid_key(k: &str) -> bool {
    k.len() == 8 && k.chars().all(|c| c.is_ascii_hexdigit())
}

/// The 32-bit token the phone puts in every packet's `authToken` field.
/// Python: `expected_hash = int(key, 16)`.
pub fn expected_hash(key: &str) -> Option<u32> {
    u32::from_str_radix(key, 16).ok()
}

/// What the phone's QR scanner parses. Python: `f"{ip},{port},{key}"`.
pub fn qr_payload(ip: &str, port: u16, key: &str) -> String {
    format!("{ip},{port},{key}")
}

/// 4 cryptographically-secure random bytes as 8 lowercase hex chars.
///
/// Uses the OS CSPRNG. If it fails we return an error rather than falling back
/// to something weaker — this key authenticates gamepad input on the LAN, so a
/// predictable key is worse than a loud failure.
/// Fill `buf` from the OS CSPRNG. Shared by the pairing key and by GRX's
/// per-session X25519 ephemeral, so there is exactly one randomness source in
/// the server and it is the operating system's.
#[cfg(windows)]
pub fn os_random(buf: &mut [u8]) -> Result<(), String> {
    use std::ffi::c_void;
    #[link(name = "bcrypt")]
    unsafe extern "system" {
        fn BCryptGenRandom(
            h_algorithm: *mut c_void,
            pb_buffer: *mut u8,
            cb_buffer: u32,
            dw_flags: u32,
        ) -> i32;
    }
    const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 0x0000_0002;

    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            buf.as_mut_ptr(),
            buf.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status != 0 {
        return Err(format!("BCryptGenRandom failed (status {status:#X})"));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn os_random(buf: &mut [u8]) -> Result<(), String> {
    use std::io::Read;
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(buf))
        .map_err(|e| format!("/dev/urandom failed: {e}"))
}

fn random_key() -> Result<String, String> {
    let mut b = [0u8; 4];
    os_random(&mut b)?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

/// Load the existing pairing key, or create and persist a new one.
///
/// Mirrors the Python fallback behaviour: if the key cannot be written to disk
/// we still return a valid key and run with it for this session, because a
/// server that refuses to start over a disk hiccup is worse than one that asks
/// for a re-scan.
pub fn load_or_create_key() -> Result<String, String> {
    let path = key_path();
    if let Ok(raw) = std::fs::read_to_string(&path) {
        let k = raw.trim().to_ascii_lowercase();
        if is_valid_key(&k) {
            return Ok(k);
        }
        eprintln!("pairing key at {} is malformed — regenerating", path.display());
    }
    let k = random_key()?;
    if let Err(e) = std::fs::create_dir_all(config_dir())
        .and_then(|_| std::fs::write(&path, &k))
    {
        eprintln!(
            "warn: could not persist the pairing key to {} ({e}) — using a \
             session-only key; the phone will need a re-scan after restart",
            path.display()
        );
    }
    Ok(k)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_validation_matches_python_rules() {
        assert!(is_valid_key("777a51b3"));
        assert!(is_valid_key("00000000"));
        assert!(is_valid_key("FFFFFFFF")); // hex digits, case-insensitive check
        assert!(!is_valid_key("777a51b"), "7 chars is invalid");
        assert!(!is_valid_key("777a51b34"), "9 chars is invalid");
        assert!(!is_valid_key("777a51gz"), "non-hex is invalid");
        assert!(!is_valid_key(""));
    }

    #[test]
    fn expected_hash_parses_like_python_int_key_16() {
        assert_eq!(expected_hash("abcd1234"), Some(0xABCD_1234));
        assert_eq!(expected_hash("00000000"), Some(0));
        assert_eq!(expected_hash("ffffffff"), Some(0xFFFF_FFFF));
        assert_eq!(expected_hash("nothex"), None);
    }

    /// The phone's scanner parses this exact string — comma-separated, no spaces.
    #[test]
    fn qr_payload_is_ip_port_key_csv() {
        assert_eq!(
            qr_payload("192.168.1.34", 7777, "777a51b3"),
            "192.168.1.34,7777,777a51b3"
        );
        let p = qr_payload("10.0.0.1", 7777, "deadbeef");
        assert_eq!(p.split(',').count(), 3);
    }

    #[test]
    fn generated_keys_are_valid_and_not_constant() {
        let a = random_key().expect("OS RNG must work");
        let b = random_key().expect("OS RNG must work");
        assert!(is_valid_key(&a), "generated key {a} is not 8 hex chars");
        assert!(is_valid_key(&b));
        // Not a strong randomness test — just catches a stubbed/zeroed RNG.
        assert_ne!(a, b, "two consecutive keys must not be identical");
        assert_ne!(a, "00000000");
    }

    /// Live check against the REAL key this machine already uses: whatever the
    /// Python server paired with must load cleanly here, or existing users get
    /// silently un-paired.
    #[test]
    fn existing_key_on_this_machine_loads_and_parses() {
        let k = load_or_create_key().expect("key load must succeed");
        assert!(is_valid_key(&k), "loaded key {k} is not 8 hex chars");
        assert!(expected_hash(&k).is_some(), "loaded key must parse as u32 hex");
        // Loading twice must be stable — a changing key would force a re-scan.
        let k2 = load_or_create_key().expect("second load must succeed");
        assert_eq!(k, k2, "pairing key must be stable across loads");
    }
}
