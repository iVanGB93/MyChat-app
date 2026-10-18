package expo.modules.axonicnearby

import org.junit.Assert.*
import org.junit.Test
import java.io.*

class AxonWebSocketTest {
  @Test fun largeFramesAreCanonicalMaskedAndRequireAdmission() {
    for(size in listOf(20001,65535,65536,700000,850000)) {
      val bytes=ByteArray(size) { 65 }; val out=ByteArrayOutputStream()
      assertThrows(IllegalArgumentException::class.java) { AxonWebSocket.write(DataOutputStream(out),bytes) }
      AxonWebSocket.write(DataOutputStream(out),bytes,maximum=AxonFrames.BULK_BYTES)
      val input=DataInputStream(ByteArrayInputStream(out.toByteArray()));assertEquals(0x81,input.readUnsignedByte())
      val marker=input.readUnsignedByte() and 127
      assertEquals(size.toLong(),if(marker==127)input.readLong() else input.readUnsignedShort().toLong())
      val mask=ByteArray(4);input.readFully(mask)
      assertArrayEquals(bytes,ByteArray(size){i->(input.readUnsignedByte() xor mask[i%4].toInt()).toByte()})
      val server=ByteArrayOutputStream();val writer=DataOutputStream(server);writer.writeByte(0x81);writer.writeByte(if(size>65535)127 else 126);if(size>65535)writer.writeLong(size.toLong()) else writer.writeShort(size);writer.write(bytes)
      assertThrows(IllegalArgumentException::class.java){read(server.toByteArray())}
      val reader=DataInputStream(ByteArrayInputStream(server.toByteArray()));assertEquals("A".repeat(size),AxonWebSocket.read(reader.read(),reader,{AxonFrames.BULK_BYTES}){_,_->})
    }
    for(size in listOf(-1L,65535L,850001L,Long.MAX_VALUE)) {
      val out=ByteArrayOutputStream();val writer=DataOutputStream(out);writer.writeByte(0x81);writer.writeByte(127);writer.writeLong(size)
      val input=DataInputStream(ByteArrayInputStream(out.toByteArray()))
      assertThrows(IllegalArgumentException::class.java){AxonWebSocket.read(input.read(),input,{AxonFrames.BULK_BYTES}){_,_->}}
    }
  }
  @Test fun wssBulkRequiresAttachmentAndMediaAdmission() {
    val sockets=AxonSockets();try{val id=sockets.reserve(java.net.Socket(),true)
      assertThrows(IllegalStateException::class.java){sockets.enableWssBulkAttachments(id)}
      sockets.enableAttachments(id);assertThrows(IllegalStateException::class.java){sockets.enableWssBulkAttachments(id)}
      sockets.enableMediaLane(id);sockets.enableWssBulkAttachments(id)
      assertThrows(IllegalStateException::class.java){sockets.enableBulkAttachments(id)}
    }finally{sockets.destroy()}
  }
  @Test fun eachClientFrameUsesOneUnderlyingWriteIncludingBoundaryLengths() {
    for (size in listOf(0, 5, 125, 126, 127, 20000)) {
      var calls = 0; val captured = ByteArrayOutputStream()
      val socket = object : OutputStream() {
        override fun write(value: Int) { calls++; captured.write(value) }
        override fun write(bytes: ByteArray, offset: Int, length: Int) { calls++; captured.write(bytes, offset, length) }
      }
      val data = ByteArray(size) { (it % 251).toByte() }
      AxonWebSocket.write(DataOutputStream(socket), data)
      assertEquals(1, calls)
      val input = DataInputStream(ByteArrayInputStream(captured.toByteArray()))
      assertEquals(0x81, input.readUnsignedByte()); val marker = input.readUnsignedByte()
      assertEquals(size, if (marker and 127 == 126) input.readUnsignedShort() else marker and 127)
      val mask = ByteArray(4); input.readFully(mask)
      assertArrayEquals(data, ByteArray(size) { i -> (input.readUnsignedByte() xor mask[i % 4].toInt()).toByte() })
      assertEquals(-1, input.read())
    }
  }
  private fun read(bytes: ByteArray, control: (Int, ByteArray) -> Unit = { _, _ -> }): String {
    val input = DataInputStream(ByteArrayInputStream(bytes))
    return AxonWebSocket.read(input.read(), input, control = control)
  }
  @Test fun fragmentsAndInterleavedPingPreserveText() {
    var pong = false
    val text = read(byteArrayOf(1, 2, 72, 101, 0x89.toByte(), 1, 7, 0x80.toByte(), 3, 108, 108, 111)) { opcode, bytes ->
      assertEquals(10, opcode); assertArrayEquals(byteArrayOf(7), bytes); pong = true
    }
    assertEquals("Hello", text); assertTrue(pong)
  }
  @Test fun sizesAndInvalidFlagsFailBeforeReadingPayload() {
    for (bytes in listOf(byteArrayOf(0x81.toByte(), 127), byteArrayOf(0x81.toByte(), 126, 0x4e, 0x21),
      byteArrayOf(0x81.toByte(), 0x80.toByte()), byteArrayOf(0xc1.toByte(), 0),
      byteArrayOf(0x82.toByte(), 0), byteArrayOf(0x80.toByte(), 0), byteArrayOf(9, 0))) {
      assertThrows(IllegalArgumentException::class.java) { read(bytes) }
    }
    assertThrows(java.nio.charset.CharacterCodingException::class.java) { read(byteArrayOf(0x81.toByte(), 1, 0xff.toByte())) }
    val oversize = byteArrayOf(1, 126, 0x4e, 0x20) + ByteArray(20000) + byteArrayOf(0x80.toByte(), 1)
    assertThrows(IllegalArgumentException::class.java) { read(oversize) }
  }
  @Test fun clientsMaskEveryFrameAndUseCanonicalLengths() {
    for (size in listOf(5, 126, 20000)) {
      val data = ByteArray(size) { (it % 127).toByte() }
      val out = ByteArrayOutputStream(); AxonWebSocket.write(DataOutputStream(out), data)
      val input = DataInputStream(ByteArrayInputStream(out.toByteArray()))
      assertEquals(0x81, input.readUnsignedByte()); val length = input.readUnsignedByte()
      assertTrue(length and 128 != 0)
      assertEquals(size, if (length and 127 == 126) input.readUnsignedShort() else length and 127)
      val mask = ByteArray(4); input.readFully(mask)
      val decoded = ByteArray(size) { i -> (input.readUnsignedByte() xor mask[i % 4].toInt()).toByte() }
      assertArrayEquals(data, decoded)
    }
  }
  @Test fun lanShutdownPreservesInternetReservationsButGlobalShutdownClosesBoth() {
    val transport = AxonSockets(); val lan = java.net.Socket(); val internet = java.net.Socket()
    try {
      transport.reserve(lan); transport.reserve(internet, true)
      transport.closeLan(); assertTrue(lan.isClosed); assertFalse(internet.isClosed)
      transport.closeAll(); assertTrue(internet.isClosed)
    } finally { transport.destroy() }
  }
  @Test fun controlFloodIsBounded() {
    val bytes = ByteArray(66) { if (it % 2 == 0) 0x8a.toByte() else 0 }
    assertThrows(IllegalStateException::class.java) { read(bytes) }
  }

  @Test(timeout = 15000) fun optionalPublicTlsHandshakeAndBoundedHello() {
    org.junit.Assume.assumeTrue(System.getenv("AXON_LIVE_TLS") == "1")
    val transport = AxonSockets()
    try {
      val tls = javax.net.ssl.SSLSocketFactory.getDefault().createSocket()
      val id = transport.reserve(tls, true)
      transport.connectWebSocket(id, "143.198.121.2", "axonic:1:" + "ab".repeat(32))
      val hello = transport.read(id)
      assertTrue(hello.contains("778f81f35399db5b3bfa5068e34aad2a4389f851b64aebc997cd453879cd008f"))
      assertTrue(hello.contains("hello"))
    } finally { transport.destroy() }
  }
}
