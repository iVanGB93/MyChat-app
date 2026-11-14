package expo.modules.axonicnearby

import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import org.json.JSONObject

/** Stores routing identifiers only, in credential-protected app storage. */
internal object MessageNoticeRestore {
  private fun store(context: Context) = context.getSharedPreferences("axonic-message-notices-v1", Context.MODE_PRIVATE)
  private fun boot(context: Context) = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)

  @Synchronized
  fun remember(context: Context, packet: Bundle, channel: String?): PendingIntent? {
    val data = packet.getBundle("data") ?: return null
    val id = packet.getString("id") ?: return null
    val messageId = data.getString("messageId") ?: return null
    val account = data.getString("account") ?: return null
    val sender = data.getString("sender") ?: return null
    val group = data.getString("group")
    val originalChannel = data.getString("restoreChannel") ?: channel ?: return null
    val boot = boot(context)
    if (boot < 0 || data.getString("type") != "root_neuron_message" || !id.startsWith("root-conversation:") ||
      id.length > 180 || !messageId.matches(Regex("[a-f0-9]{64}")) || originalChannel.length > 100 ||
      !account.matches(Regex("axonic:1:[a-f0-9]{64}")) || !sender.matches(Regex("axonic:1:[a-f0-9]{64}")) ||
      (group != null && !group.matches(Regex("[a-f0-9]{64}")))) return null
    val prefs = store(context)
    val entry = JSONObject().put("id", id).put("messageId", messageId).put("account", account)
      .put("sender", sender).put("channel", originalChannel).put("boot", boot).put("savedAt", System.currentTimeMillis())
    if (group != null) entry.put("group", group)
    val edit = prefs.edit()
    if (!prefs.contains(id) && prefs.all.size >= 100) {
      prefs.all.minByOrNull { (_, raw) -> runCatching { JSONObject(raw as String).getLong("savedAt") }.getOrDefault(0) }
        ?.let { edit.remove(it.key) }
    }
    if (!edit.putString(id, entry.toString()).commit()) return null
    val intent = Intent(context, MessageNoticeReceiver::class.java).apply {
      action = "expo.modules.axonicnearby.DISMISS_MESSAGE_NOTICE"
      this.data = Uri.Builder().scheme("axonic-notice").authority("dismiss").appendPath(id).appendPath(messageId).build()
      putExtra("id", id)
      putExtra("messageId", messageId)
    }
    return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE)
  }

  @Synchronized
  fun forget(context: Context, id: String, messageId: String?) {
    val prefs = store(context)
    val raw = prefs.getString(id, null) ?: return
    if (messageId == null || runCatching { JSONObject(raw).getString("messageId") }.getOrNull() == messageId) {
      prefs.edit().remove(id).commit()
    }
  }

  @Synchronized
  fun forgetAccount(context: Context, account: String) {
    val prefs = store(context)
    val keys = prefs.all.keys.filter { it.startsWith("root-conversation:$account:") }
    if (keys.isEmpty()) return
    val edit = prefs.edit()
    keys.forEach { edit.remove(it) }
    check(edit.commit()) { "Could not clear message notice restoration state" }
  }

  @Synchronized
  fun pending(context: Context): List<String> {
    val boot = boot(context)
    if (boot < 0) return emptyList()
    return store(context).all.values.mapNotNull { raw ->
      val value = raw as? String ?: return@mapNotNull null
      value.takeIf { runCatching { JSONObject(it).getInt("boot") in 0 until boot }.getOrDefault(false) }
    }
  }
}

class MessageNoticeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
      if (MessageNoticeRestore.pending(context).isEmpty()) return
      context.getSystemService(JobScheduler::class.java).schedule(
        JobInfo.Builder(42910, ComponentName(context, MessageNoticeRestoreJob::class.java)).setOverrideDeadline(0).build(),
      )
    } else if (intent.action == "expo.modules.axonicnearby.DISMISS_MESSAGE_NOTICE") {
      val id = intent.getStringExtra("id") ?: return
      val messageId = intent.getStringExtra("messageId") ?: return
      MessageNoticeRestore.forget(context, id, messageId)
    }
  }
}

class MessageNoticeRestoreJob : JobService() {
  private val handler = Handler(Looper.getMainLooper())
  private var parameters: JobParameters? = null
  private var listener: ReactInstanceEventListener? = null
  private val deadline = Runnable { finish() }

  override fun onStartJob(p: JobParameters): Boolean {
    val host = (application as ReactApplication).reactHost ?: return false
    parameters = p
    active = this
    handler.postDelayed(deadline, 60_000)
    val context = host.currentReactContext
    if (context != null) launch(context)
    else {
      val ready = object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          host.removeReactInstanceEventListener(this)
          handler.post { if (parameters === p) launch(context) }
        }
      }
      listener = ready
      host.addReactInstanceEventListener(ready)
      host.start()
    }
    return true
  }

  private fun launch(context: ReactContext) {
    try {
      HeadlessJsTaskContext.getInstance(context).startTask(
        HeadlessJsTaskConfig("AxonicRestoreMessageNotices", Arguments.createMap(), 60_000, true),
      )
    } catch (_: Exception) { handler.post { finish() } }
  }

  private fun cleanup() {
    handler.removeCallbacks(deadline)
    listener?.let { (application as ReactApplication).reactHost?.removeReactInstanceEventListener(it) }
    listener = null
    parameters = null
    if (active === this) active = null
  }

  private fun finish() {
    val p = parameters ?: return
    cleanup()
    jobFinished(p, false)
  }

  override fun onStopJob(p: JobParameters): Boolean { cleanup(); return false }
  override fun onDestroy() { cleanup(); super.onDestroy() }

  companion object {
    @Volatile private var active: MessageNoticeRestoreJob? = null
    fun complete() { active?.let { job -> job.handler.post { job.finish() } } }
  }
}
