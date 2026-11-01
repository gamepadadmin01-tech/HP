package com.gamepad.client

import kotlin.math.min

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

    /** [factor] is the stick's response 0..1 after deadzone and curve. Gain 1 returns it untouched, so the
     *  default is byte-identical to before; otherwise it is scaled and never goes above full. */
    fun applyGain(factor: Float, gain: Float): Float = if (gain == 1f) factor else min(1f, factor * gain)
}
