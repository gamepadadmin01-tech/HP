//! Turning the phone's H.264 back into pictures, with Windows' own decoder.
//!
//! The Microsoft H.264 decoder ships with every Windows 10/11 desktop, so this
//! adds nothing to install. It is a "transform" (MFT): we push squeezed frames
//! in with `ProcessInput` and pull pictures out with `ProcessOutput`. Output is
//! NV12, the same layout the virtual camera hands to apps — no colour
//! conversion anywhere on the PC.
//!
//! Low-latency mode is switched on: without it the decoder holds several frames
//! back to reorder them, which is ~100 ms of delay a webcam cannot afford (the
//! phone encoder never reorders frames anyway).

use std::mem::ManuallyDrop;

use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
use windows::core::Result;

pub struct H264Decoder {
    mft: IMFTransform,
    /// Decoder's frame size (may be padded to a multiple of 16, e.g. 1088).
    dec_w: u32,
    dec_h: u32,
    stride: u32,
    out_ready: bool,
}

impl H264Decoder {
    pub fn new() -> Result<Self> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET)?;
            let mft: IMFTransform = CoCreateInstance(&CLSID_MSH264DecoderMFT, None, CLSCTX_INPROC_SERVER)?;
            if let Ok(a) = mft.GetAttributes() {
                let _ = a.SetUINT32(&MF_LOW_LATENCY, 1);
            }
            let t = MFCreateMediaType()?;
            t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            t.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
            mft.SetInputType(0, &t, 0)?;
            let mut d = Self { mft, dec_w: 0, dec_h: 0, stride: 0, out_ready: false };
            // Before the first frame the decoder may not offer an output type yet;
            // it will announce one with STREAM_CHANGE once it has seen the SPS.
            let _ = d.pick_output();
            d.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            d.mft.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
            Ok(d)
        }
    }

    fn pick_output(&mut self) -> Result<()> {
        unsafe {
            let mut i = 0;
            loop {
                let t = self.mft.GetOutputAvailableType(0, i)?;
                if t.GetGUID(&MF_MT_SUBTYPE)? == MFVideoFormat_NV12 {
                    self.mft.SetOutputType(0, &t, 0)?;
                    let size = t.GetUINT64(&MF_MT_FRAME_SIZE).unwrap_or(0);
                    self.dec_w = (size >> 32) as u32;
                    self.dec_h = size as u32;
                    self.stride = t.GetUINT32(&MF_MT_DEFAULT_STRIDE).map(|s| s as i32).unwrap_or(0).unsigned_abs();
                    if self.stride < self.dec_w {
                        self.stride = self.dec_w;
                    }
                    self.out_ready = true;
                    return Ok(());
                }
                i += 1;
            }
        }
    }

    /// Feed one H.264 access unit (Annex-B, start codes included). Calls
    /// `on_frame(w, h, nv12)` for every picture that comes out, cropped to the
    /// size the phone said it sends.
    pub fn decode(&mut self, au: &[u8], pts_us: u64, want_w: u32, want_h: u32, on_frame: &mut dyn FnMut(u32, u32, Vec<u8>)) -> Result<()> {
        unsafe {
            let buf = MFCreateMemoryBuffer(au.len() as u32)?;
            let mut p: *mut u8 = std::ptr::null_mut();
            buf.Lock(&mut p, None, None)?;
            std::ptr::copy_nonoverlapping(au.as_ptr(), p, au.len());
            buf.Unlock()?;
            buf.SetCurrentLength(au.len() as u32)?;
            let s = MFCreateSample()?;
            s.AddBuffer(&buf)?;
            s.SetSampleTime(pts_us as i64 * 10)?;

            if let Err(e) = self.mft.ProcessInput(0, &s, 0) {
                if e.code() != MF_E_NOTACCEPTING {
                    return Err(e);
                }
                self.drain(want_w, want_h, on_frame)?;
                self.mft.ProcessInput(0, &s, 0)?;
            }
            self.drain(want_w, want_h, on_frame)
        }
    }

    fn drain(&mut self, want_w: u32, want_h: u32, on_frame: &mut dyn FnMut(u32, u32, Vec<u8>)) -> Result<()> {
        unsafe {
            loop {
                if !self.out_ready && self.pick_output().is_err() {
                    return Ok(());
                }
                let info = self.mft.GetOutputStreamInfo(0)?;
                let provides = info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 != 0;
                let own = if provides {
                    None
                } else {
                    let s = MFCreateSample()?;
                    s.AddBuffer(&MFCreateMemoryBuffer(info.cbSize.max(1))?)?;
                    Some(s)
                };
                let mut out = [MFT_OUTPUT_DATA_BUFFER {
                    dwStreamID: 0,
                    pSample: ManuallyDrop::new(own),
                    dwStatus: 0,
                    pEvents: ManuallyDrop::new(None),
                }];
                let mut status = 0u32;
                let r = self.mft.ProcessOutput(0, &mut out, &mut status);
                let sample = ManuallyDrop::take(&mut out[0].pSample);
                drop(ManuallyDrop::take(&mut out[0].pEvents));
                match r {
                    Ok(()) => {
                        if let Some(sample) = sample {
                            self.emit(&sample, want_w, want_h, on_frame)?;
                        }
                    }
                    Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(()),
                    Err(e) if e.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                        self.out_ready = false;
                        self.pick_output()?;
                    }
                    Err(e) => return Err(e),
                }
            }
        }
    }

    fn emit(&self, sample: &IMFSample, want_w: u32, want_h: u32, on_frame: &mut dyn FnMut(u32, u32, Vec<u8>)) -> Result<()> {
        unsafe {
            let b = sample.ConvertToContiguousBuffer()?;
            let mut p: *mut u8 = std::ptr::null_mut();
            let mut len = 0u32;
            b.Lock(&mut p, None, Some(&mut len))?;
            let (dw, dh, st) = (self.dec_w as usize, self.dec_h as usize, self.stride as usize);
            let w = (want_w as usize).min(dw) & !1;
            let h = (want_h as usize).min(dh) & !1;
            let need = st * dh * 3 / 2;
            if p.is_null() || (len as usize) < need || w == 0 || h == 0 {
                b.Unlock()?;
                return Ok(());
            }
            let src = std::slice::from_raw_parts(p, len as usize);
            let mut out = vec![0u8; w * h * 3 / 2];
            for y in 0..h {
                out[y * w..y * w + w].copy_from_slice(&src[y * st..y * st + w]);
            }
            let uv_src = st * dh;
            let uv_dst = w * h;
            for y in 0..h / 2 {
                out[uv_dst + y * w..uv_dst + y * w + w].copy_from_slice(&src[uv_src + y * st..uv_src + y * st + w]);
            }
            b.Unlock()?;
            on_frame(w as u32, h as u32, out);
            Ok(())
        }
    }
}
