package com.gamepad.client

import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.pow

/**
 * Right-stick sensitivity: a gain on the stick's final response. A line-for-line mirror of
 * applyStickGain / clampRightGain in controller-ui/src/app/stickFeel.ts, so a stick feels the same with
 * native input on and off. Change BOTH files and BOTH test files (StickMathTest.kt, stickFeel.test.mjs).
 *
 * Pure maths (no Android classes) so it can be unit-tested on the JVM.
 */
object StickMath {
    const val GAIN_MIN = 0.2f
    const val GAIN_MAX = 2f
    const val GAIN_DEFAULT = 1f

    fun clampGain(g: Float): Float = if (g.isNaN() || g.isInfinite()) GAIN_DEFAULT else g.coerceIn(GAIN_MIN, GAIN_MAX)

    const val MAX_R = 60f                      // knob travel in design units (NativeInputEngine.STICK_MAX_R)
    const val DEADZONE = 0.08f * 60f           // 8% circular deadzone (NativeInputEngine.STICK_DEADZONE)

    /**
     * The whole stick response: circular deadzone, the curve, then the sensitivity gain. Input is the
     * stick position in design units; output is the normalized -1..1 pair that becomes the axis byte.
     * Mirrors stickResponse in stickFeel.ts (a test replays the same inputs through both).
     *
     * The curve is applied to the MAGNITUDE only, so direction is untouched and the circular deadzone keeps
     * its shape (a per-axis curve would bring back the diagonal drift the circular deadzone prevents).
     * curveExp 1 is the identity. Above 1 it trades top-end travel, where a touch stick is already
     * saturated, for near-centre resolution (at 1.6, 10% output needs ~1.9 mm of thumb travel instead of
     * ~0.66 mm). The caller keeps the position inside MAX_R, so the factor is always in 0..1.
     */
    fun response(x: Float, y: Float, gain: Float, curveExp: Float): Pair<Float, Float> {
        val dist = hypot(x.toDouble(), y.toDouble()).toFloat()
        if (dist < DEADZONE || dist <= 0f) return 0f to 0f
        var factor = (dist - DEADZONE) / (MAX_R - DEADZONE)
        if (curveExp != 1f) factor = factor.toDouble().pow(curveExp.toDouble()).toFloat()
        factor = applyGain(factor, gain)
        return (x / dist * factor) to (y / dist * factor)
    }

    /** [factor] is the stick's response 0..1 after deadzone and curve. Gain 1 returns it untouched, so the
     *  default is byte-identical to before; otherwise it is scaled and never goes above full. */
    fun applyGain(factor: Float, gain: Float): Float = if (gain == 1f) factor else min(1f, factor * gain)
}
