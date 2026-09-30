package com.gamepad.client

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject

/** Owns one timer independently of the WebView and stores no personal identifier. */
internal class GuestTrial(context: Context, private val onExpired: () -> Unit) {
    private val prefs = context.getSharedPreferences("guest-trial-v1", Context.MODE_PRIVATE)
    private val handler = Handler(Looper.getMainLooper())
    private val quota = GuestQuota(
        prefs.getLong("usedMs", 0), prefs.getLong("resetsAt", 0),
        prefs.getString("zone", null) ?: java.util.TimeZone.getDefault().id,
        prefs.getLong("lastWall", 0),
        prefs.getLong("bankMs", 0),
    )
    private val ticker = object : Runnable {
        override fun run() {
            val expired = synchronized(this@GuestTrial) {
                advance()
                if (!quota.active) return
                if (quota.remainingMs() == 0L) {
                    quota.setActive(false, System.currentTimeMillis(), SystemClock.elapsedRealtime())
                    true
                } else {
                    handler.postDelayed(this, minOf(1000L, quota.remainingMs()))
                    false
                }
            }
            if (expired) onExpired()
        }
    }

    private fun advance() {
        quota.advance(System.currentTimeMillis(), SystemClock.elapsedRealtime())
        prefs.edit().putLong("usedMs", quota.usedMs).putLong("resetsAt", quota.resetsAt)
            .putLong("lastWall", quota.lastWall).putString("zone", quota.zoneId)
            .putLong("bankMs", quota.bankMs).apply()
    }

    @Synchronized fun setActive(on: Boolean): String {
        handler.removeCallbacks(ticker)
        quota.setActive(on, System.currentTimeMillis(), SystemClock.elapsedRealtime())
        if (quota.active) handler.postDelayed(ticker, minOf(1000L, quota.remainingMs()))
        return snapshot()
    }

    @Synchronized fun snapshot(): String {
        advance()
        return JSONObject().put("remainingSeconds", quota.remainingMs() / 1000.0)
            .put("freeRemainingSeconds", quota.freeRemainingMs() / 1000.0)
            .put("bankSeconds", quota.bankMs / 1000.0)
            .put("limitSeconds", GuestQuota.LIMIT_MS / 1000)
            .put("resetsAt", quota.resetsAt).toString()
    }

    @Synchronized fun exhausted(): Boolean { advance(); return quota.remainingMs() == 0L }

    /** A rewarded ad finished while signed out (AdsBridge): bank [AD_REWARD_MS]. Signed-in players are
     *  credited by the server instead, from Google's signed callback, never from here. */
    @Synchronized fun creditAd(): String {
        advance()
        quota.credit(AD_REWARD_MS)
        prefs.edit().putLong("bankMs", quota.bankMs).apply()
        return snapshot()
    }

    companion object { const val AD_REWARD_MS = 30 * 60 * 1000L }
}
