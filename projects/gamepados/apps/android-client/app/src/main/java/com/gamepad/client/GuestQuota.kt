package com.gamepad.client

import java.util.Calendar
import java.util.TimeZone

/** Per-install allowance. Elapsed time measures usage; the saved zone defines the day. */
internal class GuestQuota(
    var usedMs: Long = 0,
    var resetsAt: Long = 0,
    val zoneId: String = TimeZone.getDefault().id,
    var lastWall: Long = 0,
) {
    companion object { const val LIMIT_MS = 30 * 60 * 1000L }
    var active = false
        private set
    private var lastElapsed: Long? = null

    fun advance(wall: Long, elapsed: Long) {
        val delta = lastElapsed?.let { (elapsed - it).coerceAtLeast(0) } ?: 0
        val now = maxOf(wall, lastWall + delta)
        if (resetsAt <= 0) resetsAt = nextMidnight(now)
        if (now >= resetsAt) {
            val today = Calendar.getInstance(TimeZone.getTimeZone(zoneId)).apply {
                timeInMillis = now
                set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            }.timeInMillis
            usedMs = if (active) minOf(delta, (now - today).coerceAtLeast(0)) else 0
            resetsAt = nextMidnight(now)
        } else if (active) usedMs += delta
        usedMs = usedMs.coerceIn(0, LIMIT_MS)
        lastWall = now
        lastElapsed = elapsed
    }

    fun setActive(on: Boolean, wall: Long, elapsed: Long) {
        advance(wall, elapsed)
        active = on && remainingMs() > 0
    }

    fun remainingMs(): Long = (LIMIT_MS - usedMs).coerceAtLeast(0)

    private fun nextMidnight(now: Long): Long = Calendar.getInstance(TimeZone.getTimeZone(zoneId)).run {
        timeInMillis = now
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        add(Calendar.DAY_OF_MONTH, 1)
        timeInMillis
    }
}
