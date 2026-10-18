package expo.modules.axonicnearby

import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AttachmentStreamStageTest {
  @get:Rule val temporaryFolder = TemporaryFolder()
  private val owner = "axonic:1:" + "a".repeat(64)
  private val temporary = "b".repeat(64)
  private val digest = "c".repeat(64)
  private fun path(id: String, name: String) = File(temporaryFolder.root, "axonic-own-attachments-v1/${owner.substring(9)}/files/$id/$name")
  private fun prepare() {
    path(temporary, "content").apply { parentFile.mkdirs(); writeText("complete verified file") }
    path(temporary, "stream-temporary-v1.json").writeText("{\"expires\":9999999999999}")
    path(digest, "partial").apply { parentFile.mkdirs(); writeText("complete") }
  }
  private fun stage() = AttachmentStreamStage.stage(temporaryFolder.root, owner, temporary, digest, 22)
  @Test fun atomicallyReplacesPrefixWithoutPublishingContent() {
    prepare(); assertTrue(stage())
    assertEquals("complete verified file", path(digest, "partial").readText())
    assertFalse(path(temporary, "content").exists())
    assertFalse(path(digest, "content").exists())
    assertTrue(path(temporary, "stream-temporary-v1.json").exists())
  }
  @Test fun freshDownloadUsesSameHandoff() {
    prepare(); path(digest, "partial").delete(); assertTrue(stage())
    assertEquals(22L, path(digest, "partial").length())
  }
  @Test fun missingOrWrongSizeSourceLeavesPrefixAlone() {
    prepare(); path(temporary, "content").writeText("short")
    assertThrows(IllegalArgumentException::class.java) { stage() }
    assertEquals("complete", path(digest, "partial").readText())
    path(temporary, "content").delete()
    assertThrows(IllegalArgumentException::class.java) { stage() }
    assertEquals("complete", path(digest, "partial").readText())
  }
  @Test fun missingMarkerAndSharedTargetAreRejected() {
    prepare(); path(temporary, "stream-temporary-v1.json").delete()
    assertThrows(IllegalArgumentException::class.java) { stage() }
    prepare(); path(digest, "shared.json").writeText("{}")
    assertThrows(IllegalArgumentException::class.java) { stage() }
    assertEquals("complete", path(digest, "partial").readText())
  }
  @Test fun malformedPathsOrSameAttemptCannotMutateFiles() {
    prepare()
    for (id in listOf("../other", "B".repeat(64), "", digest)) {
      assertThrows(IllegalArgumentException::class.java) { AttachmentStreamStage.stage(temporaryFolder.root, owner, id, digest, 22) }
    }
    for (bytes in listOf(0L, -1L, 250L * 1024 * 1024 + 1)) {
      assertThrows(IllegalArgumentException::class.java) { AttachmentStreamStage.stage(temporaryFolder.root, owner, temporary, digest, bytes) }
    }
    assertEquals("complete", path(digest, "partial").readText())
  }
  @Test fun directoryCollisionLeavesVerifiedSourceIntact() {
    prepare(); path(digest, "partial").delete(); path(digest, "partial").mkdir()
    assertThrows(IllegalArgumentException::class.java) { stage() }
    assertEquals("complete verified file", path(temporary, "content").readText())
  }
}
