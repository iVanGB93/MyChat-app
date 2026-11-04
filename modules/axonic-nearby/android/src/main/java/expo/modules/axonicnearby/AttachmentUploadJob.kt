package expo.modules.axonicnearby

import android.app.*

import android.app.job.*

import android.content.ComponentName

import android.content.Context

import android.os.*

import com.facebook.react.ReactApplication

import com.facebook.react.ReactInstanceEventListener

import com.facebook.react.bridge.Arguments

import com.facebook.react.bridge.ReactContext

import com.facebook.react.jstasks.HeadlessJsTaskConfig

import com.facebook.react.jstasks.HeadlessJsTaskContext

import com.facebook.react.jstasks.HeadlessJsTaskEventListener

import java.util.UUID

/** Android owns lifetime; JS owns the existing durable queue and authenticated transport. */

class AttachmentUploadJob : JobService(), HeadlessJsTaskEventListener {

  private var params: JobParameters? = null

  private var react: ReactContext? = null

  private var task: Int? = null

  private var listener: ReactInstanceEventListener? = null

  private var token = ""

  private val handler = Handler(Looper.getMainLooper())

  private val deadline = Runnable { finish("Transfer paused. Open Axonic to continue.", false) }

  override fun onStartJob(p: JobParameters): Boolean {

    if (active != null || foreground) return false

    params = p; token = UUID.randomUUID().toString(); active = this

    val n = notification(this, "Checking pending media…", -1, true)

    if (Build.VERSION.SDK_INT >= 34) setNotification(p, NOTICE, n, JOB_END_NOTIFICATION_POLICY_REMOVE)

    else getSystemService(NotificationManager::class.java).notify(NOTICE, n)

    handler.postDelayed(deadline, 20 * 60 * 1000L)

    val host = (application as ReactApplication).reactHost

    if (host == null) { finish("Open Axonic to continue sending.", false); return false }

    val start: (ReactContext) -> Unit = { context ->

      if (active === this && params === p) {

        react = context

        val tasks = HeadlessJsTaskContext.getInstance(context)

        tasks.addTaskEventListener(this)

        val data = Arguments.createMap().apply { putString("owner", p.extras.getString("owner")); putString("token", token) }

        task = tasks.startTask(HeadlessJsTaskConfig("AxonicMediaUpload", data, 0, true))

      }

    }

    val context = host.currentReactContext

    if (context != null) start(context) else {

      val ready = object : ReactInstanceEventListener {

        override fun onReactContextInitialized(context: ReactContext) {

          host.removeReactInstanceEventListener(this); listener = null

          handler.post { start(context) }

        }

      }

      listener = ready; host.addReactInstanceEventListener(ready); host.start()

    }

    return true

  }

  override fun onStopJob(p: JobParameters): Boolean {

    cleanup()

    // A user stop must never be fought by a reschedule loop.

    return p.stopReason != JobParameters.STOP_REASON_USER && p.stopReason != JobParameters.STOP_REASON_CANCELLED_BY_APP

  }

  override fun onHeadlessJsTaskStart(taskId: Int) = Unit

  override fun onHeadlessJsTaskFinish(taskId: Int) { if (task == taskId) finish("Open Axonic to check unfinished transfers.", false) }

  override fun onDestroy() { cleanup(); super.onDestroy() }

  private fun cleanup() {

    handler.removeCallbacks(deadline)

    listener?.let { (application as ReactApplication).reactHost?.removeReactInstanceEventListener(it) }; listener = null

    react?.let { HeadlessJsTaskContext.getInstance(it).removeTaskEventListener(this) }; react = null

    task = null; params = null

    if (active === this) { active = null; getSystemService(NotificationManager::class.java).cancel(NOTICE) }

  }

  private fun finish(message: String?, retry: Boolean) {

    val p = params ?: return

    cleanup(); jobFinished(p, retry)

    if (message != null && !foreground) getSystemService(NotificationManager::class.java).notify(RESULT, notification(this, message, -1, false))

  }

  companion object {

    private const val JOB = 42731

    private const val NOTICE = 42732

    private const val RESULT = 42733

    @Volatile private var active: AttachmentUploadJob? = null
    @Volatile private var foreground = true
    private var armedOwner: String? = null

    fun resume(context: Context) {
      foreground = true
      active?.finish(null, false)
      context.getSystemService(JobScheduler::class.java).cancel(JOB)
      context.getSystemService(NotificationManager::class.java).apply { cancel(NOTICE); cancel(RESULT) }
    }

    fun disarm(owner: String) { if (armedOwner == owner) armedOwner = null }

    fun pause(context: Context) {
      foreground = false
      armedOwner?.let { schedule(context, it) }
    }

    fun transportAllowed() = active != null

    fun current(token: String) = active?.token == token

    fun scheduled(context: Context, owner: String): Boolean = armedOwner == owner || active?.params?.extras?.getString("owner") == owner ||

      context.getSystemService(JobScheduler::class.java).getPendingJob(JOB)?.extras?.getString("owner") == owner

    fun schedule(context: Context, owner: String): Boolean {

      require(Regex("axonic:1:[a-f0-9]{64}").matches(owner))

      // Older Android builds keep foreground/reopen recovery; do not mislabel a deferred ordinary job as an immediate transfer.

      if (Build.VERSION.SDK_INT < 34) return false

      armedOwner = owner
      // Admission while visible only arms the handoff. The job and its required
      // notification start when the activity leaves the foreground.
      if (foreground) return true
      if (active?.params?.extras?.getString("owner") == owner || context.getSystemService(JobScheduler::class.java).getPendingJob(JOB)?.extras?.getString("owner") == owner) return true

      val extras = PersistableBundle().apply { putString("owner", owner) }

      val job = JobInfo.Builder(JOB, ComponentName(context, AttachmentUploadJob::class.java))

        .setExtras(extras).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setUserInitiated(true).build()

      return try { context.getSystemService(JobScheduler::class.java).schedule(job) == JobScheduler.RESULT_SUCCESS } catch (_: IllegalStateException) { false } catch (_: SecurityException) { false }

    }

    fun progress(token: String, count: Int, percent: Int, state: String = "sending") {

      val job = active ?: return

      val label = when (state) { "preparing" -> "Preparing media"; "sending" -> "Sending media"; else -> "Waiting for transfer confirmation or connection" }
      job.handler.post { if (current(token)) job.getSystemService(NotificationManager::class.java).notify(NOTICE,

        notification(job, "$label · $count transfer${if (count == 1) "" else "s"}", if (state == "sending") percent.coerceIn(-1, 100) else -1, true)) }

    }

    fun complete(token: String, outcome: String) {

      val job = active ?: return

      job.handler.post { if (current(token)) {
        if (outcome == "stored" || outcome == "locked") armedOwner = null
        job.finish(when(outcome) {

        "stored", "foreground", "stopped" -> null

        "locked" -> "Unlock Axonic to continue sending."

        "paused" -> "Transfer paused. Open Axonic to continue."

        else -> "Open Axonic to check unfinished transfers."

      }, false) } }

    }

    private fun notification(context: Context, text: String, percent: Int, ongoing: Boolean): Notification {

      val manager = context.getSystemService(NotificationManager::class.java)

      manager.createNotificationChannel(NotificationChannel("axonic_media_uploads", "Media transfers", NotificationManager.IMPORTANCE_LOW))

      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)

      val open = intent?.let { PendingIntent.getActivity(context, NOTICE, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }

      return Notification.Builder(context, "axonic_media_uploads").setSmallIcon(android.R.drawable.stat_sys_upload)

        .setContentTitle("Axonic media transfer").setContentText(text).setContentIntent(open).setOngoing(ongoing)

        .setOnlyAlertOnce(true).setAutoCancel(!ongoing).setTimeoutAfter(if (ongoing) 0 else 60000).setVisibility(Notification.VISIBILITY_PRIVATE)

        .apply { if (ongoing) setProgress(100, percent.coerceAtLeast(0), percent < 0) }.build()

    }

  }

}

