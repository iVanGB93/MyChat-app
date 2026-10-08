package expo.modules.axonicnearby

import android.app.ActivityManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.SystemClock
import android.os.Build
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Release mailbox cryptography and authenticated foreground axon transports.
 * The legacy room-based LAN diagnostic remains development-only.
 * LAN TXT identity is a claim, not authentication. */
class AxonicNearbyModule : Module() {
  private data class Peer(val endpoint: String, val address: InetAddress, val port: Int)
  @Volatile private var lane: Lane? = null
  private val axons = AxonSockets()
  private var axonLan: AxonLan? = null
  private var axonForeground = true
  private var wakeUntil = 0L
  private val wakeTimer = Executors.newSingleThreadScheduledExecutor()
  private fun transportAllowed() = axonForeground || protectedCall() || SystemClock.elapsedRealtime() < wakeUntil
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
    axonLan?.stop(); axonLan = null; axons.closeAll(); stopLane()
  }
  private val axonWorkers = ThreadPoolExecutor(0, 20, 30L, TimeUnit.SECONDS, java.util.concurrent.SynchronousQueue<Runnable>())
  private fun axonWork(promise: Promise, work: () -> Any?) {
    try { axonWorkers.execute {
      try { promise.resolve(work()) } catch (error: Exception) { promise.reject("AXON_TRANSPORT", "Axon transport unavailable", error) }
    } } catch (error: Exception) { promise.reject("AXON_CAPACITY", "Axon transport busy", error) }
  }
  override fun definition() = ModuleDefinition {
    Name("AxonicNearby")
    Events("onNearby")
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
    AsyncFunction("identityScrypt") { password: String, salt: String -> IdentityKdf.derive(password, salt) }
    AsyncFunction("identityRandomBytes") { size: Int ->
      require(size in 1..64)
      val bytes = ByteArray(size)
      java.security.SecureRandom().nextBytes(bytes)
      bytes.joinToString("") { "%02x".format(it) }
    }
    AsyncFunction("mailboxIdentity") { owner: Int -> MailboxCrypto.identity(owner) }
    AsyncFunction("mailboxDigest") { value: String ->
      require(value.length <= 16000)
      MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
    AsyncFunction("mailboxSign") { owner: Int, value: String -> MailboxCrypto.sign(owner, value) }
    AsyncFunction("mailboxVerify") { key: String, value: String, signature: String ->
      MailboxCrypto.verify(key, value, signature)
    }
    AsyncFunction("mailboxSeal") { key: String, header: String, plaintext: String ->
      MailboxCrypto.seal(key, header, plaintext)
    }
    AsyncFunction("mailboxOpen") { owner: Int, header: String, key: String, iv: String, ciphertext: String ->
      MailboxCrypto.open(owner, header, key, iv, ciphertext)
    }
    AsyncFunction("start") { room: String, user: Int, peer: Int ->
      synchronized(this@AxonicNearbyModule) {
        stopLane()
        val context = requireNotNull(appContext.reactContext)
        check(context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) { "Development builds only" }
        check(Build.VERSION.SDK_INT >= 33) { "Nearby testing requires Android 13 or newer" }
        require(UUID.fromString(room).toString() == room.lowercase() && user > 0 && peer > 0 && user != peer)
        val next = Lane(context, room, user, peer)
        lane = next
        try { next.start() } catch (e: Exception) { stopLane(); throw e }
      }
    }
    AsyncFunction("stop") { synchronized(this@AxonicNearbyModule) { stopLane() } }
    Function("send") { frame: String -> lane?.send(frame) ?: false }
    OnActivityEntersForeground { synchronized(this@AxonicNearbyModule) { axonForeground = true } }
    OnActivityEntersBackground { synchronized(this@AxonicNearbyModule) { axonForeground = false; if (!transportAllowed()) closeBackgroundAxons() } }
    OnDestroy { synchronized(this@AxonicNearbyModule) { axonForeground = false; axonLan?.stop(); axonLan = null; axons.destroy(); wakeTimer.shutdownNow(); axonWorkers.shutdownNow(); stopLane() } }
  }
  private fun stopLane() { val old = lane; lane = null; old?.stop() }

  private inner class Lane(val context: Context, val room: String, val user: Int, val peer: Int) {
    val endpoint = UUID.randomUUID().toString()
    val scope = MessageDigest.getInstance("SHA-256").digest(room.toByteArray()).joinToString("") { "%02x".format(it) }
    val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val running = AtomicBoolean(true)
    val workers = ThreadPoolExecutor(4, 4, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue<Runnable>(16))
    val listenerThread = Executors.newSingleThreadExecutor()
    val sockets = ConcurrentHashMap.newKeySet<Socket>()
    val peers = ConcurrentHashMap<String, Peer>()
    val resolving = ConcurrentHashMap.newKeySet<String>()
    val resolvedNames = ConcurrentHashMap<String, String>()
    val rates = ConcurrentHashMap<String, Pair<Long, Int>>()
    var server: ServerSocket? = null
    var network: Network? = null
    var discovery: NsdManager.DiscoveryListener? = null
    var registration: NsdManager.RegistrationListener? = null
    var networkCallback: ConnectivityManager.NetworkCallback? = null
    var multicast: WifiManager.MulticastLock? = null
    fun current() = running.get() && lane === this
    fun emit(type: String, reason: String? = null, frame: String? = null) {
      if (current()) sendEvent("onNearby", bundleOf("type" to type, "reason" to reason, "frame" to frame, "count" to peers.size))
    }
    @Suppress("DEPRECATION")
    fun start() {
      val wifi = connectivity.allNetworks.firstOrNull {
        connectivity.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
      } ?: error("Connect both devices to the same Wi-Fi first")
      network = wifi
      val address = connectivity.getLinkProperties(wifi)?.linkAddresses?.map { it.address }
        ?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress } ?: error("No IPv4 Wi-Fi address available")
      server = ServerSocket().apply { reuseAddress = true; bind(InetSocketAddress(address, 0), 8) }
      multicast = (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
        .createMulticastLock("axonic-nearby").apply { setReferenceCounted(false); acquire() }
      networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onLost(lost: Network) { if (lost == wifi && current()) { emit("stopped", "Wi-Fi disconnected"); stop() } }
        override fun onLinkPropertiesChanged(n: Network, p: android.net.LinkProperties) {
          if (n == wifi && current() && p.linkAddresses.none { it.address == address }) { emit("stopped", "Wi-Fi address changed"); stop() }
        }
      }.also { connectivity.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), it) }
      registration = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(info: NsdServiceInfo) {}
        override fun onRegistrationFailed(info: NsdServiceInfo, code: Int) { emit("error", "Nearby advertising failed ($code)"); stop() }
        override fun onServiceUnregistered(info: NsdServiceInfo) {}
        override fun onUnregistrationFailed(info: NsdServiceInfo, code: Int) {}
      }.also { listener ->
        nsd.registerService(NsdServiceInfo().apply {
          serviceName = "Axonic-${endpoint.take(8)}"; serviceType = "_axonic-dev._tcp."
          port = server!!.localPort; setNetwork(wifi)
          setAttribute("v", "1"); setAttribute("endpoint", endpoint)
          setAttribute("scope", scope); setAttribute("user", user.toString())
        }, NsdManager.PROTOCOL_DNS_SD, listener)
      }
      discovery = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(type: String) { emit("peers") }
        override fun onDiscoveryStopped(type: String) {}
        override fun onStartDiscoveryFailed(type: String, code: Int) { emit("error", "Nearby discovery failed ($code)"); stop() }
        override fun onStopDiscoveryFailed(type: String, code: Int) {}
        override fun onServiceLost(info: NsdServiceInfo) {
          resolving.remove(info.serviceName)
          resolvedNames.remove(info.serviceName)?.let { peers.remove(it) }
          emit("peers")
        }
        override fun onServiceFound(info: NsdServiceInfo) {
          if (!current() || resolving.size >= 32 || !resolving.add(info.serviceName)) return
          // Serialize legacy NSD resolutions: older Android rejects simultaneous requests.
          resolveQueue.offer(info); resolveNext()
        }
      }.also { nsd.discoverServices("_axonic-dev._tcp.", NsdManager.PROTOCOL_DNS_SD, wifi, context.mainExecutor, it) }
      listenerThread.execute {
        while (current()) {
          val socket = try { server?.accept() ?: break } catch (_: Exception) { break }
          sockets.add(socket)
          try { workers.execute { receive(socket) } } catch (_: Exception) { sockets.remove(socket); socket.close() }
        }
      }
    }
    val resolveQueue = java.util.concurrent.ConcurrentLinkedQueue<NsdServiceInfo>()
    val resolveBusy = AtomicBoolean(false)
    @Suppress("DEPRECATION")
    fun resolveNext() {
      if (!current() || !resolveBusy.compareAndSet(false, true)) return
      val info = resolveQueue.poll()
      if (info == null) { resolveBusy.set(false); return }
      fun done() { resolveBusy.set(false); resolveNext() }
      try { nsd.resolveService(info, object : NsdManager.ResolveListener {
        override fun onResolveFailed(service: NsdServiceInfo, code: Int) { resolving.remove(info.serviceName); done() }
        override fun onServiceResolved(service: NsdServiceInfo) {
          try {
            fun attr(key: String) = service.attributes[key]?.toString(Charsets.UTF_8)
            val id = attr("endpoint") ?: return
            if (!current() || !resolving.contains(info.serviceName) || attr("v") != "1" || attr("scope") != scope
              || attr("user") != peer.toString() || id == endpoint || peers.size >= 4) return
            UUID.fromString(id)
            val host = if (Build.VERSION.SDK_INT >= 34) service.hostAddresses.firstOrNull { it is Inet4Address }
              else service.host
            if (host !is Inet4Address || host.isLoopbackAddress || host.isAnyLocalAddress || service.port !in 1..65535) return
            peers[id] = Peer(id, host, service.port); resolvedNames[info.serviceName] = id; emit("peers")
          } catch (_: Exception) { } finally { done() }
        }
      }) } catch (_: Exception) { resolving.remove(info.serviceName); done() }
    }
    @Synchronized fun allowed(key: String): Boolean {
      val now = android.os.SystemClock.elapsedRealtime()
      val old = rates[key]
      val count = if (old == null || now - old.first >= 60_000) 0 else old.second
      if (count >= 120) return false
      rates[key] = Pair(if (count == 0) now else old!!.first, count + 1)
      return true
    }
    fun send(raw: String): Boolean {
      if (!current() || raw.length > 65_536) return false
      return try {
        val frame = JSONObject(raw)
        if (!valid(frame) || frame.optInt("target_user_id") != peer) return false
        val targetId = frame.optString("target_endpoint_id")
        val targets = if (targetId.isEmpty() || targetId == "null") peers.values.sortedBy { it.endpoint }
          else listOfNotNull(peers[targetId])
        if (targets.isEmpty() || !allowed("out")) return false
        frame.put("event", "p2p_text_signal").put("from_endpoint_id", endpoint).put("from_user_id", user)
        workers.execute {
          // NSD can retain an old advertisement after a peer loses Wi-Fi. Try the
          // other discovered endpoints rather than repeatedly selecting a dead port.
          for (target in targets) {
            val socket = Socket(); sockets.add(socket)
            try {
              if (!current()) return@execute
              val bytes = frame.put("target_endpoint_id", target.endpoint).toString().toByteArray(Charsets.UTF_8)
              if (bytes.size > 65_536) return@execute
              network!!.bindSocket(socket); socket.connect(InetSocketAddress(target.address, target.port), 1500)
              socket.soTimeout = 2000
              DataOutputStream(socket.getOutputStream()).use { it.writeInt(bytes.size); it.write(bytes); it.flush() }
              return@execute
            } catch (_: Exception) {
              if (current() && peers.remove(target.endpoint, target)) emit("peers")
            } finally { sockets.remove(socket); runCatching { socket.close() } }
          }
        }
        true
      } catch (_: Exception) { false }
    }
    fun valid(frame: JSONObject): Boolean = frame.optInt("protocol") == 1 && frame.optString("room_id") == room &&
      frame.optString("signal_type") in listOf("offer", "answer", "ice", "close") && frame.optJSONObject("data") != null &&
      runCatching { UUID.fromString(frame.getString("session_id")) }.isSuccess
    fun receive(socket: Socket) {
      try {
        if (!current() || !allowed("in")) return
        socket.soTimeout = 2000
        val input = DataInputStream(socket.getInputStream())
        val length = input.readInt(); if (length !in 2..65_536) return
        val bytes = ByteArray(length); input.readFully(bytes)
        val frame = JSONObject(String(bytes, Charsets.UTF_8))
        val sender = peers[frame.optString("from_endpoint_id")] ?: return
        if (!valid(frame) || sender.address != socket.inetAddress || frame.optInt("from_user_id") != peer
          || frame.optInt("target_user_id") != user || frame.optString("target_endpoint_id") != endpoint) return
        emit("signal", frame = frame.toString())
      } catch (_: Exception) { } finally { sockets.remove(socket); runCatching { socket.close() } }
    }
    fun stop() {
      if (!running.getAndSet(false)) return
      runCatching { server?.close() }
      sockets.forEach { runCatching { it.close() } }; sockets.clear()
      discovery?.let { runCatching { nsd.stopServiceDiscovery(it) } }
      registration?.let { runCatching { nsd.unregisterService(it) } }
      networkCallback?.let { runCatching { connectivity.unregisterNetworkCallback(it) } }
      multicast?.let { if (it.isHeld) runCatching { it.release() } }
      workers.shutdownNow(); listenerThread.shutdownNow(); peers.clear(); resolveQueue.clear(); rates.clear()
    }
  }
}
