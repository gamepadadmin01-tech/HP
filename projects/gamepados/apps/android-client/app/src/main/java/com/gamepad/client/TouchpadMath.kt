package com.gamepad.client

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Touchpad → right stick: the movement rules. A line-for-line mirror of
 * controller-ui/src/app/touchpad.ts — read the explanation at the top of that file.
 *
 * Pure maths (no Android classes) so it can be unit-tested on the JVM. The native touch engine
 * owns one of these per finger on a touchpad widget and copies [x]/[y] into the right stick.
 * If this file and touchpad.ts drift apart, a pad feels different with native input on and off,
 * so change BOTH files and BOTH test files (TouchpadMathTest.kt, touchpad.test.mjs) together.
 */
class TouchpadMath(feel: String? = null, release: String? = null, sens: Double? = null) {

    companion object {
        const val STICK_R = 60.0
        const val DEFAULT_SENS = 1.0
        const val SENS_MIN = 0.3
        const val SENS_MAX = 3.0

        private const val SPEED_FULL = 900.0
        private const val SPEED_SMOOTH_TAU = 0.03
        private const val SPEED_STOP_AFTER = 0.045
        private const val SPEED_STOP_TAU = 0.035
        private const val DIST_FULL = 90.0
        private const val GLIDE_TAU = 0.08
        private const val MIN_DT = 0.004
        private const val ZERO_EPS = 0.5

        /** Anything but the exact word falls back to the recommended default. */
        fun cleanFeel(v: String?): String = if (v == "distance") "distance" else "speed"
        fun cleanRelease(v: String?): String = if (v == "glide") "glide" else "instant"
        fun cleanSens(v: Double?): Double =
            if (v == null || v.isNaN() || v.isInfinite()) DEFAULT_SENS else v.coerceIn(SENS_MIN, SENS_MAX)
    }

    val feel: String = cleanFeel(feel)
    val release: String = cleanRelease(release)
    val sens: Double = cleanSens(sens)

    /** The stick the pad is pushing right now, design units (±[STICK_R]). */
    var x = 0.0; private set
    var y = 0.0; private set
    var held = false; private set

    private var ox = 0.0; private var oy = 0.0
    private var lx = 0.0; private var ly = 0.0
    private var lt = 0L
    private var vx = 0.0; private var vy = 0.0
    private var tickT = 0L

    /** True while the pad still has something to say (finger down, or a glide still running). */
    val active: Boolean get() = held || abs(x) > 0.0 || abs(y) > 0.0

    fun down(px: Double, py: Double, t: Long) {
        held = true
        ox = px; oy = py; lx = px; ly = py
        lt = t; tickT = t
        vx = 0.0; vy = 0.0
        x = 0.0; y = 0.0                    // landing never deflects the stick by itself
    }

    /** The finger moved. Returns true when the stick value changed. */
    fun move(px: Double, py: Double, t: Long): Boolean {
        if (!held) return false
        val prevX = x; val prevY = y
        if (feel == "speed") {
            val dt = max((t - lt) / 1000.0, MIN_DT)
            val a = 1 - exp(-dt / SPEED_SMOOTH_TAU)
            vx += ((px - lx) / dt - vx) * a
            vy += ((py - ly) / dt - vy) * a
            fromSpeed()
        } else {
            val k = (STICK_R / DIST_FULL) * sens
            clampTo((px - ox) * k, (py - oy) * k)
        }
        lx = px; ly = py; lt = t
        return x != prevX || y != prevY
    }

    fun up(@Suppress("UNUSED_PARAMETER") t: Long) {
        held = false
        vx = 0.0; vy = 0.0
        if (release == "instant") { x = 0.0; y = 0.0 }
        // "glide": keep the current value; tick() eases it to centre.
    }

    /** Call about every frame while [active]. Returns true when the stick value changed. */
    fun tick(t: Long): Boolean {
        val dt = max((t - tickT) / 1000.0, 0.0)
        tickT = t
        val prevX = x; val prevY = y
        if (held) {
            // A finger that stopped sends no more move events, so the speed feel notices by itself.
            if (feel == "speed" && (t - lt) / 1000.0 > SPEED_STOP_AFTER) {
                val f = exp(-dt / SPEED_STOP_TAU)
                vx *= f; vy *= f
                fromSpeed()
            }
        } else if (x != 0.0 || y != 0.0) {
            val f = exp(-dt / GLIDE_TAU)
            x *= f; y *= f
            if (hypot(x, y) < ZERO_EPS) { x = 0.0; y = 0.0 }
        }
        return x != prevX || y != prevY
    }

    private fun fromSpeed() {
        val mag = hypot(vx, vy)
        if (mag < 1e-6) { x = 0.0; y = 0.0; return }
        val f = min(1.0, mag / (SPEED_FULL / sens))
        x = vx / mag * STICK_R * f
        y = vy / mag * STICK_R * f
    }

    private fun clampTo(dx: Double, dy: Double) {
        val mag = hypot(dx, dy)
        if (mag > STICK_R) { x = dx / mag * STICK_R; y = dy / mag * STICK_R }
        else { x = dx; y = dy }
    }
}
