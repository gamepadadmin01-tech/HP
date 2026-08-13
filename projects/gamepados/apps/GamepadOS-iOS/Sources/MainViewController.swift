import UIKit
import WebKit

// Single-screen host, mirroring the Android hybrid layout:
//   [black background] -> [camera preview host (hidden)] -> [transparent WKWebView]
// The React bundle (WebBundle/index.html) is the entire UI; native supplies
// the AndroidBridge backing (see Shim/bridge-shim.js), the UDP engine, motion,
// haptics, and the QR camera.
final class MainViewController: UIViewController {

    // JS-driven orientation lock, read by AppDelegate.
    static var orientationMask: UIInterfaceOrientationMask = .portrait

    private var webView: WKWebView!
    private let cameraHost = UIView()
    private let qrScanner = QRScanner()
    private let haptics = Haptics()
    private let engine = UdpEngine()
    private let motion = MotionEngine()

    // 60 Hz native->JS state push (gyro + telemetry + rumble in ONE evaluate).
    private var pushLink: CADisplayLink?
    private var statsTimer: Timer?
    private var pageReady = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        UIApplication.shared.isIdleTimerDisabled = true // FLAG_KEEP_SCREEN_ON parity

        cameraHost.frame = view.bounds
        cameraHost.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cameraHost.isHidden = true
        view.addSubview(cameraHost)
        qrScanner.attach(to: cameraHost)
        qrScanner.onCode = { [weak self] code in self?.deliverQr(code) }

        setupWebView()

        // Sensor lifecycle parity with Android (SENSORS_LIFECYCLE.md §3/§5):
        // the rotation sensor registers in onResume and runs for the app's
        // whole foreground life, INDEPENDENT of the engine — the tilt bar and
        // calibration must move before any PC is paired. Previously motion
        // only started on connectToPC, so gyro read dead zeros everywhere.
        motion.start()
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            self?.motion.stop()      // onPause parity: sensors off, engine stays up
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            self?.motion.start()     // onResume parity
        }

        UIDevice.current.isBatteryMonitoringEnabled = true
        statsTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.pushSlowState()
        }
    }

    private func setupWebView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(BridgeMessageProxy(target: self), name: "bridge")

        // Version must be readable SYNCHRONOUSLY at documentStart: the UI reads
        // getAppVersionCode once at mount (useMemo, empty deps) — a 0 there
        // shows a phantom "update available" forever. Android's JNI getter is
        // live from birth; here a boot script beats the page to it.
        let vName = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        let vCode = Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0") ?? 0
        config.userContentController.addUserScript(
            WKUserScript(source: "window.__iosBootVersion={name:'\(vName)',code:\(vCode)};",
                         injectionTime: .atDocumentStart, forMainFrameOnly: true))

        if let shimUrl = Bundle.main.url(forResource: "bridge-shim", withExtension: "js"),
           let shim = try? String(contentsOf: shimUrl, encoding: .utf8) {
            config.userContentController.addUserScript(
                WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        // Game-surface touch hygiene — WKWebView (unlike Android WebView) ships
        // text-selection/magnifier gestures that fire on the press-and-hold and
        // drag patterns every game uses, stealing pointer events from buttons
        // and sticks. Kill selection/callout everywhere except real text fields
        // (the feedback form keeps working).
        let touchCss = """
        var s=document.createElement('style');s.textContent=\
        '*:not(input):not(textarea){-webkit-user-select:none !important;-webkit-touch-callout:none !important;}\
        body{-webkit-tap-highlight-color:transparent;}';\
        document.documentElement.appendChild(s);
        """
        config.userContentController.addUserScript(
            WKUserScript(source: touchCss, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

        let wv = WKWebView(frame: view.bounds, configuration: config)
        wv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        wv.isOpaque = false                       // camera preview shows through
        wv.backgroundColor = .clear
        wv.scrollView.backgroundColor = .clear
        wv.scrollView.isScrollEnabled = false     // fixed-viewport app
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        // iOS ignores user-scalable=no since iOS 10 — clamp zoom natively so a
        // two-finger stick maneuver can't pinch-zoom the controller. Bounce off
        // (Android has no rubber-banding), link previews off (long-press).
        wv.scrollView.minimumZoomScale = 1
        wv.scrollView.maximumZoomScale = 1
        wv.scrollView.bouncesZoom = false
        wv.scrollView.bounces = false
        wv.allowsLinkPreview = false
        wv.navigationDelegate = self
        #if DEBUG
        if #available(iOS 16.4, *) { wv.isInspectable = true } // Safari Web Inspector
        #endif
        view.addSubview(wv)
        webView = wv

        guard let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "WebBundle") else {
            assertionFailure("WebBundle/index.html missing from app bundle"); return
        }
        wv.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
    }

    // ── Immersive fullscreen (Android hideSystemUI parity) ──
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { Self.orientationMask }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        qrScanner.layout()
        pushSafeArea()
        // Keep the gyro's landscape remap keyed to the INTERFACE orientation
        // (Android parity: display rotation, not physical pose).
        if let io = view.window?.windowScene?.interfaceOrientation {
            motion.setInterfaceOrientation(io)
        }
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        pushSafeArea()
    }

    // ── Native -> JS state ──────────────────────────────────────────────

    private func evalJs(_ js: String) {
        guard pageReady else { return }
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func pushSafeArea() {
        let i = view.safeAreaInsets
        // Same fallbacks as Android (44/24) so the UI never hugs a notch.
        let top = i.top > 0 ? i.top : 44, bottom = i.bottom > 0 ? i.bottom : 24
        evalJs("window.__iosPush && __iosPush({safeArea:{top:\(top),bottom:\(bottom),left:\(i.left),right:\(i.right)}})")
    }

    private var fastTick = 0

    @objc private func pushFastState() {
        // One evaluateJavaScript per frame. Latency-critical values (gyro,
        // rumble) go EVERY tick with trimmed precision; the HUD-only telemetry
        // blob rides along every 8th tick (~15 Hz) — shorter strings parse
        // faster in the web process, which is what keeps 120 Hz sustainable.
        let g = motion.snapshot()
        let r = engine.rumbleStateString()
        var js = "window.__iosPush && __iosPush({" +
            "gyro:{nx:\(String(format: "%.3f", g.nx)),ny:\(String(format: "%.3f", g.ny)),age:\(String(format: "%.1f", g.ageMs))}," +
            "rumble:\"\(r)\""
        fastTick &+= 1
        if fastTick % 8 == 0 {
            let t = engine.telemetrySnapshot()
            js += ",telemetry:{packetCount:\(t.packetCount),hz:\(t.hz),latency:\(String(format: "%.2f", t.latencyMs)),connectionType:\"\(t.connectionType)\",linkAlive:\(t.linkAlive),engineRunning:\(t.engineRunning)}"
        }
        js += "})"
        evalJs(js)
    }

    private func pushSlowState() {
        let level = UIDevice.current.batteryLevel
        let pct = level >= 0 ? Int(level * 100) : 75
        // iOS exposes no battery temperature; map thermalState to a plausible
        // display value so the UI's temp readout stays meaningful.
        let temp: Double
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: temp = 30.0
        case .fair: temp = 36.0
        case .serious: temp = 42.0
        default: temp = 48.0
        }
        evalJs("window.__iosPush && __iosPush({stats:{battery:\(pct),temp:\(temp),shizuku:false,shizukuRunning:false,bypass:false}," +
               "netDetails:{wifiIp:\"\(engine.serverIp)\",usbIp:\"\"}})")
    }

    private func pushVersion() {
        let name = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        let code = Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0") ?? 0
        evalJs("window.__iosPush && __iosPush({versionName:\"\(name)\",versionCode:\(code)})")
    }

    private func deliverQr(_ code: String) {
        guard !engine.isRunning else { return } // Android drops decodes mid-session
        // Escaping order matters (backslash FIRST) — a payload containing \'
        // would otherwise break out of the JS string literal.
        let escaped = code
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
        evalJs("if (window.onQRScanned) window.onQRScanned('\(escaped)');")
    }

    // ── Bridge action dispatch (messages from Shim/bridge-shim.js) ─────

    func handleBridgeMessage(_ body: Any) {
        guard let dict = body as? [String: Any],
              let m = dict["m"] as? String else { return }
        let a = dict["a"] as? [Any] ?? []

        switch m {
        case "packet":
            if let b64 = a.first as? String, let data = Data(base64Encoded: b64) {
                engine.injectPayload(data)
            }
        case "connectToPC":
            guard a.count >= 3,
                  let ip = a[0] as? String,
                  let port = a[1] as? Int,
                  let key = a[2] as? String else { return }
            engine.connect(ip: ip, port: UInt16(clamping: port), key: key)
            motion.start()
        case "stopEngine":
            engine.stop() // stop network WITHOUT leaving the session UI
            haptics.stopAll()
        case "exitSession":
            // cleanupSessionAndReturn parity: engine + camera teardown + notify
            // JS. Sensors deliberately KEEP running (Android only unregisters
            // them in onPause, never at session exit).
            engine.stop()
            qrScanner.stop()
            haptics.stopAll()
            evalJs("if (window.onSessionExited) window.onSessionExited();")
        case "startCameraScan": qrScanner.start()
        case "stopCameraScan": qrScanner.stop()
        case "setScreenOrientation":
            setOrientation(a.first as? String ?? "unspecified")
        case "openUrl":
            if let s = a.first as? String, let url = URL(string: s) {
                UIApplication.shared.open(url)
            }
        case "triggerHaptic":
            haptics.oneShot(durationMs: a.first as? Int ?? 20)
        case "triggerRumble":
            guard a.count >= 3 else { return }
            haptics.rumble(left: doubleArg(a[0]), right: doubleArg(a[1]), durationMs: a[2] as? Int ?? 50)
        case "playHaptic":
            haptics.play(event: a.first as? String ?? "press")
        case "playHapticWaveform":
            guard a.count >= 2 else { return }
            haptics.waveform(timingsCsv: a[0] as? String ?? "", ampsCsv: a[1] as? String ?? "")
        case "showTextInput":
            showTextInput(current: a.first as? String ?? "", hint: a.count > 1 ? (a[1] as? String ?? "") : "")
        case "exitApp":
            break // iOS apps do not self-terminate; JS back-stack handles it
        default:
            break
        }
    }

    private func doubleArg(_ v: Any) -> Double {
        if let d = v as? Double { return d }
        if let i = v as? Int { return Double(i) }
        return 0
    }

    private func setOrientation(_ mode: String) {
        switch mode {
        case "landscape": Self.orientationMask = .landscape
        case "portrait": Self.orientationMask = .portrait
        default: Self.orientationMask = [.portrait, .landscape]
        }
        if #available(iOS 16.0, *) {
            setNeedsUpdateOfSupportedInterfaceOrientations()
            let pref = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: Self.orientationMask)
            view.window?.windowScene?.requestGeometryUpdate(pref, errorHandler: nil)
        } else {
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }

    private func showTextInput(current: String, hint: String) {
        // Native text entry (Android showTextInput parity): keyboard lives in
        // the native layer, result returns via window.__textInputCallback.
        let alert = UIAlertController(title: "Layout Name", message: nil, preferredStyle: .alert)
        alert.addTextField { tf in
            tf.text = current
            tf.placeholder = hint
            tf.clearButtonMode = .whileEditing
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Done", style: .default) { [weak self, weak alert] _ in
            let raw = alert?.textFields?.first?.text?.trimmingCharacters(in: .whitespaces) ?? ""
            let escaped = String(raw.prefix(24))
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
            self?.evalJs("if(window.__textInputCallback){window.__textInputCallback('\(escaped)');delete window.__textInputCallback;}")
        })
        present(alert, animated: true)
    }
}

// WKScriptMessageHandler retains its target strongly inside the webview's
// userContentController — this proxy breaks the VC <-> WKWebView cycle.
private final class BridgeMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: MainViewController?
    init(target: MainViewController) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        target?.handleBridgeMessage(message.body)
    }
}

extension MainViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        pushVersion()
        pushSafeArea()
        pushSlowState()
        // Fast-state pump. The UI polls gyro every 8 ms (120 Hz), so push up
        // to 120 on ProMotion phones (CADisableMinimumFrameDurationOnPhone in
        // Info.plist unlocks >60); 60 Hz phones cap themselves.
        pushLink?.invalidate()
        let link = CADisplayLink(target: self, selector: #selector(pushFastState))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        pushLink = link
    }
}
