package expo.modules.kotlin.activityresult

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import expo.modules.kotlin.providers.CurrentActivityProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [35])
class ActivityResultRecreationTest {
  private class Owner : LifecycleOwner {
    val state = LifecycleRegistry(this)
    override val lifecycle: Lifecycle get() = state
  }

  @Test fun retainedLauncherWorksAfterOriginalOwnerIsDestroyed() {
    val controller = Robolectric.buildActivity(AppCompatActivity::class.java)
    controller.get().setTheme(androidx.appcompat.R.style.Theme_AppCompat)
    val activity = controller.setup().get()
    val registry = AppContextActivityResultRegistry(object : CurrentActivityProvider {
      override val currentActivity: Activity get() = activity
    })
    val owner = Owner()
    owner.state.currentState = Lifecycle.State.STARTED
    val contract = object : AppContextActivityResultContract<String, String> {
      override fun createIntent(context: Context, input: String) = Intent("axonic.test.PICK")
      override fun parseResult(input: String, resultCode: Int, intent: Intent?) = "$input:$resultCode"
    }
    var fallbackCount = 0
    val launcher = registry.register("picker", owner, contract) { _, _ -> fallbackCount++ }
    var received: String? = null
    launcher.launch("first") { received = it }
    val first = shadowOf(activity).nextStartedActivityForResult
    assertTrue(registry.dispatchResult(first.requestCode, Activity.RESULT_OK, null))
    assertEquals("first:-1", received)
    owner.state.currentState = Lifecycle.State.DESTROYED
    received = null
    // The same module and launcher survive; only their original Activity owner is gone.
    launcher.launch("second") { received = it }
    val second = shadowOf(activity).nextStartedActivityForResult
    assertTrue(registry.dispatchResult(second.requestCode, Activity.RESULT_CANCELED, null))
    assertEquals("second:0", received)
    assertEquals(0, fallbackCount)
    launcher.launch("third") { received = it }
    val third = shadowOf(activity).nextStartedActivityForResult
    assertTrue(registry.dispatchResult(third.requestCode, Activity.RESULT_OK, null))
    assertEquals("third:-1", received)
    controller.pause().stop().destroy()
  }
}
