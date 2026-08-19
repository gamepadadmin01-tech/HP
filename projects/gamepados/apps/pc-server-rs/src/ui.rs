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
const PAPER: egui::Color32 = egui::Color32::from_rgb(0x07, 0x08, 0x0C);
const SURFACE: egui::Color32 = egui::Color32::from_rgb(0x13, 0x15, 0x1C);
const SURFACE_2: egui::Color32 = egui::Color32::from_rgb(0x1B, 0x1E, 0x27);
const INK: egui::Color32 = egui::Color32::from_rgb(0xF4, 0xF5, 0xF8);
const TEXT: egui::Color32 = egui::Color32::from_rgb(0xD6, 0xD9, 0xE1);
const ORANGE: egui::Color32 = egui::Color32::from_rgb(0xFF, 0x5A, 0x14);
const BORDER: egui::Color32 = egui::Color32::from_rgb(0x24, 0x27, 0x33);

/// Paint egui in the product's colours. Called once at startup.
fn apply_theme(ctx: &egui::Context) {
    use egui::{Color32, Stroke};

    let mut v = egui::Visuals::dark();
    v.panel_fill = PAPER;
    v.window_fill = PAPER;
    v.extreme_bg_color = egui::Color32::from_rgb(0x04, 0x05, 0x08); // text-edit wells
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
    v.widgets.active.fg_stroke = Stroke::new(1.0, Color32::WHITE);

    v.selection.bg_fill = ORANGE.gamma_multiply(0.35);
    v.selection.stroke = Stroke::new(1.0, INK);

    ctx.set_visuals(v);
}

/// Messages from worker threads back to the UI.
enum Msg {
    Update(Box<UpdateInfo>),
    DownloadProgress(u64, u64),
    DownloadDone(Result<std::path::PathBuf, String>),
    FeedbackDone(Result<(), String>),
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
        app
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
                        Ok(()) => std::process::exit(0),
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
    // eframe 0.35 hands the app a `Ui` directly; the older `update(ctx, frame)`
    // + explicit CentralPanel form no longer exists.
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        self.drain_messages();
        ctx.request_repaint_after(REPAINT_EVERY);

        {
            let ui = &mut *ui;
            ui.add_space(6.0);
            ui.vertical_centered(|ui| {
                ui.heading("Gamepad Server");
                ui.label(
                    egui::RichText::new("Scan the code using GamepadOS on your phone.")
                        .size(12.0)
                        .weak(),
                );
            });
            ui.add_space(8.0);

            // ── QR ───────────────────────────────────────────────────────────
            ui.vertical_centered(|ui| {
                if let Some(tex) = &self.qr_texture {
                    // The white plate hugs the QR: it is sized to the code plus a
                    // small margin, NOT stretched to the panel width. Two reasons
                    // it must be tight — a wide white band reads as a UI surface
                    // rather than part of the code, and the QUIET ZONE is already
                    // baked into the texture (4 modules, added in
                    // build_qr_texture), so extra white here adds nothing a
                    // scanner uses. It only makes the code smaller for a given
                    // window, which is the opposite of what helps a phone camera.
                    const QR: f32 = 190.0;
                    const PAD: f32 = 10.0;
                    let side = QR + PAD * 2.0;
                    // Allocate exactly the card's footprint so the Frame cannot
                    // expand to fill the centred layout's full width.
                    ui.allocate_ui(egui::vec2(side, side), |ui| {
                        egui::Frame::new()
                            .fill(egui::Color32::WHITE)
                            .corner_radius(6.0)
                            .inner_margin(PAD)
                            .show(ui, |ui| {
                                ui.add(
                                    egui::Image::new(tex)
                                        .fit_to_exact_size(egui::vec2(QR, QR)),
                                );
                            });
                    });
                } else {
                    ui.colored_label(
                        egui::Color32::from_rgb(0xc0, 0x39, 0x2b),
                        "Pairing QR unavailable — Wi-Fi pairing will not work.",
                    );
                }
            });

            ui.add_space(10.0);

            // ── Live state ───────────────────────────────────────────────────
            ui.vertical_centered(|ui| {
                if self.status.running() {
                    let n = self.status.devices();
                    ui.label(
                        egui::RichText::new(format!("Connected devices: {n}"))
                            .size(14.0)
                            .strong(),
                    );
                } else {
                    ui.colored_label(
                        egui::Color32::from_rgb(0xc0, 0x39, 0x2b),
                        "Server is not running — see the console for the reason.",
                    );
                }
                ui.label(
                    egui::RichText::new(format!("{}  ·  key {}", self.lan_ip, self.pairing_key))
                        .size(11.0)
                        .weak(),
                );
            });

            ui.add_space(10.0);
            ui.separator();

            // ── Updates ──────────────────────────────────────────────────────
            ui.horizontal(|ui| {
                let checking = self.update_state == UpdateState::Checking;
                let downloading = self.update_state == UpdateState::Downloading;

                if self.update_state == UpdateState::Available {
                    if ui.button("Install update").clicked() {
                        self.start_download(&ctx);
                    }
                } else if ui
                    .add_enabled(!checking && !downloading, egui::Button::new("Check for updates"))
                    .clicked()
                {
                    self.start_update_check(&ctx);
                }

                let color = match self.update_state {
                    UpdateState::Failed => egui::Color32::from_rgb(0xc0, 0x39, 0x2b),
                    UpdateState::Available => egui::Color32::from_rgb(0x1e, 0x8e, 0x3e),
                    _ => ui.visuals().weak_text_color(),
                };
                ui.colored_label(color, egui::RichText::new(&self.update_msg).size(11.0));
            });

            // Every failure — check, download, or installer hand-off — ends here.
            // The in-app updater can't repair itself, so the manual download page
            // is the only route forward and must always be one click away.
            if self.update_state == UpdateState::Failed {
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new("Your internet may be fine — our service can be down.")
                            .size(11.0)
                            .weak(),
                    );
                    ui.hyperlink_to(
                        egui::RichText::new("Download the latest version").size(11.0),
                        http::DOWNLOAD_PAGE_URL,
                    );
                });
            }

            if self.update_state == UpdateState::Downloading && self.dl_total > 0 {
                let frac = self.dl_done as f32 / self.dl_total as f32;
                ui.add(egui::ProgressBar::new(frac).show_percentage());
            }

            ui.add_space(6.0);

            // ── Feedback ─────────────────────────────────────────────────────
            ui.horizontal(|ui| {
                ui.label(egui::RichText::new("Found a bug or have an idea?").size(11.0).weak());
                if ui.button("💬 Send Feedback").clicked() {
                    self.feedback_open = true;
                    self.feedback_status.clear();
                }
            });
        }

        self.show_feedback_window(&ctx);
    }
}

impl App {
    fn show_feedback_window(&mut self, ctx: &egui::Context) {
        if !self.feedback_open {
            return;
        }
        let mut open = true;
        egui::Window::new("Send Feedback")
            .open(&mut open)
            .collapsible(false)
            .resizable(false)
            .default_width(380.0)
            .anchor(egui::Align2::CENTER_CENTER, egui::vec2(0.0, 0.0))
            .show(ctx, |ui| {
                ui.label(
                    egui::RichText::new("We read every message — add your email so we can reply.")
                        .size(11.0)
                        .weak(),
                );
                ui.add_space(8.0);
                ui.label(egui::RichText::new("Your email").size(11.0).weak());
                ui.add(
                    egui::TextEdit::singleline(&mut self.feedback_email)
                        .desired_width(f32::INFINITY),
                );
                ui.add_space(6.0);
                ui.label(egui::RichText::new("Message").size(11.0).weak());
                ui.add(
                    egui::TextEdit::multiline(&mut self.feedback_message)
                        .desired_rows(6)
                        .desired_width(f32::INFINITY),
                );
                ui.add_space(4.0);

                if !self.feedback_status.is_empty() {
                    let color = if self.feedback_ok {
                        egui::Color32::from_rgb(0x1e, 0x8e, 0x3e)
                    } else {
                        egui::Color32::from_rgb(0xc0, 0x39, 0x2b)
                    };
                    ui.colored_label(color, egui::RichText::new(&self.feedback_status).size(11.0));
                }

                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    // Validate before spending a network round-trip, and give
                    // the SAME messages the Python dialog gives.
                    let can_send = !self.feedback_sending;
                    if ui.add_enabled(can_send, egui::Button::new("Send")).clicked() {
                        if !http::looks_like_email(&self.feedback_email) {
                            self.feedback_ok = false;
                            self.feedback_status = "Please enter a valid email.".into();
                        } else if self.feedback_message.trim().chars().count() < http::MIN_FEEDBACK_LEN {
                            self.feedback_ok = false;
                            self.feedback_status = format!(
                                "Please write at least {} characters.",
                                http::MIN_FEEDBACK_LEN
                            );
                        } else {
                            self.start_feedback_send(ctx);
                        }
                    }
                    if self.feedback_sending {
                        ui.spinner();
                    }
                });
            });

        // Close on success, mirroring Python's `dlg.after(1400, dlg.destroy)`.
        if self.feedback_ok {
            self.feedback_open = false;
            self.feedback_email.clear();
            self.feedback_message.clear();
            self.feedback_ok = false;
        } else if !open {
            self.feedback_open = false;
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
            // Sized to the CONTENT. 560 left ~150 px of dead space below the
            // feedback row, which reads as a window that failed to load
            // something. Measured against the real window, not guessed.
            .with_inner_size([380.0, 420.0])
            .with_resizable(false)
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
