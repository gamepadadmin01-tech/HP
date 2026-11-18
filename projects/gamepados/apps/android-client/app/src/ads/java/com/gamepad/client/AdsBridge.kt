package com.gamepad.client

import android.webkit.JavascriptInterface
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import org.json.JSONObject

// Rewarded ads — playstore, direct and uptodown only (build.gradle.kts wires src/ads/java into those
// three; the other stores get the empty class in src/noads/java, so these methods are absent from
// window.AndroidBridge there, the same store-safety boundary as BillingBridge and UpdaterBridge).
//
// ## The only ad in the app, and it is optional
//
// Nothing here shows an ad on its own. An ad plays only when the player taps "Watch an ad · +30 min"
// (showRewardedAd). Never on the controller screen while input is live, never at launch.
//
// ## Who grants the 30 minutes
//
//   * Signed in: the SERVER. The account id rides on the ad as Google's server-side-verification
//     user id; when the ad completes, Google calls /api/ads/admob/reward with a signed message and
//     the server banks the time. This class grants nothing for a signed-in player — a patched app
//     that claims a reward gets nothing, because only Google's signature counts.
//   * Signed out: there is no account to credit, so the phone banks it itself (GuestTrial.creditAd),
//     exactly like the one-time 30 free minutes, which are also counted on the phone.
//
// ## Consent (Google's User Messaging Platform)
//
// Asked on the first tap, not at launch: a consent form is only worth showing to someone who has
// chosen to watch an ad. Where the law needs it (EEA/UK), Google's own form appears once; after
// that canRequestAds() stays true across launches. adPrivacyOptionsRequired/showAdPrivacyOptions
// let the settings screen offer "Ad privacy choices", which the EEA requires to be reachable.
//
// ## Which network plays the ad
//
// BuildConfig.AD_NETWORK is the starting network: "unity" in direct and uptodown (UnityRewarded, from 2026-10-30)
// and in the playstore build since 2026-11-01. The playstore build can be switched between "admob" (everything
// above) and "unity" from the admin portal since 2026-11-09 (setAdNetwork). With Unity a signed-in player's finished ad is reported
// with a one-time `claim` id and the page asks the server to credit it (/api/ads/unity/claim).
//
// Results reach JS as window.onRewardedAdResult(json), json = { status, network, message?, guest?, claim?,
// kind?, code? } where status is "rewarded" | "closed" (dismissed before the reward) | "failed" | "consent".
// A "failed" carries kind ("nofill" | "error" | "network" | "other", see AdFailure) and the ad network's
// own error name: the page tells the server, which gives 20 free minutes when the network was at fault.
open class AdsBridge(activity: MainActivity) : UpdaterBridgeBase(activity) {

    private var ad: RewardedAd? = null
    private var loading = false
    private var started = false
    /** A tap that arrived before an ad had loaded: show it as soon as one does. */
    private var waitingUser: String? = null

    private val consent: ConsentInformation by lazy { UserMessagingPlatform.getConsentInformation(activity) }

    /** Which network plays the ad. direct and uptodown: always Unity (build.gradle.kts). The Play build starts on
     *  BuildConfig.AD_NETWORK, but since 2026-11-09 the admin portal can SWITCH it between AdMob and Unity
     *  (owner: "if AdMob fails again we can switch it to Unity"), via setAdNetwork from the page. The choice is
     *  remembered, so an offline launch keeps the last one. */
    private val canSwitch = BuildConfig.DISTRIBUTION_CHANNEL == "playstore"
    private val prefs by lazy { activity.getSharedPreferences("gamepad_prefs", android.content.Context.MODE_PRIVATE) }
    @Volatile private var network: String =
        if (canSwitch) (prefs.getString("playAdNetwork", null)?.takeIf { it == "admob" || it == "unity" } ?: BuildConfig.AD_NETWORK)
        else BuildConfig.AD_NETWORK
    private val useUnity get() = network == "unity"
    private val unity by lazy { UnityRewarded(activity) }

    @JavascriptInterface
    fun adsAvailable(): Boolean = true

    /** "admob" or "unity": the page tells the server, so the portal's switch and messages for THIS
     *  network are the ones this build follows (the Play build moved to Unity on 2026-11-01). */
    @JavascriptInterface
    fun adNetwork(): String = network

    /** The portal's choice for the Play build ("admob" or "unity"). Ignored by every other build, and by an
     *  unknown name. Returns the network now in use. A ready AdMob ad is dropped on a switch, so the next tap
     *  loads from the network that was chosen. */
    @JavascriptInterface
    fun setAdNetwork(name: String): String {
        if (!canSwitch || (name != "admob" && name != "unity") || name == network) return network
        network = name
        prefs.edit().putString("playAdNetwork", name).apply()
        activity.runOnUiThread { ad = null; waitingUser = null }
        return name
    }

    /** Tap: ask for consent if needed, then show an ad (loading one first if none is ready). */
    @JavascriptInterface
    fun showRewardedAd(userId: String) {
        activity.runOnUiThread {
            gatherConsent { problem ->
                if (problem != null) { report("consent", problem); return@gatherConsent }
                if (useUnity) { showUnity(userId); return@gatherConsent }
                startSdk()
                val ready = ad
                if (ready != null) show(ready, userId)
                else { waitingUser = userId; load() }
            }
        }
    }

    /** Warm an ad so the tap is instant. Does nothing until consent was given on an earlier tap —
     *  merely opening a screen must never pop a consent form. */
    @JavascriptInterface
    fun preloadRewardedAd() {
        // Not during launch: starting an ad network on the main thread while the logo fades made the opening stutter.
        activity.runAfterLaunch {
            if (!consent.canRequestAds()) return@runAfterLaunch
            if (useUnity) {
                unity.start(personalisedAds()) { problem -> if (problem == null) unity.loadThen { } }
                return@runAfterLaunch
            }
            startSdk()
            if (ad == null) load()
        }
    }

    /** False where Google's form says the player has privacy choices to make (EEA/UK-style regions):
     *  Unity then serves ads without tracking. Everywhere else it is the normal, personalised kind. */
    private fun personalisedAds(): Boolean =
        consent.privacyOptionsRequirementStatus != ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED

    /** The Unity version of a tap: start the SDK, make sure an ad is ready, play it.
     *
     *  Unity has no signed message to our server (it only sends one after Support enables it), so
     *  for a signed-in player the phone reports a one-time claim number with "rewarded"; the page
     *  then POSTs it to /api/ads/unity/claim and the server applies the 30-minute rule. A signed-out
     *  player is banked on the phone, exactly like with AdMob. */
    private fun showUnity(userId: String) {
        unity.start(personalisedAds()) { startProblem ->
            if (startProblem != null) { reportProblem(startProblem); return@start }
            unity.loadThen { loadProblem ->
                if (loadProblem != null) { reportProblem(loadProblem); return@loadThen }
                val signedIn = userId.isNotBlank()
                unity.show { watched, problem ->
                    when {
                        problem != null -> reportProblem(problem)
                        !watched -> report("closed", null, guest = !signedIn)
                        signedIn -> report("rewarded", null, claim = java.util.UUID.randomUUID().toString())
                        else -> { activity.creditGuestAdReward(); report("rewarded", null, guest = true) }
                    }
                }
            }
        }
    }

    @JavascriptInterface
    fun adPrivacyOptionsRequired(): Boolean =
        consent.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED

    @JavascriptInterface
    fun showAdPrivacyOptions() {
        activity.runOnUiThread { UserMessagingPlatform.showPrivacyOptionsForm(activity) { } }
    }

    /** Answers null when ads may be requested, otherwise the sentence to show the player.
     *
     *  Until 2026-10-01 every failure said "Ads could not be shown without your ad choices." — which
     *  sounds like the player refused something. Outside the EEA/UK nobody is ever asked, so the
     *  real cause was almost always that Google's consent server could not be reached (Private DNS,
     *  an ad blocker, a VPN, or no internet) on an install that had no saved answer yet. The message
     *  now says that, and carries Google's error code so a player's screenshot tells us why. */
    private fun gatherConsent(done: (String?) -> Unit) {
        val params = ConsentRequestParameters.Builder().build()
        consent.requestConsentInfoUpdate(activity, params, {
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { formError ->
                when {
                    consent.canRequestAds() -> done(null)
                    formError != null -> done(consentProblem(formError.errorCode))
                    // The form was shown (EEA/UK) and closed without an answer.
                    else -> done("Ads need your OK first. Tap Watch an ad again and choose an option on Google's form.")
                }
            }
        }, { error ->
            // The consent check failed. An answer saved on an earlier launch still counts.
            done(if (consent.canRequestAds()) null else consentProblem(error.errorCode))
        })
    }

    /** UMP FormError codes: 1 internal, 2 internet, 3 invalid operation (setup), 4 timeout. */
    private fun consentProblem(code: Int): String = when (code) {
        2, 4 -> "Couldn't reach Google to check ad settings. Check your internet, or turn off " +
            "Private DNS, VPN or ad blockers, then try again. (Error $code)"
        else -> "Couldn't check ad settings with Google right now. Turn off Private DNS, VPN or " +
            "ad blockers and try again in a minute. (Error $code)"
    }

    private fun startSdk() {
        if (started) return
        started = true
        // Google asks for initialize() off the main thread; ads may be requested before it finishes.
        Thread { try { MobileAds.initialize(activity) { } } catch (_: Throwable) { } }.start()
    }

    private fun load() {
        if (loading) return
        loading = true
        RewardedAd.load(activity, BuildConfig.ADMOB_REWARDED_ID, AdRequest.Builder().build(),
            object : RewardedAdLoadCallback() {
                override fun onAdLoaded(loaded: RewardedAd) {
                    loading = false
                    ad = loaded
                    waitingUser?.let { u -> waitingUser = null; show(loaded, u) }
                }
                override fun onAdFailedToLoad(error: LoadAdError) {
                    loading = false
                    ad = null
                    if (waitingUser != null) {
                        waitingUser = null
                        val name = AdFailure.admobName(error.code)
                        reportProblem(AdProblem("No ad is available right now. Try again in a minute. (Error $name)",
                            AdFailure.admobLoad(error.code), name))
                    }
                }
            })
    }

    private fun show(rewarded: RewardedAd, userId: String) {
        ad = null
        val signedIn = userId.isNotBlank()
        if (signedIn) {
            rewarded.setServerSideVerificationOptions(
                ServerSideVerificationOptions.Builder().setUserId(userId).build())
        }
        var earned = false
        rewarded.fullScreenContentCallback = object : FullScreenContentCallback() {
            // No automatic load() of the next ad here (removed 2026-10-01). The usual moment an ad
            // closes is the out-of-time screen, and play resumes straight after — so the next ad's
            // video was downloading over the player's Wi-Fi while they raced (lag and jitter
            // spikes). The next ad now loads when the button is next on screen (preloadRewardedAd)
            // or on the tap itself.
            override fun onAdDismissedFullScreenContent() {
                report(if (earned) "rewarded" else "closed", null, guest = !signedIn)
            }
            override fun onAdFailedToShowFullScreenContent(error: AdError) {
                reportProblem(AdProblem("The ad could not play. Try again in a minute. (Error ${error.code})",
                    AdFailure.ERROR, "SHOW_${error.code}"))
            }
        }
        rewarded.show(activity) { _ ->
            earned = true
            if (!signedIn) activity.creditGuestAdReward()
        }
    }

    // ── Sign in with Google, through Android's own account chooser ─────────────────
    //
    // Lives in this class only because it is the flavour split that already means "this build
    // carries Google Play services" (playstore, direct, uptodown). The other store builds have
    // no such method, so the UI sees it is absent and uses the browser flow instead.
    //
    // JS passes the public web client id (the audience of the ID token) and a nonce it got from
    // our server. The result comes back as window.onNativeGoogleResult(json), json =
    //   { idToken }                 the token to trade for a session, or
    //   { error: "cancelled" }      the person closed the chooser, or
    //   { error: "unavailable" }    this phone cannot do it (no Google Play services, no account,
    //                               a configuration problem): JS then uses the browser flow.
    @JavascriptInterface
    fun googleSignInNative(webClientId: String, nonce: String) {
        activity.runOnUiThread {
            try {
                val option = GetSignInWithGoogleOption.Builder(webClientId).setNonce(nonce).build()
                val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
                CredentialManager.create(activity).getCredentialAsync(
                    activity, request, CancellationSignal(), ContextCompat.getMainExecutor(activity),
                    object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                        override fun onResult(result: GetCredentialResponse) {
                            val credential = result.credential
                            if (credential is CustomCredential &&
                                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                                try {
                                    reportGoogle(idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken)
                                } catch (e: GoogleIdTokenParsingException) {
                                    reportGoogle(error = "unavailable", detail = "parse: " + e.message)
                                }
                            } else {
                                reportGoogle(error = "unavailable", detail = "unexpected credential " + credential.type)
                            }
                        }
                        override fun onError(e: GetCredentialException) {
                            // Only a real "I closed it" is a cancellation. Google ALSO reports a failed
                            // account re-verification ("[16] Account reauth failed.", the phone's Google
                            // account wants to be verified again) as a cancellation. That is not the person
                            // backing out, so it must use the browser, not say "cancelled".
                            // Match the word "reauth" only, never the code "[16]": 16 is Google's code for
                            // EVERY cancel, so "Don't share" on the consent sheet ("[16] Cancelled by user")
                            // was opening the browser (owner report, 2026-11-19).
                            val text = e.message.orEmpty()
                            val reauth = text.contains("reauth", ignoreCase = true)
                            reportGoogle(error = if (e is GetCredentialCancellationException && !reauth) "cancelled" else "unavailable",
                                detail = e.javaClass.simpleName + " / " + e.type + " / " + e.message)
                        }
                    })
            } catch (t: Throwable) {
                reportGoogle(error = "unavailable", detail = t.javaClass.simpleName + ": " + t.message)
            }
        }
    }

    private fun reportGoogle(idToken: String? = null, error: String? = null, detail: String? = null) {
        val json = JSONObject()
        if (idToken != null) json.put("idToken", idToken)
        if (error != null) json.put("error", error)
        if (detail != null) json.put("detail", detail.take(200))
        activity.evalJs("window.onNativeGoogleResult && window.onNativeGoogleResult(" +
            JSONObject.quote(json.toString()) + ")")
    }

    /** A failed step, with who is to blame (AdFailure): the page reports it to the server, which may
     *  give the player 20 free minutes when the ad network was at fault. */
    private fun reportProblem(p: AdProblem) = report("failed", p.text, kind = p.kind, code = p.code)

    private fun report(status: String, message: String?, guest: Boolean = false, claim: String? = null,
                       kind: String? = null, code: String? = null) {
        // "network" says which ad network this build plays, so the page can count every tap per network.
        val json = JSONObject().put("status", status).put("guest", guest).put("network", network)
        if (message != null) json.put("message", message)
        if (claim != null) json.put("claim", claim)
        if (kind != null) json.put("kind", kind)
        if (code != null) json.put("code", code)
        activity.evalJs("window.onRewardedAdResult && window.onRewardedAdResult(" +
            JSONObject.quote(json.toString()) + ")")
    }
}
