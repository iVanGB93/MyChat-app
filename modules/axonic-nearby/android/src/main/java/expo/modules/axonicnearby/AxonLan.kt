package expo.modules.axonicnearby

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.SystemClock
import org.json.JSONObject
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Development LAN identity discovery. Advertisements and hello accounts are claims;
 * JavaScript's shared identity protocol must verify them before admitting a neuron.
 * Snapshots/pull accepts avoid an unbounded stream of React Native bridge events.
 */
internal class AxonLan(private val context: Context, private val account: String, private val sockets: AxonSockets) {
  private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
  private val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private val active = AtomicBoolean(false)
  private val accepting = AtomicBoolean(false)
  private val sources = LinkedHashMap<String, Pair<Long, Int>>()
  private var windowAt = 0L; private var attempts = 0
  private val services = LinkedHashMap<String, NsdServiceInfo>()
  private val peers = LinkedHashMap<String, Map<String, Any>>()
  private val resolvedAt = HashMap<String, Long>()
  private var resolving: String? = null
  private var server: ServerSocket? = null
  private var registration: NsdManager.RegistrationListener? = null
  private var discovery: NsdManager.DiscoveryListener? = null
  private var callback: ConnectivityManager.NetworkCallback? = null
  private var multicast: WifiManager.MulticastLock? = null
  private lateinit var address: InetAddress
  private var prefix = 0
  private fun local(host: InetAddress): Boolean {
    val bytes = host.address
    if (bytes.size != 4 || host.isLoopbackAddress || host.isAnyLocalAddress || host.isMulticastAddress) return false
    return (0 until prefix).all { bit ->
      val mask = 1 shl (7 - bit % 8)
      (bytes[bit / 8].toInt() and mask) == (address.address[bit / 8].toInt() and mask)
    }
  }
  @Suppress("DEPRECATION")
  fun start() {
    require(Build.VERSION.SDK_INT >= 33 && account.matches(Regex("axonic:1:[0-9a-f]{64}")))
    val wifi = cm.allNetworks.firstOrNull { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }
      ?: error("Wi-Fi unavailable")
    val link = cm.getLinkProperties(wifi)?.linkAddresses?.firstOrNull { it.address is Inet4Address && it.address.isSiteLocalAddress }
      ?: error("Private Wi-Fi address unavailable")
    address = link.address; prefix = link.prefixLength
    require(prefix in 1..32)
    active.set(true)
    try {
      server = ServerSocket().apply { reuseAddress = true; bind(InetSocketAddress(address, 0), 5); soTimeout = 1000 }
      multicast = (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
        .createMulticastLock("axonic-identity").apply { setReferenceCounted(false); acquire() }
      callback = object : ConnectivityManager.NetworkCallback() {
        override fun onLost(network: Network) { if (network == wifi) stop() }
        override fun onLinkPropertiesChanged(network: Network, p: android.net.LinkProperties) {
          if (network == wifi && p.linkAddresses.none { it.address == address && it.prefixLength == prefix }) stop()
        }
      }.also { cm.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), it) }
      registration = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(info: NsdServiceInfo) {}
        override fun onRegistrationFailed(info: NsdServiceInfo, code: Int) { stop() }
        override fun onServiceUnregistered(info: NsdServiceInfo) {}
        override fun onUnregistrationFailed(info: NsdServiceInfo, code: Int) {}
      }.also { nsd.registerService(NsdServiceInfo().apply {
        serviceName = "Axonic-ID-${UUID.randomUUID().toString().take(8)}"; serviceType = "_axonic-id._tcp."
        port = server!!.localPort; setNetwork(wifi); setAttribute("v", "1"); setAttribute("account", account)
      }, NsdManager.PROTOCOL_DNS_SD, it) }
      discovery = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(type: String) {}
        override fun onDiscoveryStopped(type: String) {}
        override fun onStartDiscoveryFailed(type: String, code: Int) { stop() }
        override fun onStopDiscoveryFailed(type: String, code: Int) {}
        override fun onServiceFound(info: NsdServiceInfo) { synchronized(this@AxonLan) {
          if (active.get() && services.size < 32) services[info.serviceName] = info
          resolveNext()
        } }
        override fun onServiceLost(info: NsdServiceInfo) { synchronized(this@AxonLan) {
          services.remove(info.serviceName); peers.remove(info.serviceName); resolvedAt.remove(info.serviceName)
        } }
      }.also { nsd.discoverServices("_axonic-id._tcp.", NsdManager.PROTOCOL_DNS_SD, wifi, context.mainExecutor, it) }
    } catch (error: Exception) { stop(); throw error }
  }
  @Synchronized @Suppress("DEPRECATION") private fun resolveNext() {
    if (!active.get() || resolving != null) return
    val now = SystemClock.elapsedRealtime()
    val entry = services.entries.firstOrNull { now - (resolvedAt[it.key] ?: -60_000L) >= 60_000 } ?: return
    val name = entry.key; resolving = name; resolvedAt[name] = now
    fun finish() { synchronized(this@AxonLan) { resolving = null; resolveNext() } }
    try { nsd.resolveService(entry.value, object : NsdManager.ResolveListener {
      override fun onResolveFailed(info: NsdServiceInfo, code: Int) { synchronized(this@AxonLan) { peers.remove(name) }; finish() }
      override fun onServiceResolved(info: NsdServiceInfo) {
        try { synchronized(this@AxonLan) {
          if (!active.get() || !services.containsKey(name)) return
          peers.remove(name)
          val peer = info.attributes["account"]?.toString(Charsets.UTF_8) ?: return
          val host = if (Build.VERSION.SDK_INT >= 34) info.hostAddresses.firstOrNull { it is Inet4Address } else info.host
          if (info.attributes["v"]?.toString(Charsets.UTF_8) != "1" || !peer.matches(Regex("axonic:1:[0-9a-f]{64}"))
            || peer == account || host == null || !local(host) || info.port !in 1..65535) return
          peers[name] = mapOf("account" to peer, "host" to host.hostAddress!!, "port" to info.port)
        } } finally { finish() }
      }
    }) } catch (_: Exception) { finish() }
  }
  @Synchronized fun snapshot(): Map<String, Any> {
    resolveNext()
    val now = SystemClock.elapsedRealtime()
    return mapOf("active" to active.get(), "peers" to peers.filterKeys { now - (resolvedAt[it] ?: 0) < 120_000 }.values.toList())
  }
  @Synchronized private fun allowed(host: String): Boolean {
    val now = SystemClock.elapsedRealtime()
    if (now - windowAt >= 60_000) { windowAt = now; attempts = 0; sources.clear() }
    if (++attempts > 16 || (!sources.containsKey(host) && sources.size >= 32)) return false
    val count = sources[host]?.second ?: 0
    sources[host] = Pair(now, count + 1)
    return count < 8
  }
  fun accept(): Map<String, String>? {
    check(active.get() && accepting.compareAndSet(false, true)) { "LAN listener unavailable" }
    var id: String? = null
    try {
      val socket = try { server?.accept() ?: return null } catch (_: SocketTimeoutException) { return null }
      try {
        if (!active.get() || !local(socket.inetAddress) || !allowed(socket.inetAddress.hostAddress!!)) { socket.close(); return null }
        synchronized(this) { if (!active.get()) { socket.close(); return null }; id = sockets.incoming(socket) }
        val hello = sockets.read(id!!)
        val frame = JSONObject(hello); val peer = frame.optString("account")
        // Only the lower account dials; the higher one accepts, avoiding crossed duplicates.
        require(frame.optInt("version") == 1 && frame.optString("kind") == "hello"
          && peer.matches(Regex("axonic:1:[0-9a-f]{64}")) && peer < account)
        return mapOf("id" to id!!, "account" to peer, "host" to socket.inetAddress.hostAddress!!, "hello" to hello)
      } catch (_: Exception) { id?.let { sockets.close(it) }; runCatching { socket.close() }; return null }
    } finally { accepting.set(false) }
  }
  @Synchronized fun stop() {
    if (!active.getAndSet(false)) return
    runCatching { server?.close() }; server = null; sockets.closeLan()
    discovery?.let { runCatching { nsd.stopServiceDiscovery(it) } }; discovery = null
    registration?.let { runCatching { nsd.unregisterService(it) } }; registration = null
    callback?.let { runCatching { cm.unregisterNetworkCallback(it) } }; callback = null
    runCatching { multicast?.release() }; multicast = null
    services.clear(); peers.clear(); resolvedAt.clear()
  }
}
