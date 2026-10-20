package expo.modules.axonicappupdate

import android.app.Activity
import android.content.Context
import android.media.AudioManager
import android.media.AudioDeviceInfo
import android.os.Build
import android.view.WindowInsets
import android.view.View
import android.view.ViewTreeObserver
import androidx.core.os.bundleOf
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

class AxonicAppUpdateModule : Module() {
  private val keyboardObservers = mutableMapOf<Int, Pair<View, ViewTreeObserver.OnGlobalLayoutListener>>()
  private fun stopKeyboardObserver(tag: Int) {
    keyboardObservers.remove(tag)?.let { (view, listener) ->
      if (view.viewTreeObserver.isAlive) view.viewTreeObserver.removeOnGlobalLayoutListener(listener)
    }
  }
  private var chatStorageRecovery: ChatStorageRecovery? = null
  private var flowPending = false
  private var observedUpdateManager: AppUpdateManager? = null
  private val installListener = InstallStateUpdatedListener { state ->
    sendEvent("onInstallState", bundleOf("installStatus" to state.installStatus()))
  }
  private var previousAudioMode: Int? = null
  private var previousSpeaker = false
  private val audio get() = requireNotNull(appContext.reactContext).getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var callAudioRouter: CallAudioRouter? = null

  @Suppress("DEPRECATION")
  private fun restoreCallAudio() {
    callAudioRouter?.stop()
    val previous = previousAudioMode ?: return
    if (Build.VERSION.SDK_INT >= 31) audio.clearCommunicationDevice()
    else audio.isSpeakerphoneOn = previousSpeaker
    audio.mode = previous
    previousAudioMode = null
  }
  override fun definition() = ModuleDefinition {
    Name("AxonicAppUpdate")
    Constants("chatStorageRecoveryAvailable" to ChatStorageRecovery.supported, "callScreenSharingAvailable" to true)
    AsyncFunction("checkChatStorageWrite") { owner: String, bytes: Double ->
      require(bytes.isFinite() && bytes >= 0 && bytes == bytes.toLong().toDouble())
      val context = requireNotNull(appContext.reactContext)
      val store = chatStorageRecovery ?: ChatStorageRecovery(context.getDatabasePath("RKStorage"), java.io.File(context.noBackupFilesDir, "axonic-chat-recovery-v1")).also { chatStorageRecovery = it }
      store.checkWrite(owner, bytes.toLong())
    }
    AsyncFunction("readChatStorage") { owner: String ->
      val context = requireNotNull(appContext.reactContext)
      val store = chatStorageRecovery ?: ChatStorageRecovery(context.getDatabasePath("RKStorage"), java.io.File(context.noBackupFilesDir, "axonic-chat-recovery-v1")).also { chatStorageRecovery = it }
      store.read(owner)
    }
    // Invoked only by the explicit remove-account workflow, never normal recovery.
    AsyncFunction("clearChatRecoverySnapshot") {
      val context = requireNotNull(appContext.reactContext)
      val directory = java.io.File(context.noBackupFilesDir, "axonic-chat-recovery-v1")
      check(!directory.exists() || directory.deleteRecursively()) { "Could not remove recovery snapshot" }
      chatStorageRecovery = null
    }
    AsyncFunction("getDiagnosticBuildInfo") {
      val context = requireNotNull(appContext.reactContext)
      @Suppress("DEPRECATION")
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      @Suppress("DEPRECATION")
      val versionCode = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
      mapOf("applicationId" to context.packageName, "versionName" to info.versionName,
        "versionCode" to versionCode.toString())
    }
    Events("onInstallState", "onCallAudioRoute", "onKeyboardLayout")
    AsyncFunction("watchKeyboardLayout") { tag: Int ->
      stopKeyboardObserver(tag)
      val view = appContext.findView<View>(tag)
      if (view != null && Build.VERSION.SDK_INT >= 30) {
        var previous = ""
        val listener = ViewTreeObserver.OnGlobalLayoutListener {
          val insets = view.rootWindowInsets
          val position = IntArray(2)
          view.getLocationOnScreen(position)
          val state = "${insets?.isVisible(WindowInsets.Type.ime())}:${insets?.getInsets(WindowInsets.Type.ime())?.bottom}:${position[1]}:${view.height}"
          if (state != previous) { previous = state; sendEvent("onKeyboardLayout", bundleOf("viewTag" to tag)) }
        }
        view.viewTreeObserver.addOnGlobalLayoutListener(listener)
        keyboardObservers[tag] = Pair(view, listener)
        listener.onGlobalLayout()
        true
      } else false
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("unwatchKeyboardLayout") { tag: Int -> stopKeyboardObserver(tag) }.runOnQueue(Queues.MAIN)
    AsyncFunction("startCallAudio") { video: Boolean ->
      val router = callAudioRouter ?: CallAudioRouter(requireNotNull(appContext.reactContext)) { sendEvent("onCallAudioRoute", it) }.also { callAudioRouter = it }
      router.start(video)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("getCallAudioRoutes") { callAudioRouter?.snapshot() }.runOnQueue(Queues.MAIN)
    AsyncFunction("selectCallAudioRoute") { route: String ->
      requireNotNull(callAudioRouter) { "No active call" }.select(route)
    }.runOnQueue(Queues.MAIN)
    OnStartObserving {
      appContext.reactContext?.let { context ->
        if (observedUpdateManager == null) {
          observedUpdateManager = AppUpdateManagerFactory.create(context).also { it.registerListener(installListener) }
        }
      }
    }
    OnStopObserving {
      observedUpdateManager?.unregisterListener(installListener)
      observedUpdateManager = null
    }
    // Read live IME insets, not React Native's cached keyboardDidShow frame.
    // Measure both edges on the UI thread in screen pixels, then convert once.
    AsyncFunction("getKeyboardOverlap") { viewTag: Int, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null || Build.VERSION.SDK_INT < 30) {
        promise.resolve(null)
      } else activity.runOnUiThread {
        try {
          val context = requireNotNull(appContext.reactContext)
          // React Native Modal views live in a Dialog window, outside the
          // activity decor. Resolve the React tag and read that view's insets.
          val view = appContext.findView<View>(viewTag)
            ?: activity.window.decorView.findViewById<View>(viewTag)
          val insets = view?.rootWindowInsets
          if (view == null || !view.isAttachedToWindow || insets == null) {
            promise.resolve(null)
          } else {
            val visible = insets.isVisible(WindowInsets.Type.ime())
            val imeBottom = insets.getInsets(WindowInsets.Type.ime()).bottom
            val position = IntArray(2)
            view.getLocationOnScreen(position)
            // WindowMetrics includes system/IME areas even when adjustResize
            // has already reduced the content view. Do not subtract IME twice.
            val keyboardTop = activity.windowManager.currentWindowMetrics.bounds.bottom - imeBottom
            val overlap = if (visible && imeBottom > 0)
              (position[1] + view.height - keyboardTop).coerceIn(0, view.height) else 0
            promise.resolve(mapOf("visible" to visible, "overlap" to overlap / context.resources.displayMetrics.density))
          }
        } catch (_: Exception) { promise.resolve(null) }
      }
    }
    AsyncFunction("setCallSpeaker") { enabled: Boolean ->
      val manager = audio
      if (previousAudioMode == null) {
        previousAudioMode = manager.mode
        previousSpeaker = manager.isSpeakerphoneOn
      }
      manager.mode = AudioManager.MODE_IN_COMMUNICATION
      if (Build.VERSION.SDK_INT >= 31) {
        val devices = manager.availableCommunicationDevices
        val external = devices.firstOrNull { it.type != AudioDeviceInfo.TYPE_BUILTIN_SPEAKER && it.type != AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
        val target = if (enabled) devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
          else external ?: devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
        check(target != null && manager.setCommunicationDevice(target)) { "Audio route unavailable" }
        target.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
      } else {
        @Suppress("DEPRECATION")
        manager.isSpeakerphoneOn = enabled
        manager.isSpeakerphoneOn
      }
    }
    AsyncFunction("restoreCallAudio") { restoreCallAudio() }.runOnQueue(Queues.MAIN)
    OnDestroy {
      appContext.currentActivity?.runOnUiThread { keyboardObservers.keys.toList().forEach { stopKeyboardObserver(it) } }
      observedUpdateManager?.unregisterListener(installListener)
      observedUpdateManager = null
      restoreCallAudio()
    }

    AsyncFunction("startUpdateAsync") { immediate: Boolean, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_PLAY_UPDATE_ACTIVITY", "No foreground activity", null)
        return@AsyncFunction
      }
      activity.runOnUiThread {
        if (flowPending) {
          promise.resolve("busy")
          return@runOnUiThread
        }
        flowPending = true
        val manager = AppUpdateManagerFactory.create(activity)
        manager.appUpdateInfo.addOnSuccessListener { info ->
          if (info.installStatus() == InstallStatus.DOWNLOADED) {
            flowPending = false
            promise.resolve("downloaded")
          } else if (info.updateAvailability() != UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS && (info.installStatus() == InstallStatus.DOWNLOADING || info.installStatus() == InstallStatus.PENDING)) {
            flowPending = false
            promise.resolve("accepted")
          } else {
            val type = if (immediate || info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) AppUpdateType.IMMEDIATE else AppUpdateType.FLEXIBLE
            if (!info.isUpdateTypeAllowed(type)) {
              flowPending = false
              promise.resolve("unavailable")
            } else {
              try {
                manager.startUpdateFlow(info, activity, AppUpdateOptions.newBuilder(type).build())
                  .addOnSuccessListener { result ->
                    flowPending = false
                    promise.resolve(when (result) {
                      Activity.RESULT_OK -> "accepted"
                      Activity.RESULT_CANCELED -> "cancelled"
                      else -> "failed"
                    })
                  }
                  .addOnFailureListener { error ->
                    flowPending = false
                    promise.reject("ERR_PLAY_UPDATE_START", "Could not start Google Play update", error)
                  }
              } catch (error: Exception) {
                flowPending = false
                promise.reject("ERR_PLAY_UPDATE_START", "Could not open Google Play update", error)
              }
            }
          }
        }.addOnFailureListener { error ->
          flowPending = false
          promise.reject("ERR_PLAY_UPDATE_CHECK", "Could not check Google Play", error)
        }
      }
    }

    AsyncFunction("completeUpdateAsync") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("ERR_PLAY_UPDATE_CONTEXT", "Android application context is unavailable", null)
        return@AsyncFunction
      }
      val manager = AppUpdateManagerFactory.create(context)
      manager.appUpdateInfo.addOnSuccessListener { info ->
        if (info.installStatus() != InstallStatus.DOWNLOADED) {
          promise.reject("ERR_PLAY_UPDATE_NOT_READY", "Update has not finished downloading", null)
        } else {
          manager.completeUpdate().addOnSuccessListener { promise.resolve(null) }
            .addOnFailureListener { error -> promise.reject("ERR_PLAY_UPDATE_COMPLETE", "Could not install update", error) }
        }
      }.addOnFailureListener { error -> promise.reject("ERR_PLAY_UPDATE_CHECK", "Could not check update status", error) }
    }

    AsyncFunction("getUpdateInfoAsync") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("ERR_PLAY_UPDATE_CONTEXT", "Android application context is unavailable", null)
        return@AsyncFunction
      }

      AppUpdateManagerFactory.create(context).appUpdateInfo
        .addOnSuccessListener { info ->
          val availability = when (info.updateAvailability()) {
            UpdateAvailability.UPDATE_AVAILABLE -> "available"
            UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS -> "in_progress"
            UpdateAvailability.UPDATE_NOT_AVAILABLE -> "not_available"
            else -> "unknown"
          }
          promise.resolve(mapOf(
            "availability" to availability,
            "availableVersionCode" to info.availableVersionCode(),
            "updatePriority" to info.updatePriority(),
            "stalenessDays" to info.clientVersionStalenessDays(),
            "flexibleAllowed" to info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE),
            "immediateAllowed" to info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE),
            "installStatus" to info.installStatus(),
            "bytesDownloaded" to info.bytesDownloaded(),
            "totalBytesToDownload" to info.totalBytesToDownload(),
          ))
        }
        .addOnFailureListener { error ->
          promise.reject(
            "ERR_PLAY_UPDATE_CHECK",
            "Google Play could not determine update availability",
            error,
          )
        }
    }
  }
}
