import AVFoundation
import UIKit

// QR pairing scanner. Android uses CameraX+ZXing rendered UNDER the
// transparent WebView; here an AVCaptureVideoPreviewLayer sits in a host view
// below the WKWebView and AVCaptureMetadataOutput does the decoding natively
// (no third-party decoder needed on iOS).
final class QRScanner: NSObject, AVCaptureMetadataOutputObjectsDelegate {

    private let session = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private weak var hostView: UIView?
    private var running = false
    private var lastEmit = Date.distantPast

    /// Fires on the main thread with the decoded QR string, throttled to one
    /// emit per 300 ms (parity with the Android lastAnalysisTime throttle).
    var onCode: ((String) -> Void)?

    func attach(to view: UIView) { hostView = view }

    func start() {
        guard !running, let host = hostView else { return }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: configureAndRun(host: host)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async { if granted { self?.configureAndRun(host: host) } }
            }
        default: break // denied — the JS layer shows its own manual-entry path
        }
    }

    private func configureAndRun(host: UIView) {
        if session.inputs.isEmpty {
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else { return }
            session.beginConfiguration()
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { session.commitConfiguration(); return }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            session.commitConfiguration()
        }
        if previewLayer == nil {
            let layer = AVCaptureVideoPreviewLayer(session: session)
            layer.videoGravity = .resizeAspectFill
            layer.frame = host.bounds
            host.layer.addSublayer(layer)
            previewLayer = layer
        }
        previewLayer?.frame = host.bounds
        host.isHidden = false
        running = true
        DispatchQueue.global(qos: .userInitiated).async { [session] in session.startRunning() }
    }

    func stop() {
        guard running else { return }
        running = false
        hostView?.isHidden = true
        DispatchQueue.global(qos: .userInitiated).async { [session] in session.stopRunning() }
    }

    func layout() { if let host = hostView { previewLayer?.frame = host.bounds } }

    func metadataOutput(_ output: AVCaptureMetadataOutput,
                        didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        guard running, Date().timeIntervalSince(lastEmit) > 0.3 else { return }
        for obj in metadataObjects {
            if let qr = obj as? AVMetadataMachineReadableCodeObject, qr.type == .qr,
               let value = qr.stringValue, !value.isEmpty {
                lastEmit = Date()
                onCode?(value)
                return
            }
        }
    }
}
