package com.gamepad.camos

import kotlin.math.max
import kotlin.math.min

/**
 * Auto-framing maths (owner, 2026-11-23), kept free of Android so it can be unit-tested (FramingTest).
 *
 * Coordinates are the output's clip space of the un-zoomed picture: x and y from −1 to 1 (y up). A crop is a centre
 * (x, y) and a zoom z ≥ 1: the output shows x ± 1/z, y ± 1/z.
 */
object Framing {
    /** How big the face should be: about 28 % of the output height (head and shoulders). */
    const val FACE_SHARE = 0.56f   // of the 2-unit height
    /** All faces must fit inside 75 % of the width. */
    const val WIDTH_SHARE = 1.5f
    /** The face sits this far above the middle (clip units of the zoomed output). */
    const val HEADROOM = 0.15f

    /**
     * Where to frame, from face boxes found in a small copy that was itself taken through crop (cx, cy, z)
     * (boxes as fractions 0…1, top-left origin). Returns (x, y, zoom), or null with no faces.
     */
    fun target(boxes: List<FloatArray>, cx: Float, cy: Float, z: Float, maxZoom: Float): FloatArray? {
        if (boxes.isEmpty()) return null
        var minX = Float.MAX_VALUE; var maxX = -Float.MAX_VALUE; var minY = Float.MAX_VALUE; var maxY = -Float.MAX_VALUE
        for (b in boxes) {
            val x0 = (2f * b[0] - 1f) / z + cx; val x1 = (2f * b[2] - 1f) / z + cx
            val yTop = (1f - 2f * b[1]) / z + cy; val yBot = (1f - 2f * b[3]) / z + cy
            minX = min(minX, x0); maxX = max(maxX, x1); minY = min(minY, yBot); maxY = max(maxY, yTop)
        }
        val fw = max(0.01f, maxX - minX); val fh = max(0.01f, maxY - minY)
        val zoom = min(FACE_SHARE / fh, WIDTH_SHARE / fw).coerceIn(1f, maxZoom)
        return floatArrayOf((minX + maxX) / 2f, (minY + maxY) / 2f - HEADROOM / zoom, zoom)
    }

    /** Keep the crop inside the camera picture, which reaches `coverX`/`coverY` (≥ 1) past the centre. */
    fun clampCentre(x: Float, y: Float, z: Float, coverX: Float, coverY: Float): FloatArray {
        val mx = max(0f, coverX - 1f / z); val my = max(0f, coverY - 1f / z)
        return floatArrayOf(x.coerceIn(-mx, mx), y.coerceIn(-my, my))
    }

    /** Big enough change to move the camera (a dead zone keeps the picture still for small movements). */
    fun worthMoving(cur: FloatArray, next: FloatArray): Boolean =
        kotlin.math.abs(next[0] - cur[0]) > 0.1f || kotlin.math.abs(next[1] - cur[1]) > 0.1f ||
            kotlin.math.abs(next[2] - cur[2]) / cur[2] > 0.12f
}
