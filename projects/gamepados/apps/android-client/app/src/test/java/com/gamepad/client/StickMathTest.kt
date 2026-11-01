package com.gamepad.client

import org.junit.Assert.*
import org.junit.Test

// Right-stick sensitivity. Mirrors controller-ui/stickFeel.test.mjs case for case.
class StickMathTest {
    @Test fun gainOneChangesNothing() {
        assertEquals(0.5f, StickMath.applyGain(0.5f, 1f), 0f)
        assertEquals(1f, StickMath.applyGain(1f, 1f), 0f)
        assertEquals(0f, StickMath.applyGain(0f, 1f), 0f)
    }
    @Test fun halfSensitivityHalvesTheCameraSpeed() {
        assertEquals(0.4f, StickMath.applyGain(0.8f, 0.5f), 1e-6f)
        assertEquals(0.5f, StickMath.applyGain(1f, 0.5f), 1e-6f)
    }
    @Test fun doubleSensitivityReachesFullEarlyButNeverMore() {
        assertEquals(1f, StickMath.applyGain(0.8f, 2f), 0f)
        assertEquals(0.5f, StickMath.applyGain(0.25f, 2f), 1e-6f)
        assertEquals(0f, StickMath.applyGain(0f, 2f), 0f)   // at rest stays at rest
    }
    @Test fun limitsAreClamped() {
        assertEquals(0.2f, StickMath.clampGain(0.05f), 0f)
        assertEquals(2f, StickMath.clampGain(5f), 0f)
        assertEquals(0.75f, StickMath.clampGain(0.75f), 0f)
        assertEquals(1f, StickMath.clampGain(Float.NaN), 0f)       // garbage becomes the default
        assertEquals(1f, StickMath.clampGain(Float.POSITIVE_INFINITY), 0f)
    }
}
