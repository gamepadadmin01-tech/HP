package com.gamepad.client

import org.junit.Assert.*
import org.junit.Test

// Who is to blame when an ad does not play decides whether the player gets the 20 free minutes
// (owner, 2026-11-01): the ad network's fault earns time, the player's own connection does not.
class AdFailureTest {
    @Test fun unityNoFillAndErrorsEarnTime() {
        assertEquals(AdFailure.NOFILL, AdFailure.unityLoad("NO_FILL"))
        assertEquals(AdFailure.ERROR, AdFailure.unityLoad("INTERNAL_ERROR"))
        assertEquals(AdFailure.ERROR, AdFailure.unityLoad("INVALID_ARGUMENT"))
        assertEquals(AdFailure.ERROR, AdFailure.unityShow("VIDEO_PLAYER_ERROR"))
        assertEquals(AdFailure.ERROR, AdFailure.unityShow("NOT_READY"))
    }
    @Test fun theirOwnConnectionEarnsNothing() {
        // Airplane mode, Private DNS, a VPN or an ad blocker all end up as these.
        assertEquals(AdFailure.NETWORK, AdFailure.unityLoad("INITIALIZE_FAILED"))
        assertEquals(AdFailure.NETWORK, AdFailure.unityLoad("TIMEOUT"))
        assertEquals(AdFailure.NETWORK, AdFailure.unityShow("NO_CONNECTION"))
        assertEquals(AdFailure.NETWORK, AdFailure.admobLoad(2))
    }
    @Test fun anythingUnknownEarnsNothing() {
        assertEquals(AdFailure.OTHER, AdFailure.unityLoad(null))
        assertEquals(AdFailure.OTHER, AdFailure.unityLoad("SOMETHING_NEW"))
        assertEquals(AdFailure.OTHER, AdFailure.unityShow("ALREADY_SHOWING"))
        assertEquals(AdFailure.OTHER, AdFailure.admobLoad(42))
    }
    @Test fun admobNoFillAndErrorsEarnTime() {
        assertEquals(AdFailure.NOFILL, AdFailure.admobLoad(3))
        assertEquals(AdFailure.NOFILL, AdFailure.admobLoad(9))
        assertEquals(AdFailure.ERROR, AdFailure.admobLoad(0))
        assertEquals(AdFailure.ERROR, AdFailure.admobLoad(1))
    }
    @Test fun admobNamesAreReadable() {
        assertEquals("NO_FILL", AdFailure.admobName(3))
        assertEquals("CODE_77", AdFailure.admobName(77))
    }
}
