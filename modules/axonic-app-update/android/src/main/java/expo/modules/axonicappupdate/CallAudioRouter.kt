package expo.modules.axonicappupdate

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper

/** Only owns routing while a live Axonic call is mounted. All methods run on main. */
@Suppress("DEPRECATION")
internal class CallAudioRouter(private val context: Context, private val changed: (Map<String, Any?>) -> Unit) {
  private val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val handler = Handler(Looper.getMainLooper())
  private var previousMode: Int? = null
  private var previousSpeaker = false
  private var previousSco = false
  private var startedSco = false
  private var automatic = true
  private var video = false
  private var chosenId: String? = null
  private var initialMedia: AudioDeviceInfo? = null
  private var preserveMediaSpeaker = false
  private var listener: AudioManager.OnCommunicationDeviceChangedListener? = null
  private val callback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(devices: Array<out AudioDeviceInfo>) = devicesChanged()
    override fun onAudioDevicesRemoved(devices: Array<out AudioDeviceInfo>) = devicesChanged()
  }
  private val scoReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) { if (previousMode != null) changed(snapshot()) }
  }
  private fun kind(device: AudioDeviceInfo) = when (device.type) {
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "phone"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER -> "bluetooth"
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired"
    AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_DEVICE -> "usb"
    else -> "other"
  }
  private fun devices(): List<AudioDeviceInfo> = if (Build.VERSION.SDK_INT >= 31) manager.availableCommunicationDevices
    else manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).filter { kind(it) != "other" }
  private fun id(device: AudioDeviceInfo) = if (Build.VERSION.SDK_INT >= 31) device.id.toString() else kind(device)
  private fun external(device: AudioDeviceInfo) = kind(device) !in listOf("speaker", "phone", "other")
  private fun current(): AudioDeviceInfo? {
    val choices = devices()
    if (Build.VERSION.SDK_INT >= 31) return manager.communicationDevice
    return choices.firstOrNull { kind(it) == if (manager.isBluetoothScoOn) "bluetooth" else if (manager.isSpeakerphoneOn) "speaker" else "wired" }
      ?: choices.firstOrNull { kind(it) == "usb" } ?: choices.firstOrNull { kind(it) == "phone" }
  }
  fun snapshot(): Map<String, Any?> {
    val selected = current()
    return mapOf("automatic" to automatic, "selectedId" to selected?.let(::id), "devices" to devices().distinctBy(::id).map { device ->
      val type = kind(device)
      val label = when(type) { "speaker" -> "Speaker"; "phone" -> "Phone"; "bluetooth" -> "Bluetooth"; "wired" -> "Wired headphones"; "usb" -> "USB audio"; else -> "Audio device" }
      mapOf("id" to id(device), "kind" to type, "label" to label,
        "name" to if (external(device)) device.productName.toString() else "")
    })
  }
  private fun chooseAutomatic(): AudioDeviceInfo? {
    val choices = devices()
    val media = initialMedia
    val matched = media?.let { source -> choices.firstOrNull { it.id == source.id ||
      (external(it) && (it.address.isNotEmpty() && it.address == source.address || it.productName.toString() == source.productName.toString())) } }
    return matched?.takeIf { external(it) || preserveMediaSpeaker && kind(it) == "speaker" }
      ?: current()?.takeIf { external(it) && choices.any { candidate -> candidate.id == it.id } } ?: choices.firstOrNull(::external)
      ?: choices.firstOrNull { kind(it) == if (video || previousSpeaker) "speaker" else "phone" }
      ?: choices.firstOrNull { kind(it) == "speaker" }
  }
  private fun apply(device: AudioDeviceInfo) {
    if (Build.VERSION.SDK_INT >= 31) {
      check(manager.setCommunicationDevice(device)) { "This audio device is unavailable. Choose another output." }
    } else {
      val bluetooth = kind(device) == "bluetooth"
      manager.isSpeakerphoneOn = kind(device) == "speaker"
      if (bluetooth) {
        manager.startBluetoothSco(); startedSco = !previousSco; manager.isBluetoothScoOn = true
      } else {
        if (startedSco) { manager.stopBluetoothSco(); startedSco = false }
        manager.isBluetoothScoOn = false
      }
    }
  }
  private fun devicesChanged() {
    if (previousMode == null) return
    val available = devices()
    if (!automatic && available.none { id(it) == chosenId }) { automatic = true; chosenId = null }
    if (automatic) {
      if (initialMedia != null && available.none { it.id == initialMedia?.id || external(it) &&
        (it.address.isNotEmpty() && it.address == initialMedia?.address || it.productName == initialMedia?.productName) }) initialMedia = null
      try { chooseAutomatic()?.let(::apply) } catch (_: Exception) { /* OS keeps its available fallback. */ }
    }
    changed(snapshot())
  }
  fun start(isVideo: Boolean): Map<String, Any?> {
    if (previousMode != null) return snapshot()
    video = isVideo; automatic = true; chosenId = null
    previousSpeaker = manager.isSpeakerphoneOn; previousSco = manager.isBluetoothScoOn
    preserveMediaSpeaker = manager.isMusicActive
    // Preserve the user's media headset before changing to communication mode.
    initialMedia = if (Build.VERSION.SDK_INT >= 33) manager.getAudioDevicesForAttributes(
      AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
    ).firstOrNull { preserveMediaSpeaker || it.type !in listOf(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) } else current()?.takeIf(::external)
    previousMode = manager.mode
    manager.mode = AudioManager.MODE_IN_COMMUNICATION
    manager.registerAudioDeviceCallback(callback, handler)
    if (Build.VERSION.SDK_INT >= 31) {
      listener = AudioManager.OnCommunicationDeviceChangedListener { if (previousMode != null) changed(snapshot()) }
      manager.addOnCommunicationDeviceChangedListener(context.mainExecutor, listener!!)
    } else context.registerReceiver(scoReceiver, IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED))
    chooseAutomatic()?.let(::apply)
    return snapshot()
  }
  fun select(route: String): Map<String, Any?> {
    check(previousMode != null) { "No active call" }
    if (route == "automatic") {
      automatic = true; chosenId = null; initialMedia = null; preserveMediaSpeaker = false
      chooseAutomatic()?.let(::apply)
    } else {
      val target = devices().firstOrNull { id(it) == route } ?: error("This audio device disconnected. Choose another output.")
      apply(target); automatic = false; chosenId = route
    }
    return snapshot()
  }
  fun stop() {
    val mode = previousMode ?: return
    previousMode = null
    manager.unregisterAudioDeviceCallback(callback)
    if (Build.VERSION.SDK_INT >= 31) {
      listener?.let { manager.removeOnCommunicationDeviceChangedListener(it) }; listener = null
      manager.clearCommunicationDevice()
    } else {
      context.unregisterReceiver(scoReceiver)
      if (startedSco) manager.stopBluetoothSco()
      manager.isBluetoothScoOn = previousSco; manager.isSpeakerphoneOn = previousSpeaker
    }
    manager.mode = mode; startedSco = false; initialMedia = null; chosenId = null
  }
}
