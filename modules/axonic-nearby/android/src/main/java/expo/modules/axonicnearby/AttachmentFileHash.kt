package expo.modules.axonicnearby

import java.io.File
import java.security.MessageDigest

/** Read-back verification of app-owned attachment bytes; never accepts a remote path. */
internal object AttachmentFileHash {
  fun sha256(filesDir: File, owner: String, digest: String, completed: Boolean, expectedBytes: Long): String {
    require(owner.matches(Regex("axonic:1:[0-9a-f]{64}")) && digest.matches(Regex("[0-9a-f]{64}")))
    require(expectedBytes in 1..250L * 1024 * 1024)
    val root = filesDir.canonicalFile
    val file = File(root, "axonic-own-attachments-v1/${owner.substring(9)}/files/$digest/${if (completed) "content" else "partial"}")
    require(file.canonicalFile == file.absoluteFile && file.isFile && file.length() == expectedBytes) { "Attachment file unavailable" }
    val hash = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(65536)
    var read = 0L
    try {
      file.inputStream().use { stream ->
        while (true) {
          check(!Thread.currentThread().isInterrupted) { "Attachment verification cancelled" }
          val count = stream.read(buffer)
          if (count < 0) break
          read += count
          require(read <= expectedBytes) { "Attachment size changed" }
          hash.update(buffer, 0, count)
        }
      }
      require(read == expectedBytes && file.length() == expectedBytes) { "Attachment size changed" }
      val alphabet = "0123456789abcdef"
      return buildString(64) { for (byte in hash.digest()) {
        val n = byte.toInt() and 255; append(alphabet[n ushr 4]); append(alphabet[n and 15])
      } }
    } finally { buffer.fill(0) }
  }
}
