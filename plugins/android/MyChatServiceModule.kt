package com.axonic

import android.app.PictureInPictureParams
import android.content.Intent
import android.os.Build
import android.util.Rational
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class MyChatServiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        @Volatile
        var pictureInPictureEnabled = false
            private set
    }

    override fun getName() = "MyChatService"

    @ReactMethod
    fun start(callType: String, promise: Promise) {
        try {
            val intent = Intent(reactContext, MyChatForegroundService::class.java).apply {
                putExtra(MyChatForegroundService.EXTRA_CALL_TYPE, callType)
            }
            reactContext.startForegroundService(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("START_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            val intent = Intent(reactContext, MyChatForegroundService::class.java)
            reactContext.stopService(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun update(title: String, text: String, promise: Promise) {
        try {
            MyChatForegroundService.updateNotification(reactContext, title, text)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("UPDATE_ERROR", e.message, e)
        }
    }

    /**
     * Arms Android Picture-in-Picture only while React Native reports a
     * connected video call. Android 12+ uses auto-enter for a smooth Home
     * gesture; Android 8-11 is handled by MainActivity.onUserLeaveHint().
     */
    @ReactMethod
    fun setPictureInPictureEnabled(enabled: Boolean, promise: Promise) {
        pictureInPictureEnabled = enabled

        val activity = reactContext.currentActivity
        if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            promise.resolve(null)
            return
        }

        activity.runOnUiThread {
            try {
                val builder = PictureInPictureParams.Builder()
                    .setAspectRatio(Rational(9, 16))
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    builder.setAutoEnterEnabled(enabled)
                    builder.setSeamlessResizeEnabled(true)
                }
                activity.setPictureInPictureParams(builder.build())
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("PIP_ERROR", e.message, e)
            }
        }
    }
}
