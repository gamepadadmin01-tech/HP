//! Real virtual-gamepad output via the ViGEmBus driver.
//!
//! This is the only place that talks to the driver; everything upstream works
//! through the `PadSink` trait, which is why the whole protocol is testable
//! without ViGEm installed.
//!
//! ## Conformance notes (why the numbers here are not arbitrary)
//!
//! * **Button mapping** — the wire's bit N is NOT the XInput bit. Our bit 0 is
//!   `A` (XInput `0x1000`), bit 10 is `DPAD_UP` (XInput `0x0001`), and so on.
//!   The table is derived from `wire::BUTTON_MAP`, which is itself scraped from
//!   the Python `apply_inputs`, and the XInput masks come from `vigem_client`'s
//!   own constants — not from memory.
//! * **Sticks** — `wire::thumb_i16` reproduces vgamepad's
//!   `round(value * 32767)`, verified for all 256 byte values.
//! * **Y axes are negated** — done upstream in `wire::pad_axes`.
//! * **Triggers are raw bytes** — `server.py` passes the wire byte straight
//!   through; there is no scaling.

#![cfg(windows)]

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use vigem_client::{Client, TargetId, XButtons, XGamepad, Xbox360Wired};

use crate::net::PadSink;
use crate::wire::{pad_axes, thumb_i16, trigger_u8, Packet, MAX_PADS};

/// Wire button bit -> XInput button mask.
///
/// Built from `vigem_client::XButtons` constants so a future change in that
/// crate cannot silently desync us. Index = our wire bit (see wire::BUTTON_MAP).
const XINPUT_MASK: [u16; 15] = [
    XButtons::A,      // 0
    XButtons::B,      // 1
    XButtons::X,      // 2
    XButtons::Y,      // 3
    XButtons::LB,     // 4  LEFT_SHOULDER
    XButtons::RB,     // 5  RIGHT_SHOULDER
    XButtons::START,  // 6  (phone's "menu")
    XButtons::BACK,   // 7  (phone's "view")
    XButtons::LTHUMB, // 8
    XButtons::RTHUMB, // 9
    XButtons::UP,     // 10 DPAD_UP
    XButtons::DOWN,   // 11
    XButtons::LEFT,   // 12
    XButtons::RIGHT,  // 13
    XButtons::GUIDE,  // 14
];

/// Translate one wire packet into an XInput report.
pub fn to_xgamepad(pkt: &Packet, allow_guide: bool) -> XGamepad {
    let mut raw = 0u16;
    for (bit, mask) in XINPUT_MASK.iter().enumerate() {
        if pkt.buttons & (1u16 << bit) != 0 {
            // Guide is gated per-session (server.py `sess.allow_guide`).
            if bit == 14 && !allow_guide {
                continue;
            }
            raw |= *mask;
        }
    }
    let axes = pad_axes(pkt);
    XGamepad {
        buttons: XButtons { raw },
        left_trigger: trigger_u8(pkt.lt),
        right_trigger: trigger_u8(pkt.rt),
        thumb_lx: thumb_i16(axes.left_x),
        thumb_ly: thumb_i16(axes.left_y),
        thumb_rx: thumb_i16(axes.right_x),
        thumb_ry: thumb_i16(axes.right_y),
    }
}

struct Pad {
    target: Xbox360Wired<Arc<Client>>,
    /// Latest force-feedback from the game, packed `large << 8 | small`.
    /// Written by the notification thread, read on the packet path.
    rumble: Arc<AtomicU32>,
}

pub struct ViGEmSink {
    client: Arc<Client>,
    pads: Vec<Option<Pad>>,
}

impl ViGEmSink {
    /// Connect to ViGEmBus. Fails if the driver is not installed/running.
    pub fn connect() -> Result<ViGEmSink, String> {
        let client = Client::connect()
            .map_err(|e| format!("cannot reach the ViGEmBus driver ({e:?}). Is it installed?"))?;
        let mut pads = Vec::with_capacity(MAX_PADS);
        for _ in 0..MAX_PADS {
            pads.push(None);
        }
        Ok(ViGEmSink {
            client: Arc::new(client),
            pads,
        })
    }
}

impl PadSink for ViGEmSink {
    fn acquire_pad(&mut self, slot: usize) -> bool {
        if slot >= self.pads.len() {
            return false;
        }
        if self.pads[slot].is_some() {
            return true; // already plugged in
        }
        let mut target = Xbox360Wired::new(Arc::clone(&self.client), TargetId::XBOX360_WIRED);
        if let Err(e) = target.plugin() {
            eprintln!("ViGEm: plugin() failed for slot {slot}: {e:?}");
            return false;
        }
        // Wait for Windows to finish enumerating the device, otherwise the first
        // reports are written into the void and the first input is swallowed.
        if let Err(e) = target.wait_ready() {
            eprintln!("ViGEm: wait_ready() failed for slot {slot}: {e:?}");
            return false;
        }

        // Force feedback: the driver notifies us of motor changes. Runs on its
        // own thread and only ever stores into an atomic, so the packet path
        // never blocks on it.
        let rumble = Arc::new(AtomicU32::new(0));
        match target.request_notification() {
            Ok(req) => {
                let sink = Arc::clone(&rumble);
                req.spawn_thread(move |_, n| {
                    let packed = ((n.large_motor as u32) << 8) | n.small_motor as u32;
                    sink.store(packed, Ordering::Relaxed);
                });
            }
            Err(e) => {
                // Non-fatal: input still works, the phone just won't rumble.
                eprintln!("ViGEm: rumble notifications unavailable on slot {slot}: {e:?}");
            }
        }

        self.pads[slot] = Some(Pad { target, rumble });
        true
    }

    fn write(&mut self, slot: usize, pkt: &Packet, allow_guide: bool) {
        if let Some(Some(pad)) = self.pads.get_mut(slot) {
            let report = to_xgamepad(pkt, allow_guide);
            if let Err(e) = pad.target.update(&report) {
                eprintln!("ViGEm: update() failed on slot {slot}: {e:?}");
            }
        }
    }

    fn neutralize(&mut self, slot: usize) {
        if let Some(Some(pad)) = self.pads.get_mut(slot) {
            // Anti-stuck: a dropped link must not leave a throttle latched.
            let _ = pad.target.update(&XGamepad::default());
        }
    }

    fn release(&mut self, slot: usize) {
        if let Some(entry) = self.pads.get_mut(slot) {
            if let Some(mut pad) = entry.take() {
                let _ = pad.target.update(&XGamepad::default());
                if let Err(e) = pad.target.unplug() {
                    eprintln!("ViGEm: unplug() failed on slot {slot}: {e:?}");
                }
                // Dropping `pad` releases the target; the notification thread
                // ends when the target goes away.
            }
        }
    }

    fn rumble(&mut self, slot: usize) -> (u8, u8) {
        match self.pads.get(slot) {
            Some(Some(pad)) => {
                let p = pad.rumble.load(Ordering::Relaxed);
                (((p >> 8) & 0xFF) as u8, (p & 0xFF) as u8)
            }
            _ => (0, 0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(buttons: u16) -> Packet {
        Packet {
            ts: 1,
            buttons,
            lt: 0,
            rt: 0,
            ls_x: 128,
            ls_y: 128,
            rs_x: 128,
            rs_y: 128,
            auth_token: 0,
        }
    }

    /// The wire bit -> XInput bit remap is the single easiest thing to get
    /// wrong (they are completely different orderings), so pin every one.
    #[test]
    fn every_wire_bit_maps_to_the_right_xinput_button() {
        let cases = [
            (0, XButtons::A),
            (1, XButtons::B),
            (2, XButtons::X),
            (3, XButtons::Y),
            (4, XButtons::LB),
            (5, XButtons::RB),
            (6, XButtons::START),
            (7, XButtons::BACK),
            (8, XButtons::LTHUMB),
            (9, XButtons::RTHUMB),
            (10, XButtons::UP),
            (11, XButtons::DOWN),
            (12, XButtons::LEFT),
            (13, XButtons::RIGHT),
            (14, XButtons::GUIDE),
        ];
        for (bit, mask) in cases {
            let r = to_xgamepad(&p(1u16 << bit), true);
            assert_eq!(r.buttons.raw, mask, "wire bit {bit} mapped wrong");
        }
    }

    #[test]
    fn guide_is_gated_by_allow_guide() {
        assert_eq!(to_xgamepad(&p(1 << 14), true).buttons.raw, XButtons::GUIDE);
        assert_eq!(to_xgamepad(&p(1 << 14), false).buttons.raw, 0);
        // gating Guide must not disturb other buttons in the same packet
        let both = to_xgamepad(&p((1 << 14) | 1), false);
        assert_eq!(both.buttons.raw, XButtons::A);
    }

    #[test]
    fn neutral_report_is_all_zero() {
        let r = to_xgamepad(&p(0), true);
        assert_eq!(r.buttons.raw, 0);
        assert_eq!((r.thumb_lx, r.thumb_ly, r.thumb_rx, r.thumb_ry), (0, 0, 0, 0));
        assert_eq!((r.left_trigger, r.right_trigger), (0, 0));
    }

    #[test]
    fn sticks_are_negated_on_y_and_triggers_pass_through() {
        let mut pkt = p(0);
        pkt.ls_y = 255; // full "down" on the wire
        pkt.rs_x = 0;
        pkt.lt = 200;
        pkt.rt = 7;
        let r = to_xgamepad(&pkt, true);
        assert!(r.thumb_ly < 0, "wire ls_y=255 must become NEGATIVE (Y is inverted)");
        assert!(r.thumb_rx < 0, "wire rs_x=0 must become negative");
        assert_eq!(r.left_trigger, 200, "triggers are raw bytes, unscaled");
        assert_eq!(r.right_trigger, 7);
    }
}
