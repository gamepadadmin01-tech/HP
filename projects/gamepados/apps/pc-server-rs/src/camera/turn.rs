//! Turning a picture upright on the PC (owner, 2026-11-23: real 60 fps for Premium on phones like his Xiaomi).
//! Pure code, unit-tested.
//!
//! Normally the phone's picture engine turns and mirrors the picture before it is squeezed. In "direct 60 fps"
//! mode the camera feeds the phone's video chip directly (on many phones that is the only way to get more than 30
//! pictures a second to an app), so the picture arrives the way the camera sensor sees it, usually lying on its
//! side. The phone says how many quarter turns make it upright (proto.rs, hello flags), and this does the turn.
//!
//! Pictures are NV12: a full-size brightness plane, then a half-size plane of colour pairs (U,V). Both planes are
//! turned the same way; the copy goes in 32×32 tiles so memory is read and written in nearby chunks (a 1080p
//! picture takes a few milliseconds).

/// Turn `src` (w×h NV12) by `quarters` clockwise, then mirror left-right if `mirror`. Returns the new size and
/// pixels, or None if the input is not a whole even-sized NV12 picture.
pub fn turn_nv12(w: u32, h: u32, src: &[u8], quarters: u8, mirror: bool) -> Option<(u32, u32, Vec<u8>)> {
    let (w, h) = (w as usize, h as usize);
    if w < 2 || h < 2 || w % 2 != 0 || h % 2 != 0 || src.len() < w * h * 3 / 2 {
        return None;
    }
    let q = quarters & 3;
    let (dw, dh) = if q % 2 == 1 { (h, w) } else { (w, h) };
    let mut out = vec![0u8; w * h * 3 / 2];
    let (y_src, uv_src) = src[..w * h * 3 / 2].split_at(w * h);
    let (y_dst, uv_dst) = out.split_at_mut(w * h);
    turn_plane::<1>(y_src, w, h, y_dst, q, mirror);
    turn_plane::<2>(uv_src, w / 2, h / 2, uv_dst, q, mirror);
    Some((dw as u32, dh as u32, out))
}

/// Turn one plane of `w`×`h` elements of `N` bytes each.
fn turn_plane<const N: usize>(src: &[u8], w: usize, h: usize, dst: &mut [u8], q: u8, mirror: bool) {
    let dw = if q % 2 == 1 { h } else { w };
    const T: usize = 32;
    for ty in (0..h).step_by(T) {
        for tx in (0..w).step_by(T) {
            for sy in ty..(ty + T).min(h) {
                for sx in tx..(tx + T).min(w) {
                    let (mut dx, dy) = match q {
                        0 => (sx, sy),
                        1 => (h - 1 - sy, sx),
                        2 => (w - 1 - sx, h - 1 - sy),
                        _ => (sy, w - 1 - sx),
                    };
                    if mirror {
                        dx = dw - 1 - dx;
                    }
                    let s = (sy * w + sx) * N;
                    let d = (dy * dw + dx) * N;
                    dst[d..d + N].copy_from_slice(&src[s..s + N]);
                }
            }
        }
    }
}

/// Shrink an NV12 picture to fit inside `max_w`×`max_h`, keeping its shape (direct 60 fps on the free plan: the
/// camera sends 1080p, the free plan streams 720p). Each output pixel averages the 2×2 nearest source pixels, which
/// is smooth enough for a 1.5× shrink. Returns the input unchanged if it already fits.
pub fn fit_nv12(w: u32, h: u32, src: Vec<u8>, max_w: u32, max_h: u32) -> (u32, u32, Vec<u8>) {
    if w <= max_w && h <= max_h || w < 2 || h < 2 || src.len() < (w * h * 3 / 2) as usize {
        return (w, h, src);
    }
    let scale = (max_w as f32 / w as f32).min(max_h as f32 / h as f32);
    let ow = (((w as f32 * scale) as u32) & !1).max(2);
    let oh = (((h as f32 * scale) as u32) & !1).max(2);
    let (w, h, ow, oh) = (w as usize, h as usize, ow as usize, oh as usize);
    let mut out = vec![0u8; ow * oh * 3 / 2];
    let (y_src, uv_src) = src.split_at(w * h);
    let (y_dst, uv_dst) = out.split_at_mut(ow * oh);
    for y in 0..oh {
        let sy = (y * h / oh).min(h - 2);
        for x in 0..ow {
            let sx = (x * w / ow).min(w - 2);
            let i = sy * w + sx;
            y_dst[y * ow + x] = ((y_src[i] as u32 + y_src[i + 1] as u32 + y_src[i + w] as u32 + y_src[i + w + 1] as u32 + 2) / 4) as u8;
        }
    }
    let (cw, ch, ocw, och) = (w / 2, h / 2, ow / 2, oh / 2);
    for y in 0..och {
        let sy = y * ch / och;
        for x in 0..ocw {
            let sx = x * cw / ocw;
            let s = (sy * cw + sx) * 2;
            let d = (y * ocw + x) * 2;
            uv_dst[d] = uv_src[s];
            uv_dst[d + 1] = uv_src[s + 1];
        }
    }
    (ow as u32, oh as u32, out)
}

/// The "CamOS" mark, pre-rendered (Segoe UI Bold, white on black): 2-byte width, 2-byte height, then 1 byte per pixel.
static MARK: &[u8] = include_bytes!("../../assets/watermark-camos.gray");

/// Stamp the free plan's watermark into an NV12 picture, the same as the phone draws it (GlPipeline.drawMark): bold
/// white "CamOS", 4.5 % of the picture height, bottom-right, margin 0.6 × its height, 28 % strength.
pub fn watermark_nv12(w: u32, h: u32, buf: &mut [u8]) {
    let (w, h) = (w as usize, h as usize);
    if buf.len() < w * h || MARK.len() < 4 {
        return;
    }
    let mw = u16::from_le_bytes([MARK[0], MARK[1]]) as usize;
    let mh = u16::from_le_bytes([MARK[2], MARK[3]]) as usize;
    let mask = &MARK[4..];
    if mask.len() < mw * mh || mw == 0 || mh == 0 {
        return;
    }
    let th = ((h as f32 * 0.045).round() as usize).max(8);
    let tw = th * mw / mh;
    let margin = (th as f32 * 0.6) as usize;
    if tw + margin >= w || th + margin >= h {
        return;
    }
    let (x0, y0) = (w - margin - tw, h - margin - th);
    for y in 0..th {
        let my = y * mh / th;
        for x in 0..tw {
            let a = mask[my * mw + x * mw / tw] as u32 * 28 / 100; // 0..71 of 255
            if a == 0 {
                continue;
            }
            let p = &mut buf[(y0 + y) * w + x0 + x];
            *p = ((*p as u32 * (255 - a) + 235 * a) / 255) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 4×2 NV12 picture with every byte different: Y = 0..8, UV pairs = (100,101), (102,103).
    fn sample() -> Vec<u8> {
        let mut v: Vec<u8> = (0..8).collect();
        v.extend_from_slice(&[100, 101, 102, 103]);
        v
    }

    #[test]
    fn a_quarter_turn_clockwise_puts_the_bottom_left_on_top() {
        // Y plane      turned 90° clockwise (2 wide, 4 tall)
        //  0 1 2 3      4 0
        //  4 5 6 7      5 1
        //               6 2
        //               7 3
        let (w, h, out) = turn_nv12(4, 2, &sample(), 1, false).unwrap();
        assert_eq!((w, h), (2, 4));
        assert_eq!(&out[..8], &[4, 0, 5, 1, 6, 2, 7, 3]);
        // UV is 2×1 pairs → 1×2 pairs, the pair (100,101) stays together and goes on top.
        assert_eq!(&out[8..], &[100, 101, 102, 103]);
    }

    #[test]
    fn half_turn_and_mirror() {
        let (_, _, half) = turn_nv12(4, 2, &sample(), 2, false).unwrap();
        assert_eq!(&half[..8], &[7, 6, 5, 4, 3, 2, 1, 0]);
        assert_eq!(&half[8..], &[102, 103, 100, 101]);
        let (_, _, m) = turn_nv12(4, 2, &sample(), 0, true).unwrap();
        assert_eq!(&m[..8], &[3, 2, 1, 0, 7, 6, 5, 4]);
    }

    #[test]
    fn four_quarter_turns_and_two_mirrors_change_nothing() {
        let (w0, h0) = (64u32, 48u32);
        let src: Vec<u8> = (0..(w0 * h0 * 3 / 2)).map(|i| (i * 7 % 251) as u8).collect();
        let (mut w, mut h, mut p) = (w0, h0, src.clone());
        for _ in 0..4 {
            let r = turn_nv12(w, h, &p, 1, false).unwrap();
            (w, h, p) = r;
        }
        assert_eq!((w, h), (w0, h0));
        assert_eq!(p, src);
        // Mirroring reverses the direction of a turn, so "turn 90 + mirror" done twice is the original.
        let (_, _, m1) = turn_nv12(w0, h0, &src, 1, true).unwrap();
        let (_, _, m2) = turn_nv12(h0, w0, &m1, 1, true).unwrap();
        assert_eq!(m2, src);
    }

    /// How long a 1080p quarter turn takes (run with `cargo test --release -- --ignored --nocapture turn_speed`).
    #[test]
    #[ignore]
    fn turn_speed() {
        let src = vec![128u8; 1920 * 1080 * 3 / 2];
        let t = std::time::Instant::now();
        for _ in 0..60 {
            std::hint::black_box(turn_nv12(1920, 1080, &src, 1, false));
        }
        println!("1080p quarter turn: {:.2} ms each", t.elapsed().as_secs_f64() * 1000.0 / 60.0);
    }

    #[test]
    fn fitting_shrinks_1080p_to_720p_and_keeps_tall_pictures_tall() {
        let src = vec![100u8; 1920 * 1080 * 3 / 2];
        let (w, h, out) = fit_nv12(1920, 1080, src, 1280, 720);
        assert_eq!((w, h), (1280, 720));
        assert_eq!(out.len(), 1280 * 720 * 3 / 2);
        assert!(out.iter().all(|&b| b == 100), "a flat picture stays flat");
        let (w, h, _) = fit_nv12(1080, 1920, vec![0u8; 1080 * 1920 * 3 / 2], 720, 1280);
        assert_eq!((w, h), (720, 1280));
        let small = vec![7u8; 640 * 360 * 3 / 2];
        assert_eq!(fit_nv12(640, 360, small.clone(), 1280, 720), (640, 360, small), "already small: untouched");
    }

    #[test]
    fn the_watermark_brightens_only_the_bottom_right_corner() {
        let (w, h) = (1280usize, 720usize);
        let mut buf = vec![16u8; w * h * 3 / 2]; // black
        watermark_nv12(w as u32, h as u32, &mut buf);
        let changed: Vec<(usize, usize)> = (0..h).flat_map(|y| (0..w).map(move |x| (x, y))).filter(|&(x, y)| buf[y * w + x] != 16).collect();
        assert!(!changed.is_empty(), "the mark must show");
        assert!(changed.iter().all(|&(x, y)| x > w * 3 / 4 && y > h * 9 / 10), "only in the corner");
        let brightest = changed.iter().map(|&(x, y)| buf[y * w + x]).max().unwrap();
        assert!(brightest > 60 && brightest < 90, "faint, like the phone's 28 %: {brightest}");
        assert!(buf[w * h..].iter().all(|&b| b == 16), "colour untouched");
    }

    #[test]
    fn broken_input_is_refused() {
        assert!(turn_nv12(3, 2, &[0; 9], 1, false).is_none());
        assert!(turn_nv12(4, 2, &[0; 5], 1, false).is_none());
    }
}
