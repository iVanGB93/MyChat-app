package expo.modules.axonicnearby

import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Length-prefixed identity frames. Not compatible with WebSocket framing.
 * No conversation payload is carried by this experimental LAN transport.
 */
internal object AxonFrames {
  const val MAX_BYTES = 20_000
  fun read(first: Int, input: DataInputStream): String {
    require(first >= 0) { "Axon closed" }
    val length = (first shl 24) or (input.readUnsignedByte() shl 16) or
      (input.readUnsignedByte() shl 8) or input.readUnsignedByte()
    require(length in 1..MAX_BYTES) { "Invalid axon frame size" }
    val bytes = ByteArray(length)
    input.readFully(bytes)
    return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
  }
  fun encode(raw: String): ByteArray {
    require(raw.length in 1..MAX_BYTES) { "Invalid axon frame size" }
    val bytes = raw.toByteArray(Charsets.UTF_8)
    require(bytes.size <= MAX_BYTES) { "Invalid axon frame size" }
    return bytes
  }
}

/** Pull-based reads: at most one frame crosses the bridge per awaited read.
 * Slots include connecting sockets. Closing interrupts blocking reads/writes.
 */
internal class AxonSockets {
  private class Entry(val socket: Socket, val websocket: Boolean) {
    val output by lazy { DataOutputStream(socket.getOutputStream()) }
    var admission: java.util.concurrent.ScheduledFuture<*>? = null
    val reading = AtomicBoolean(false)
    val writing = AtomicBoolean(false)
    var windowAt = System.nanoTime()
    var frames = 0
    @Volatile var attachments = false
  }
  private val sockets = ConcurrentHashMap<String, Entry>()
  private var limit = 5
  private val deadlines = ScheduledThreadPoolExecutor(1).apply { removeOnCancelPolicy = true }
  @Synchronized fun setLimit(value: Int) { require(value in 1..10 && sockets.isEmpty()); limit = value }
  @Synchronized fun reserve(socket: Socket, websocket: Boolean = false): String {
    if (sockets.size >= limit) { socket.close(); error("Axon capacity reached") }
    val id = UUID.randomUUID().toString()
    sockets[id] = Entry(socket, websocket)
    return id
  }
  @Synchronized fun incoming(socket: Socket): String {
    socket.soTimeout = 4000; socket.tcpNoDelay = true
    val id = reserve(socket)
    sockets[id]!!.admission = deadlines.schedule({ close(id) }, 10_000, TimeUnit.MILLISECONDS)
    return id
  }
  @Synchronized fun claim(id: String) {
    val entry = sockets[id] ?: error("Axon closed")
    entry.admission?.cancel(false); entry.admission = null
    entry.socket.soTimeout = 30_000
  }
  // Only the verified JS session enables this; discovery/claim alone leaves the admission limit intact.
  fun enableAttachments(id:String) { (sockets[id] ?: error("Axon closed")).attachments = true }
  fun connect(id: String, address: InetSocketAddress) {
    val entry = sockets[id] ?: error("Axon closed")
    try {
      entry.socket.connect(address, 4000)
      entry.socket.soTimeout = 30_000
      entry.socket.tcpNoDelay = true
      check(sockets[id] === entry) { "Axon closed" }
    } catch (error: Exception) { close(id); throw error }
  }
  fun connectWebSocket(id: String, host: String, account: String) {
    val entry = sockets[id] ?: error("Axon closed")
    val deadline = deadlines.schedule({ close(id) }, 4000, TimeUnit.MILLISECONDS)
    try {
      require(entry.websocket)
      connect(id, InetSocketAddress(host, 443))
      val tls = entry.socket as javax.net.ssl.SSLSocket
      tls.sslParameters = tls.sslParameters.apply { endpointIdentificationAlgorithm = "HTTPS" }
      tls.startHandshake()
      AxonWebSocket.handshake(DataInputStream(tls.getInputStream()), entry.output, host, account)
      check(sockets[id] === entry) { "Axon closed" }
    } catch (error: Exception) { close(id); throw error }
    finally { deadline.cancel(false) }
  }
  fun read(id: String): String {
    val entry = sockets[id] ?: error("Axon closed")
    check(entry.reading.compareAndSet(false, true)) { "Axon read already pending" }
    try {
      val input = DataInputStream(entry.socket.getInputStream())
      val first = input.read() // Idle deadline is separate from a partial-frame deadline.
      val deadline = deadlines.schedule({ close(id) }, 4000, TimeUnit.MILLISECONDS)
      try {
        val now = System.nanoTime()
        if (now - entry.windowAt >= TimeUnit.MINUTES.toNanos(1)) { entry.windowAt = now; entry.frames = 0 }
        check(++entry.frames <= if(entry.attachments) 3856 else 64) { "Axon frame rate exceeded" }
        return if (entry.websocket) AxonWebSocket.read(first, input) { opcode, bytes -> AxonWebSocket.write(entry.output, bytes, opcode) }
          else AxonFrames.read(first, input)
      } finally { deadline.cancel(false) }
    } catch (error: Exception) { close(id); throw error }
    finally { entry.reading.set(false) }
  }
  fun write(id: String, raw: String) {
    val bytes = AxonFrames.encode(raw)
    val entry = sockets[id] ?: error("Axon closed")
    check(entry.writing.compareAndSet(false, true)) { "Axon write already pending" }
    val deadline = deadlines.schedule({ close(id) }, 4000, TimeUnit.MILLISECONDS)
    try {
      val output = entry.output
      if (entry.websocket) AxonWebSocket.write(output, bytes)
      else { output.writeInt(bytes.size); output.write(bytes); output.flush() }
    } catch (error: Exception) { close(id); throw error }
    finally { deadline.cancel(false); entry.writing.set(false) }
  }
  fun close(id: String) { sockets.remove(id)?.let { it.admission?.cancel(false); runCatching { it.socket.close() } } }
  @Synchronized fun closeLan() { for ((id, entry) in sockets.entries.toList()) if (!entry.websocket) close(id) }
  @Synchronized fun closeAll() { for (id in sockets.keys.toList()) close(id) }
  fun destroy() { closeAll(); deadlines.shutdownNow() }
}
