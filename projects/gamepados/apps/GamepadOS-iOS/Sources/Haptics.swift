import UIKit
import CoreHaptics

// Taptic Engine port of the Android tiered haptics — designed for the way the
// UI actually drives it:
//
//  • play(event:)      — button/UI semantics, called per press/release. Uses
//    UIFeedbackGenerator (OEM-tuned, pre-warmed) with per-event style+intensity;
//    "rigid" impacts feel like real gamepad microswitches.
//  • rumble(l,r,ms)    — GAME FORCE FEEDBACK, called up to 60 Hz while a game
//    rumbles (once per RMB datagram). Two PERSISTENT looped players model the
//    Xbox motors: large = low sharpness (heavy, rounded), small = high
//    sharpness (fine buzz). Each packet is a ~zero-cost dynamic-parameter
//    update (hapticIntensityControl) — never a new pattern/player. A watchdog
//    zeroes the motors `ms` after the last packet so a lost RMB(0,0) can't
//    leave the phone buzzing (Android's timed vibrate semantics).
//  • oneShot/waveform  — legacy fallbacks, transient-based for crispness.
final class Haptics {

    private var engine: CHHapticEngine?
    private var engineStarted = false

    // Persistent rumble players (created lazily, invalidated on engine reset).
    private var largePlayer: CHHapticAdvancedPatternPlayer?  // low-freq "heavy" motor
    private var smallPlayer: CHHapticAdvancedPatternPlayer?  // high-freq "fine" motor
    private var rumbleRunning = false
    private var rumbleWatchdog: Timer?
    private var rumbleIdleStop: Timer?

    // Pre-warmed generators — prepare() keeps the Taptic Engine hot so press
    // haptics land with no first-hit latency.
    private let rigid = UIImpactFeedbackGenerator(style: .rigid)
    private let light = UIImpactFeedbackGenerator(style: .light)
    private let heavy = UIImpactFeedbackGenerator(style: .heavy)
    private let soft = UIImpactFeedbackGenerator(style: .soft)

    init() {
        rigid.prepare(); light.prepare(); heavy.prepare(); soft.prepare()
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        do {
            let e = try CHHapticEngine()
            e.playsHapticsOnly = true
            e.stoppedHandler = { [weak self] _ in
                self?.engineStarted = false
                self?.invalidateRumblePlayers()
            }
            e.resetHandler = { [weak self] in
                guard let self else { return }
                self.engineStarted = false
                self.invalidateRumblePlayers()
                if (try? self.engine?.start()) != nil { self.engineStarted = true }
            }
            engine = e
        } catch { engine = nil }
    }

    private func startedEngine() -> CHHapticEngine? {
        guard let e = engine else { return nil }
        if !engineStarted { do { try e.start(); engineStarted = true } catch { return nil } }
        return e
    }

    // ── Button / UI events (Android playHaptic parity) ──────────────────
    // Gamepad buttons want a MECHANICAL click, not a generic thud: .rigid is
    // the crispest impact style; intensity differentiates press vs release.

    func play(event: String) {
        switch event {
        case "tick", "uiToggle":
            light.impactOccurred(intensity: 0.8)
            light.prepare()
        case "buttonRelease":
            soft.impactOccurred(intensity: 0.6)
            soft.prepare()
        case "triggerPull":
            heavy.impactOccurred(intensity: 1.0)
            heavy.prepare()
        default: // press-type
            rigid.impactOccurred(intensity: 1.0)
            rigid.prepare()
        }
    }

    /// Android triggerHaptic(ms) fallback: short = crisp transient tap,
    /// long = full-strength continuous.
    func oneShot(durationMs: Int) {
        guard let e = startedEngine() else { rigid.impactOccurred(); return }
        let ev: CHHapticEvent
        if durationMs <= 35 {
            ev = CHHapticEvent(eventType: .hapticTransient, parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: 1.0),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.6),
            ], relativeTime: 0)
        } else {
            ev = CHHapticEvent(eventType: .hapticContinuous, parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.9),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.5),
            ], relativeTime: 0, duration: Double(durationMs) / 1000.0)
        }
        if let pattern = try? CHHapticPattern(events: [ev], parameters: []),
           let player = try? e.makePlayer(with: pattern) {
            try? player.start(atTime: CHHapticTimeImmediate)
        }
    }

    // ── Game rumble (RMB packets, up to 60 Hz) ──────────────────────────

    /// Perceptual curve: the Taptic Engine's low end is nearly imperceptible
    /// on a linear map; games expect the Xbox motor ramp. γ≈0.75 lifts subtle
    /// rumble into the feelable range without flattening the top.
    private func curve(_ v255: Double) -> Float {
        let x = max(0.0, min(1.0, v255 / 255.0))
        return x <= 0 ? 0 : Float(pow(x, 0.75))
    }

    func rumble(left: Double, right: Double, durationMs: Int) {
        let lv = curve(left)   // large motor -> low-sharpness player
        let sv = curve(right)  // small motor -> high-sharpness player

        rumbleWatchdog?.invalidate()
        if lv <= 0 && sv <= 0 { setMotors(0, 0); return }

        guard ensureRumblePlayers() else {
            // No Core Haptics (very old device): approximate with an impact.
            if lv + sv >= 0.4 { heavy.impactOccurred(intensity: CGFloat(max(lv, sv))) }
            return
        }
        setMotors(lv, sv)
        // Watchdog: if no follow-up packet lands within the pulse duration
        // (+ slack for Wi-Fi jitter), the game stopped rumbling — fall silent.
        rumbleWatchdog = Timer.scheduledTimer(withTimeInterval: Double(durationMs + 60) / 1000.0,
                                              repeats: false) { [weak self] _ in
            self?.setMotors(0, 0)
        }
    }

    private func ensureRumblePlayers() -> Bool {
        guard let e = startedEngine() else { return false }
        if largePlayer == nil || smallPlayer == nil {
            largePlayer = makeMotorPlayer(engine: e, sharpness: 0.25)
            smallPlayer = makeMotorPlayer(engine: e, sharpness: 0.85)
        }
        guard largePlayer != nil, smallPlayer != nil else { return false }
        if !rumbleRunning {
            do {
                try largePlayer?.start(atTime: CHHapticTimeImmediate)
                try smallPlayer?.start(atTime: CHHapticTimeImmediate)
                rumbleRunning = true
            } catch {
                invalidateRumblePlayers()
                return false
            }
        }
        return true
    }

    private func makeMotorPlayer(engine e: CHHapticEngine, sharpness: Float) -> CHHapticAdvancedPatternPlayer? {
        // Base intensity 1.0; the live level is hapticIntensityControl (a
        // multiplier), so per-packet updates never rebuild anything.
        let ev = CHHapticEvent(eventType: .hapticContinuous, parameters: [
            CHHapticEventParameter(parameterID: .hapticIntensity, value: 1.0),
            CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
        ], relativeTime: 0, duration: 0.5)
        guard let pattern = try? CHHapticPattern(events: [ev], parameters: []),
              let p = try? e.makeAdvancedPlayer(with: pattern) else { return nil }
        p.loopEnabled = true
        return p
    }

    private func setMotors(_ largeV: Float, _ smallV: Float) {
        guard rumbleRunning else { return }
        let now = CHHapticTimeImmediate
        try? largePlayer?.sendParameters([CHHapticDynamicParameter(
            parameterID: .hapticIntensityControl, value: largeV, relativeTime: 0)], atTime: now)
        try? smallPlayer?.sendParameters([CHHapticDynamicParameter(
            parameterID: .hapticIntensityControl, value: smallV, relativeTime: 0)], atTime: now)

        // Battery: after 2 s of silence stop the looped players entirely
        // (restart latency on the next packet is negligible).
        rumbleIdleStop?.invalidate()
        if largeV <= 0 && smallV <= 0 {
            rumbleIdleStop = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { [weak self] _ in
                self?.stopRumblePlayers()
            }
        }
    }

    private func stopRumblePlayers() {
        try? largePlayer?.stop(atTime: CHHapticTimeImmediate)
        try? smallPlayer?.stop(atTime: CHHapticTimeImmediate)
        rumbleRunning = false
    }

    private func invalidateRumblePlayers() {
        largePlayer = nil
        smallPlayer = nil
        rumbleRunning = false
    }

    /// Session teardown: silence everything now (the CHHapticEngine itself
    /// stays alive to keep the next session's first haptic instant).
    func stopAll() {
        rumbleWatchdog?.invalidate()
        rumbleIdleStop?.invalidate()
        stopRumblePlayers()
    }

    // ── Waveform (Android playHapticWaveform parity) ────────────────────
    // Off/on alternating timings with per-segment amplitude. Very short ON
    // segments become transients (crisp), longer ones continuous.

    func waveform(timingsCsv: String, ampsCsv: String) {
        let timings = timingsCsv.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        let amps = ampsCsv.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard !timings.isEmpty, let e = startedEngine() else { return }
        var events: [CHHapticEvent] = []
        var t: TimeInterval = 0
        for (i, ms) in timings.enumerated() {
            let dur = ms / 1000.0
            let on = i % 2 == 1 // odd indices vibrate (index 0 is initial delay)
            if on {
                let amp = Float(min(max((i < amps.count ? amps[i] : 255) / 255.0, 0.05), 1.0))
                if dur <= 0.03 {
                    events.append(CHHapticEvent(eventType: .hapticTransient, parameters: [
                        CHHapticEventParameter(parameterID: .hapticIntensity, value: amp),
                        CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.6),
                    ], relativeTime: t))
                } else {
                    events.append(CHHapticEvent(eventType: .hapticContinuous, parameters: [
                        CHHapticEventParameter(parameterID: .hapticIntensity, value: amp),
                        CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.5),
                    ], relativeTime: t, duration: max(dur, 0.008)))
                }
            }
            t += dur
        }
        guard !events.isEmpty else { return }
        if let pattern = try? CHHapticPattern(events: events, parameters: []),
           let player = try? e.makePlayer(with: pattern) {
            try? player.start(atTime: CHHapticTimeImmediate)
        }
    }
}
