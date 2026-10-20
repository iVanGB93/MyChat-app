package expo.modules.axonicnearby

import android.app.Notification
import android.app.NotificationManager
import android.app.Person
import android.content.Context
import android.os.Build

/** Retain Notifee identity/actions/cancellation while using Android's call template. */
internal object NotificationCallStyle {
  fun install(context: Context, id: String, name: String, video: Boolean): Boolean {
    require(id.matches(Regex("root-call:[a-f0-9]{64}")))
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val notice = manager.activeNotifications.firstOrNull {
      it.notification.extras.getBundle("notifee.notification")?.getString("id") == id
    } ?: return false
    val original = notice.notification
    val actions = original.actions ?: return false
    if (actions.size != 2) return false
    val caller = Person.Builder().setName(name.take(80).ifBlank { "Unknown caller" }).setImportant(true).build()
    val style = Notification.CallStyle.forIncomingCall(caller, actions[0].actionIntent, actions[1].actionIntent).setIsVideo(video)
    val updated = Notification.Builder.recoverBuilder(context, original)
      .setActions().setStyle(style).setCategory(Notification.CATEGORY_CALL).setOnlyAlertOnce(true).build()
    manager.notify(notice.tag, notice.id, updated)
    return true
  }
}
