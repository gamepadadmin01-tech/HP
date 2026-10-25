package com.gamepad.client

import org.junit.Assert.*
import org.junit.Test

// Signed-out play time, rules of 2026-09-30: no daily free time, a ONE-TIME 30 minutes,
// ads stack and never expire, ads offered only while under an hour is left.
class GuestQuotaTest {
    private val noon = 1789128000000L
    private val min = 60000L

    @Test fun noDailyFreeTime() {
        assertEquals(0L, GuestQuota.LIMIT_MS)
        val q = GuestQuota(zoneId = "UTC")
        q.advance(noon, 0)
        assertEquals(0L, q.remainingMs())                    // nothing until the one-time grant
    }
    @Test fun welcomeIsGrantedExactlyOnce() {
        val q = GuestQuota(zoneId = "UTC")
        assertTrue(q.ensureWelcome())
        assertFalse(q.ensureWelcome())                       // a second call gives nothing
        assertEquals(30 * min, q.bankMs)
        // After a restart the saved flag stops a second grant.
        val restored = GuestQuota(q.usedMs, q.resetsAt, q.zoneId, q.lastWall, q.bankMs, q.welcomeGranted)
        assertFalse(restored.ensureWelcome())
        assertEquals(30 * min, restored.bankMs)
    }
    @Test fun chargesOnlyControllerTimeAndSurvivesRestart() {
        val q = GuestQuota(zoneId = "UTC"); q.ensureWelcome()
        q.setActive(true, noon, 0)
        q.setActive(false, noon + 10 * min, 10 * min)          // 10 min on the controller
        q.advance(noon + 15 * min, 15 * min)                    // 5 min off it: not charged
        assertEquals(20 * min, q.remainingMs())
        val restored = GuestQuota(q.usedMs, q.resetsAt, q.zoneId, q.lastWall, q.bankMs, q.welcomeGranted)
        restored.setActive(true, noon + 20 * min, 10)
        restored.advance(noon + 21 * min, min + 10)
        assertEquals(19 * min, restored.remainingMs())
    }
    @Test fun delayedTickExhaustsExactlyAndRollbackDoesNotRefund() {
        val q = GuestQuota(zoneId = "UTC"); q.ensureWelcome()
        q.setActive(true, noon, 0)
        q.advance(noon - min, 30 * min + 5000)                 // clock rolled back, elapsed still counts
        assertEquals(0L, q.remainingMs())
        q.setActive(true, noon, 30 * min + 5001)
        assertFalse(q.active)
    }
    @Test fun midnightGivesNothingBack() {
        val q = GuestQuota(zoneId = "UTC"); q.ensureWelcome()
        q.setActive(true, noon, 0)
        q.advance(noon + 20 * min, 20 * min)                   // 20 of the 30 minutes played
        q.setActive(false, noon + 20 * min, 20 * min)
        q.advance(q.resetsAt + 1, 20 * min + 100)              // next day, idle
        assertEquals(10 * min, q.remainingMs())                // still 10 — no daily refill
    }
    @Test fun adsStackAndReopenAnEmptyQuota() {
        val q = GuestQuota(zoneId = "UTC", welcomeGranted = true)
        q.advance(noon, 0)
        q.setActive(true, noon, 0)
        assertFalse(q.active)                                  // out of time
        q.credit(30 * min); q.credit(30 * min)
        assertEquals(60 * min, q.remainingMs())
        q.setActive(true, noon + 1000, 1000)
        assertTrue(q.active)
        q.advance(noon + 70 * min, 70 * min)
        assertEquals(0L, q.remainingMs())                      // bank never goes below zero
        assertEquals(0L, q.bankMs)
    }
    @Test fun bankSurvivesMidnightAndRestart() {
        val q = GuestQuota(zoneId = "UTC", bankMs = 45 * min, welcomeGranted = true)
        q.advance(noon, 0)
        q.advance(q.resetsAt + 1, 100)
        assertEquals(45 * min, q.remainingMs())
        val restored = GuestQuota(q.usedMs, q.resetsAt, q.zoneId, q.lastWall, q.bankMs, q.welcomeGranted)
        assertEquals(45 * min, restored.bankMs)
    }
    @Test fun adsOfferedOnlyUnderAnHour() {
        val q = GuestQuota(zoneId = "UTC", bankMs = 59 * min + 59_000, welcomeGranted = true)
        assertTrue(q.canEarnAd())                              // 59:59 left: one more allowed
        q.credit(1000)
        assertFalse(q.canEarnAd())                             // exactly an hour: no more
        val under = GuestQuota(zoneId = "UTC", bankMs = 45 * min, welcomeGranted = true)
        assertTrue(under.canEarnAd())
        under.credit(30 * min)                                 // one ad still adds the full 30
        assertEquals(75 * min, under.remainingMs())
        assertFalse(under.canEarnAd())
    }
    // 1.4.11: the rules come from the server, clamped here.
    @Test fun serverRulesAreUsedAndClamped() {
        val q = GuestQuota(zoneId = "UTC")
        q.setRules(45 * 60, 20 * 60, 90 * 60)
        assertTrue(q.ensureWelcome())
        assertEquals(45 * min, q.bankMs)                       // the welcome follows the server
        assertEquals(20 * min, q.adRewardMs)
        assertTrue(q.canEarnAd())                              // 45 < 90-minute cap
        q.setRules(Long.MAX_VALUE / 2000, 0, 0)                // absurd values
        assertEquals(120 * min, q.welcomeMs)                   // at most 2 hours
        assertEquals(5 * min, q.adRewardMs)                    // at least 5 minutes an ad
        assertEquals(30 * min, q.adCapMs)                      // cap at least 30 minutes
        q.setRules(-5, 999_999, 999_999)
        assertEquals(0L, q.welcomeMs)
        assertEquals(60 * min, q.adRewardMs)                   // at most an hour an ad
        assertEquals(180 * min, q.adCapMs)                     // cap at most 3 hours
    }
    @Test fun defaultsUntilTheServerAnswers() {
        val q = GuestQuota(zoneId = "UTC")
        assertEquals(30 * min, q.welcomeMs)
        assertEquals(30 * min, q.adRewardMs)
        assertEquals(60 * min, q.adCapMs)
    }
    // "Get free time": only while under the threshold, so a guest holds at most 59 min.
    @Test fun freeTimeOnlyUnderThirtyMinutes() {
        val q = GuestQuota(zoneId = "UTC", bankMs = 29 * min + 59_000, welcomeGranted = true)
        q.advance(noon, 0)
        assertTrue(q.creditFreeTime(30 * min, 30 * min))       // 29:59 left → allowed
        assertEquals(59 * min + 59_000, q.remainingMs())       // the most anyone can hold
        assertFalse(q.creditFreeTime(30 * min, 30 * min))      // now over 30 → refused
        assertEquals(59 * min + 59_000, q.remainingMs())
        val exact = GuestQuota(zoneId = "UTC", bankMs = 30 * min, welcomeGranted = true)
        assertFalse(exact.creditFreeTime(30 * min, 30 * min))  // exactly 30 → refused
    }
    @Test fun freeTimeAmountsAreClamped() {
        val q = GuestQuota(zoneId = "UTC", welcomeGranted = true)
        q.advance(noon, 0)
        assertTrue(q.creditFreeTime(10 * 60 * min, 10 * 60 * min)) // asked for 10 hours
        assertEquals(60 * min, q.bankMs)                        // got at most an hour
        assertFalse(q.creditFreeTime(30 * min, 10 * 60 * min))  // threshold clamped to an hour too
    }
    @Test fun normalTiltWrapsButKeepsSmallMovement() {
        assertEquals(10f, GyroAngle.shortest(370f), 0.001f)
        assertEquals(-10f, GyroAngle.shortest(-370f), 0.001f)
        assertEquals(2f, GyroAngle.shortest(-358f), 0.001f)
        assertEquals(0f, GyroAngle.shortest(720f), 0.001f)
    }
}
