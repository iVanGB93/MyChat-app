package expo.modules.axonicnearby

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Authenticated axon transports, attachment hashing and local identity key derivation.
 * LAN TXT identity is a claim, not authentication. */
class AxonicNearbyModule : Module() {
  private val axons = AxonSockets()
  private val attachmentWorkers = ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(1))
  private var axonLan: AxonLan? = null
  private val foregroundGate = AxonForegroundGate()
  private var backgroundClose: java.util.concurrent.ScheduledFuture<*>? = null
  private var wakeUntil = 0L
  private val wakeTimer = Executors.newSingleThreadScheduledExecutor()
  private fun transportAllowed() = foregroundGate.allowed(SystemClock.elapsedRealtime()) || protectedCall() || SystemClock.elapsedRealtime() < wakeUntil
  private var connectedCall = false
  private fun protectedCall(): Boolean {
    if (!connectedCall) return false
    val context = appContext.reactContext ?: return false
    val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    @Suppress("DEPRECATION")
    return manager.getRunningServices(Int.MAX_VALUE).any {
      it.service.packageName == context.packageName &&
        it.service.className.endsWith(".MyChatForegroundService") && it.foreground
    }
  }
  private fun closeBackgroundAxons() {
    axonLan?.stop(); axonLan = null; axons.closeAll()
  }
  private val axonWorkers = ThreadPoolExecutor(0, 20, 30L, TimeUnit.SECONDS, java.util.concurrent.SynchronousQueue<Runnable>())
  private fun axonWork(promise: Promise, work: () -> Any?) {
    try { axonWorkers.execute {
      try { promise.resolve(work()) } catch (error: Exception) { promise.reject("AXON_TRANSPORT", "Axon transport unavailable", error) }
    } } catch (error: Exception) { promise.reject("AXON_CAPACITY", "Axon transport busy", error) }
  }
  override fun definition() = ModuleDefinition {
    Name("AxonicNearby")
    AsyncFunction("notificationReadActionInShade") { id: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("App context unavailable")
      NotificationReadAction.install(context, id)
    }
    // Unlike JS timers, this bounded wake timer does not depend on display frames.
    AsyncFunction("axonMessageWait") { milliseconds: Int, promise: Promise ->
      require(milliseconds in 1..1000)
      wakeTimer.schedule({ promise.resolve(null) }, milliseconds.toLong(), TimeUnit.MILLISECONDS)
    }
    // A verified FCM wake grants a bounded window for authenticated encrypted inbox recovery.
    Function("axonMessageWake") { milliseconds: Int -> synchronized(this@AxonicNearbyModule) {
      require(milliseconds in 0..30000)
      wakeUntil = if (milliseconds == 0) 0L else SystemClock.elapsedRealtime() + milliseconds
      if (milliseconds == 0) { if (!transportAllowed()) closeBackgroundAxons() }
      else wakeTimer.schedule({ synchronized(this@AxonicNearbyModule) {
        if (!transportAllowed()) closeBackgroundAxons()
      } }, milliseconds.toLong(), TimeUnit.MILLISECONDS)
      Unit
    } }

    Function("axonConnectedCall") { enabled: Boolean -> synchronized(this@AxonicNearbyModule) {
      connectedCall = enabled
      if (!transportAllowed()) closeBackgroundAxons()
    } }
    AsyncFunction("axonLanStart") { account: String -> synchronized(this@AxonicNearbyModule) {
      val context = requireNotNull(appContext.reactContext)
      check(transportAllowed()) { "Axon transport requires an active app" }
      axonLan?.stop(); axonLan = null; axons.closeLan()
      val next = AxonLan(context, account, axons)
      axonLan = next
      try { next.start() } catch (error: Exception) { next.stop(); axonLan = null; throw error }
    } }
    Function("axonLanStop") { synchronized(this@AxonicNearbyModule) { axonLan?.stop(); axonLan = null; axons.closeLan() } }
    Function("axonLanSnapshot") { synchronized(this@AxonicNearbyModule) {
      axonLan?.snapshot() ?: mapOf("active" to false, "peers" to emptyList<Map<String, Any>>())
    } }
    AsyncFunction("axonAccept") { promise: Promise ->
      val own = synchronized(this@AxonicNearbyModule) { axonLan }
      axonWork(promise) { own?.accept() }
    }
    Function("axonClaim") { id: String -> axons.claim(id) }
    Function("axonEnableMediaLane") { id: String -> axons.enableMediaLane(id) }
    Function("axonEnableBulkAttachments") { id: String -> axons.enableBulkAttachments(id) }
    Function("axonEnableAttachments") { id: String -> axons.enableAttachments(id) }
    // Experimental identity frames only. Restrict dialing to the current Wi-Fi subnet.
    AsyncFunction("axonConnect") { host: String, port: Int, promise: Promise ->
      val socket = Socket()
      try {
        val address: InetAddress
        val id: String
        synchronized(this@AxonicNearbyModule) {
          val context = requireNotNull(appContext.reactContext)
          check(transportAllowed()) { "Axon transport requires an active app" }
          require(port in 1..65535 && host.matches(Regex("[0-9]{1,3}(\\.[0-9]{1,3}){3}")))
          val parts = host.split('.').map { it.toInt() }
          require(parts.all { it in 0..255 } && parts.joinToString(".") == host)
          require(parts[0] == 10 || (parts[0] == 172 && parts[1] in 16..31) || (parts[0] == 192 && parts[1] == 168))
          address = InetAddress.getByAddress(parts.map { it.toByte() }.toByteArray())
          val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
          val wifi = cm.allNetworks.firstOrNull { n ->
            cm.getNetworkCapabilities(n)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true &&
              cm.getLinkProperties(n)?.linkAddresses?.any { link ->
                val own = link.address.address
                own.size == 4 && link.prefixLength in 1..32 && (0 until link.prefixLength).all { bit ->
                  val mask = 1 shl (7 - bit % 8)
                  (own[bit / 8].toInt() and mask) == (parts[bit / 8] and mask)
                }
              } == true
          } ?: error("No matching Wi-Fi route")
          wifi.bindSocket(socket)
          id = axons.reserve(socket)
        }
        try { axonWorkers.execute {
          try { axons.connect(id, InetSocketAddress(address, port)); promise.resolve(id) }
          catch (error: Exception) { axons.close(id); promise.reject("AXON_CONNECT", "Axon connection failed", error) }
        } } catch (error: Exception) { axons.close(id); throw error }
      } catch (error: Exception) { runCatching { socket.close() }; promise.reject("AXON_CONNECT", "Axon connection unavailable", error) }
    }
    AsyncFunction("axonWssConnect") { host: String, account: String, promise: Promise ->
      var socket: java.net.Socket? = null
      var id: String? = null
      try {
        synchronized(this@AxonicNearbyModule) {
          val context = requireNotNull(appContext.reactContext)
          check(transportAllowed()) { "Axon transport requires an active app" }
          // Bootstrap endpoint allowlist, not an identity authority. Shared crypto verifies the peer.
          require(host in setOf("143.198.121.2", "secondneuron-production.up.railway.app") && account.matches(Regex("axonic:1:[0-9a-f]{64}")))
          socket = javax.net.ssl.SSLSocketFactory.getDefault().createSocket()
          id = axons.reserve(socket!!, true)
        }
        val key = id!!
        axonWorkers.execute {
          try { axons.connectWebSocket(key, host, account); promise.resolve(key) }
          catch (error: Exception) { axons.close(key); promise.reject("AXON_CONNECT", "Internet axon connection failed", error) }
        }
      } catch (error: Exception) {
        id?.let { axons.close(it) }; runCatching { socket?.close() }
        promise.reject("AXON_CONNECT", "Internet axon connection failed", error)
      }
    }
    AsyncFunction("axonRead") { id: String, promise: Promise -> axonWork(promise) { axons.read(id) } }
    AsyncFunction("axonWrite") { id: String, raw: String, promise: Promise -> axonWork(promise) { axons.write(id, raw); true } }
    Function("axonClose") { id: String -> axons.close(id) }
    Function("attachmentSha256") { value: String -> AttachmentHash.sha256(value) }
    AsyncFunction("attachmentStagedFileSha256") { owner: String, id: String, bytes: Double, promise: Promise ->
      try {
        require(bytes.isFinite() && bytes == bytes.toLong().toDouble() && bytes >= 1 && bytes <= 250L * 1024 * 1024)
        val root = requireNotNull(appContext.reactContext).filesDir
        attachmentWorkers.execute {
          try { promise.resolve(AttachmentFileHash.sha256(root, owner, id, true, bytes.toLong(), staged = true)) }
          catch (error: Exception) { promise.reject("ATTACHMENT_VERIFY", "Attachment verification failed", error) }
        }
      } catch (error: Exception) { promise.reject("ATTACHMENT_VERIFY", "Attachment verification unavailable", error) }
    }
    AsyncFunction("attachmentFileSha256") { owner: String, digest: String, completed: Boolean, bytes: Double, promise: Promise ->
      try {
        require(bytes.isFinite() && bytes == bytes.toLong().toDouble() && bytes >= 1 && bytes <= 250L * 1024 * 1024)
        val root = requireNotNull(appContext.reactContext).filesDir
        attachmentWorkers.execute {
          try { promise.resolve(AttachmentFileHash.sha256(root, owner, digest, completed, bytes.toLong())) }
          catch (error: Exception) { promise.reject("ATTACHMENT_VERIFY", "Attachment verification failed", error) }
        }
      } catch (error: Exception) { promise.reject("ATTACHMENT_VERIFY", "Attachment verification unavailable", error) }
    }
    // Explicit account-removal close: a fresh process is required before private-store cleanup.
    Function("closeForDeviceRemoval") {
      android.os.Handler(android.os.Looper.getMainLooper()).post {
        appContext.currentActivity?.finishAndRemoveTask()
        android.os.Process.killProcess(android.os.Process.myPid())
      }
      true
    }
    AsyncFunction("identityScrypt") { password: String, salt: String -> IdentityKdf.derive(password, salt) }
    AsyncFunction("identityRandomBytes") { size: Int ->
      require(size in 1..64)
      val bytes = ByteArray(size)
      java.security.SecureRandom().nextBytes(bytes)
      bytes.joinToString("") { "%02x".format(it) }
    }
    OnActivityEntersForeground { synchronized(this@AxonicNearbyModule) {
      foregroundGate.resume(); backgroundClose?.cancel(false); backgroundClose = null
    } }
    OnActivityEntersBackground { synchronized(this@AxonicNearbyModule) {
      val delay = foregroundGate.pause(SystemClock.elapsedRealtime())
      backgroundClose?.cancel(false)
      backgroundClose = wakeTimer.schedule({ synchronized(this@AxonicNearbyModule) {
        if (!transportAllowed()) closeBackgroundAxons()
      } }, delay, TimeUnit.MILLISECONDS)
    } }
    OnDestroy { synchronized(this@AxonicNearbyModule) { foregroundGate.destroy(); backgroundClose?.cancel(false); backgroundClose = null; axonLan?.stop(); axonLan = null; axons.destroy(); wakeTimer.shutdownNow(); axonWorkers.shutdownNow(); attachmentWorkers.shutdownNow() } }
  }
}
