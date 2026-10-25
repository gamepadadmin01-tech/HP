package com.gamepad.client

import java.util.Calendar
import java.util.TimeZone

/** Per-install play time for signed-out players. Elapsed time measures usage; the saved zone
 *  defines the day.
 *
 *  RULES (owner's decisions, 2026-09-30 — the same as the server's for accounts):
 *   * There is NO daily free time any more (LIMIT_MS = 0; the midnight roll-over still runs but
 *     has nothing to give back).
 *   * Every install gets a ONE-TIME 30 minutes (WELCOME_MS), granted once by [ensureWelcome] and
 *     remembered by [welcomeGranted] — existing installs get it once on the update too.
 *   * bankMs holds that grant plus time earned from rewarded ads: it stacks and never expires.
 *   * Ads are offered only while less than AD_CAP_MS (1 hour) is left ([canEarnAd]); one ad
 *     still adds the full 30 minutes.
 *  It lives on this phone only and is never moved into an account: phone-side time can be faked. */
internal class GuestQuota(
    var usedMs: Long = 0,
    var resetsAt: Long = 0,
    val zoneId: String = TimeZone.getDefault().id,
    var lastWall: Long = 0,
    var bankMs: Long = 0,
    var welcomeGranted: Boolean = false,
) {
    companion object {
        /** Daily free time. 0 since 2026-09-30: all play time comes from the bank. */
        const val LIMIT_MS = 0L
        const val WELCOME_MS = 30 * 60 * 1000L
        const val AD_CAP_MS = 60 * 60 * 1000L
    }
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
        // Anything played past the daily free time (now: all of it) comes out of the bank.
        if (usedMs > LIMIT_MS) { bankMs = (bankMs - (usedMs - LIMIT_MS)).coerceAtLeast(0); usedMs = LIMIT_MS }
        usedMs = usedMs.coerceIn(0, LIMIT_MS)
        lastWall = now
        lastElapsed = elapsed
    }

    fun setActive(on: Boolean, wall: Long, elapsed: Long) {
        advance(wall, elapsed)
        active = on && remainingMs() > 0
    }

    /** How long they can play right now: the daily free time (none) plus the bank. */
    fun remainingMs(): Long = freeRemainingMs() + bankMs
    fun freeRemainingMs(): Long = (LIMIT_MS - usedMs).coerceAtLeast(0)

    fun credit(ms: Long) { if (ms > 0) bankMs += ms }

    /** Grant the one-time 30 minutes if this install never had them. Returns true when it did. */
    fun ensureWelcome(): Boolean {
        if (welcomeGranted) return false
        credit(WELCOME_MS)
        welcomeGranted = true
        return true
    }

    /** May this player be offered another ad? Only while under an hour is left. */
    fun canEarnAd(): Boolean = remainingMs() < AD_CAP_MS

    private fun nextMidnight(now: Long): Long = Calendar.getInstance(TimeZone.getTimeZone(zoneId)).run {
        timeInMillis = now
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        add(Calendar.DAY_OF_MONTH, 1)
        timeInMillis
    }
}
