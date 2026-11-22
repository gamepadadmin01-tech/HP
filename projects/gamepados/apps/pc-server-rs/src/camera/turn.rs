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
    fn broken_input_is_refused() {
        assert!(turn_nv12(3, 2, &[0; 9], 1, false).is_none());
        assert!(turn_nv12(4, 2, &[0; 5], 1, false).is_none());
    }
}
