package com.gamepad.camos

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * "Camera foreground service" (plan section 6, item 5): while CamOS streams, this keeps a notification up so Android
 * lets the camera keep working with the screen off or another app in front. Without it Android takes the camera
 * away the moment CamOS leaves the screen and the PC picture freezes.
 *
 * It does no work itself: the stream lives in CamStreamer. It is started when the user presses Start camera (Android
 * only allows a camera service to start while the app is on screen) and stopped when the stream ends. The
 * notification's Stop button ends the stream.
 */
class CamService : Service() {
    companion object {
        private const val CHANNEL = "camos_streaming"
        private const val NOTE_ID = 7780
        private const val ACTION_STOP = "com.gamepad.camos.STOP"

        /** Set by MainActivity: what the notification's Stop button does. */
        @Volatile var onStopPressed: (() -> Unit)? = null

        fun start(ctx: Context) {
            try { ContextCompat.startForegroundService(ctx, Intent(ctx, CamService::class.java)) } catch (_: Exception) {}
        }

        fun stop(ctx: Context) {
            try { ctx.stopService(Intent(ctx, CamService::class.java)) } catch (_: Exception) {}
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            onStopPressed?.invoke()
            stopSelf()
            return START_NOT_STICKY
        }
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Streaming to your PC", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while CamOS is your PC's camera"
                setShowBadge(false)
            })
        }
        val open = PendingIntent.getActivity(this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, CamService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val note = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_camos)
            .setContentTitle("CamOS is your PC's camera")
            .setContentText("Streaming now. Tap to open CamOS.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .build()
        try {
            if (Build.VERSION.SDK_INT >= 30) startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
            else startForeground(NOTE_ID, note)
        } catch (_: Exception) {
            stopSelf()   // Android refused (e.g. started from the background): streaming still works while on screen
        }
        return START_NOT_STICKY
    }
}
