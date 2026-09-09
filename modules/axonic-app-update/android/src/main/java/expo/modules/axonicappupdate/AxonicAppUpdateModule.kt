package expo.modules.axonicappupdate

import android.app.Activity
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AxonicAppUpdateModule : Module() {
  private var flowPending = false
  override fun definition() = ModuleDefinition {
    Name("AxonicAppUpdate")

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
