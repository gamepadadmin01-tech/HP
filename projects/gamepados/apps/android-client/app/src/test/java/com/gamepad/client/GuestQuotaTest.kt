package com.gamepad.client

import org.junit.Assert.*
import org.junit.Test

class GuestQuotaTest {
    private val noon = 1789128000000L
    @Test fun chargesOnlyControllerTimeAndSurvivesRestart() {
        val q = GuestQuota(zoneId = "UTC")
        q.setActive(true, noon, 0)
        q.setActive(false, noon + 600000, 600000)
        q.advance(noon + 900000, 900000)
        assertEquals(1200000L, q.remainingMs())
        val restored = GuestQuota(q.usedMs, q.resetsAt, q.zoneId, q.lastWall)
        restored.setActive(true, noon + 1000000, 10)
        restored.advance(noon + 1060000, 60010)
        assertEquals(1140000L, restored.remainingMs())
    }
    @Test fun delayedTickExhaustsExactlyAndRollbackDoesNotRefund() {
        val q = GuestQuota(zoneId = "UTC")
        q.setActive(true, noon, 0)
        q.advance(noon - 60000, GuestQuota.LIMIT_MS + 5000)
        assertEquals(0L, q.remainingMs())
        q.setActive(true, noon, GuestQuota.LIMIT_MS + 5001)
        assertFalse(q.active)
    }
    @Test fun midnightResetsAndChargesOnlyNewDayPortion() {
        val q = GuestQuota(zoneId = "UTC")
        q.advance(noon, 0)
        val midnight = q.resetsAt
        q.setActive(true, midnight - 10000, 1000)
        q.advance(midnight + 20000, 31000)
        assertEquals(20000L, q.usedMs)
        assertEquals(midnight + 86400000L, q.resetsAt)
    }
    // ── Ad bank (signed-out rewarded ads) ──
    @Test fun adBankAddsToTodayAndIsSpentOnlyAfterFreeTime() {
        val q = GuestQuota(zoneId = "UTC")
        q.advance(noon, 0)
        q.credit(30 * 60000L)
        assertEquals(GuestQuota.LIMIT_MS + 30 * 60000L, q.remainingMs())
        q.setActive(true, noon, 0)
        q.advance(noon + 10 * 60000L, 10 * 60000L)          // 10 min played: all free time
        assertEquals(30 * 60000L, q.bankMs)
        q.advance(noon + 40 * 60000L, 40 * 60000L)          // 40 min played: free 30 gone, 10 from the bank
        assertEquals(0L, q.freeRemainingMs())
        assertEquals(20 * 60000L, q.bankMs)
        assertEquals(20 * 60000L, q.remainingMs())
    }
    @Test fun exhaustedDayReopensWithAnAd() {
        val q = GuestQuota(usedMs = GuestQuota.LIMIT_MS, zoneId = "UTC")
        q.advance(noon, 0)
        q.setActive(true, noon, 0)
        assertFalse(q.active)
        q.credit(30 * 60000L)
        q.setActive(true, noon + 1000, 1000)
        assertTrue(q.active)
        q.advance(noon + 31 * 60000L, 31 * 60000L)
        assertEquals(0L, q.remainingMs())                   // bank can't go below zero
        assertEquals(0L, q.bankMs)
    }
    @Test fun bankSurvivesMidnightAndRestart() {
        val q = GuestQuota(usedMs = GuestQuota.LIMIT_MS, zoneId = "UTC", bankMs = 45 * 60000L)
        q.advance(noon, 0)
        q.advance(q.resetsAt + 1, 100)                      // next day, idle
        assertEquals(GuestQuota.LIMIT_MS + 45 * 60000L, q.remainingMs())
        val restored = GuestQuota(q.usedMs, q.resetsAt, q.zoneId, q.lastWall, q.bankMs)
        assertEquals(45 * 60000L, restored.bankMs)
    }
    @Test fun exhaustedTrialRenewsNextDay() {
        val q = GuestQuota(usedMs = GuestQuota.LIMIT_MS, zoneId = "UTC")
        q.advance(noon, 0)
        q.setActive(true, q.resetsAt + 1, 100)
        assertEquals(GuestQuota.LIMIT_MS, q.remainingMs())
        assertTrue(q.active)
    }
    @Test fun normalTiltWrapsButKeepsSmallMovement() {
        assertEquals(10f, GyroAngle.shortest(370f), 0.001f)
        assertEquals(-10f, GyroAngle.shortest(-370f), 0.001f)
        assertEquals(2f, GyroAngle.shortest(-358f), 0.001f)
        assertEquals(0f, GyroAngle.shortest(720f), 0.001f)
    }
}
