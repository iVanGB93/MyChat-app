package expo.modules.axonicnearby

import android.app.job.*
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.*
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import java.util.UUID

/** One-shot FCM work. Android owns process lifetime; the existing JS path verifies every wake. */
class MessageRecoveryJob : JobService() {
  private var parameters: JobParameters? = null
  private var react: ReactContext? = null
  private var listener: ReactInstanceEventListener? = null
  private val running = java.util.concurrent.ConcurrentHashMap<String, JobWorkItem>()
  private val handler = Handler(Looper.getMainLooper())
  private val deadline = Runnable { finish(false) }

  override fun onStartJob(p: JobParameters): Boolean {
    parameters = p; active = this
    Log.i("AxonicMessageJob", "started expedited=${Build.VERSION.SDK_INT >= 31 && p.isExpeditedJob}")
    handler.postDelayed(deadline, 180000)
    val host = (application as ReactApplication).reactHost
    if (host == null) { finish(true); return false }
    val context = host.currentReactContext
    if (context != null) { react = context; drain() }
    else {
      val ready = object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          host.removeReactInstanceEventListener(this)
          handler.post { listener = null; if (parameters === p) { react = context; drain() } }
        }
      }
      listener = ready; host.addReactInstanceEventListener(ready); host.start()
    }
    return true
  }

  private fun drain() {
    val p = parameters ?: return
    val context = react ?: return
    while (running.size < 4) {
      val work = p.dequeueWork() ?: break
      val raw = work.intent.getStringExtra("message")
      if (raw == null) { p.completeWork(work); continue }
      val token = UUID.randomUUID().toString()
      running[token] = work
      val data = Arguments.createMap().apply {
        putString("token", token); putString("message", raw)
        putDouble("queuedAt", work.intent.getLongExtra("queuedAt", 0).toDouble())
      }
      try {
        com.facebook.react.jstasks.HeadlessJsTaskContext.getInstance(context)
          .startTask(HeadlessJsTaskConfig("AxonicMessageRecovery", data, 0, true))
      } catch (e: Exception) { finish(true); return }
    }
    if (running.isEmpty()) finish(false)
  }

  private fun cleanup() {
    handler.removeCallbacks(deadline)
    listener?.let { (application as ReactApplication).reactHost?.removeReactInstanceEventListener(it) }
    listener = null; react = null; parameters = null; running.clear()
    if (active === this) active = null
  }
  private fun finish(retry: Boolean) { val p = parameters ?: return; cleanup(); jobFinished(p, retry) }
  override fun onStopJob(p: JobParameters): Boolean {
    cleanup()
    return p.stopReason != JobParameters.STOP_REASON_USER && p.stopReason != JobParameters.STOP_REASON_CANCELLED_BY_APP
  }
  override fun onDestroy() { cleanup(); super.onDestroy() }

  companion object {
    private const val JOB = 42734
    @Volatile private var active: MessageRecoveryJob? = null
    fun transportAllowed() = active != null
    fun current(token: String): Boolean = active?.running?.containsKey(token) == true
    fun complete(token: String) {
      val job = active ?: return
      job.handler.post {
        val work = job.running.remove(token) ?: return@post
        job.parameters?.completeWork(work); job.drain()
      }
    }
    fun enqueue(context: Context, raw: String, highPriority: Boolean): Boolean {
      if (Build.VERSION.SDK_INT < 31) return false
      if (raw.toByteArray(Charsets.UTF_8).size > 16384) return false
      val scheduler = context.getSystemService(JobScheduler::class.java)
      val builder = JobInfo.Builder(JOB, ComponentName(context, MessageRecoveryJob::class.java))
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
      // Do not replace/change an existing job while adding another event.
      val existing = scheduler.getPendingJob(JOB)
      if (Build.VERSION.SDK_INT >= 31 && highPriority) builder.setExpedited(true)
      val work = JobWorkItem(Intent().putExtra("message", raw).putExtra("queuedAt", System.currentTimeMillis()))
      return try {
        val accepted = scheduler.enqueue(existing ?: builder.build(), work) == JobScheduler.RESULT_SUCCESS
        // Android need not call onStartJob again for work added to an active job.
        // Drain on this event instead of waiting for an older recovery to finish.
        if (accepted) active?.let { job -> job.handler.post { job.drain() } }
        accepted
      }
      catch (_: IllegalStateException) { false } catch (_: SecurityException) { false }
    }
  }
}
