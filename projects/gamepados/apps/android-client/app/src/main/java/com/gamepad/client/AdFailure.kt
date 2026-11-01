package com.gamepad.client

/** Why an ad could not be shown: who is to blame decides whether the player is compensated.
 *
 *  Owner's rule (2026-11-01): when the AD NETWORK had no ad ([NOFILL]) or failed on its own side
 *  ([ERROR]) the player is given 20 free minutes, up to 3 a day, decided by the server
 *  (website routes.ads.js, POST /api/ads/outcome). The player's own connection ([NETWORK], also an ad
 *  blocker or Private DNS) earns nothing, and neither does anything we cannot place ([OTHER]).
 *
 *  Pure functions on the ad SDKs' error NAMES and codes, so a test pins the table down. */
object AdFailure {
    const val NOFILL = "nofill"
    const val ERROR = "error"
    const val NETWORK = "network"
    const val OTHER = "other"

    /** UnityAds.UnityAdsLoadError name. */
    fun unityLoad(name: String?): String = when (name) {
        "NO_FILL" -> NOFILL
        "INTERNAL_ERROR", "INVALID_ARGUMENT" -> ERROR
        "INITIALIZE_FAILED", "TIMEOUT" -> NETWORK
        else -> OTHER
    }

    /** UnityAds.UnityAdsShowError name. */
    fun unityShow(name: String?): String = when (name) {
        "NO_CONNECTION", "TIMEOUT" -> NETWORK
        "NOT_READY", "NOT_INITIALIZED", "VIDEO_PLAYER_ERROR", "INTERNAL_ERROR" -> ERROR
        else -> OTHER
    }

    /** AdMob LoadAdError.code. */
    fun admobLoad(code: Int): String = when (code) {
        3, 9 -> NOFILL                      // NO_FILL, MEDIATION_NO_FILL
        0, 1 -> ERROR                       // INTERNAL_ERROR, INVALID_REQUEST
        2 -> NETWORK                        // NETWORK_ERROR
        else -> OTHER
    }

    fun admobName(code: Int): String = when (code) {
        0 -> "INTERNAL_ERROR"; 1 -> "INVALID_REQUEST"; 2 -> "NETWORK_ERROR"; 3 -> "NO_FILL"
        8 -> "APP_ID_MISSING"; 9 -> "MEDIATION_NO_FILL"
        else -> "CODE_$code"
    }
}

/** A step of showing an ad that did not work: the sentence for the player, who is to blame
 *  ([AdFailure] kind) and the ad network's own error name (shown in the portal's ad health). */
class AdProblem(val text: String, val kind: String, val code: String)
