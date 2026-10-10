package expo.modules.axonicnearby

import org.junit.Assert.*
import org.junit.Test

class AttachmentHashTest {
  @Test fun matchesIndependentSha256Vectors() {
    assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", AttachmentHash.sha256("abc"))
    for ((length, expected) in listOf(
      34 to "ee3a4574a5ab72decdf6910a4ba07d14566910a0b8c4a8adad4805a652934b8c",
      8224 to "d3cd6540b11404765643243b610c57d511838cdc4ec31fc43149b6b0990ea409"
    )) assertEquals(expected, AttachmentHash.sha256("[\"axonic-attachment-leaf-v1\",63999,\"${"a".repeat(length)}\"]"))
  }
  @Test fun rejectsOversizedAndNonAsciiInputsBeforeEncoding() {
    for (value in listOf("", "a".repeat(8301), "é", "\uD800")) {
      try { AttachmentHash.sha256(value); fail("accepted invalid input") } catch (_: IllegalArgumentException) {}
    }
    assertEquals(64, AttachmentHash.sha256("a".repeat(8300)).length)
  }
}
