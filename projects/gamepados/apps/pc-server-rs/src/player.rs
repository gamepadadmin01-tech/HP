//! "Connected players" (owner, 2026-11-13: "a small column showing the name of the app user connected if he is
//! signed in"). While the controller is open, the phone sends one small NAME frame every 5 s: the signed-in
//! player's display name, or "Guest". The window lists each playing phone with its name.
//!
//! ## The frame (48 bytes, cleartext, on the input socket)
//!
//! `"GPN"` · version `1` · name length `n` (1..=43) · `n` bytes of UTF-8 · zero padding to 48.
//!
//! It cannot be mistaken for anything else on the socket: input is 20 bytes (GRX-sealed input 41), tickets are 96
//! bytes, GRX handshakes start with 0xE1..0xE3. A server older than this ignores it (unknown length).
//!
//! ## Why cleartext is fine
//!
//! It is a label for the window, nothing more: it grants nothing, and a wrong name changes nothing but the text.
//! It is the player's display name, sent only to their own PC on their own network. It is never logged.

/// Length of every NAME frame.
pub const NAME_FRAME_LEN: usize = 48;
const MAGIC: &[u8; 3] = b"GPN";
const VERSION: u8 = 1;
/// Names are cut to this many characters for the window.
pub const MAX_NAME_CHARS: usize = 24;

/// Cheap check used while draining the socket: right length and magic. Parsing happens after the drain.
pub fn looks_like_name(frame: &[u8]) -> bool {
    frame.len() == NAME_FRAME_LEN && &frame[0..3] == MAGIC
}

/// The name in a NAME frame, cleaned for display: control characters removed, trimmed, at most
/// `MAX_NAME_CHARS` characters. `None` for anything malformed or empty.
pub fn parse_name(frame: &[u8]) -> Option<String> {
    if !looks_like_name(frame) || frame[3] != VERSION {
        return None;
    }
    let n = frame[4] as usize;
    if n == 0 || n > NAME_FRAME_LEN - 5 {
        return None;
    }
    let s = std::str::from_utf8(&frame[5..5 + n]).ok()?;
    let clean: String = s.chars().filter(|c| !c.is_control()).collect();
    let t: String = clean.trim().chars().take(MAX_NAME_CHARS).collect();
    let t = t.trim().to_string();
    if t.is_empty() { None } else { Some(t) }
}

/// One playing phone, as the window shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerRow {
    /// XInput slot (0-based): "Player 1" is slot 0.
    pub slot: usize,
    /// The name the phone sent, if any (USB-debugging phones cannot send one).
    pub name: Option<String>,
    /// Connected over USB (tether or USB debugging) rather than Wi-Fi.
    pub usb: bool,
}

/// Build a NAME frame (used by the tests; the phone builds the same bytes in controller-ui platform/native.ts).
pub fn name_frame(name: &str) -> [u8; NAME_FRAME_LEN] {
    let mut f = [0u8; NAME_FRAME_LEN];
    f[0..3].copy_from_slice(MAGIC);
    f[3] = VERSION;
    let mut bytes = name.as_bytes();
    while bytes.len() > NAME_FRAME_LEN - 5 {
        // Cut at a character boundary.
        let mut cut = NAME_FRAME_LEN - 5;
        while !name.is_char_boundary(cut) { cut -= 1; }
        bytes = &name.as_bytes()[..cut];
    }
    f[4] = bytes.len() as u8;
    f[5..5 + bytes.len()].copy_from_slice(bytes);
    f
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        assert_eq!(parse_name(&name_frame("Akhil")).as_deref(), Some("Akhil"));
        assert_eq!(parse_name(&name_frame("Guest")).as_deref(), Some("Guest"));
    }

    #[test]
    fn non_ascii_names_survive() {
        assert_eq!(parse_name(&name_frame("Thiago Dí Pietrantonio")).as_deref(), Some("Thiago Dí Pietrantonio"));
        assert_eq!(parse_name(&name_frame("అఖిల్")).as_deref(), Some("అఖిల్"));
    }

    #[test]
    fn long_names_are_cut_for_the_window() {
        let n = parse_name(&name_frame("A very very long display name indeed, much too long")).unwrap();
        assert_eq!(n.chars().count(), MAX_NAME_CHARS);
    }

    #[test]
    fn control_characters_and_blank_names_are_refused_or_cleaned() {
        assert_eq!(parse_name(&name_frame("Ak\nhil\t")).as_deref(), Some("Akhil"));
        assert_eq!(parse_name(&name_frame("   ")), None);
    }

    #[test]
    fn malformed_frames_are_ignored() {
        let mut f = name_frame("Akhil");
        f[3] = 2;
        assert_eq!(parse_name(&f), None, "unknown version");
        let mut f = name_frame("Akhil");
        f[4] = 44;
        assert_eq!(parse_name(&f), None, "length past the frame");
        let mut f = name_frame("Akhil");
        f[5] = 0xFF;
        assert_eq!(parse_name(&f), None, "not UTF-8");
        assert!(!looks_like_name(&[0u8; NAME_FRAME_LEN]), "wrong magic");
        assert!(!looks_like_name(&name_frame("Akhil")[..20]), "wrong length");
    }

    #[test]
    fn never_mistaken_for_other_frames() {
        assert_ne!(NAME_FRAME_LEN, crate::wire::PAYLOAD_SIZE);
        assert_ne!(NAME_FRAME_LEN, crate::grx::WIRE_LEN);
        assert_ne!(NAME_FRAME_LEN, crate::ticket::TICKET_LEN);
        assert!(!crate::grx::is_handshake(&name_frame("Akhil")));
        assert!(!crate::ticket::looks_like_ticket(&name_frame("Akhil")));
    }
}
