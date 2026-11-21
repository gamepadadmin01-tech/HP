//! A small copy of the phone's picture for the Gamepad Server window, so the PC owner can see what apps see
//! ("Phone camera live" + the picture itself). Pure code, unit-tested.
//!
//! Every decoded frame passes through `offer()`; at most ~15 times a second it is shrunk (nearest neighbour, so it
//! costs a fraction of a millisecond) and turned from NV12 (the video chip's colour layout) into RGBA, which is what
//! the window can draw. The window polls `latest()` and redraws only when `seq` changed.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Longest side of the window preview, in pixels.
pub const MAX_SIDE: u32 = 320;
const EVERY: Duration = Duration::from_millis(66);

#[derive(Clone)]
pub struct Preview {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    /// Bumps on every new picture, so the window knows when to redraw.
    pub seq: u64,
}

struct State {
    last: Option<Instant>,
    seq: u64,
    frame: Option<Preview>,
}

static STATE: Mutex<State> = Mutex::new(State { last: None, seq: 0, frame: None });

/// Called for every decoded frame (`w`×`h` NV12, rows packed). Cheap when it is not yet time for a new preview.
pub fn offer(w: u32, h: u32, nv12: &[u8]) {
    let Ok(mut s) = STATE.lock() else { return };
    let now = Instant::now();
    if s.last.is_some_and(|t| now.duration_since(t) < EVERY) {
        return;
    }
    s.last = Some(now);
    if let Some((pw, ph, rgba)) = shrink_to_rgba(w, h, nv12, MAX_SIDE) {
        s.seq += 1;
        let seq = s.seq;
        s.frame = Some(Preview { width: pw, height: ph, rgba, seq });
    }
}

/// The phone stopped: the window goes back to the QR code.
pub fn clear() {
    if let Ok(mut s) = STATE.lock() {
        s.frame = None;
        s.last = None;
    }
}

/// The newest preview, if a phone is streaming.
pub fn latest() -> Option<Preview> {
    STATE.lock().ok().and_then(|s| s.frame.clone())
}

/// Shrink an NV12 picture so its longest side is at most `max_side`, keeping its shape, and convert to RGBA.
pub fn shrink_to_rgba(w: u32, h: u32, nv12: &[u8], max_side: u32) -> Option<(u32, u32, Vec<u8>)> {
    let (w, h) = (w as usize, h as usize);
    if w < 2 || h < 2 || nv12.len() < w * h * 3 / 2 {
        return None;
    }
    let scale = (w.max(h) as f32 / max_side as f32).max(1.0);
    let pw = ((w as f32 / scale) as usize).max(1);
    let ph = ((h as f32 / scale) as usize).max(1);
    let mut out = vec![0u8; pw * ph * 4];
    let uv = &nv12[w * h..];
    for y in 0..ph {
        let sy = y * h / ph;
        for x in 0..pw {
            let sx = x * w / pw;
            let yy = nv12[sy * w + sx] as i32;
            let ci = (sy / 2) * w + (sx / 2) * 2;
            let (u, v) = (uv[ci] as i32, uv[ci + 1] as i32);
            let (r, g, b) = yuv_to_rgb(yy, u, v);
            let o = (y * pw + x) * 4;
            out[o] = r;
            out[o + 1] = g;
            out[o + 2] = b;
            out[o + 3] = 255;
        }
    }
    Some((pw as u32, ph as u32, out))
}

/// BT.601 "TV range" (what phone video chips produce), integer maths.
fn yuv_to_rgb(y: i32, u: i32, v: i32) -> (u8, u8, u8) {
    let c = (y - 16).max(0) * 298;
    let d = u - 128;
    let e = v - 128;
    let clamp = |x: i32| ((x + 128) >> 8).clamp(0, 255) as u8;
    (clamp(c + 409 * e), clamp(c - 100 * d - 208 * e), clamp(c + 516 * d))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat(w: usize, h: usize, y: u8, u: u8, v: u8) -> Vec<u8> {
        let mut b = vec![y; w * h * 3 / 2];
        for p in b[w * h..].chunks_mut(2) {
            p[0] = u;
            p[1] = v;
        }
        b
    }

    #[test]
    fn keeps_shape_and_size_limit() {
        let (pw, ph, rgba) = shrink_to_rgba(1280, 720, &flat(1280, 720, 128, 128, 128), 320).unwrap();
        assert_eq!((pw, ph), (320, 180));
        assert_eq!(rgba.len(), 320 * 180 * 4);
        // A tall phone picture stays tall.
        let (pw, ph, _) = shrink_to_rgba(720, 1280, &flat(720, 1280, 128, 128, 128), 320).unwrap();
        assert_eq!((pw, ph), (180, 320));
    }

    #[test]
    fn colours_come_out_right() {
        // TV-range white, black, and pure red.
        let (_, _, w) = shrink_to_rgba(4, 4, &flat(4, 4, 235, 128, 128), 4).unwrap();
        assert!(w[0] > 250 && w[1] > 250 && w[2] > 250);
        let (_, _, k) = shrink_to_rgba(4, 4, &flat(4, 4, 16, 128, 128), 4).unwrap();
        assert!(k[0] < 5 && k[1] < 5 && k[2] < 5);
        let (_, _, r) = shrink_to_rgba(4, 4, &flat(4, 4, 81, 90, 240), 4).unwrap();
        assert!(r[0] > 240 && r[1] < 20 && r[2] < 20, "{:?}", &r[..3]);
    }

    #[test]
    fn short_buffer_is_refused() {
        assert!(shrink_to_rgba(64, 64, &[0u8; 10], 32).is_none());
    }
}
