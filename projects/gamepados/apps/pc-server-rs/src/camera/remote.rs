//! The PC window as a remote control for the CamOS phone.
//!
//! The phone sends its state (what is set, and what its plan and camera allow) inside the video stream
//! (`proto::FLAG_STATE`). The window shows controls from that state and sends requests back
//! (`proto::remote_command`). **The phone decides**: it applies a request only if its own plan allows it, and its
//! next state message shows the truth — so the window never shows an unlocked control the phone did not unlock,
//! and editing this file cannot unlock anything either. Pure code apart from the socket, unit-tested.

use std::io::Write;
use std::net::TcpStream;
use std::sync::Mutex;

use serde_json::{Value, json};

use super::proto;

/// What the phone says about itself. Every field has a safe default, so a partial or older message still works.
#[derive(Debug, Clone, PartialEq)]
pub struct PhoneState {
    pub quality: u32,
    pub fps: u32,
    pub portrait: bool,
    pub front: bool,
    pub zoom: f32,
    pub zoom_min: f32,
    pub zoom_max: f32,
    pub ev: i32,
    pub ev_min: i32,
    pub ev_max: i32,
    pub ev_step: f32,
    pub look: String,
    pub smooth: f32,
    pub low_light: bool,
    pub torch: bool,
    /// The phone's own verdicts. The window only greys controls out from these; the phone enforces them.
    pub premium: bool,
    pub hd: bool,
    pub flash: bool,
    pub other_lens: bool,
}

impl Default for PhoneState {
    fn default() -> Self {
        Self {
            quality: 720, fps: 30, portrait: false, front: false, zoom: 1.0, zoom_min: 1.0, zoom_max: 1.0,
            ev: 0, ev_min: 0, ev_max: 0, ev_step: 0.0, look: "none".into(), smooth: 0.0, low_light: false,
            torch: false, premium: false, hd: false, flash: false, other_lens: false,
        }
    }
}

/// Read a state message. Unknown fields are ignored; wrong types fall back to the default.
pub fn parse_state(bytes: &[u8]) -> Option<PhoneState> {
    if bytes.len() > proto::MAX_STATE {
        return None;
    }
    let v: Value = serde_json::from_slice(bytes).ok()?;
    let d = PhoneState::default();
    let f = |k: &str, def: f32| v.get(k).and_then(Value::as_f64).map(|x| x as f32).filter(|x| x.is_finite()).unwrap_or(def);
    let i = |k: &str, def: i32| v.get(k).and_then(Value::as_i64).map(|x| x.clamp(-1000, 10_000) as i32).unwrap_or(def);
    let b = |k: &str, def: bool| v.get(k).and_then(Value::as_bool).unwrap_or(def);
    let look = v.get("look").and_then(Value::as_str).unwrap_or("none");
    Some(PhoneState {
        quality: i("quality", d.quality as i32).max(0) as u32,
        fps: i("fps", d.fps as i32).max(0) as u32,
        portrait: b("portrait", d.portrait),
        front: b("front", d.front),
        zoom: f("zoom", d.zoom),
        zoom_min: f("zoomMin", d.zoom_min),
        zoom_max: f("zoomMax", d.zoom_max),
        ev: i("ev", d.ev),
        ev_min: i("evMin", d.ev_min),
        ev_max: i("evMax", d.ev_max),
        ev_step: f("evStep", d.ev_step),
        // Only names the window knows how to show; anything else reads as "none".
        look: if LOOKS.iter().any(|(k, _)| *k == look) { look.to_string() } else { "none".into() },
        smooth: f("smooth", d.smooth).clamp(0.0, 1.0),
        low_light: b("lowLight", d.low_light),
        torch: b("torch", d.torch),
        premium: b("premium", d.premium),
        hd: b("hd", d.hd),
        flash: b("flash", d.flash),
        other_lens: b("otherLens", d.other_lens),
    })
}

/// Colour looks, in the phone app's order: (wire name, label).
pub const LOOKS: [(&str, &str); 6] = [("none", "None"), ("warm", "Warm"), ("cool", "Cool"), ("vivid", "Vivid"), ("bw", "B&W"), ("film", "Film")];

// ── requests the window can make (the phone checks each one) ─────────────────────────────────────────────────

pub fn cmd_set(key: &str, value: Value) -> String {
    json!({ "set": { key: value } }).to_string()
}

pub fn cmd_action(name: &str) -> String {
    json!({ "action": name }).to_string()
}

// ── live connection ──────────────────────────────────────────────────────────────────────────────────────────

struct Live {
    writer: Option<TcpStream>,
    state: Option<PhoneState>,
}

static LIVE: Mutex<Live> = Mutex::new(Live { writer: None, state: None });

/// A phone started streaming: keep a second handle on its socket for requests (and key-frame asks).
pub fn attach(stream: &TcpStream) {
    if let Ok(mut l) = LIVE.lock() {
        l.writer = stream.try_clone().ok();
        l.state = None;
    }
}

/// The phone stopped.
pub fn detach() {
    if let Ok(mut l) = LIVE.lock() {
        l.writer = None;
        l.state = None;
    }
}

/// A state message arrived inside the stream.
pub fn on_state(bytes: &[u8]) {
    if let Some(s) = parse_state(bytes) {
        if let Ok(mut l) = LIVE.lock() {
            l.state = Some(s);
        }
    }
}

/// The phone's latest state. None until a phone that supports remote control has sent one.
pub fn state() -> Option<PhoneState> {
    LIVE.lock().ok().and_then(|l| l.state.clone())
}

/// Send raw bytes to the phone under the one writer lock, so a request and a key-frame ask never interleave.
pub fn write_raw(bytes: &[u8]) -> bool {
    let Ok(mut l) = LIVE.lock() else { return false };
    match l.writer.as_mut() {
        Some(w) => w.write_all(bytes).is_ok(),
        None => false,
    }
}

/// Ask the phone for something. Only sent to a phone that has announced it understands requests.
pub fn send(json: &str) -> bool {
    if state().is_none() {
        return false;
    }
    match proto::remote_command(json) {
        Some(b) => write_raw(&b),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_state_reads_back() {
        let s = parse_state(br#"{"quality":1080,"fps":60,"portrait":true,"front":true,"zoom":2.5,"zoomMin":0.6,"zoomMax":8,
            "ev":-3,"evMin":-12,"evMax":12,"evStep":0.1667,"look":"warm","smooth":0.4,"lowLight":true,"torch":false,
            "premium":true,"hd":true,"flash":false,"otherLens":true}"#).unwrap();
        assert_eq!((s.quality, s.fps, s.portrait, s.front), (1080, 60, true, true));
        assert_eq!((s.ev, s.ev_min, s.ev_max), (-3, -12, 12));
        assert_eq!(s.look, "warm");
        assert!(s.premium && s.hd && s.low_light && s.other_lens);
    }

    #[test]
    fn partial_or_odd_state_falls_back_safely() {
        let s = parse_state(br#"{"look":"<script>","smooth":7,"premium":"yes","zoom":"big"}"#).unwrap();
        assert_eq!(s.look, "none");
        assert_eq!(s.smooth, 1.0);
        assert!(!s.premium, "only a real true counts");
        assert_eq!(s.zoom, 1.0);
        assert!(parse_state(b"not json").is_none());
    }

    #[test]
    fn a_window_request_reaches_the_phone_only_after_it_announced_itself() {
        use std::io::Read;
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mut phone = TcpStream::connect(l.local_addr().unwrap()).unwrap();
        let (server_side, _) = l.accept().unwrap();
        attach(&server_side);
        // An older phone that never sent state gets nothing (it would misread the bytes).
        assert!(!send(&cmd_set("zoom", json!(2.0))));
        on_state(br#"{"zoom":1.0,"premium":false}"#);
        assert!(send(&cmd_set("zoom", json!(2.0))));
        let mut head = [0u8; 3];
        phone.read_exact(&mut head).unwrap();
        assert_eq!(head[0], b'C');
        let mut body = vec![0u8; u16::from_be_bytes([head[1], head[2]]) as usize];
        phone.read_exact(&mut body).unwrap();
        assert_eq!(body, br#"{"set":{"zoom":2.0}}"#);
        detach();
        assert!(state().is_none());
        assert!(!send(&cmd_action("stop")), "nothing is sent once the phone is gone");
    }

    #[test]
    fn requests_are_small_json() {
        assert_eq!(cmd_set("zoom", json!(2.0)), r#"{"set":{"zoom":2.0}}"#);
        assert_eq!(cmd_action("flip"), r#"{"action":"flip"}"#);
    }
}
