package expo.modules.axonicnearby

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket

class AxonSocketsTest {
  @Test(timeout = 5000) fun incomingAndOutgoingSocketsShareOneAdmissionLimit() {
    val transport = AxonSockets()
    transport.setLimit(2)
    ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress()).use { server ->
      try {
        val outgoing = transport.reserve(Socket())
        transport.connect(outgoing, InetSocketAddress(server.inetAddress, server.localPort))
        val incoming = transport.incoming(server.accept())
        assertThrows(IllegalStateException::class.java) { transport.reserve(Socket()) }
        transport.write(outgoing, "hello")
        assertEquals("hello", transport.read(incoming))
        transport.claim(incoming)
        transport.write(incoming, "reply")
        assertEquals("reply", transport.read(outgoing))
        transport.closeAll()
        assertThrows(IllegalStateException::class.java) { transport.claim(incoming) }
      } finally { transport.destroy() }
    }
  }
  @Test fun rejectsLengthsBeforeReadingPayloadAndRejectsInvalidUtf8() {
    for (size in listOf(0, -1, 20001, Int.MAX_VALUE)) {
      val bytes = java.nio.ByteBuffer.allocate(4).putInt(size).array()
      val input = DataInputStream(ByteArrayInputStream(bytes))
      assertThrows(IllegalArgumentException::class.java) { AxonFrames.read(input.read(), input) }
    }
    val malformed = DataInputStream(ByteArrayInputStream(byteArrayOf(0, 0, 0, 1, 0xff.toByte())))
    assertThrows(java.nio.charset.CharacterCodingException::class.java) { AxonFrames.read(malformed.read(), malformed) }
    assertThrows(IllegalArgumentException::class.java) { AxonFrames.encode("é".repeat(10001)) }
    assertEquals(20000, AxonFrames.encode("é".repeat(10000)).size)
  }
  @Test fun connectingSocketsConsumeCapacityAndShutdownReleasesThem() {
    val transport = AxonSockets()
    try {
      transport.setLimit(10)
      repeat(10) { transport.reserve(Socket()) }
      val extra = Socket()
      assertThrows(IllegalStateException::class.java) { transport.reserve(extra) }
      assertTrue(extra.isClosed)
      transport.closeAll()
      transport.close(transport.reserve(Socket()))
    } finally { transport.destroy() }
  }
  @Test(timeout = 5000) fun realSocketPreservesEarlyFramesAndUsesUtf8ByteLengths() {
    val transport = AxonSockets()
    ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress()).use { server ->
      try {
        val id = transport.reserve(Socket())
        transport.connect(id, InetSocketAddress(server.inetAddress, server.localPort))
        server.accept().use { peer ->
          peer.soTimeout = 2000
          val output = DataOutputStream(peer.getOutputStream())
          val bytes = "early 🔑".toByteArray(Charsets.UTF_8)
          output.writeInt(bytes.size); output.write(bytes); output.flush()
          assertEquals("early 🔑", transport.read(id))
          transport.write(id, "reply é")
          val input = DataInputStream(peer.getInputStream())
          assertEquals("reply é", AxonFrames.read(input.read(), input))
          transport.closeAll()
          assertEquals(-1, input.read())
        }
      } finally { transport.destroy() }
    }
  }
  @Test(timeout = 7000) fun partialFrameHasAnAbsoluteDeadline() {
    val transport = AxonSockets()
    ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress()).use { server ->
      try {
        val id = transport.reserve(Socket())
        transport.connect(id, InetSocketAddress(server.inetAddress, server.localPort))
        server.accept().use { peer ->
          peer.getOutputStream().write(0); peer.getOutputStream().flush()
          assertThrows(java.net.SocketException::class.java) { transport.read(id) }
        }
      } finally { transport.destroy() }
    }
  }
}
