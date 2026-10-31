package com.gamepad.client

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.abs
import kotlin.math.hypot

// The same cases as controller-ui/touchpad.test.mjs — keep the two in step.
class TouchpadMathTest {
    private val R = TouchpadMath.STICK_R
    private fun near(a: Double, b: Double, tol: Double, msg: String) =
        assertTrue("$msg: $a is not within $tol of $b", abs(a - b) <= tol)

    private fun swipeRight(p: TouchpadMath, perMove: Double) {
        p.down(0.0, 0.0, 0)
        for (i in 1..10) p.move(i * perMove, 0.0, i * 16L)
    }

    @Test fun optionsAreCleaned() {
        assertEquals("speed", TouchpadMath.cleanFeel(null)); assertEquals("speed", TouchpadMath.cleanFeel("x"))
        assertEquals("distance", TouchpadMath.cleanFeel("distance"))
        assertEquals("instant", TouchpadMath.cleanRelease("y")); assertEquals("glide", TouchpadMath.cleanRelease("glide"))
        assertEquals(1.0, TouchpadMath.cleanSens(null), 0.0); assertEquals(1.0, TouchpadMath.cleanSens(Double.NaN), 0.0)
        assertEquals(3.0, TouchpadMath.cleanSens(99.0), 0.0); assertEquals(0.3, TouchpadMath.cleanSens(0.0), 0.0)
    }

    @Test fun landingNeverMovesTheStick() {
        val p = TouchpadMath()
        p.down(500.0, 300.0, 0)
        assertEquals(0.0, p.x, 0.0); assertEquals(0.0, p.y, 0.0)
        assertTrue(p.active)
    }

    @Test fun speedFeelFollowsHowFastTheFingerMoves() {
        val fast = TouchpadMath("speed"); swipeRight(fast, 20.0)
        assertTrue("a fast swipe nearly fills the stick (${fast.x})", fast.x > 0.9 * R)
        near(fast.y, 0.0, 1e-6, "a straight swipe has no sideways push")
        val slow = TouchpadMath("speed"); swipeRight(slow, 3.0)
        assertTrue("a slow swipe pushes only a little (${slow.x})", slow.x > 0 && slow.x < 0.4 * R)
        val down = TouchpadMath("speed"); down.down(0.0, 0.0, 0)
        for (i in 1..10) down.move(0.0, i * 20.0, i * 16L)
        assertTrue(down.y > 0.9 * R && abs(down.x) < 1e-6)
        val left = TouchpadMath("speed"); left.down(0.0, 0.0, 0)
        for (i in 1..10) left.move(-i * 20.0, 0.0, i * 16L)
        assertTrue(left.x < -0.9 * R)
    }

    @Test fun aRestingFingerLetsTheStickGoHome() {
        val p = TouchpadMath("speed"); swipeRight(p, 20.0)
        var t = 160L; val before = p.x
        assertFalse("just after a move the stick is left alone", p.tick(t + 16))
        repeat(30) { t += 16; p.tick(t) }
        assertTrue("a resting finger lets the stick go home (${p.x})", p.x < before * 0.05)
        assertTrue(p.held)
    }

    @Test fun sensitivityScalesThePush() {
        fun run(s: Double): Double { val p = TouchpadMath("speed", "instant", s); swipeRight(p, 8.0); return p.x }
        assertTrue(run(2.0) > run(1.0) && run(1.0) > run(0.5))
        assertTrue(run(3.0) <= R + 1e-9)
    }

    @Test fun distanceFeelFollowsHowFarFromTheFirstTouch() {
        val p = TouchpadMath("distance"); p.down(100.0, 100.0, 0)
        p.move(145.0, 100.0, 16); near(p.x, R * 0.5, 1e-6, "half the drag is half the push")
        p.move(100.0, 190.0, 32); near(p.y, R, 1e-6, "the full drag gives the full push")
        p.move(100.0, 400.0, 48); near(hypot(p.x, p.y), R, 1e-6, "never past full")
        assertFalse(p.tick(1000))
        val s2 = TouchpadMath("distance", "instant", 2.0); s2.down(0.0, 0.0, 0); s2.move(22.5, 0.0, 16)
        near(s2.x, R * 0.5, 1e-6, "double sensitivity needs half the drag")
        val d = TouchpadMath("distance"); d.down(0.0, 0.0, 0); d.move(200.0, 200.0, 16)
        near(hypot(d.x, d.y), R, 1e-6, "a diagonal is clamped round, not square")
    }

    @Test fun releaseInstantSnapsAndGlideEases() {
        val a = TouchpadMath("distance", "instant"); a.down(0.0, 0.0, 0); a.move(90.0, 0.0, 16); a.up(32)
        assertEquals(0.0, a.x, 0.0); assertFalse(a.active)

        val g = TouchpadMath("distance", "glide"); g.down(0.0, 0.0, 0); g.move(90.0, 0.0, 16); g.up(32)
        assertTrue(g.x == R && g.active)
        g.tick(32 + 80)
        assertTrue("glide is well down after one time-constant (${g.x})", g.x > 0 && g.x < 0.5 * R)
        var t = 112L
        var n = 0
        while (g.active && n < 60) { t += 16; g.tick(t); n++ }
        assertEquals(0.0, g.x, 0.0); assertFalse(g.active)

        val gs = TouchpadMath("speed", "glide"); swipeRight(gs, 20.0)
        val top = gs.x; gs.up(170)
        assertEquals(top, gs.x, 0.0)
        gs.tick(170 + 80)
        assertTrue(gs.x < top && gs.x > 0)
    }

    @Test fun movesWithoutAFingerAreIgnoredAndTheNextTouchStartsClean() {
        val p = TouchpadMath("distance")
        assertFalse(p.move(10.0, 10.0, 0))
        p.down(0.0, 0.0, 0); p.move(90.0, 0.0, 16); p.up(32)
        p.down(300.0, 300.0, 100)
        assertEquals(0.0, p.x, 0.0)
        p.move(345.0, 300.0, 116)
        near(p.x, R * 0.5, 1e-6, "measures from its own first touch")
    }
}
