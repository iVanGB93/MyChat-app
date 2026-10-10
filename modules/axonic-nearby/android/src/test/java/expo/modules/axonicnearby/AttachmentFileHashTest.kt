package expo.modules.axonicnearby

import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Test

class AttachmentFileHashTest {
  private val owner = "axonic:1:" + "a".repeat(64)
  private val digest = "b".repeat(64)
  @Test fun streamsExactFileAcrossBufferBoundaries() {
    val root = Files.createTempDirectory("attachment-hash").toFile()
    try {
      val bytes = ByteArray(3 * 65536 + 17) { (it % 251).toByte() }
      val expected = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
      for (completed in listOf(false,true)) {
        val file = File(root,"axonic-own-attachments-v1/${owner.substring(9)}/files/$digest/${if(completed) "content" else "partial"}")
        file.parentFile.mkdirs();file.writeBytes(bytes)
        assertEquals(expected,AttachmentFileHash.sha256(root,owner,digest,completed,bytes.size.toLong()))
        for (length in listOf(0L, bytes.size.toLong()-1,bytes.size.toLong()+1,250L*1024*1024+1)) {
          assertThrows(IllegalArgumentException::class.java) { AttachmentFileHash.sha256(root,owner,digest,completed,length) }
        }
      }
      assertThrows(IllegalArgumentException::class.java) { AttachmentFileHash.sha256(root,"../outside",digest,false,1) }
      assertThrows(IllegalArgumentException::class.java) { AttachmentFileHash.sha256(root,owner,"../outside",false,1) }
      assertThrows(IllegalArgumentException::class.java) { AttachmentFileHash.sha256(root,owner,"c".repeat(64),false,1) }
    } finally { root.deleteRecursively() }
  }
  @Test fun cancellationDoesNotReturnDigest() {
    val root=Files.createTempDirectory("attachment-hash-cancel").toFile()
    try {
      val file=File(root,"axonic-own-attachments-v1/${owner.substring(9)}/files/$digest/partial")
      file.parentFile.mkdirs();file.writeBytes(byteArrayOf(1))
      Thread.currentThread().interrupt()
      assertThrows(IllegalStateException::class.java) { AttachmentFileHash.sha256(root,owner,digest,false,1) }
    } finally { Thread.interrupted();root.deleteRecursively() }
  }
}
