package expo.modules.axonicnearby

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** Minimal RFC6455 client with gated binary attachment records. TLS, deadlines and socket ownership live in AxonSockets.
 * No extensions, compression, redirects or cookies. Lengths are checked before allocation.
 */
internal object AxonWebSocket {
  private val random = SecureRandom()
  fun handshake(input: DataInputStream, output: DataOutputStream, host: String, account: String) {
    require(account.matches(Regex("axonic:1:[0-9a-f]{64}")))
    val key = Base64.getEncoder().encodeToString(ByteArray(16).also { random.nextBytes(it) })
    output.writeBytes("GET /v2/axon?account=$account HTTP/1.1\r\nHost: $host\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\n\r\n")
    output.flush()
    val bytes = ByteArrayOutputStream()
    var end = 0
    while (end != 0x0d0a0d0a) {
      require(bytes.size() < 8192) { "Upgrade headers too large" }
      val b = input.readUnsignedByte(); bytes.write(b); end = (end shl 8) or b
    }
    val lines = bytes.toString("US-ASCII").split("\r\n")
    require(lines.first().startsWith("HTTP/1.1 101 ")) { "Upgrade rejected" }
    val headers = mutableMapOf<String, String>()
    for (line in lines.drop(1).filter { it.isNotEmpty() }) {
      val colon = line.indexOf(':'); require(colon > 0)
      val name = line.substring(0, colon).lowercase(java.util.Locale.ROOT)
      require(!headers.containsKey(name)) { "Duplicate upgrade header" }
      headers[name] = line.substring(colon + 1).trim()
    }
    val expected = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1")
      .digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray(Charsets.US_ASCII)))
    require(headers["sec-websocket-accept"] == expected && headers["upgrade"].equals("websocket", true)
      && headers["connection"]?.split(',')?.any { it.trim().equals("upgrade", true) } == true
      && !headers.containsKey("sec-websocket-extensions") && !headers.containsKey("sec-websocket-protocol"))
  }

  fun write(output: DataOutputStream, bytes: ByteArray, opcode: Int = 1, maximum: Int = AxonFrames.MAX_BYTES) {
    require(maximum in AxonFrames.MAX_BYTES..AxonFrames.STREAM_BYTES && bytes.size <= maximum)
    require(opcode == 1 || opcode == 2 && maximum >= 32838 && bytes.size in 71..32838 || opcode in 8..10 && bytes.size <= 125)
    synchronized(output) {
      // SSLSocket writes are not buffered: separate header writes become tiny TLS
      // records. Assemble one bounded RFC6455 frame before touching the socket.
      val header = if (bytes.size < 126) 2 else if (bytes.size <= 65535) 4 else 10
      val frame = ByteArray(header + 4 + bytes.size)
      frame[0] = (0x80 or opcode).toByte()
      frame[1] = (0x80 or if (header == 2) bytes.size else if (header == 4) 126 else 127).toByte()
      if (header == 4) { frame[2] = (bytes.size ushr 8).toByte(); frame[3] = bytes.size.toByte() }
      if (header == 10) ByteBuffer.wrap(frame, 2, 8).putLong(bytes.size.toLong())
      val mask = ByteArray(4).also { random.nextBytes(it) }
      mask.copyInto(frame, header)
      for (i in bytes.indices) frame[header + 4 + i] = (bytes[i].toInt() xor mask[i % 4].toInt()).toByte()
      try { output.write(frame); output.flush() } finally { frame.fill(0); mask.fill(0) }
    }
  }

  fun read(first: Int, input: DataInputStream, maximum: () -> Int = { AxonFrames.MAX_BYTES }, control: (Int, ByteArray) -> Unit): String {
    return readPacket(first, input, maximum, { false }, control) as String
  }
  fun readPacket(first: Int, input: DataInputStream, maximum: () -> Int = { AxonFrames.MAX_BYTES }, binaryAllowed: () -> Boolean = { false }, control: (Int, ByteArray) -> Unit): Any {
    val message = ByteArrayOutputStream()
    var header = first; var started = false; var binary = false
    // Includes controls and empty fragments, so they cannot extend the deadline/work without bound.
    repeat(32) {
      require(header >= 0 && header and 0x70 == 0) { "Invalid WebSocket flags" }
      val final = header and 0x80 != 0; val opcode = header and 15
      val second = input.readUnsignedByte(); require(second and 0x80 == 0) { "Masked server frame" }
      val marker = second and 127
      val limit = maximum(); require(limit in AxonFrames.MAX_BYTES..AxonFrames.STREAM_BYTES)
      val length = when (marker) {
        127 -> { require(limit > 65535) { "Axon frame too large" }; val n = input.readLong(); require(n in 65536L..limit.toLong()) { "Invalid large frame size" }; n.toInt() }
        126 -> input.readUnsignedShort().also { require(it >= 126) }
        else -> marker
      }
      if (opcode >= 8) {
        require(opcode in 8..10 && final && length <= 125) { "Invalid control frame" }
        val payload = ByteArray(length); input.readFully(payload)
        if (opcode == 8) { control(8, byteArrayOf(3, -24)); error("Peer closed axon") }
        if (opcode == 9) control(10, payload)
      } else {
        require((!started && (opcode == 1 || opcode == 2 && binaryAllowed())) || (started && opcode == 0)) { "Unadmitted axon frame" }
        if (!started) binary = opcode == 2
        require(message.size() + length <= if(binary) minOf(limit,32838) else limit) { "Axon message too large" }
        val payload = ByteArray(length); input.readFully(payload); message.write(payload); started = true
        if (final) {
          require(message.size() > 0)
          if(binary){require(message.size() >= 71);return message.toByteArray()}
          return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(message.toByteArray())).toString()
        }
      }
      header = input.read()
    }
    error("Too many WebSocket fragments")
  }
}
