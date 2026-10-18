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
    private var overlayPermission: Promise? = null
    private val overlayPermissionRequest = 7801
    private val overlayPermissionListener = object : com.facebook.react.bridge.BaseActivityEventListener() {
        override fun onActivityResult(activity: android.app.Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != overlayPermissionRequest) return
            val pending = overlayPermission ?: return
            overlayPermission = null
            pending.resolve(android.provider.Settings.canDrawOverlays(reactContext))
        }
    }
    init { reactContext.addActivityEventListener(overlayPermissionListener) }

    private var shareBar: android.widget.LinearLayout? = null
    private var shareMute: ShareControlButton? = null
    private fun windowManager() = reactContext.getSystemService(android.content.Context.WINDOW_SERVICE) as android.view.WindowManager
    private fun emitShare(action: String, fraction: Double? = null) {
        val data = com.facebook.react.bridge.Arguments.createMap().apply {
            putString("action", action)
            if (fraction != null) putDouble("fraction", fraction)
        }
        reactContext.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("AxonicShareControls", data)
    }

    @ReactMethod
    fun requestShareOverlayPermission(promise: Promise) {
        if (android.provider.Settings.canDrawOverlays(reactContext)) { promise.resolve(true); return }
        val activity = reactContext.currentActivity
        if (activity == null) { promise.reject("NO_ACTIVITY", "Open Axonic first"); return }
        activity.runOnUiThread {
            if (overlayPermission != null) { promise.reject("PERMISSION_PENDING", "Permission request already open"); return@runOnUiThread }
            overlayPermission = promise
            try {
                activity.startActivityForResult(Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:" + reactContext.packageName)), overlayPermissionRequest)
            } catch (error: Exception) {
                overlayPermission = null
                promise.reject("PERMISSION_SETTINGS", error.message, error)
            }
        }
    }

    @ReactMethod
    fun prepareShareOverlay(muted: Boolean, promise: Promise) {
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            try {
                if (!android.provider.Settings.canDrawOverlays(reactContext)) throw IllegalStateException("Allow display over other apps to use sharing controls")
                removeShareBar()
                val bar = android.widget.LinearLayout(reactContext).apply {
                    orientation = android.widget.LinearLayout.VERTICAL
                    gravity = android.view.Gravity.CENTER
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(android.graphics.Color.rgb(2,13,31))
                        cornerRadius = 24 * resources.displayMetrics.density
                        setStroke((resources.displayMetrics.density).toInt().coerceAtLeast(1), android.graphics.Color.rgb(0,178,204))
                    }
                    val padding = (6 * resources.displayMetrics.density).toInt()
                    setPadding(padding,padding,padding,padding)
                    elevation = 4 * resources.displayMetrics.density
                    visibility = android.view.View.INVISIBLE
                }
                shareBar = bar
                val grip = android.widget.TextView(reactContext).apply {
                    text = "━"; textSize = 14f
                    setTextColor(android.graphics.Color.rgb(156,196,213))
                    gravity = android.view.Gravity.CENTER
                    contentDescription = "Drag sharing controls to move them"
                }
                bar.addView(grip, android.widget.LinearLayout.LayoutParams(-1, (20 * reactContext.resources.displayMetrics.density).toInt()))
                val row = android.widget.LinearLayout(reactContext).apply { orientation = android.widget.LinearLayout.HORIZONTAL }
                bar.addView(row, android.widget.LinearLayout.LayoutParams(-1,0,1f))
                fun button(label: String, action: String): ShareControlButton {
                    val b = ShareControlButton(reactContext, action, label).apply {
                        setOnClickListener {
                            // A direct user gesture on the overlay returns to the existing call activity.
                            if (action == "stop") try {
                                reactContext.packageManager.getLaunchIntentForPackage(reactContext.packageName)?.let { intent ->
                                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                                    reactContext.startActivity(intent)
                                }
                            } catch (error: Exception) {
                                android.util.Log.w("AxonicShareControls", "Unable to restore call activity", error)
                            }
                            emitShare(action)
                        }
                    }
                    row.addView(b, android.widget.LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.MATCH_PARENT, 1f))
                    return b
                }
                shareMute = button(if (muted) "Unmute" else "Mute", "mute")
                button("Stop sharing", "stop")
                button("Hang up", "end")
                val density = reactContext.resources.displayMetrics.density
                val metrics = android.util.DisplayMetrics()
                @Suppress("DEPRECATION")
                windowManager().defaultDisplay.getRealMetrics(metrics)
                // 6dp padding + 20dp handle + 48dp controls + 6dp padding.
                val height = (80 * density).toInt()
                val params = android.view.WindowManager.LayoutParams(
                    (180 * density).toInt().coerceAtMost(metrics.widthPixels), height,
                    android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or android.view.WindowManager.LayoutParams.FLAG_SECURE,
                    android.graphics.PixelFormat.TRANSLUCENT).apply {
                        gravity = android.view.Gravity.TOP or android.view.Gravity.LEFT
                        x = (metrics.widthPixels - width) / 2
                        y = (metrics.heightPixels - height - 64 * density).toInt().coerceAtLeast(0)
                    }
                var downX = 0f; var downY = 0f; var originX = 0; var originY = 0
                grip.setOnTouchListener { _, event ->
                    when(event.actionMasked) {
                        android.view.MotionEvent.ACTION_DOWN -> { downX=event.rawX; downY=event.rawY; originX=params.x; originY=params.y; true }
                        android.view.MotionEvent.ACTION_MOVE -> {
                            @Suppress("DEPRECATION")
                            windowManager().defaultDisplay.getRealMetrics(metrics)
                            params.x = (originX+event.rawX-downX).toInt().coerceIn(0,(metrics.widthPixels-params.width).coerceAtLeast(0))
                            params.y = (originY+event.rawY-downY).toInt().coerceIn(0,(metrics.heightPixels-height-48*density).toInt().coerceAtLeast(0))
                            if (shareBar === bar) windowManager().updateViewLayout(bar,params)
                            true
                        }
                        android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> true
                        else -> false
                    }
                }
                var first = true
                bar.viewTreeObserver.addOnGlobalLayoutListener {
                    if (shareBar !== bar) return@addOnGlobalLayoutListener
                    // Share the entire display; Android protects only the movable panel's pixels.
                    if (first && bar.width > 0) { first = false; promise.resolve(0.0) }
                }
                windowManager().addView(bar, params)
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    if (first) {
                        first = false
                        if (shareBar === bar) removeShareBar()
                        promise.reject("OVERLAY_LAYOUT", "Sharing controls could not be positioned")
                    }
                }, 3000)
            } catch (error: Exception) { removeShareBar(); promise.reject("OVERLAY_ERROR", error.message, error) }
        }
    }

    @ReactMethod
    fun showShareOverlay(muted: Boolean) {
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            shareMute?.setMuted(muted)
            shareBar?.visibility = android.view.View.VISIBLE
        }
    }

    private fun removeShareBar() {
        // Also used on React teardown; an overlay must never outlive the call UI.
        shareBar?.let { try { windowManager().removeViewImmediate(it) } catch (_: Exception) {} }
        shareBar = null; shareMute = null
    }
    @ReactMethod
    fun updateShareOverlayMute(muted: Boolean) {
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            shareMute?.setMuted(muted)
        }
    }
    @ReactMethod
    fun hideShareOverlay() { android.os.Handler(android.os.Looper.getMainLooper()).post { removeShareBar() } }

    override fun invalidate() {
        reactContext.removeActivityEventListener(overlayPermissionListener)
        overlayPermission?.reject("CANCELLED", "Call interface closed")
        overlayPermission = null
        hideShareOverlay()
        super.invalidate()
    }

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

/** Native equivalents of Axonic's circular call actions; no platform button chrome. */
private class ShareControlButton(context: android.content.Context, private val action: String, label: String) : android.widget.LinearLayout(context) {
    private var muted = label == "Unmute"
    private val icon = object : android.view.View(context) {
        override fun onDraw(canvas: android.graphics.Canvas) {
            super.onDraw(canvas)
            canvas.save(); canvas.scale(width/48f,height/48f)
            val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
            val cyan = android.graphics.Color.rgb(0,229,255)
            p.color = if(action=="end") android.graphics.Color.rgb(255,59,107) else android.graphics.Color.rgb(0,40,52)
            canvas.drawCircle(24f,24f,22f,p)
            p.style=android.graphics.Paint.Style.STROKE; p.strokeWidth=1f; p.color=cyan
            if(action!="end")canvas.drawCircle(24f,24f,22f,p)
            p.color=android.graphics.Color.WHITE;p.strokeWidth=2f;p.strokeCap=android.graphics.Paint.Cap.ROUND
            when(action){
                "mute" -> {
                    canvas.drawRoundRect(20f,12f,28f,28f,4f,4f,p)
                    canvas.drawArc(16f,17f,32f,33f,0f,180f,false,p)
                    canvas.drawLine(24f,33f,24f,37f,p);canvas.drawLine(20f,37f,28f,37f,p)
                    if(muted)canvas.drawLine(13f,12f,35f,36f,p)
                }
                "stop" -> {canvas.drawCircle(24f,24f,12f,p);p.style=android.graphics.Paint.Style.FILL;canvas.drawRoundRect(19f,19f,29f,29f,2f,2f,p)}
                else -> {canvas.drawArc(12f,20f,36f,36f,205f,130f,false,p);p.strokeWidth=5f;canvas.drawLine(13f,25f,13f,29f,p);canvas.drawLine(35f,25f,35f,29f,p)}
            }
            canvas.restore()
        }
    }
    init {
        orientation=VERTICAL;gravity=android.view.Gravity.CENTER;isClickable=true;isFocusable=true
        val size=(48*resources.displayMetrics.density).toInt()
        addView(icon,LayoutParams(size,size))
        contentDescription=label
        tooltipText=label
    }
    override fun getAccessibilityClassName(): CharSequence = "android.widget.Button"
    fun setMuted(value:Boolean){muted=value;contentDescription=if(value)"Unmute" else "Mute";tooltipText=contentDescription;icon.invalidate()}
}
