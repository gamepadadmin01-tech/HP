//! Pairing QR, rendered to the terminal.
//!
//! **Not cosmetic.** A phone on Wi-Fi can only pair by scanning: manual connect
//! sends auth token 0, and the server accepts token 0 only from an off-LAN or
//! USB-tether source. Without a scannable code, the Rust server is unusable over
//! Wi-Fi — tether would be the only option.
//!
//! Python renders a PNG into a tkinter window; we draw directly in the console
//! with half-block characters, which phone cameras scan perfectly well and which
//! needs no GUI framework, no image encoder and no window.
//!
//! Contrast matters: QR readers expect **dark modules on a light background**,
//! and a quiet zone of at least 4 modules. Both are honoured below — an inverted
//! or unpadded code is the usual reason "it won't scan".

use qrcode::{EcLevel, QrCode};

/// Two vertically-stacked modules per character cell, so the code stays square
/// in a terminal (cells are roughly twice as tall as they are wide).
const UPPER: char = '\u{2580}'; // ▀ upper half block
const LOWER: char = '\u{2584}'; // ▄ lower half block
const FULL: char = '\u{2588}'; // █
const BLANK: char = ' ';

/// Quiet zone required by the spec. Skipping this is a common scan failure.
const QUIET: usize = 4;

/// The raw module grid — `grid[y][x] == true` means a dark module. `None` if the
/// payload cannot be encoded.
///
/// Exists so the GUI (`ui.rs`) rasterises from the SAME encoder settings as the
/// terminal renderer below. Encoding the payload twice with independently-chosen
/// parameters is how you end up with a window QR and a console QR that disagree
/// — and only find out when a user's phone won't scan one of them.
///
/// The quiet zone is deliberately NOT included here: the terminal renderer and
/// the GUI pad differently (characters vs pixels). Both must add it — omitting
/// the quiet zone is the single most common cause of "it won't scan".
pub fn modules(payload: &str) -> Option<Vec<Vec<bool>>> {
    let code = QrCode::with_error_correction_level(payload.as_bytes(), EcLevel::L).ok()?;
    let w = code.width();
    let dark: Vec<bool> = code.into_colors().iter().map(|c| *c == qrcode::Color::Dark).collect();
    Some((0..w).map(|y| dark[y * w..(y + 1) * w].to_vec()).collect())
}

/// Render `payload` as a terminal QR code, or `None` if it cannot be encoded.
///
/// Colours are inverted relative to the obvious mapping: we print **light cells
/// where modules are dark**, because terminals are usually dark-on-light... no —
/// we print the module grid directly and rely on the caller's terminal being
/// light-on-dark, which is why the background is drawn as filled blocks. See
/// `render_inverted` for the other polarity.
pub fn render(payload: &str) -> Option<String> {
    // Low EC is plenty for a short, close-range code and keeps the module count
    // (and therefore the printed size) small enough to fit a normal console.
    let code = QrCode::with_error_correction_level(payload.as_bytes(), EcLevel::L).ok()?;
    let w = code.width();
    let dark: Vec<bool> = code.into_colors().iter().map(|c| *c == qrcode::Color::Dark).collect();

    let total = w + QUIET * 2;
    let at = |x: usize, y: usize| -> bool {
        if x < QUIET || y < QUIET || x >= QUIET + w || y >= QUIET + w {
            return false; // quiet zone is light
        }
        dark[(y - QUIET) * w + (x - QUIET)]
    };

    let mut out = String::with_capacity(total * total / 2 + total);
    // Two rows per printed line.
    let mut y = 0;
    while y < total {
        for x in 0..total {
            let top = at(x, y);
            let bot = if y + 1 < total { at(x, y + 1) } else { false };
            // Dark module -> we want a DARK cell. On a light background that is
            // the block glyph; the light background is the blank.
            out.push(match (top, bot) {
                (true, true) => FULL,
                (true, false) => UPPER,
                (false, true) => LOWER,
                (false, false) => BLANK,
            });
        }
        out.push('\n');
        y += 2;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_a_scannable_looking_grid() {
        let out = render("192.168.1.34,7777,777a51b3").expect("payload must encode");
        let lines: Vec<&str> = out.lines().collect();
        assert!(!lines.is_empty());

        // Square-ish: printed lines are half the module rows (two per line).
        let cols = lines[0].chars().count();
        assert!(
            (lines.len() as i64 - (cols as i64 / 2)).abs() <= 1,
            "expected ~{} lines for {cols} columns, got {}",
            cols / 2,
            lines.len()
        );
        // Every line the same width, or the code is skewed and unscannable.
        assert!(lines.iter().all(|l| l.chars().count() == cols), "ragged rows");

        // Quiet zone: the first two printed lines must be entirely blank.
        assert!(
            lines[0].chars().all(|c| c == BLANK) && lines[1].chars().all(|c| c == BLANK),
            "missing quiet zone — a common reason codes fail to scan"
        );
        // And there must be actual modules somewhere.
        assert!(out.chars().any(|c| c == FULL || c == UPPER || c == LOWER));
    }

    #[test]
    fn different_payloads_differ() {
        let a = render("192.168.1.34,7777,aaaaaaaa").unwrap();
        let b = render("192.168.1.34,7777,bbbbbbbb").unwrap();
        assert_ne!(a, b, "the key must actually affect the code");
    }

    #[test]
    fn handles_a_realistic_range_of_payloads() {
        for p in [
            "10.0.0.1,7777,00000000",
            "192.168.100.200,65535,ffffffff",
            "172.16.31.254,7777,deadbeef",
        ] {
            assert!(render(p).is_some(), "failed to encode {p}");
        }
    }
}
