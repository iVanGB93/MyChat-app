package expo.modules.axonicnearby

import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AttachmentHashTest {
  @Test fun matchesIndependentSha256Vectors() {
    assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", AttachmentHash.sha256("abc"))
    for ((length, expected) in listOf(
      34 to "ee3a4574a5ab72decdf6910a4ba07d14566910a0b8c4a8adad4805a652934b8c",
      8224 to "d3cd6540b11404765643243b610c57d511838cdc4ec31fc43149b6b0990ea409"
    )) assertEquals(expected, AttachmentHash.sha256("[\"axonic-attachment-leaf-v1\",63999,\"${"a".repeat(length)}\"]"))
  }
  @Test fun exactAsciiDigestAtShippingBounds() {
    for (size in listOf(1, 4096, AttachmentHash.MAX_CANONICAL_BYTES)) {
      val input = "a".repeat(size)
      val expected = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.US_ASCII))
        .joinToString("") { "%02x".format(it.toInt() and 255) }
      assertEquals(expected, AttachmentHash.sha256(input))
    }
  }
  @Test fun streamLeafSizesMatchIndependentDigest() {
    for (length in listOf(32768, 131072, 524448)) {
      val input="a".repeat(length)
      val expected=MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.US_ASCII)).joinToString(""){"%02x".format(it.toInt() and 255)}
      assertEquals(expected,AttachmentHash.sha256(input))
    }
  }
  @Test fun invalidBoundsAndNonAsciiStayRejected() {
    for (input in listOf("", "a".repeat(AttachmentHash.MAX_CANONICAL_BYTES + 1), "aé", "\uD800", "\uD83D\uDE00")) {
      assertThrows(IllegalArgumentException::class.java) { AttachmentHash.sha256(input) }
    }
  }
}
