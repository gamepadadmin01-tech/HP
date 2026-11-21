//! Open "CamOS Camera" the way Zoom/Chrome do (through Windows' camera service)
//! and read frames from it. Proves the whole PC chain without clicking anything.
//!
//!   cargo run --release --example camos_probe
#[cfg(windows)]
fn main() -> windows::core::Result<()> {
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::*;
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET)?;
        let mut attrs: Option<IMFAttributes> = None;
        MFCreateAttributes(&mut attrs, 1)?;
        let attrs = attrs.unwrap();
        attrs.SetGUID(&MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID)?;
        let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut n = 0u32;
        MFEnumDeviceSources(&attrs, &mut list, &mut n)?;
        let devs = std::slice::from_raw_parts(list, n as usize);
        let mut found = None;
        for d in devs.iter().flatten() {
            let mut p = windows::core::PWSTR::null();
            let mut len = 0u32;
            d.GetAllocatedString(&MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, &mut p, &mut len)?;
            let name = p.to_string().unwrap_or_default();
            println!("camera: {name}");
            if name.contains("CamOS") {
                found = Some(d.clone());
            }
        }
        let Some(act) = found else {
            println!("RESULT: CamOS Camera NOT listed");
            return Ok(());
        };
        let src: IMFMediaSource = act.ActivateObject()?;
        let reader = MFCreateSourceReaderFromMediaSource(&src, None)?;
        let t = reader.GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32)?;
        let size = t.GetUINT64(&MF_MT_FRAME_SIZE)?;
        println!("format: {}x{} subtype={:?}", size >> 32, size as u32, t.GetGUID(&MF_MT_SUBTYPE)?);
        let start = std::time::Instant::now();
        let mut got = 0;
        while got < 60 && start.elapsed().as_secs() < 15 {
            let mut flags = 0u32;
            let mut ts = 0i64;
            let mut s: Option<IMFSample> = None;
            reader.ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32, 0, None, Some(&mut flags), Some(&mut ts), Some(&mut s))?;
            if let Some(s) = s {
                let b = s.ConvertToContiguousBuffer()?;
                let mut p: *mut u8 = std::ptr::null_mut();
                let mut len = 0u32;
                b.Lock(&mut p, None, Some(&mut len))?;
                if got == 45 {
                    if let Ok(path) = std::env::var("CAMOS_DUMP") {
                        // Save the picture (full colour, NV12 -> RGB) to look at it.
                        let (w, h) = ((size >> 32) as usize, size as usize & 0xffff_ffff);
                        let d = std::slice::from_raw_parts(p, len as usize);
                        let mut rgb = image::RgbImage::new(w as u32, h as u32);
                        for y in 0..h {
                            for x in 0..w {
                                let yy = d[y * w + x] as f32;
                                let uv = w * h + (y / 2) * w + (x / 2) * 2;
                                let (u, v) = (d[uv] as f32 - 128.0, d[uv + 1] as f32 - 128.0);
                                let c = |f: f32| f.clamp(0.0, 255.0) as u8;
                                rgb.put_pixel(x as u32, y as u32, image::Rgb([c(yy + 1.402 * v), c(yy - 0.344 * u - 0.714 * v), c(yy + 1.772 * u)]));
                            }
                        }
                        let _ = rgb.save(&path);
                        println!("saved {path}");
                    }
                }
                let y0 = *p;
                let ymid = *p.add((len as usize) / 3);
                b.Unlock()?;
                got += 1;
                if got % 15 == 1 {
                    println!("frame {got}: {len} bytes, Y[0]={y0} Y[mid]={ymid}");
                }
            }
        }
        let secs = start.elapsed().as_secs_f32();
        println!("RESULT: {got} frames in {secs:.1}s ({:.1} fps)", got as f32 / secs);
        let _ = src.Shutdown();
    }
    Ok(())
}
#[cfg(not(windows))]
fn main() {}
