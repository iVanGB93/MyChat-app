package expo.modules.axonicnearby

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle

/** Notifee's Android 12 action activity collapses the shade even without launchActivity.
 * Route only Mark as read to its existing headless service and leave receipt handling in JS. */
internal object NotificationReadAction {
  fun install(context: Context, id: String): Boolean {
    require(id.startsWith("root-conversation:"))
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val notice = manager.activeNotifications.firstOrNull {
      it.notification.extras.getBundle("notifee.notification")?.getString("id") == id
    } ?: return false
    val original = notice.notification
    val packet = Bundle(original.extras.getBundle("notifee.notification") ?: return false)
    val options = Bundle(packet.getBundle("android") ?: return false)
    // Cancellation belongs to the existing JS handler, which protects newer arrivals.
    options.putBoolean("autoCancel", false)
    packet.putBundle("android", options)
    val configured = options.getParcelableArrayList<Bundle>("actions") ?: return false
    val index = configured.indexOfFirst { it.getBundle("pressAction")?.getString("id") == "root-mark-read" }
    val actions = original.actions ?: return false
    if (index !in actions.indices) return false
    val press = Bundle().apply { putString("id", "root-mark-read") }
    val intent = Intent("app.notifee.core.ReceiverService.ACTION_PRESS_INTENT").apply {
      setClassName(context, "app.notifee.core.ReceiverService")
      // Different conversations have independent pending intents; an update refreshes its snapshot.
      data = android.net.Uri.parse("axonic-notification://mark-read/" + android.net.Uri.encode(id))
      putExtra("notification", packet)
      putExtra("pressAction", press)
    }
    val pending = PendingIntent.getService(context, 0, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val old = actions[index]
    val actionExtras = Bundle(old.extras).apply {
      putBoolean("android.support.action.showsUserInterface", false)
    }
    actions[index] = Notification.Action.Builder(old.getIcon(), old.title, pending)
      .addExtras(actionExtras)
      .setSemanticAction(Notification.Action.SEMANTIC_ACTION_MARK_AS_READ).build()
    val updated = Notification.Builder.recoverBuilder(context, original)
      .setActions(*actions).setOnlyAlertOnce(true).build()
    manager.notify(notice.tag, notice.id, updated)
    return true
  }
}
