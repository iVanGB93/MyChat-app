package expo.modules.axonicnearby

import java.io.File
import java.security.MessageDigest

/** Read-back verification of app-owned attachment bytes; never accepts a remote path. */
internal object AttachmentFileHash {
  fun sha256(filesDir: File, owner: String, digest: String, completed: Boolean, expectedBytes: Long, staged: Boolean = false): String {
    require(owner.matches(Regex("axonic:1:[0-9a-f]{64}")) && digest.matches(Regex("[0-9a-f]{64}")))
    require(expectedBytes in 1..250L * 1024 * 1024)
    val root = filesDir.canonicalFile
    require(!staged || completed)
    val accountRoot = File(root, "axonic-own-attachments-v1/${owner.substring(9)}")
    var directory = File(accountRoot, "${if (staged) "staging" else "files"}/$digest")
    // Group sends share one private immutable payload across recipient grants.
    // Match the app-owned shared.json writer, never accept a path from the link.
    val link = File(directory, "shared.json")
    if (!staged && completed && link.exists()) {
      require(link.canonicalFile == link.absoluteFile && link.isFile && link.length() in 1..256)
      val shared = Regex("""\s*\{\s*"id"\s*:\s*"([0-9a-f]{64})"\s*}\s*""").matchEntire(link.readText())?.groupValues?.get(1)
      requireNotNull(shared) { "Invalid shared attachment reference" }
      directory = File(accountRoot, "shared/$shared")
    }
    val file = File(directory, if (completed) "content" else "partial")
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
