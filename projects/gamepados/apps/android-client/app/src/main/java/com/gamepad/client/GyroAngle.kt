package com.gamepad.client

internal object GyroAngle {
    fun shortest(degrees: Float): Float = ((degrees + 180f) % 360f + 360f) % 360f - 180f
}
