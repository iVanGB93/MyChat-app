package com.axonic

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.util.UUID

/** Private entry point for Notifee's incoming-call pending intents. */
class CallNotificationActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val data = intent.getBundleExtra("notification")?.getBundle("data")
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
}

internal class IncomingCallWindow(private val activity: Activity) {
  private val handler = Handler(Looper.getMainLooper())
  private var callId: String? = null
  private val expire = Runnable { clear() }

  fun apply(intent: Intent?) {
    clear()
    val token = intent?.getStringExtra(TOKEN) ?: return
    intent.removeExtra(TOKEN)
    val grant = pending?.takeIf { it.token == token } ?: return
    pending = null
    val remaining = grant.deadline - SystemClock.elapsedRealtime()
    if (remaining <= 0L || Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) return
    callId = grant.callId
    activity.setShowWhenLocked(true)
    activity.setTurnScreenOn(true)
    handler.postDelayed(expire, remaining)
  }

  fun clear(expectedCallId: String? = null) {
    if (callId == null || (expectedCallId != null && callId != expectedCallId)) return
    callId = null
    handler.removeCallbacks(expire)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(false)
      activity.setTurnScreenOn(false)
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
