package com.gamepad.client

import org.junit.Assert.*
import org.junit.Test

class ScreenAwakePolicyTest {
    @Test fun browsingDoesNotHoldScreenAwake() {
        val policy = ScreenAwakePolicy()
        assertFalse(policy.keepAwake)
        policy.resumed = true
        assertFalse(policy.keepAwake)
    }

    @Test fun controllerResumesButBackgroundNeverStaysAwake() {
        val policy = ScreenAwakePolicy()
        policy.controllerActive = true
        assertFalse(policy.keepAwake)
        policy.resumed = true
        assertTrue(policy.keepAwake)
        policy.resumed = false
        assertFalse(policy.keepAwake)
        policy.resumed = true
        assertTrue(policy.keepAwake)
    }

    @Test fun leavingControllerOrExpiringQuotaAllowsSleep() {
        val policy = ScreenAwakePolicy()
        policy.resumed = true
        policy.controllerActive = true
        policy.controllerActive = false
        assertFalse(policy.keepAwake)
        policy.resumed = false
        policy.resumed = true
        assertFalse(policy.keepAwake)
    }
}
