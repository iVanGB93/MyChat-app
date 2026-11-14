package com.axonic

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.Build
import android.graphics.Color
import android.net.Uri
import com.facebook.react.ReactApplication
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

class MyChatForegroundService : Service() {
    private var callId: String? = null
    private var actionToken: String? = null

    companion object {
        const val CHANNEL_ID = "axonic_call_channel"
        const val NOTIFICATION_ID = 1001
        const val EXTRA_CALL_TYPE = "call_type"
        const val CALL_TYPE_VIDEO = "video"
        const val EXTRA_CALL_ID = "call_id"
        private const val ACTION_HANG_UP = "com.axonic.HANG_UP_ONGOING_CALL"

        private fun openAppIntent(context: Context): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
            }
            return PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
        }

    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_HANG_UP) {
            val id = callId
            if (id != null && actionToken != null && intent.data?.lastPathSegment == actionToken) {
                val context = (application as ReactApplication).reactHost?.currentReactContext
                context?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit("AxonicCallHangUp", id)
            } else if (actionToken == null) {
                stopSelf(startId)
            }
            return START_NOT_STICKY
        }
        val callType = intent?.getStringExtra(EXTRA_CALL_TYPE)
        callId = intent?.getStringExtra(EXTRA_CALL_ID)
        val token = UUID.randomUUID().toString()
        actionToken = token
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Axonic")
            .setContentText("Call in progress")
            .setSmallIcon(R.drawable.notification_icon)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openAppIntent(this))
            .setAutoCancel(false)
        var notification = builder.build()
        if (callId != null) {
            val hangUp = PendingIntent.getService(this, 0,
                Intent(this, MyChatForegroundService::class.java).apply {
                    action = ACTION_HANG_UP
                    data = Uri.parse("axonic-call://hang-up/$token")
                }, PendingIntent.FLAG_IMMUTABLE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val caller = Person.Builder().setName("Axonic").setImportant(true).build()
                val style = Notification.CallStyle.forOngoingCall(caller, hangUp)
                    .setDeclineButtonColorHint(Color.RED).setIsVideo(callType == CALL_TYPE_VIDEO)
                notification = Notification.Builder.recoverBuilder(this, notification)
                    .setStyle(style).setCategory(Notification.CATEGORY_CALL).setOnlyAlertOnce(true).build()
            } else {
                val label = android.text.SpannableString("Hang up").apply {
                    setSpan(android.text.style.ForegroundColorSpan(Color.RED), 0, length, 0)
                }
                notification = builder.addAction(0, label, hangUp).build()
            }
        }

        var foregroundTypes = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (callType == CALL_TYPE_VIDEO) {
            foregroundTypes = foregroundTypes or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        }

        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, foregroundTypes)
        } catch (error: SecurityException) {
            // Android can revoke foreground eligibility before this service starts.
            android.util.Log.w("AxonicCallService", "Call foreground service permission unavailable", error)
            stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Active Call",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shown only while a call is active"
            setShowBadge(false)
        }
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)
    }
}
