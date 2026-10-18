package expo.modules.axonicnearby

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING

/** Same-filesystem handoff after stream hash verification. Never delete the old
 * prefix first, and never fall back to a non-atomic copy/delete on failure. The
 * transfer worker still verifies the staged file before publishing a receipt. */
internal object AttachmentStreamStage {
  fun stage(filesDir: File, owner: String, temporary: String, digest: String, bytes: Long): Boolean {
    require(owner.matches(Regex("axonic:1:[0-9a-f]{64}")))
    require(listOf(temporary, digest).all { it.matches(Regex("[0-9a-f]{64}")) } && temporary != digest)
    require(bytes in 1..250L * 1024 * 1024)
    val root = File(filesDir.canonicalFile, "axonic-own-attachments-v1/${owner.substring(9)}/files")
    val source = File(root, "$temporary/content")
    val marker = File(root, "$temporary/stream-temporary-v1.json")
    val target = File(root, "$digest/partial")
    require(listOf(source, marker, target).all { it.canonicalFile == it.absoluteFile })
    require(source.isFile && source.length() == bytes && marker.isFile) { "Stream staging unavailable" }
    require(!File(target.parentFile, "stream-temporary-v1.json").exists())
    require(!File(target.parentFile, "shared.json").exists())
    require(!target.exists() || target.isFile)
    check(target.parentFile.isDirectory || target.parentFile.mkdirs()) { "Stream staging unavailable" }
    Files.move(source.toPath(), target.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
    return true
  }
}
