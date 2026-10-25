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
    /** Open play: while the wall clock is before this, nothing is charged and the quota reports
     *  unlimited. It is a short LEASE the app renews from the server (see [setOpenPlay]); 0 = off. */
    var openUntilMs: Long = 0,
) {
    companion object {
        /** Daily free time. 0 since 2026-09-30: all play time comes from the bank. */
        const val LIMIT_MS = 0L
        const val WELCOME_MS = 30 * 60 * 1000L
        const val AD_CAP_MS = 60 * 60 * 1000L
        /** What an open-play phone reports as "left", for UI code that only reads remaining time. */
        const val OPEN_REMAINING_MS = 24 * 60 * 60 * 1000L
        /** No lease is ever longer than this, whatever the app asks or the clock says. */
        const val OPEN_MAX_TTL_MS = 2 * 60 * 60 * 1000L
    }
    var active = false
        private set
    private var lastElapsed: Long? = null

    fun advance(wall: Long, elapsed: Long) {
        val delta = lastElapsed?.let { (elapsed - it).coerceAtLeast(0) } ?: 0
        val now = maxOf(wall, lastWall + delta)
        if (openUntilMs - now > OPEN_MAX_TTL_MS) openUntilMs = 0   // implausibly far ahead: never trust it
        // Only the part of this step AFTER the open-play lease ended is charged, so a long gap that
        // straddles the end (a sleeping phone, a late tick) is not billed for the open part.
        val freePart = if (openUntilMs > 0) (minOf(now, openUntilMs) - (now - delta)).coerceIn(0L, delta) else 0L
        val billed = delta - freePart
        if (resetsAt <= 0) resetsAt = nextMidnight(now)
        if (now >= resetsAt) {
            val today = Calendar.getInstance(TimeZone.getTimeZone(zoneId)).apply {
                timeInMillis = now
                set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            }.timeInMillis
            usedMs = if (active) minOf(billed, (now - today).coerceAtLeast(0)) else 0
            resetsAt = nextMidnight(now)
        } else if (active) usedMs += billed
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

    /** Is open play on right now? Read against the last clock reading, so call [advance] first. */
    fun isOpen(): Boolean = openUntilMs > lastWall

    /** Switch open play on for [ttlMs] (at most [OPEN_MAX_TTL_MS]) from [wall], or off. Time is not
     *  charged while it is on, and the bank is left exactly as it was. */
    fun setOpenPlay(open: Boolean, ttlMs: Long, wall: Long) {
        openUntilMs = if (open) wall + ttlMs.coerceIn(0, OPEN_MAX_TTL_MS) else 0
    }

    /** How long they can play right now: the daily free time (none) plus the bank. */
    fun remainingMs(): Long = if (isOpen()) maxOf(OPEN_REMAINING_MS, freeRemainingMs() + bankMs) else freeRemainingMs() + bankMs
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
    fun canEarnAd(): Boolean = !isOpen() && remainingMs() < AD_CAP_MS

    private fun nextMidnight(now: Long): Long = Calendar.getInstance(TimeZone.getTimeZone(zoneId)).run {
        timeInMillis = now
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        add(Calendar.DAY_OF_MONTH, 1)
        timeInMillis
    }
}
