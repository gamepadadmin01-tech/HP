import CoreMotion
import UIKit

// Tilt engine — port of the Android onSensorChanged pipeline (spec/
// SENSORS_LIFECYCLE.md §3-4). Android reads the GAME_ROTATION_VECTOR (gyro+
// accel fused, no magnetometer) and takes the world-up vector in a landscape
// view frame; the CoreMotion equivalent is deviceMotion with
// .xArbitraryZVertical (no magnetometer -> no yaw pulls) whose `gravity` IS
// the fused world-down in device coordinates, so up_device = -gravity.
//
//   roll  = STEER_SIGN * atan2(up.x, up.y)  [deg]  — steering, left/right tilt
//   pitch = PITCH_SIGN * asin(up.z)         [deg]  — fwd/back lean (3D look Y)
//
// Values cross the bridge in DEGREES (the -1..1 normalization lives in JS),
// each 1€-filtered with the shipped latency-biased tune (2.8 / 0.5).
// STEER_SIGN/PITCH_SIGN mirror the Android shipped constants — flip here if
// on-device tilt-right steers left (same caveat as the Android build).
final class MotionEngine {

    private let STEER_SIGN = 1.0
    private let PITCH_SIGN = -1.0

    private let manager = CMMotionManager()
    private let queue = OperationQueue() // dedicated queue = Android HandlerThread parity
    private let rollFilter = OneEuroFilter(minCutoff: 2.8, beta: 0.5)
    private let pitchFilter = OneEuroFilter(minCutoff: 2.8, beta: 0.5)

    private let lock = NSLock()
    private var rollDeg = 0.0
    private var pitchDeg = 0.0
    private var lastEventUptime: TimeInterval = 0

    // Which landscape the interface is in decides the device->view axis swap.
    // Updated from the main thread; read on the motion queue.
    private var landscapeLeft = true

    init() {
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .userInteractive
        NotificationCenter.default.addObserver(forName: UIDevice.orientationDidChangeNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            switch UIDevice.current.orientation {
            case .landscapeLeft: self.setLandscape(left: true)
            case .landscapeRight: self.setLandscape(left: false)
            default: break // keep the last landscape mapping while portrait/flat
            }
        }
    }

    private func setLandscape(left: Bool) {
        lock.lock(); landscapeLeft = left; lock.unlock()
    }

    func start() {
        guard manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 200.0 // SENSOR_DELAY_FASTEST parity
        manager.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: queue) { [weak self] motion, _ in
            guard let self, let m = motion else { return }
            // World-up in the DEVICE frame (portrait: x right, y toward top,
            // z out of the screen).
            let ux0 = -m.gravity.x, uy0 = -m.gravity.y, uz0 = -m.gravity.z

            self.lock.lock(); let left = self.landscapeLeft; self.lock.unlock()
            // Device -> landscape view frame (view x = screen right, y = screen
            // up, z = out of screen). The two landscapes are opposite rotations;
            // if steering reads inverted on-device, swap these two cases (same
            // class of sign flip the Android build documents for STEER_SIGN).
            let ux = left ? -uy0 : uy0
            let uy = left ? ux0 : -ux0
            let uz = max(-1.0, min(1.0, uz0))

            let roll = self.STEER_SIGN * (atan2(ux, uy) * 180.0 / .pi)
            let pitch = self.PITCH_SIGN * (asin(uz) * 180.0 / .pi)

            let r = self.rollFilter.filter(roll, t: m.timestamp)
            let p = self.pitchFilter.filter(pitch, t: m.timestamp)

            self.lock.lock()
            self.rollDeg = r
            self.pitchDeg = p
            self.lastEventUptime = m.timestamp
            self.lock.unlock()
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
    }

    /// nx = roll deg, ny = pitch deg, ageMs = staleness of the last sample
    /// (-1 when no sample yet) — the exact getGyroscopeDataJson contract.
    func snapshot() -> (nx: Double, ny: Double, ageMs: Double) {
        lock.lock(); defer { lock.unlock() }
        let age = lastEventUptime == 0 ? -1.0
                  : (ProcessInfo.processInfo.systemUptime - lastEventUptime) * 1000.0
        return (rollDeg, pitchDeg, age)
    }
}

// 1€ filter (Casiez/Roussel/Vogel CHI 2012) — verbatim port of the Android
// inner class, adapted from ns to CMDeviceMotion's seconds-since-boot clock.
// First sample passes through unfiltered.
final class OneEuroFilter {
    private let minCutoff: Double // Hz — lower = smoother when still
    private let beta: Double      // speed coefficient — higher = less lag
    private let dCutoff: Double
    private var xPrev = 0.0
    private var dxPrev = 0.0
    private var tPrev = 0.0
    private var started = false

    init(minCutoff: Double = 2.8, beta: Double = 0.5, dCutoff: Double = 1.0) {
        self.minCutoff = minCutoff
        self.beta = beta
        self.dCutoff = dCutoff
    }

    private func alpha(_ cutoff: Double, _ dt: Double) -> Double {
        let tau = 1.0 / (2.0 * .pi * cutoff)
        return 1.0 / (1.0 + tau / dt)
    }

    func filter(_ x: Double, t: TimeInterval) -> Double {
        if !started { started = true; xPrev = x; dxPrev = 0; tPrev = t; return x }
        var dt = t - tPrev
        if dt <= 0 || dt > 0.1 { dt = 1.0 / 200.0 } // bad/large gap -> assume 200 Hz
        tPrev = t
        let dx = (x - xPrev) / dt
        let aD = alpha(dCutoff, dt)
        let edx = aD * dx + (1 - aD) * dxPrev
        dxPrev = edx
        let cutoff = minCutoff + beta * abs(edx)
        let aX = alpha(cutoff, dt)
        let xFilt = aX * x + (1 - aX) * xPrev
        xPrev = xFilt
        return xFilt
    }
}
