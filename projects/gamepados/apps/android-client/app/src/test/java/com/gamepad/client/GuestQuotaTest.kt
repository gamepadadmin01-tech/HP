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
