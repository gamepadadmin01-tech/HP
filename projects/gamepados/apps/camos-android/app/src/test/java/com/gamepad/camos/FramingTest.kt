package com.gamepad.camos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FramingTest {
    private fun box(l: Float, t: Float, r: Float, b: Float) = floatArrayOf(l, t, r, b)

    @Test fun noFacesNoTarget() {
        assertNull(Framing.target(emptyList(), 0f, 0f, 1f, 2f))
    }

    @Test fun smallCentredFaceZoomsInButNotPastTheLimit() {
        // A face 10 % of the height in the middle of an un-zoomed picture: wants 2.8×, capped at 2×.
        val t = Framing.target(listOf(box(0.45f, 0.45f, 0.55f, 0.55f)), 0f, 0f, 1f, 2f)!!
        assertEquals(2f, t[2], 1e-4f)
        assertEquals(0f, t[0], 1e-4f)
        assertEquals(-0.075f, t[1], 1e-4f)   // centre slightly below the face, so the face sits above the middle
    }

    @Test fun bigFaceNeedsNoZoom() {
        val t = Framing.target(listOf(box(0.3f, 0.2f, 0.7f, 0.8f)), 0f, 0f, 1f, 2f)!!
        assertEquals(1f, t[2], 1e-4f)
    }

    @Test fun faceOnTheLeftMovesTheCentreLeftButStaysInsideThePicture() {
        val t = Framing.target(listOf(box(0.0f, 0.4f, 0.1f, 0.5f)), 0f, 0f, 1f, 2f)!!
        assertTrue(t[0] < -0.5f)
        // The camera picture reaches exactly to the output edge (cover 1): at 2× the centre may move ±0.5 at most.
        val c = Framing.clampCentre(t[0], t[1], t[2], 1f, 1f)
        assertEquals(-0.5f, c[0], 1e-4f)
    }

    @Test fun facesSeenThroughAZoomMapBackToTheSamePlace() {
        // Seen at 2× around (0.2, 0.1), a face in the middle of the copy is really at (0.2, 0.1) un-zoomed.
        val t = Framing.target(listOf(box(0.45f, 0.45f, 0.55f, 0.55f)), 0.2f, 0.1f, 2f, 2f)!!
        assertEquals(0.2f, t[0], 1e-4f)
        assertEquals(0.1f - Framing.HEADROOM / t[2], t[1], 1e-4f)
    }

    @Test fun twoPeopleBothFit() {
        val t = Framing.target(listOf(box(0.1f, 0.4f, 0.2f, 0.5f), box(0.8f, 0.4f, 0.9f, 0.5f)), 0f, 0f, 1f, 2f)!!
        // Faces span 1.6 clip units of width: they must fit in 75 % of it, so no zoom.
        assertEquals(1f, t[2], 1e-4f)
    }

    @Test fun deadZoneIgnoresSmallMoves() {
        val cur = floatArrayOf(0f, 0f, 1.5f)
        assertFalse(Framing.worthMoving(cur, floatArrayOf(0.05f, 0.02f, 1.55f)))
        assertTrue(Framing.worthMoving(cur, floatArrayOf(0.2f, 0f, 1.5f)))
        assertTrue(Framing.worthMoving(cur, floatArrayOf(0f, 0f, 1.8f)))
    }
}
