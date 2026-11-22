//! The server window. Port of `run_gui` (`apps/pc-server/server.py:1556-1863`).
//!
//! Deliberately a near-copy of the Python window rather than a redesign: users
//! upgrading from 1.1.17 should not have to relearn it, and every element here
//! earns its place in the existing product.
//!
//! ## The window's real job is the QR
//!
//! It looks like a status window, but the QR is the only *functional* element: a
//! phone on Wi-Fi can pair **no other way**. Manual connect sends auth token 0,
//! which is accepted only from an off-LAN or tether source. Everything else —
//! device count, update check, feedback — is secondary.
//!
//! ## Threading
//!
//! egui owns the main thread; the server runs on a worker. The two communicate
//! ONLY through [`Status`] atomics — never a shared lock, see `status.rs`.
//! Network calls (update check, download, feedback) each get their own thread
//! and report back through a channel, exactly as the Python version does with
//! `threading.Thread(target=worker)`. Blocking the UI thread on a cold-starting
//! backend would freeze the window for seconds.

// egui is re-exported by eframe rather than depended on directly, so the two
// can never drift to mismatched versions.
use eframe::egui;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::time::Duration;

use crate::http::{self, UpdateInfo};
use crate::status::Status;

/// Repaint cadence. The only live value is the device count, which the server
/// refreshes at 1 Hz — repainting faster would burn GPU for nothing.
const REPAINT_EVERY: Duration = Duration::from_millis(500);

// --- Colours -----------------------------------------------------------------
//
// The same palette the website and the phone app use, so the three surfaces of
// one product stop looking like three products. This window previously ran
// egui's stock LIGHT theme -- a grey dialog with default buttons -- which is
// the whole of why it read as unfinished.
//
// COLOURS ONLY. No font sizes, no spacing, no window size, nothing moved.
//
// That restriction is the point. A previous attempt re-themed AND re-laid-out
// this window: bigger type, roomier spacing, elements regrouped into cards. The
// window is sized to its content (380x420, measured against the real thing), so
// growing the type pushed the feedback row off the bottom and the cards off
// both sides. It compiled perfectly and was only wrong once you opened it.
// Changing paint cannot change layout; changing metrics can.
//
// The phone app's current theme (2026-11-13, owner: "update the PC server theme ... to latest, good looking as
// phone"): the warm brown page, cards and lines, and the orange accent of controller-ui/src/styles/redesign.css
// (--calm-paper / --calm-surface / --calm-soft / --calm-line / --calm-ink / --calm-muted / --calm-accent).
// Still colours and corner rounding only.
const PAPER: egui::Color32 = egui::Color32::from_rgb(0x1A, 0x12, 0x10);     // --calm-paper
const SURFACE: egui::Color32 = egui::Color32::from_rgb(0x25, 0x1A, 0x17);   // --calm-surface
const SURFACE_2: egui::Color32 = egui::Color32::from_rgb(0x36, 0x26, 0x1F); // --calm-soft
const INK: egui::Color32 = egui::Color32::from_rgb(0xF6, 0xED, 0xE9);       // --calm-ink
const TEXT: egui::Color32 = egui::Color32::from_rgb(0xEA, 0xDE, 0xD8);      // body text, a touch softer than ink
const ORANGE: egui::Color32 = egui::Color32::from_rgb(0xFF, 0x55, 0x00);    // --calm-accent (the app icon's orange)
const BORDER: egui::Color32 = egui::Color32::from_rgb(0x3F, 0x2E, 0x28);    // --calm-line
const MUTED: egui::Color32 = egui::Color32::from_rgb(0xB8, 0xA5, 0x9D);     // --calm-muted
const ART: egui::Color32 = egui::Color32::from_rgb(0x14, 0x0D, 0x0B);       // --calm-art: text-entry wells
/// Problems and success, readable on the brown page (the old #c0392b / #1e8e3e were too dark on it).
const BAD: egui::Color32 = egui::Color32::from_rgb(0xFF, 0x6B, 0x5B);
const GOOD: egui::Color32 = egui::Color32::from_rgb(0x4C, 0xD9, 0x7B);
/// Rounded like the phone app's buttons and cards.
const ROUND: egui::CornerRadius = egui::CornerRadius::same(12);

/// Paint egui in the product's colours. Called once at startup.
fn apply_theme(ctx: &egui::Context) {
    use egui::Stroke;
    ctx.set_theme(egui::Theme::Dark);

    let mut v = egui::Visuals::dark();
    v.panel_fill = PAPER;
    v.window_fill = PAPER;
    v.extreme_bg_color = ART; // text-edit wells
    v.faint_bg_color = SURFACE;
    v.override_text_color = Some(TEXT);
    v.hyperlink_color = ORANGE;
    v.window_stroke = Stroke::new(1.0, BORDER);

    // `weak_bg_fill` is what an ordinary button actually paints with;
    // `bg_fill` is the checked/selected state. Both must be set or half the
    // widgets stay grey.
    v.widgets.noninteractive.bg_fill = SURFACE;
    v.widgets.noninteractive.weak_bg_fill = SURFACE;
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0, BORDER);
    v.widgets.noninteractive.fg_stroke = Stroke::new(1.0, TEXT);

    v.widgets.inactive.bg_fill = SURFACE_2;
    v.widgets.inactive.weak_bg_fill = SURFACE;
    v.widgets.inactive.bg_stroke = Stroke::new(1.0, BORDER);
    v.widgets.inactive.fg_stroke = Stroke::new(1.0, TEXT);

    v.widgets.hovered.bg_fill = SURFACE_2;
    v.widgets.hovered.weak_bg_fill = SURFACE_2;
    v.widgets.hovered.bg_stroke = Stroke::new(1.0, ORANGE);
    v.widgets.hovered.fg_stroke = Stroke::new(1.0, INK);

    v.widgets.active.bg_fill = ORANGE;
    v.widgets.active.weak_bg_fill = ORANGE;
    v.widgets.active.bg_stroke = Stroke::new(1.0, ORANGE);
    v.widgets.active.fg_stroke = Stroke::new(1.0, PAPER);

    v.selection.bg_fill = ORANGE.gamma_multiply(0.35);
    v.selection.stroke = Stroke::new(1.0, INK);

    // Rounded corners like the phone app (paint only: corner radius never changes a widget's size).
    for w in [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
        w.corner_radius = ROUND;
    }
    v.window_corner_radius = egui::CornerRadius::same(16);
    v.menu_corner_radius = ROUND;

    ctx.set_visuals(v);
    let mut style = (*ctx.style_of(ctx.theme())).clone();
    style.spacing.item_spacing = egui::vec2(8.0, 6.0);
    style.spacing.button_padding = egui::vec2(12.0, 7.0);
    style.text_styles.insert(egui::TextStyle::Heading, egui::FontId::proportional(21.0));
    style.text_styles.insert(egui::TextStyle::Body, egui::FontId::proportional(14.0));
    style.text_styles.insert(egui::TextStyle::Button, egui::FontId::proportional(14.0));
    ctx.set_style_of(ctx.theme(), style);
}

/// Messages from worker threads back to the UI.
enum Msg {
    Update(Box<UpdateInfo>),
    DownloadProgress(u64, u64),
    DownloadDone(Result<std::path::PathBuf, String>),
    FeedbackDone(Result<(), String>),
    /// The PC's Wi-Fi address changed: redraw the QR (owner, 2026-11-22).
    LanIp(String),
}

#[derive(PartialEq)]
enum UpdateState {
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Failed,
}

pub struct App {
    status: Arc<Status>,
    qr_texture: Option<egui::TextureHandle>,
    qr_payload: String,
    pairing_key: String,
    lan_ip: String,

    /// CamOS: the phone's live picture, shown where the QR is while a phone streams.
    preview_tex: Option<egui::TextureHandle>,
    preview_seq: u64,
    /// The user tapped "Show QR" while a phone camera is live.
    show_qr: bool,
    /// Last moment a CamOS picture was seen (keeps the camera screen up through a quick restart).
    last_live: Option<std::time::Instant>,
    /// A short note under the controls ("Colour looks needs Premium on the phone").
    notice: Option<(String, std::time::Instant)>,
    /// The window size last asked for: compact for the QR, taller for the CamOS controls.
    win_size: egui::Vec2,
    /// The pairing QR needs redrawing (the Wi-Fi address changed).
    qr_dirty: bool,
    /// Full-screen camera view (owner, 2026-11-22).
    fullscreen: bool,
    /// Which screen was drawn last frame, and since when (for the fade-in when it changes).
    screen_kind: u8,
    screen_since: std::time::Instant,
    /// Window height being animated toward its target (smooth grow/shrink between screens).
    win_h_anim: f32,
    /// Where the QR button is, for the first-time tip that points at it.
    qr_btn: Option<egui::Rect>,
    /// The first-time tip ("show the QR again here") was dismissed (kept on disk).
    tip_seen: bool,

    tx: Sender<Msg>,
    rx: Receiver<Msg>,

    update_state: UpdateState,
    update_info: Option<UpdateInfo>,
    update_msg: String,
    dl_done: u64,
    dl_total: u64,

    feedback_open: bool,
    feedback_email: String,
    feedback_message: String,
    feedback_status: String,
    feedback_ok: bool,
    feedback_sending: bool,
}

impl App {
    pub fn new(
        cc: &eframe::CreationContext<'_>,
        status: Arc<Status>,
        qr_payload: String,
        pairing_key: String,
        lan_ip: String,
    ) -> Self {
        let (tx, rx) = channel();
        let mut app = Self {
            status,
            qr_texture: None,
            qr_payload,
            pairing_key,
            lan_ip,
            preview_tex: None,
            preview_seq: 0,
            show_qr: false,
            last_live: None,
            notice: None,
            win_size: QR_WINDOW,
            qr_dirty: false,
            fullscreen: false,
            screen_kind: 0,
            screen_since: std::time::Instant::now(),
            win_h_anim: QR_WINDOW.y,
            qr_btn: None,
            tip_seen: tip_file().map(|p| p.exists()).unwrap_or(false),
            tx,
            rx,
            update_state: UpdateState::Idle,
            update_info: None,
            update_msg: String::new(),
            dl_done: 0,
            dl_total: 0,
            feedback_open: false,
            feedback_email: String::new(),
            feedback_message: String::new(),
            feedback_status: String::new(),
            feedback_ok: false,
            feedback_sending: false,
        };
        apply_theme(&cc.egui_ctx);
        app.build_qr_texture(&cc.egui_ctx);
        // Silent auto-check on launch, matching `_run_check(manual=False)`. Only
        // surfaces if an update is actually available — a launch-time popup
        // saying "you're up to date" is noise.
        app.start_update_check(&cc.egui_ctx);
        app.watch_lan_ip(&cc.egui_ctx);
        app
    }

    /// Watch the PC's Wi-Fi address every few seconds and redraw the QR when it changes (a new network, a hotspot,
    /// a router that handed out a new address). Without this the window kept showing the old address and phones
    /// scanned a dead QR. Skipped when the address was set by hand (--lan-ip).
    fn watch_lan_ip(&self, ctx: &egui::Context) {
        let (tx, ctx, start) = (self.tx.clone(), ctx.clone(), self.lan_ip.clone());
        std::thread::Builder::new().name("lan-ip-watch".into()).spawn(move || {
            if crate::netdetect::lan_ip() != start {
                return; // set by hand: leave it alone
            }
            let mut last = start;
            loop {
                std::thread::sleep(Duration::from_secs(3));
                let now = crate::netdetect::lan_ip();
                if now != last && !now.is_empty() && now != "0.0.0.0" {
                    last = now.clone();
                    if tx.send(Msg::LanIp(now)).is_err() {
                        return;
                    }
                    ctx.request_repaint();
                }
            }
        }).ok();
    }

    /// Rasterise the pairing QR into a texture.
    ///
    /// Rendered at 1 module = 1 pixel and then scaled up with **nearest-neighbour**
    /// at draw time. Any smoothing here blurs module edges, and a blurry QR is a
    /// QR that phone cameras fail to decode — which would silently break the one
    /// functional element of this window.
    fn build_qr_texture(&mut self, ctx: &egui::Context) {
        let Some(modules) = crate::qr::modules(&self.qr_payload) else {
            eprintln!("warn: could not render the pairing QR — Wi-Fi pairing will not work");
            return;
        };
        let n = modules.len();
        const QUIET: usize = 4; // required quiet zone; without it scanners fail
        let dim = n + QUIET * 2;
        let mut pixels = vec![egui::Color32::WHITE; dim * dim];
        for (y, row) in modules.iter().enumerate() {
            for (x, &dark) in row.iter().enumerate() {
                if dark {
                    pixels[(y + QUIET) * dim + (x + QUIET)] = egui::Color32::BLACK;
                }
            }
        }
        let image = egui::ColorImage {
            size: [dim, dim],
            pixels,
            source_size: egui::vec2(dim as f32, dim as f32),
        };
        self.qr_texture = Some(ctx.load_texture(
            "pairing-qr",
            image,
            egui::TextureOptions::NEAREST,
        ));
    }

    fn start_update_check(&mut self, ctx: &egui::Context) {
        if self.update_state == UpdateState::Checking || self.update_state == UpdateState::Downloading {
            return;
        }
        self.update_state = UpdateState::Checking;
        self.update_msg = "Checking for updates…".into();
        let tx = self.tx.clone();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let info = http::check_for_update(Duration::from_secs(10), 1);
            let _ = tx.send(Msg::Update(Box::new(info)));
            ctx.request_repaint(); // wake the UI; it may be idle
        });
    }

    fn start_download(&mut self, ctx: &egui::Context) {
        let Some(info) = self.update_info.clone() else { return };
        self.update_state = UpdateState::Downloading;
        self.dl_done = 0;
        self.dl_total = 0;
        self.update_msg = "Downloading…".into();
        let tx = self.tx.clone();
        let ctx2 = ctx.clone();
        std::thread::spawn(move || {
            let dest = std::env::temp_dir().join("GamepadServer-Setup.exe");
            // Throttle repaint requests: the progress callback fires per 64 KB
            // chunk, and waking the UI thread on every one of those would spend
            // more time repainting than downloading.
            let mut last_repaint = std::time::Instant::now();
            let r = http::download_update(
                &info.url,
                &dest,
                &info.sha256,
                Duration::from_secs(300),
                |done, total| {
                    let _ = tx.send(Msg::DownloadProgress(done, total));
                    if last_repaint.elapsed() > Duration::from_millis(100) {
                        last_repaint = std::time::Instant::now();
                        ctx2.request_repaint();
                    }
                },
            );
            let _ = tx.send(Msg::DownloadDone(r.map(|()| dest)));
            ctx2.request_repaint();
        });
    }

    fn start_feedback_send(&mut self, ctx: &egui::Context) {
        self.feedback_sending = true;
        self.feedback_status = "Sending…".into();
        self.feedback_ok = false;
        let (email, message) = (self.feedback_email.clone(), self.feedback_message.clone());
        let tx = self.tx.clone();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let r = http::submit_feedback(&email, &message, Duration::from_secs(12));
            let _ = tx.send(Msg::FeedbackDone(r));
            ctx.request_repaint();
        });
    }

    fn drain_messages(&mut self) {
        while let Ok(msg) = self.rx.try_recv() {
            match msg {
                Msg::Update(info) => {
                    if let Some((kind, _)) = info.error {
                        self.update_state = UpdateState::Failed;
                        self.update_msg = kind.message().into();
                    } else if info.available {
                        self.update_state = UpdateState::Available;
                        self.update_msg = format!("Version {} is available", info.latest);
                    } else {
                        self.update_state = UpdateState::UpToDate;
                        self.update_msg = format!("Up to date (v{})", http::APP_VERSION);
                    }
                    self.update_info = Some(*info);
                }
                Msg::DownloadProgress(d, t) => {
                    self.dl_done = d;
                    self.dl_total = t;
                }
                Msg::DownloadDone(Ok(path)) => {
                    // Hand off to the elevated installer and quit IMMEDIATELY.
                    // The installer must be able to replace our files, and our
                    // singleton mutex only frees on process exit — staying alive
                    // here is what makes an upgrade fail with "file in use".
                    match launch_installer_elevated(&path) {
                        Ok(()) => {
                            crate::wlan::restore_now();
                            std::process::exit(0)
                        }
                        Err(e) => {
                            self.update_state = UpdateState::Failed;
                            self.update_msg = e;
                        }
                    }
                }
                Msg::DownloadDone(Err(e)) => {
                    self.update_state = UpdateState::Failed;
                    self.update_msg = e;
                }
                Msg::LanIp(ip) => {
                    let port = self.qr_payload.split(',').nth(1).and_then(|p| p.parse::<u16>().ok()).unwrap_or(7777);
                    self.qr_payload = crate::pairing::qr_payload(&ip, port, &self.pairing_key);
                    self.lan_ip = ip;
                    self.qr_dirty = true;
                }
                Msg::FeedbackDone(r) => {
                    self.feedback_sending = false;
                    match r {
                        Ok(()) => {
                            self.feedback_ok = true;
                            self.feedback_status = "Thanks! Your feedback was sent.".into();
                        }
                        Err(e) => {
                            self.feedback_ok = false;
                            self.feedback_status = e;
                        }
                    }
                }
            }
        }
    }
}

impl eframe::App for App {
    /// The page colour. eframe 0.35 draws straight onto the window (there is no panel to paint `panel_fill`), so
    /// without this the window showed eframe's own near-black (12,12,12) instead of the theme (2026-11-13).
    fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
        PAPER.to_normalized_gamma_f32()
    }

    // Two screens (owner, 2026-11-22: "QR must dominate, minimum text; when CamOS connects, the server becomes the
    // phone's controls, based on the phone's plan; no scrolling"):
    //   • waiting  — the QR fills the window; one short line; address + key small; update / feedback as small links
    //   • CamOS    — the live picture, the phone's camera buttons, and its picture controls (locked ones greyed)
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.drain_messages();
        if self.qr_dirty {
            self.qr_dirty = false;
            self.build_qr_texture(&ctx);
        }

        let preview = crate::camera::preview::latest();
        let phone = crate::camera::remote::state();
        if preview.is_some() {
            self.last_live = Some(std::time::Instant::now());
        } else if self.last_live.is_some_and(|t| t.elapsed() > LIVE_GRACE) {
            // The phone really stopped (not a quick restart for a new quality or shape).
            self.last_live = None;
            self.show_qr = false;
            self.preview_tex = None;
        }
        let camera_screen = self.last_live.is_some() && !self.show_qr;
        // Live: repaint at up to 60 Hz so the preview is as smooth as the phone (it was 15 Hz before).
        ctx.request_repaint_after(if self.last_live.is_some() { Duration::from_millis(16) } else { REPAINT_EVERY });
        if self.fullscreen && (!camera_screen || ctx.input(|i| i.key_pressed(egui::Key::Escape))) {
            self.fullscreen = false;
            ctx.send_viewport_cmd(egui::ViewportCommand::Fullscreen(false));
        }
        let kind = if self.feedback_open { 2 } else if camera_screen { 1 } else { 0 };
        if kind != self.screen_kind {
            self.screen_kind = kind;
            self.screen_since = std::time::Instant::now();
        }
        // Fade the new screen in over a quarter second (ease-out), like the phone app's screen changes.
        let t = (self.screen_since.elapsed().as_secs_f32() / 0.25).min(1.0);
        let fade = 1.0 - (1.0 - t) * (1.0 - t);
        if t < 1.0 {
            ctx.request_repaint();
        }

        let full = ui.max_rect();
        let footer_h = 30.0;
        let body = egui::Rect::from_min_max(full.min, egui::pos2(full.max.x, full.max.y - footer_h));
        let footer = egui::Rect::from_min_max(egui::pos2(full.min.x, full.max.y - footer_h), full.max);

        let used = ui.scope_builder(egui::UiBuilder::new().max_rect(body.shrink2(egui::vec2(16.0, 0.0))), |ui| {
            if fade < 1.0 { ui.multiply_opacity(fade.max(0.01)); }
            if self.feedback_open {
                self.feedback_screen(ui, &ctx);
            } else if camera_screen {
                self.camera_screen(ui, &ctx, preview.as_ref(), phone.as_ref());
            } else {
                self.qr_screen(ui);
            }
        }).response.rect;
        // The window hugs what it shows (no empty bands): measured each frame, resized when it changes by more than
        // a few pixels — compact around the QR, taller while the CamOS controls show, a row taller when chips wrap.
        let want = egui::vec2(QR_WINDOW.x, (used.max.y - full.min.y + 12.0 + footer_h).clamp(400.0, 820.0).round());
        if !self.fullscreen {
            // Grow / shrink smoothly toward the size this screen needs (about a quarter second), instead of a jump.
            let gap = want.y - self.win_h_anim;
            if gap.abs() > 1.0 {
                self.win_h_anim += if gap.abs() < 4.0 { gap } else { gap * 0.28 };
                ctx.request_repaint();
            }
            let now = egui::vec2(want.x, self.win_h_anim.round());
            if (now.y - self.win_size.y).abs() >= 1.0 {
                self.win_size = now;
                ctx.send_viewport_cmd(egui::ViewportCommand::MinInnerSize(egui::vec2(now.x, 380.0)));
                ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(now));
            }
        }

        // First time the camera screen shows: a tip pointing at the QR button.
        if camera_screen && !self.tip_seen && !self.feedback_open {
            if let Some(btn) = self.qr_btn {
                self.qr_tip(ui, btn);
            }
        }
        ui.scope_builder(egui::UiBuilder::new().max_rect(footer.shrink2(egui::vec2(14.0, 4.0))), |ui| {
            self.footer(ui, &ctx);
        });

    }
}

/// Starting window size (logical pixels): the QR + two lines + footer. After that the window sizes itself to fit.
const QR_WINDOW: egui::Vec2 = egui::vec2(430.0, 474.0);

/// How long the camera screen stays up after the picture stops, so a quick restart (new quality or shape)
/// doesn't flash the QR screen.
const LIVE_GRACE: Duration = Duration::from_millis(3500);

impl App {
    // ── waiting: the QR, and almost nothing else ─────────────────────────────────────────────────────────────
    fn qr_screen(&mut self, ui: &mut egui::Ui) {
        ui.vertical_centered(|ui| {
            let qr = (ui.available_width() - 40.0).clamp(220.0, 320.0);
            ui.add_space(16.0);
            if let Some(tex) = &self.qr_texture {
                // White plate hugging the code (the quiet zone is baked into the texture; see build_qr_texture).
                const PAD: f32 = 10.0;
                ui.allocate_ui(egui::vec2(qr + PAD * 2.0, qr + PAD * 2.0), |ui| {
                    egui::Frame::new().fill(egui::Color32::WHITE).corner_radius(18.0).inner_margin(PAD).show(ui, |ui| {
                        ui.add(egui::Image::new(tex).fit_to_exact_size(egui::vec2(qr, qr)));
                    });
                });
            } else {
                ui.colored_label(BAD, "Pairing QR unavailable");
            }
            ui.add_space(14.0);

            if let Some(err) = self.status.fatal_error() {
                ui.colored_label(BAD, egui::RichText::new(err).size(13.0));
            } else if !self.status.running() {
                ui.colored_label(BAD, egui::RichText::new("Server is not running").size(13.0));
            } else {
                let players = self.status.players();
                if players.is_empty() {
                    ui.label(egui::RichText::new("Scan with GamepadOS or CamOS").size(15.0).color(INK));
                } else {
                    players_line(ui, &players);
                }
            }
            ui.add_space(6.0);
            ui.label(egui::RichText::new(format!("{}  ·  {}", self.lan_ip, self.pairing_key)).size(12.0).color(MUTED));
            if self.last_live.is_some() {
                ui.add_space(8.0);
                if pill_button(ui, "Back to camera", false).clicked() {
                    self.show_qr = false;
                }
            }
        });
    }

    // ── CamOS connected: the picture and the phone's controls ────────────────────────────────────────────────
    fn camera_screen(&mut self, ui: &mut egui::Ui, ctx: &egui::Context, preview: Option<&crate::camera::preview::Preview>, phone: Option<&crate::camera::remote::PhoneState>) {
        use crate::camera::remote::{self, LOOKS, cmd_action, cmd_set};
        use serde_json::json;

        ui.add_space(10.0);
        // Top line: which phone, and a way back to the QR (to pair another phone).
        ui.horizontal(|ui| {
            let (dot, _) = ui.allocate_exact_size(egui::vec2(10.0, 18.0), egui::Sense::hover());
            ui.painter().circle_filled(dot.center(), 4.0, if preview.is_some() { ORANGE } else { MUTED });
            #[cfg(windows)]
            let device = { let c = crate::camera::stream::status(); if c.device.is_empty() { "Phone".to_string() } else { c.device } };
            #[cfg(not(windows))]
            let device = "Phone".to_string();
            ui.label(egui::RichText::new(format!("CamOS  ·  {device}")).size(13.0).color(INK));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let qr = icon_button(ui, Icon::Qr, false, 30.0).on_hover_text("Show the pairing QR");
                self.qr_btn = Some(qr.rect);
                if qr.clicked() {
                    self.show_qr = true;
                    self.dismiss_tip();
                }
                let (icon, tip) = if self.fullscreen { (Icon::Shrink, "Leave full screen (Esc)") } else { (Icon::Expand, "Full screen") };
                if icon_button(ui, icon, self.fullscreen, 30.0).on_hover_text(tip).clicked() {
                    self.fullscreen = !self.fullscreen;
                    ctx.send_viewport_cmd(egui::ViewportCommand::Fullscreen(self.fullscreen));
                }
                let players = self.status.players();
                if !players.is_empty() {
                    ui.label(egui::RichText::new(format!("{} playing", players.len())).size(12.0).color(ORANGE));
                }
            });
        });
        ui.add_space(8.0);

        // The picture, fitted (never cropped) in a dark rounded box.
        let w = ui.available_width();
        // Full screen: the picture takes all the height the controls leave (they need about 300 px).
        let box_size = if self.fullscreen {
            let h = (ui.available_height() - 300.0).max(200.0);
            egui::vec2(w, h)
        } else {
            egui::vec2(w, (w * 9.0 / 16.0).round())
        };
        let (box_rect, _) = ui.allocate_exact_size(box_size, egui::Sense::hover());
        let painter = ui.painter_at(box_rect);
        painter.rect_filled(box_rect, 14.0, ART);
        if let Some(pv) = preview {
            if self.preview_tex.is_none() || self.preview_seq != pv.seq {
                let img = egui::ColorImage::from_rgba_unmultiplied([pv.width as usize, pv.height as usize], &pv.rgba);
                match &mut self.preview_tex {
                    Some(t) => t.set(img, egui::TextureOptions::LINEAR),
                    None => self.preview_tex = Some(ctx.load_texture("camos-preview", img, egui::TextureOptions::LINEAR)),
                }
                self.preview_seq = pv.seq;
            }
            if let Some(tex) = &self.preview_tex {
                let k = (box_rect.width() / pv.width as f32).min(box_rect.height() / pv.height as f32);
                let r = egui::Rect::from_center_size(box_rect.center(), egui::vec2(pv.width as f32 * k, pv.height as f32 * k));
                egui::Image::new(tex).corner_radius(14.0).paint_at(ui, r);
            }
            // LIVE pill over the picture.
            if let Some(p) = phone {
                // The frame rate the PC actually RECEIVES (measured), not the one asked for: phone and PC agree.
                #[cfg(windows)]
                let got = crate::camera::stream::status().fps.round() as u32;
                #[cfg(not(windows))]
                let got = p.fps;
                let text = format!("LIVE  {}p · {} fps", p.quality, if got > 0 { got } else { p.fps });
                let font = egui::FontId::proportional(11.0);
                let g = painter.layout_no_wrap(text, font, INK);
                let pill = egui::Rect::from_min_size(box_rect.min + egui::vec2(10.0, 10.0), g.size() + egui::vec2(26.0, 10.0));
                painter.rect_filled(pill, 999.0, egui::Color32::from_rgba_unmultiplied(9, 6, 5, 190));
                painter.circle_filled(pill.left_center() + egui::vec2(10.0, 0.0), 3.5, ORANGE);
                painter.galley(pill.min + egui::vec2(18.0, 5.0), g, INK);
            }
        } else {
            painter.text(box_rect.center(), egui::Align2::CENTER_CENTER, "Switching…", egui::FontId::proportional(14.0), MUTED);
        }
        ui.add_space(12.0);

        let Some(p) = phone else {
            // A phone app from before remote control: picture only.
            ui.vertical_centered(|ui| {
                ui.label(egui::RichText::new("Update CamOS on your phone for controls here").size(12.0).color(MUTED));
            });
            return;
        };
        let ask = |json: String| { remote::send(&json); };

        // Main buttons, like the phone's control bar.
        ui.horizontal(|ui| {
            let n = 3.0 + if p.other_lens { 1.0 } else { 0.0 } + if p.flash { 1.0 } else { 0.0 };
            let used = n * 44.0 + (n - 1.0) * 10.0 + 10.0 + 90.0;
            ui.add_space(((ui.available_width() - used) / 2.0).max(0.0));
            ui.spacing_mut().item_spacing.x = 10.0;
            if p.other_lens && icon_button(ui, Icon::Switch, false, 44.0).on_hover_text("Switch camera").clicked() {
                ask(cmd_action("flip"));
            }
            if p.flash && icon_button(ui, Icon::Flash, p.torch, 44.0).on_hover_text(if p.torch { "Flashlight off" } else { "Flashlight on" }).clicked() {
                ask(cmd_set("torch", json!(!p.torch)));
            }
            let (icon, tip) = if p.portrait { (Icon::Wide, "Switch to a wide picture") } else { (Icon::Tall, "Switch to a tall picture") };
            if icon_button(ui, icon, false, 44.0).on_hover_text(tip).clicked() {
                ask(cmd_action("reshape"));
            }
            if icon_button(ui, Icon::Moon, false, 44.0).on_hover_text("Dim the phone screen (keeps streaming)").clicked() {
                ask(cmd_action("dim"));
            }
            ui.add_space(10.0);
            if ui.add_sized([90.0, 44.0], egui::Button::new(egui::RichText::new("Stop").color(PAPER).strong()).fill(ORANGE).corner_radius(14.0)).clicked() {
                ask(cmd_action("stop"));
            }
        });
        ui.add_space(12.0);

        // Picture controls. Labels are one word; locked items (the phone's plan) show a lock and do nothing.
        let label_w = 78.0;
        let row = |ui: &mut egui::Ui, label: &str, add: &mut dyn FnMut(&mut egui::Ui)| {
            ui.horizontal_top(|ui| {
                ui.allocate_ui_with_layout(egui::vec2(label_w, 30.0), egui::Layout::left_to_right(egui::Align::Center), |ui| {
                    ui.label(egui::RichText::new(label).size(13.0).color(MUTED));
                });
                // Chips wrap onto a second line rather than running off the window.
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = egui::vec2(6.0, 6.0);
                    add(ui);
                });
            });
            ui.add_space(4.0);
        };

        let mut locked_tap: Option<&str> = None;
        row(ui, "Zoom", &mut |ui| {
            let (dec, inc) = stepper(ui, &format!("{:.1}×", p.zoom), p.zoom > p.zoom_min + 0.01, p.zoom < p.zoom_max - 0.01);
            if dec { ask(cmd_set("zoom", json!(((p.zoom - 0.5).max(p.zoom_min) * 10.0).round() / 10.0))); }
            if inc { ask(cmd_set("zoom", json!(((p.zoom + 0.5).min(p.zoom_max) * 10.0).round() / 10.0))); }
            ui.add_space(14.0);
            ui.label(egui::RichText::new("Light").size(13.0).color(MUTED));
            let ev = p.ev as f32 * p.ev_step;
            let (dec, inc) = stepper(ui, &format!("{}{:.1}", if ev > 0.0 { "+" } else { "" }, ev), p.ev > p.ev_min, p.ev < p.ev_max);
            let step = if p.ev_step > 0.0 { (0.34 / p.ev_step).round().max(1.0) as i32 } else { 1 };
            if dec { ask(cmd_set("ev", json!((p.ev - step).max(p.ev_min)))); }
            if inc { ask(cmd_set("ev", json!((p.ev + step).min(p.ev_max)))); }
        });
        row(ui, "Quality", &mut |ui| {
            for q in [480u32, 720, 1080] {
                let locked = q == 1080 && !p.hd;
                if chip(ui, &format!("{q}p"), p.quality == q, locked).clicked() {
                    if locked { locked_tap = Some("1080p HD"); } else if p.quality != q { ask(cmd_set("quality", json!(q))); }
                }
            }
        });
        row(ui, "Look", &mut |ui| {
            for (key, label) in LOOKS {
                let locked = !p.premium && key != "none";
                if chip(ui, label, p.look == key, locked).clicked() {
                    if locked { locked_tap = Some("Colour looks"); } else { ask(cmd_set("look", json!(key))); }
                }
            }
        });
        row(ui, "Smoothing", &mut |ui| {
            let now = if p.smooth < 0.2 { 0 } else if p.smooth < 0.6 { 1 } else { 2 };
            for (i, (label, v)) in [("Off", 0.0), ("Low", 0.4), ("High", 0.8)].into_iter().enumerate() {
                let locked = !p.premium && i > 0;
                if chip(ui, label, now == i, locked).clicked() {
                    if locked { locked_tap = Some("Face smoothing"); } else { ask(cmd_set("smooth", json!(v))); }
                }
            }
            ui.add_space(10.0);
            let locked = !p.premium;
            if chip(ui, "Low light", p.low_light, locked).clicked() {
                if locked { locked_tap = Some("Low-light boost"); } else { ask(cmd_set("lowLight", json!(!p.low_light))); }
            }
        });

        if let Some(what) = locked_tap {
            self.notice = Some((format!("{what} needs Premium on the phone"), std::time::Instant::now()));
        }
        if let Some((msg, at)) = &self.notice {
            if at.elapsed() < Duration::from_secs(3) {
                ui.vertical_centered(|ui| { ui.label(egui::RichText::new(msg).size(12.0).color(ORANGE)); });
            } else {
                self.notice = None;
            }
        }
    }

    // ── footer: version / update and feedback as small links ─────────────────────────────────────────────────
    fn footer(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        ui.horizontal(|ui| {
            match self.update_state {
                UpdateState::Available => {
                    if pill_button(ui, "Install update", true).clicked() {
                        self.start_download(ctx);
                    }
                }
                UpdateState::Downloading => {
                    let pct = if self.dl_total > 0 { self.dl_done * 100 / self.dl_total } else { 0 };
                    ui.label(egui::RichText::new(format!("Updating {pct}%")).size(12.0).color(MUTED));
                }
                UpdateState::Failed => {
                    ui.label(egui::RichText::new("Update failed").size(12.0).color(BAD)).on_hover_text(&self.update_msg);
                    ui.hyperlink_to(egui::RichText::new("Download").size(12.0), http::DOWNLOAD_PAGE_URL);
                }
                UpdateState::Checking => {
                    ui.label(egui::RichText::new("Checking…").size(12.0).color(MUTED));
                }
                _ => {
                    ui.label(egui::RichText::new(format!("v{}", http::APP_VERSION)).size(12.0).color(MUTED));
                    if link(ui, if self.update_state == UpdateState::UpToDate { "Up to date · check again" } else { "Check for updates" }).clicked() {
                        self.start_update_check(ctx);
                    }
                }
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if !self.feedback_open && link(ui, "Feedback").clicked() {
                    self.feedback_open = true;
                    self.feedback_status.clear();
                }
                // Short notes (feedback sent) live here on the QR screen.
                if let Some((msg, at)) = &self.notice {
                    if at.elapsed() < Duration::from_secs(3) && self.last_live.is_none() {
                        ui.label(egui::RichText::new(msg).size(12.0).color(GOOD));
                    }
                }
            });
        });
    }
}

/// Where "the first-time tip was dismissed" is remembered (next to the pairing key).
fn tip_file() -> Option<std::path::PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| std::path::PathBuf::from(d).join("GamepadServer").join("tip-qr-button.seen"))
}

impl App {
    fn dismiss_tip(&mut self) {
        if !self.tip_seen {
            self.tip_seen = true;
            if let Some(p) = tip_file() {
                let _ = std::fs::create_dir_all(p.parent().unwrap_or(std::path::Path::new(".")));
                let _ = std::fs::write(p, b"1");
            }
        }
    }

    /// A small bubble under the QR button with an arrow pointing up at it: "Show the QR code again here".
    fn qr_tip(&mut self, ui: &mut egui::Ui, btn: egui::Rect) {
        let w = 210.0;
        let top = btn.max.y + 10.0;
        let right = btn.max.x + 6.0;
        let rect = egui::Rect::from_min_max(egui::pos2(right - w, top), egui::pos2(right, top + 66.0));
        let p = ui.ctx().layer_painter(egui::LayerId::new(egui::Order::Foreground, egui::Id::new("qr-tip")));
        p.rect(rect, 12.0, SURFACE_2, egui::Stroke::new(1.0, ORANGE), egui::StrokeKind::Inside);
        let tip = btn.center_bottom() + egui::vec2(0.0, 2.0);
        p.add(egui::Shape::convex_polygon(vec![tip, egui::pos2(tip.x - 7.0, top + 0.5), egui::pos2(tip.x + 7.0, top + 0.5)], SURFACE_2, egui::Stroke::NONE));
        p.line_segment([tip, egui::pos2(tip.x - 7.0, top)], egui::Stroke::new(1.0, ORANGE));
        p.line_segment([tip, egui::pos2(tip.x + 7.0, top)], egui::Stroke::new(1.0, ORANGE));
        p.text(rect.min + egui::vec2(12.0, 10.0), egui::Align2::LEFT_TOP, "Show the QR code again here", egui::FontId::proportional(13.0), INK);
        let got = egui::Rect::from_min_size(rect.min + egui::vec2(12.0, 36.0), egui::vec2(60.0, 22.0));
        p.text(got.left_center(), egui::Align2::LEFT_CENTER, "Got it", egui::FontId::proportional(13.0), ORANGE);
        let r = ui.interact(rect, egui::Id::new("qr-tip-click"), egui::Sense::click());
        if r.clicked() {
            self.dismiss_tip();
        }
        if r.hovered() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
        }
    }
}

// ── small widgets in the phone app's style ───────────────────────────────────────────────────────────────────

/// Connected GamepadOS players on one line: "P1 Akhil   P2 Guest".
fn players_line(ui: &mut egui::Ui, players: &[crate::player::PlayerRow]) {
    let font = egui::FontId::proportional(14.0);
    let mut job = egui::text::LayoutJob::default();
    for (i, p) in players.iter().enumerate() {
        if i > 0 {
            job.append("    ", 0.0, egui::TextFormat { font_id: font.clone(), color: INK, ..Default::default() });
        }
        let name: String = p.name.clone().unwrap_or_else(|| "Phone".to_owned()).chars().take(14).collect();
        job.append(&format!("P{} ", p.slot + 1), 0.0, egui::TextFormat { font_id: font.clone(), color: ORANGE, ..Default::default() });
        job.append(&name, 0.0, egui::TextFormat { font_id: font.clone(), color: INK, ..Default::default() });
    }
    ui.label(job);
}

/// Plain small link text (no underline until hovered).
fn link(ui: &mut egui::Ui, text: &str) -> egui::Response {
    let r = ui.add(egui::Label::new(egui::RichText::new(text).size(12.0).color(MUTED)).sense(egui::Sense::click()));
    if r.hovered() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    r
}

/// A rounded pill button; `main` = the orange one.
fn pill_button(ui: &mut egui::Ui, text: &str, main: bool) -> egui::Response {
    let rt = egui::RichText::new(text).size(13.0).color(if main { PAPER } else { INK });
    let mut b = egui::Button::new(if main { rt.strong() } else { rt }).corner_radius(999.0);
    if main {
        b = b.fill(ORANGE);
    }
    ui.add(b)
}

/// A choice chip like the phone's ChoiceBar pills. Locked: dimmed with a small padlock; still clickable so the
/// window can say why.
fn chip(ui: &mut egui::Ui, text: &str, selected: bool, locked: bool) -> egui::Response {
    let font = egui::FontId::proportional(13.0);
    let galley = ui.painter().layout_no_wrap(text.to_owned(), font, INK);
    let lock_w = if locked { 12.0 } else { 0.0 };
    let size = egui::vec2(galley.size().x + 20.0 + lock_w, 30.0);
    let (rect, resp) = ui.allocate_exact_size(size, egui::Sense::click());
    let hover = resp.hovered();
    let (fill, stroke, ink) = if selected && !locked {
        (ORANGE, ORANGE, PAPER)
    } else if hover {
        (SURFACE_2, ORANGE, INK)
    } else {
        (SURFACE, BORDER, if locked { MUTED } else { INK })
    };
    let p = ui.painter();
    p.rect(rect, 999.0, fill, egui::Stroke::new(1.0, stroke), egui::StrokeKind::Inside);
    p.galley(egui::pos2(rect.min.x + 10.0, rect.center().y - galley.size().y / 2.0), galley, ink);
    if locked {
        draw_lock(p, egui::pos2(rect.max.x - 15.0, rect.center().y), MUTED);
    }
    if hover {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    resp
}

/// "−  value  +" with round buttons.
fn stepper(ui: &mut egui::Ui, value: &str, can_dec: bool, can_inc: bool) -> (bool, bool) {
    let dec = ui.add_enabled(can_dec, egui::Button::new(egui::RichText::new("−").size(15.0)).min_size(egui::vec2(30.0, 30.0)).corner_radius(999.0)).clicked();
    ui.allocate_ui_with_layout(egui::vec2(44.0, 30.0), egui::Layout::centered_and_justified(egui::Direction::LeftToRight), |ui| {
        ui.label(egui::RichText::new(value).size(13.0).color(INK));
    });
    let inc = ui.add_enabled(can_inc, egui::Button::new(egui::RichText::new("+").size(15.0)).min_size(egui::vec2(30.0, 30.0)).corner_radius(999.0)).clicked();
    (dec, inc)
}

#[derive(Clone, Copy)]
enum Icon { Switch, Flash, Wide, Tall, Moon, Qr, Expand, Shrink }

/// A square rounded icon button, drawn with lines (no icon font needed). `on` = highlighted (e.g. flashlight on).
fn icon_button(ui: &mut egui::Ui, icon: Icon, on: bool, side: f32) -> egui::Response {
    let (rect, resp) = ui.allocate_exact_size(egui::vec2(side, side), egui::Sense::click());
    let hover = resp.hovered();
    let fill = if on { ORANGE } else if hover { SURFACE_2 } else { SURFACE };
    let ink = if on { PAPER } else { INK };
    let p = ui.painter();
    p.rect(rect, side * 0.3, fill, egui::Stroke::new(1.0, if hover && !on { ORANGE } else { BORDER }), egui::StrokeKind::Inside);
    let c = rect.center();
    let s = side * 0.22; // icon half-size
    let st = egui::Stroke::new(1.8, ink);
    match icon {
        Icon::Switch => {
            // Two curved arrows going round: "turn the camera around".
            for (start, end, tip) in [(200.0f32, 340.0f32, 340.0f32), (20.0, 160.0, 160.0)] {
                let pts: Vec<egui::Pos2> = (0..=12).map(|i| {
                    let a = (start + (end - start) * i as f32 / 12.0).to_radians();
                    c + egui::vec2(a.cos(), a.sin()) * s
                }).collect();
                p.add(egui::Shape::line(pts, st));
                let a = tip.to_radians();
                let at = c + egui::vec2(a.cos(), a.sin()) * s;
                let tangent = egui::vec2(-a.sin(), a.cos());
                let normal = egui::vec2(a.cos(), a.sin());
                p.add(egui::Shape::convex_polygon(vec![at + tangent * 4.0, at - normal * 3.5, at + normal * 3.5], ink, egui::Stroke::NONE));
            }
        }
        Icon::Flash => {
            let pts = vec![c + egui::vec2(1.5, -s * 1.1), c + egui::vec2(-s * 0.7, s * 0.15), c + egui::vec2(-0.5, s * 0.15),
                           c + egui::vec2(-1.5, s * 1.1), c + egui::vec2(s * 0.7, -s * 0.15), c + egui::vec2(0.5, -s * 0.15)];
            p.add(egui::Shape::closed_line(pts, st));
        }
        Icon::Wide => { p.rect_stroke(egui::Rect::from_center_size(c, egui::vec2(s * 2.2, s * 1.3)), 3.0, st, egui::StrokeKind::Middle); }
        Icon::Tall => { p.rect_stroke(egui::Rect::from_center_size(c, egui::vec2(s * 1.3, s * 2.2)), 3.0, st, egui::StrokeKind::Middle); }
        Icon::Moon => {
            // Filled crescent: a disc with a second disc in the button colour biting into it.
            p.circle_filled(c, s * 0.95, ink);
            p.circle_filled(c + egui::vec2(s * 0.5, -s * 0.35), s * 0.8, fill);
        }
        Icon::Expand | Icon::Shrink => {
            // Four corner brackets: pointing out (enter full screen) or in (leave it).
            let q = s * 0.85;
            let l = s * 0.45;
            let out = matches!(icon, Icon::Expand);
            for (dx, dy) in [(-1.0f32, -1.0f32), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
                // Expand: the bracket sits at the outer corner, arms pointing back in. Shrink: near the centre,
                // arms pointing out.
                let (k, sx, sy) = if out { (c + egui::vec2(dx * q, dy * q), -dx, -dy) } else { (c + egui::vec2(dx * q * 0.4, dy * q * 0.4), dx, dy) };
                p.add(egui::Shape::line(vec![k + egui::vec2(sx * l, 0.0), k, k + egui::vec2(0.0, sy * l)], st));
            }
        }
        Icon::Qr => {
            let q = s * 0.55;
            for (dx, dy) in [(-1.0f32, -1.0f32), (1.0, -1.0), (-1.0, 1.0)] {
                p.rect_stroke(egui::Rect::from_center_size(c + egui::vec2(dx, dy) * q, egui::vec2(q * 1.3, q * 1.3)), 1.5, egui::Stroke::new(1.4, ink), egui::StrokeKind::Middle);
            }
            p.rect_filled(egui::Rect::from_center_size(c + egui::vec2(q, q), egui::vec2(q * 0.6, q * 0.6)), 1.0, ink);
        }
    }
    if hover {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    resp
}

/// Small padlock: a rounded body and a shackle.
fn draw_lock(p: &egui::Painter, c: egui::Pos2, color: egui::Color32) {
    p.rect_filled(egui::Rect::from_center_size(c + egui::vec2(0.0, 2.0), egui::vec2(8.0, 6.0)), 1.5, color);
    let pts: Vec<egui::Pos2> = (0..=10).map(|i| {
        let a = (180.0 + 180.0 * i as f32 / 10.0f32).to_radians();
        c + egui::vec2(0.0, -1.0) + egui::vec2(a.cos() * 2.6, a.sin() * 3.0)
    }).collect();
    p.add(egui::Shape::line(pts, egui::Stroke::new(1.4, color)));
}

impl App {
    /// Feedback as a page of its own, in the app's look (replaces the old floating box).
    fn feedback_screen(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        ui.add_space(16.0);
        ui.label(egui::RichText::new("Feedback").size(22.0).color(INK).strong());
        ui.label(egui::RichText::new("We read every message. Add your email so we can reply.").size(13.0).color(MUTED));
        ui.add_space(14.0);
        let field = |ui: &mut egui::Ui, label: &str| { ui.label(egui::RichText::new(label).size(12.0).color(MUTED)); };
        field(ui, "Your email");
        ui.add(egui::TextEdit::singleline(&mut self.feedback_email).desired_width(f32::INFINITY).margin(egui::vec2(10.0, 8.0)).hint_text("you@example.com"));
        ui.add_space(10.0);
        field(ui, "Message");
        ui.add(egui::TextEdit::multiline(&mut self.feedback_message).desired_rows(7).desired_width(f32::INFINITY).margin(egui::vec2(10.0, 8.0)).hint_text("What happened, or what would make it better?"));
        ui.add_space(8.0);
        if !self.feedback_status.is_empty() {
            ui.label(egui::RichText::new(&self.feedback_status).size(12.0).color(if self.feedback_ok { GOOD } else { BAD }));
            ui.add_space(4.0);
        }
        ui.horizontal(|ui| {
            let send = ui.add_enabled(!self.feedback_sending,
                egui::Button::new(egui::RichText::new(if self.feedback_sending { "Sending…" } else { "Send" }).color(PAPER).strong())
                    .fill(ORANGE).corner_radius(999.0).min_size(egui::vec2(110.0, 38.0)));
            if send.clicked() {
                // Same checks (and messages) as before, before spending a network round-trip.
                if !http::looks_like_email(&self.feedback_email) {
                    self.feedback_ok = false;
                    self.feedback_status = "Please enter a valid email.".into();
                } else if self.feedback_message.trim().chars().count() < http::MIN_FEEDBACK_LEN {
                    self.feedback_ok = false;
                    self.feedback_status = format!("Please write at least {} characters.", http::MIN_FEEDBACK_LEN);
                } else {
                    self.start_feedback_send(ctx);
                }
            }
            ui.add_space(8.0);
            if link(ui, "Cancel").clicked() {
                self.feedback_open = false;
                self.feedback_status.clear();
            }
        });
        // Sent: back to the main screen (the footer shows the thank-you for a moment).
        if self.feedback_ok {
            self.feedback_open = false;
            self.feedback_email.clear();
            self.feedback_message.clear();
            self.feedback_ok = false;
            self.notice = Some(("Thanks! Your feedback was sent.".into(), std::time::Instant::now()));
        }
    }
}

/// Start the Inno installer elevated via `ShellExecuteW(runas)`.
///
/// `/SILENT` shows the installer's own slim progress bar; the installer then
/// closes this server (via `AppMutex` + `CloseApplications=force` — see
/// `singleton.rs`) and relaunches the new build itself.
#[cfg(windows)]
fn launch_installer_elevated(path: &std::path::Path) -> Result<(), String> {
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: isize,
            lpOperation: *const u16,
            lpFile: *const u16,
            lpParameters: *const u16,
            lpDirectory: *const u16,
            nShowCmd: i32,
        ) -> isize;
    }
    let wide = |s: &str| -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() };
    let op = wide("runas");
    let file = wide(&path.to_string_lossy());
    let params = wide("/SILENT");
    // SAFETY: all four pointers are null-terminated UTF-16 buffers that outlive
    // the call.
    let rc = unsafe {
        ShellExecuteW(0, op.as_ptr(), file.as_ptr(), params.as_ptr(), std::ptr::null(), 1)
    };
    // ShellExecuteW returns >32 on success. The common failure is the user
    // declining UAC (SE_ERR_ACCESSDENIED, 5) — not an error worth alarming
    // about, so it gets a plain-language message and the server keeps running.
    if rc > 32 {
        Ok(())
    } else if rc == 5 {
        Err("Update cancelled — administrator approval is required.".into())
    } else {
        Err(format!("Couldn't start the installer (code {rc})."))
    }
}

#[cfg(not(windows))]
fn launch_installer_elevated(_path: &std::path::Path) -> Result<(), String> {
    Err("Updates are Windows-only.".into())
}

/// Decode a PNG into egui's RGBA icon format.
///
/// `image` is pulled in with **png only** (no default features): the crate
/// otherwise drags in decoders for a dozen formats we will never open, and this
/// binary decodes exactly one image, once, at startup.
fn image_from_png(bytes: &[u8]) -> Option<egui::IconData> {
    let img = image::load_from_memory_with_format(bytes, image::ImageFormat::Png).ok()?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    Some(egui::IconData { rgba: rgba.into_raw(), width, height })
}

/// The taskbar / title-bar icon.
///
/// Same `app_icon.png` the Python server used, embedded at compile time so there
/// is no file to lose at runtime. Must match the exe icon set in `build.rs` and
/// the installer's `SetupIconFile` — three places, one image.
fn load_window_icon() -> egui::IconData {
    const PNG: &[u8] = include_bytes!("../assets/app_icon.png");
    match image_from_png(PNG) {
        Some(icon) => icon,
        None => {
            // A missing icon is cosmetic; never let it stop the server starting.
            eprintln!("warn: could not decode the window icon");
            egui::IconData { rgba: vec![0; 4], width: 1, height: 1 }
        }
    }
}

/// Guard so the process really dies when the window closes.
///
/// This is the **1.1.17 fix** carried over: closing the window used to leave a
/// background process alive, which then produced a bogus "already running"
/// popup on the next launch (and, with the singleton in place, would now block
/// startup outright). The server runs on a detached worker thread, so returning
/// from the event loop is NOT enough on its own.
pub static SHOULD_EXIT: AtomicBool = AtomicBool::new(false);

/// Run the window. Returns when it closes.
pub fn run(
    status: Arc<Status>,
    qr_payload: String,
    pairing_key: String,
    lan_ip: String,
) -> Result<(), String> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            // Tall enough for the big QR and for the CamOS controls, with no scrolling (owner, 2026-11-22).
            .with_inner_size(QR_WINDOW)
            .with_min_inner_size(QR_WINDOW)
            .with_resizable(false)
            // with_resizable(false) alone does NOT grey out the maximize button on
            // Windows -- the caption button stays lit and clickable, and clicking it
            // snaps the frame to the full screen around a fixed-size 380x420 layout,
            // leaving the QR marooned in a large empty window. Disable the button
            // itself so the affordance matches what the window can actually do.
            .with_maximize_button(false)
            .with_title("Gamepad Server")
            .with_icon(load_window_icon()),
        ..Default::default()
    };
    let r = eframe::run_native(
        "Gamepad Server",
        options,
        Box::new(move |cc| Ok(Box::new(App::new(cc, status, qr_payload, pairing_key, lan_ip)))),
    )
    .map_err(|e| format!("could not open the server window: {e}"));

    SHOULD_EXIT.store(true, Ordering::Relaxed);
    r
}
