package com.axonic

import android.app.Activity
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import java.util.UUID

/** Private entry point for Notifee's incoming-call pending intents. */
class CallNotificationActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val data = intent.getBundleExtra("notification")?.getBundle("data") ?: activeIncomingCallData()
    val callId = data?.getString("callId")
    val expiresAt = data?.getString("expiresAt")?.toLongOrNull() ?: 0L
    val remaining = (expiresAt - System.currentTimeMillis()).coerceAtMost(60_000L)
    if (data?.getString("type") == "root_neuron_call" &&
      callId != null && callId.matches(Regex("[a-f0-9]{64}")) && remaining > 0L) {
      val mainIntent = Intent(this, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        .putExtras(intent)
      IncomingCallWindow.authorize(mainIntent, callId, remaining)
      startActivity(mainIntent)
    }
    finish()
  }

  // Notifee's full-screen activity intent can contain only the component.
  // On that path use the app's one unexpired incoming notification as authority.
  // A stale or ambiguous notification must never grant a lock-screen window.
  private fun activeIncomingCallData(): Bundle? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) return null
    val manager = getSystemService(NotificationManager::class.java) ?: return null
    val now = System.currentTimeMillis()
    return manager.activeNotifications.mapNotNull { entry ->
      val notice = entry.notification
      if (notice.category != Notification.CATEGORY_CALL || notice.channelId != "incoming-calls-v2") return@mapNotNull null
      val model = notice.extras.getBundle("notifee.notification") ?: return@mapNotNull null
      val data = model.getBundle("data") ?: return@mapNotNull null
      val callId = data.getString("callId") ?: return@mapNotNull null
      val expiresAt = data.getString("expiresAt")?.toLongOrNull() ?: return@mapNotNull null
      if (data.getString("type") != "root_neuron_call" || model.getString("id") != "root-call:$callId" || expiresAt <= now) return@mapNotNull null
      data
    }.singleOrNull()
  }
}

internal class IncomingCallWindow(private val activity: Activity) {
  private val handler = Handler(Looper.getMainLooper())
  private var callId: String? = null
  private var connected = false
  private var privacyCover: View? = null
  private var contentVisibility = View.VISIBLE
  private val expire = Runnable { clear() }

  fun apply(intent: Intent?) {
    val token = intent?.getStringExtra(TOKEN) ?: return
    intent.removeExtra(TOKEN)
    val grant = pending?.takeIf { it.token == token } ?: return
    pending = null
    val remaining = grant.deadline - SystemClock.elapsedRealtime()
    if (remaining <= 0L || Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1 || !keyguardLocked()) return
    if (grant.callId == callId) return
    clear()
    // Call modals use a separate window. Mask the conversation UI underneath
    // before showing the activity over keyguard, including between modals.
    if (privacyCover == null) {
      val decor = activity.window.decorView as? FrameLayout ?: return
      val content = activity.findViewById<View>(android.R.id.content) ?: return
      contentVisibility = content.visibility
      content.visibility = View.INVISIBLE
      val cover = View(activity).apply { setBackgroundColor(Color.BLACK); isClickable = true }
      decor.addView(cover, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      privacyCover = cover
    }
    callId = grant.callId
    activity.setShowWhenLocked(true)
    activity.setTurnScreenOn(true)
    handler.postDelayed(expire, remaining)
  }

  private fun keyguardLocked(): Boolean = activity.getSystemService(KeyguardManager::class.java)?.let {
    it.isKeyguardLocked || it.isDeviceLocked
  } == true

  fun onWindowFocusChanged(hasFocus: Boolean) {
    if (hasFocus && !keyguardLocked()) clear()
  }

  fun markConnected(expectedCallId: String) {
    if (callId != expectedCallId || connected) return
    connected = true
    handler.removeCallbacks(expire)
  }

  fun clear(expectedCallId: String? = null) {
    if (expectedCallId != null && callId != expectedCallId) return
    if (callId != null) {
      callId = null
      connected = false
      handler.removeCallbacks(expire)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        activity.setShowWhenLocked(false)
        activity.setTurnScreenOn(false)
      }
    }
    // The activity may still be visible while Android reapplies keyguard.
    if (!keyguardLocked()) privacyCover?.let { cover ->
      (cover.parent as? ViewGroup)?.removeView(cover)
      privacyCover = null
      activity.findViewById<View>(android.R.id.content)?.visibility = contentVisibility
    }
  }

  companion object {
    private const val TOKEN = "com.axonic.incomingCallWindowToken"
    private data class Grant(val token: String, val callId: String, val deadline: Long)
    private var pending: Grant? = null

    // Both activities run on the main thread. An external launch of exported
    // MainActivity cannot grant itself lock-screen access using intent extras.
    fun authorize(intent: Intent, callId: String, remaining: Long) {
      val token = UUID.randomUUID().toString()
      pending = Grant(token, callId, SystemClock.elapsedRealtime() + remaining)
      intent.putExtra(TOKEN, token)
    }
  }
}
