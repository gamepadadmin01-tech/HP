import UIKit
import CoreHaptics

// Port of the Android tiered haptics (MainActivity doVibrate/playHaptic/
// playHapticWaveform). iPhones since the 8 all have the Taptic Engine with
// full amplitude control, so the Android capability tiers collapse to:
//   - semantic events  -> UIFeedbackGenerator (OEM-tuned, like EFFECT_CLICK)
//   - rumble/waveforms -> CHHapticEngine continuous events with real intensity
final class Haptics {

    private var engine: CHHapticEngine?
    private var engineStarted = false

    // Pre-warmed generators — prepare() keeps the Taptic Engine hot so the
    // press haptic lands with no first-hit latency (parity with the Android
    // USAGE_TOUCH prebaked effects).
    private let click = UIImpactFeedbackGenerator(style: .medium)
    private let tick = UIImpactFeedbackGenerator(style: .light)
    private let heavy = UIImpactFeedbackGenerator(style: .heavy)

    init() {
        click.prepare(); tick.prepare(); heavy.prepare()
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        do {
            let e = try CHHapticEngine()
            e.playsHapticsOnly = true
            // Auto-restart after the system reclaims the engine (backgrounding).
            e.resetHandler = { [weak self] in try? self?.engine?.start() }
            engine = e
        } catch { engine = nil }
    }

    private func startedEngine() -> CHHapticEngine? {
        guard let e = engine else { return nil }
        if !engineStarted { do { try e.start(); engineStarted = true } catch { return nil } }
        return e
    }

    /// Semantic event -> best-fit system haptic (Android playHaptic parity).
    func play(event: String) {
        switch event {
        case "tick", "uiToggle", "buttonRelease": tick.impactOccurred()
        case "triggerPull": heavy.impactOccurred()
        default: click.impactOccurred() // press-type
        }
    }

    /// Android triggerHaptic(ms): default-strength one-shot.
    func oneShot(durationMs: Int) {
        continuous(intensity: 0.8, durationMs: max(durationMs, 10))
    }

    /// Android triggerRumble(left,right,ms): amplitude 0-255 -> 0-1 intensity.
    func rumble(left: Double, right: Double, durationMs: Int) {
        let amp = max(left, right)
        guard amp >= 1 else { return }
        continuous(intensity: Float(min(amp / 255.0, 1.0)), durationMs: durationMs)
    }

    /// Android playHapticWaveform(timingsCsv, ampsCsv): off/on alternating
    /// timings with per-segment amplitude — rebuilt as CHHaptic events.
    func waveform(timingsCsv: String, ampsCsv: String) {
        let timings = timingsCsv.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        let amps = ampsCsv.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard !timings.isEmpty, let e = startedEngine() else { return }
        var events: [CHHapticEvent] = []
        var t: TimeInterval = 0
        // Android waveform semantics: index 0 is an initial DELAY, then the
        // vibrator alternates ON/OFF per entry. Amplitudes align per entry.
        for (i, ms) in timings.enumerated() {
            let dur = ms / 1000.0
            let on = i % 2 == 1 // odd indices vibrate
            if on {
                let amp = i < amps.count ? amps[i] / 255.0 : 1.0
                events.append(CHHapticEvent(
                    eventType: .hapticContinuous,
                    parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: Float(max(amp, 0.05)))],
                    relativeTime: t, duration: max(dur, 0.008)))
            }
            t += dur
        }
        guard !events.isEmpty else { return }
        if let pattern = try? CHHapticPattern(events: events, parameters: []),
           let player = try? e.makePlayer(with: pattern) {
            try? player.start(atTime: 0)
        }
    }

    private func continuous(intensity: Float, durationMs: Int) {
        guard let e = startedEngine() else {
            // Non-haptic fallback (very old devices): plain impact.
            click.impactOccurred(); return
        }
        let ev = CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.5),
            ],
            relativeTime: 0, duration: Double(durationMs) / 1000.0)
        if let pattern = try? CHHapticPattern(events: [ev], parameters: []),
           let player = try? e.makePlayer(with: pattern) {
            try? player.start(atTime: 0)
        }
    }
}
