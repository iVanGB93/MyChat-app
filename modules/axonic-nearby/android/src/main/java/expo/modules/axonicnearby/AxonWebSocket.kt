package expo.modules.axonicnearby

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** Minimal text-only RFC6455 client. TLS, deadlines and socket ownership live in AxonSockets.
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

  fun write(output: DataOutputStream, bytes: ByteArray, opcode: Int = 1) {
    require(bytes.size <= AxonFrames.MAX_BYTES)
    synchronized(output) {
      output.writeByte(0x80 or opcode)
      if (bytes.size < 126) output.writeByte(0x80 or bytes.size)
      else { output.writeByte(0x80 or 126); output.writeShort(bytes.size) }
      val mask = ByteArray(4).also { random.nextBytes(it) }; output.write(mask)
      val masked = ByteArray(bytes.size) { i -> (bytes[i].toInt() xor mask[i % 4].toInt()).toByte() }
      output.write(masked); output.flush()
    }
  }

  fun read(first: Int, input: DataInputStream, control: (Int, ByteArray) -> Unit): String {
    val message = ByteArrayOutputStream()
    var header = first; var started = false
    // Includes controls and empty fragments, so they cannot extend the deadline/work without bound.
    repeat(32) {
      require(header >= 0 && header and 0x70 == 0) { "Invalid WebSocket flags" }
      val final = header and 0x80 != 0; val opcode = header and 15
      val second = input.readUnsignedByte(); require(second and 0x80 == 0) { "Masked server frame" }
      val marker = second and 127
      require(marker != 127) { "Axon frame too large" }
      val length = if (marker == 126) input.readUnsignedShort().also { require(it >= 126) } else marker
      if (opcode >= 8) {
        require(opcode in 8..10 && final && length <= 125) { "Invalid control frame" }
        val payload = ByteArray(length); input.readFully(payload)
        if (opcode == 8) { control(8, byteArrayOf(3, -24)); error("Peer closed axon") }
        if (opcode == 9) control(10, payload)
      } else {
        require((!started && opcode == 1) || (started && opcode == 0)) { "Only text axons supported" }
        require(message.size() + length <= AxonFrames.MAX_BYTES) { "Axon message too large" }
        val payload = ByteArray(length); input.readFully(payload); message.write(payload); started = true
        if (final) {
          require(message.size() > 0)
          return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(message.toByteArray())).toString()
        }
      }
      header = input.read()
    }
    error("Too many WebSocket fragments")
  }
}
