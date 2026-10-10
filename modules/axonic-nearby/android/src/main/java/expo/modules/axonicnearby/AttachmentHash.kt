package expo.modules.axonicnearby

import java.security.MessageDigest

/** Bounded public ciphertext leaf input, never a key or plaintext. */
internal object AttachmentHash {
  fun sha256(value: String): String {
    require(value.length in 1..8300 && value.all { it.code < 128 }) { "Invalid attachment hash input" }
    val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.US_ASCII))
    val alphabet = "0123456789abcdef"
    return buildString(64) {
      for (byte in digest) { val n = byte.toInt() and 255; append(alphabet[n ushr 4]); append(alphabet[n and 15]) }
    }
  }
}
