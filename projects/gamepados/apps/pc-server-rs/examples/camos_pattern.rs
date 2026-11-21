//! Test the CamOS virtual camera WITHOUT a phone: creates "CamOS Camera" and
//! feeds it a moving colour pattern at 1280x720 / 30 fps for two minutes.
//! Open the Windows Camera app (or meet.google.com) and pick "CamOS Camera".
//!
//!   cargo run --release --example camos_pattern
#[cfg(windows)]
fn main() {
    use pc_server_rs::camera::vcam;
    match vcam::start() {
        Ok(()) => println!("CamOS Camera is up — open the Camera app and pick it"),
        Err(e) => {
            eprintln!("failed: {e}");
            std::process::exit(1);
        }
    }
    let (w, h) = (1280usize, 720usize);
    let start = std::time::Instant::now();
    let mut n = 0u64;
    while start.elapsed().as_secs() < 120 {
        let mut f = vec![0u8; w * h * 3 / 2];
        let off = (n * 8) as usize;
        for y in 0..h {
            for x in 0..w {
                f[y * w + x] = (((x + off) / 64 + y / 64) % 2 * 120 + 60) as u8;
            }
        }
        for (i, p) in f[w * h..].chunks_exact_mut(2).enumerate() {
            let x = i % (w / 2);
            p[0] = (x * 255 / (w / 2)) as u8;
            p[1] = 200;
        }
        vcam::publish(w as u32, h as u32, f);
        n += 1;
        std::thread::sleep(std::time::Duration::from_millis(33));
    }
}
#[cfg(not(windows))]
fn main() {}
