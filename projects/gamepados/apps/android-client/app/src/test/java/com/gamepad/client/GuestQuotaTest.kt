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
    // Open play (the server's OPEN_PLAY_UNTIL switch, relayed as a short lease): nothing is charged,
    // the bank is untouched, and it ends by itself.
    @Test fun openPlayStopsTheClockAndKeepsTheBank() {
        val q = GuestQuota(zoneId = "UTC", bankMs = 10 * min, welcomeGranted = true)
        q.advance(noon, 0)
        q.setOpenPlay(true, 30 * min, noon)
        q.advance(noon, 0)
        assertTrue(q.isOpen())
        assertFalse(q.canEarnAd())                             // no ad is offered while open
        q.setActive(true, noon, 0)
        q.advance(noon + 20 * min, 20 * min)                   // 20 minutes of play
        assertEquals(10 * min, q.bankMs)                       // ...cost nothing
        assertTrue(q.remainingMs() >= GuestQuota.OPEN_REMAINING_MS)
        assertTrue(q.active)
    }
    @Test fun openPlayWorksEvenWithAnEmptyBank() {
        val q = GuestQuota(zoneId = "UTC", welcomeGranted = true)
        q.advance(noon, 0)
        q.setActive(true, noon, 0)
        assertFalse(q.active)                                  // normally out of time
        q.setOpenPlay(true, 30 * min, noon); q.advance(noon, 0)
        q.setActive(true, noon, 0)
        assertTrue(q.active)
    }
    @Test fun openPlayEndsByItselfAndNormalRulesResume() {
        val q = GuestQuota(zoneId = "UTC", bankMs = 5 * min, welcomeGranted = true)
        q.advance(noon, 0)
        q.setOpenPlay(true, 30 * min, noon); q.advance(noon, 0)
        q.setActive(true, noon, 0)
        q.advance(noon + 31 * min, 31 * min)                   // one step that straddles the lease end
        assertFalse(q.isOpen())
        assertEquals(4 * min, q.remainingMs())                 // only the minute AFTER the lease is charged
        q.advance(noon + 33 * min, 33 * min)                   // and time counts normally again
        assertEquals(2 * min, q.remainingMs())
    }
    @Test fun turningOpenPlayOffStopsItAtOnce() {
        val q = GuestQuota(zoneId = "UTC", welcomeGranted = true)
        q.advance(noon, 0)
        q.setOpenPlay(true, 30 * min, noon); q.advance(noon, 0)
        assertTrue(q.isOpen())
        q.setOpenPlay(false, 0, noon + min); q.advance(noon + min, min)
        assertFalse(q.isOpen())
        assertEquals(0L, q.remainingMs())
    }
    @Test fun aLeaseIsCappedAndImplausibleValuesAreIgnored() {
        val q = GuestQuota(zoneId = "UTC", welcomeGranted = true)
        q.setOpenPlay(true, 24 * 60 * min, noon)               // asked for a day
        assertEquals(noon + GuestQuota.OPEN_MAX_TTL_MS, q.openUntilMs)
        // A saved value far in the future (clock rolled back, then forward) is dropped on the next reading.
        val bogus = GuestQuota(zoneId = "UTC", welcomeGranted = true, openUntilMs = noon + 48 * 60 * min)
        bogus.advance(noon, 0)
        assertEquals(0L, bogus.openUntilMs)
        assertFalse(bogus.isOpen())
    }
    @Test fun openPlaySurvivesARestartWithinItsLease() {
        val q = GuestQuota(zoneId = "UTC", welcomeGranted = true)
        q.advance(noon, 0)
        q.setOpenPlay(true, 30 * min, noon)
        val restored = GuestQuota(q.usedMs, q.resetsAt, q.zoneId, q.lastWall, q.bankMs, q.welcomeGranted, q.openUntilMs)
        restored.advance(noon + 5 * min, 5 * min)
        assertTrue(restored.isOpen())
        restored.advance(noon + 40 * min, 40 * min)
        assertFalse(restored.isOpen())
    }
    @Test fun normalTiltWrapsButKeepsSmallMovement() {
        assertEquals(10f, GyroAngle.shortest(370f), 0.001f)
        assertEquals(-10f, GyroAngle.shortest(-370f), 0.001f)
        assertEquals(2f, GyroAngle.shortest(-358f), 0.001f)
        assertEquals(0f, GyroAngle.shortest(720f), 0.001f)
    }
}
