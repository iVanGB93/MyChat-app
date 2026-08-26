package expo.modules.axonicappupdate

import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AxonicAppUpdateModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AxonicAppUpdate")

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
