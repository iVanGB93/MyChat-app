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
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.drawable.Icon
import android.net.Uri
import android.util.Base64
import com.facebook.react.ReactApplication
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

class MyChatForegroundService : Service() {
    private var callId: String? = null
    private var callType: String? = null
    private var actionToken: String? = null

    companion object {
        const val CHANNEL_ID = "axonic_call_channel"
        const val NOTIFICATION_ID = 1001
        const val EXTRA_CALL_TYPE = "call_type"
        const val CALL_TYPE_VIDEO = "video"
        const val EXTRA_CALL_ID = "call_id"
        const val EXTRA_CALL_AVATAR = "call_avatar"
        const val ACTION_UPDATE_AVATAR = "com.axonic.UPDATE_ONGOING_CALL_AVATAR"
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
        if (intent?.action == ACTION_UPDATE_AVATAR) {
            if (actionToken == null) {
                stopSelf(startId)
            } else if (callId != null && intent.getStringExtra(EXTRA_CALL_ID) == callId) {
                try {
                    getSystemService(NotificationManager::class.java).notify(
                        NOTIFICATION_ID, buildNotification(decodeAvatar(intent.getStringExtra(EXTRA_CALL_AVATAR)))
                    )
                } catch (_: SecurityException) {
                    // Notification permission may change during the call.
                }
            }
            return START_NOT_STICKY
        }
        callType = intent?.getStringExtra(EXTRA_CALL_TYPE)
        callId = intent?.getStringExtra(EXTRA_CALL_ID)
        actionToken = UUID.randomUUID().toString()
        var foregroundTypes = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (callType == CALL_TYPE_VIDEO) {
            foregroundTypes = foregroundTypes or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        }
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), foregroundTypes)
        } catch (error: SecurityException) {
            // Android can revoke foreground eligibility before this service starts.
            actionToken = null
            android.util.Log.w("AxonicCallService", "Call foreground service permission unavailable", error)
            stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    private fun buildNotification(avatar: Bitmap? = null): Notification {
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Axonic")
            .setContentText("Call in progress")
            .setSmallIcon(R.drawable.notification_icon)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openAppIntent(this))
            .setAutoCancel(false)
        if (avatar != null) builder.setLargeIcon(avatar)
        val token = actionToken
        var notification = builder.build()
        if (callId != null && token != null) {
            val hangUp = PendingIntent.getService(this, 0,
                Intent(this, MyChatForegroundService::class.java).apply {
                    action = ACTION_HANG_UP
                    data = Uri.parse("axonic-call://hang-up/$token")
                }, PendingIntent.FLAG_IMMUTABLE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val caller = Person.Builder().setName("Axonic").setImportant(true).apply {
                    if (avatar != null) setIcon(Icon.createWithBitmap(avatar))
                }.build()
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

        return notification
    }

    private fun decodeAvatar(encoded: String?): Bitmap? {
        // Shared contact avatars are limited to 16 KiB before base64 encoding.
        if (encoded.isNullOrEmpty() || encoded.length > 22_000) return null
        return try {
            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            if (options.outMimeType != "image/jpeg" || minOf(options.outWidth, options.outHeight) <= 0) return null
            val longestSide = maxOf(options.outWidth, options.outHeight)
            options.inSampleSize = 1
            while (longestSide / options.inSampleSize > 256) options.inSampleSize *= 2
            options.inJustDecodeBounds = false
            val source = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
            val size = minOf(source.width, source.height)
            val radius = size / 2f
            val shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
            shader.setLocalMatrix(Matrix().apply {
                setTranslate((size - source.width) / 2f, (size - source.height) / 2f)
            })
            val avatar = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { this.shader = shader }
            Canvas(avatar).drawCircle(radius, radius, radius, paint)
            avatar
        } catch (_: IllegalArgumentException) {
            null
        }
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
