package expo.modules.axonicappupdate

import android.app.Activity
import android.content.ContentUris
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/** Shared storage only; no broad permissions and no remote/network operations. */
class AxonicMediaStoreModule : Module() {
  private var deletePromise: Promise? = null
  private val context get() = requireNotNull(appContext.reactContext)
  private val resolver get() = context.contentResolver

  override fun definition() = ModuleDefinition {
    Name("AxonicMediaStore")
    Constant("supported") { Build.VERSION.SDK_INT >= 29 }
    AsyncFunction("requestDelete") { value: String, messageId: String, promise: Promise ->
      try {
        check(Build.VERSION.SDK_INT >= 30)
        val uri = Uri.parse(value)
        require(uri.scheme == "content" && uri.authority == "media")
        var managed = false
        resolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) {
            val name = cursor.getString(0) ?: ""
            managed = name.startsWith("AXN_") && Uri.decode(name.substringAfter("AXN_").substringBefore("__")) == messageId &&
              cursor.getString(1) in listOf("Pictures/Axonic/", "Movies/Axonic/", "Download/Axonic/")
          }
        }
        require(managed) { "File is not a recorded Axonic attachment" }
        val activity = requireNotNull(appContext.currentActivity)
        val request = MediaStore.createDeleteRequest(resolver, listOf(uri))
        activity.runOnUiThread {
          if (deletePromise != null) { promise.resolve(false); return@runOnUiThread }
          deletePromise = promise
          try { activity.startIntentSenderForResult(request.intentSender, 48173, null, 0, 0, 0) }
          catch (error: Exception) { deletePromise = null; promise.reject("MEDIA_DELETE", "Could not request deletion", error) }
        }
      } catch (error: Exception) { promise.reject("MEDIA_DELETE", "Use Gallery or Files to remove this attachment", error) }
    }
    OnActivityResult { _, result ->
      if (result.requestCode == 48173) {
        deletePromise?.resolve(result.resultCode == Activity.RESULT_OK)
        deletePromise = null
      }
    }
    OnDestroy { deletePromise?.resolve(false); deletePromise = null }
    AsyncFunction("save") { source: String, name: String, mime: String, kind: String ->
      check(Build.VERSION.SDK_INT >= 29)
      require(name.startsWith("AXN_") && !name.contains('/') && !name.contains('\\'))
      val sourceUri = Uri.parse(source)
      require(sourceUri.scheme == "file")
      val file = File(requireNotNull(sourceUri.path)).canonicalFile
      require(listOf(context.filesDir, context.cacheDir).any {
        file.path.startsWith(it.canonicalPath + File.separator)
      }) { "Source must be Axonic private storage" }
      require(file.isFile && file.length() > 0)
      val collection = when (kind) {
        "image" -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        "video" -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        else -> MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      }
      val folder = when (kind) {
        "image" -> "Pictures/Axonic/"
        "video" -> "Movies/Axonic/"
        else -> "Download/Axonic/"
      }
      // Reuse a completed identical export after a crash between publishing
      // and SQLite relinking. Never overwrite an existing different file.
      val digest = file.inputStream().use { hash(it) }
      var existing: Uri? = null
      resolver.query(collection, arrayOf("_id", MediaStore.MediaColumns.IS_PENDING),
        "${MediaStore.MediaColumns.DISPLAY_NAME}=? AND ${MediaStore.MediaColumns.RELATIVE_PATH}=? AND ${MediaStore.MediaColumns.OWNER_PACKAGE_NAME}=?",
        arrayOf(name, folder, context.packageName), null)?.use { cursor ->
        while (cursor.moveToNext() && existing == null) {
          val candidate = ContentUris.withAppendedId(collection, cursor.getLong(0))
          val matches = try { resolver.openInputStream(candidate)?.use { hash(it) } == digest } catch (_: Exception) { false }
          if (matches) {
            // Process death can leave a complete but unpublished row. Verify
            // before publishing it; never expose a partial attachment.
            if (cursor.getInt(1) != 0) {
              check(resolver.update(candidate, ContentValues().apply {
                put(MediaStore.MediaColumns.IS_PENDING, 0)
              }, null, null) == 1)
            }
            existing = candidate
          }
        }
      }
      if (existing != null) return@AsyncFunction existing.toString()
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
        put(MediaStore.MediaColumns.MIME_TYPE, mime)
        put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
      val destination = requireNotNull(resolver.insert(collection, values))
      try {
        requireNotNull(resolver.openOutputStream(destination, "w")).use { output ->
          file.inputStream().use { it.copyTo(output, 256 * 1024) }
        }
        check(resolver.openInputStream(destination)?.use { hash(it) } == digest) { "Media verification failed" }
        check(resolver.update(destination, ContentValues().apply {
          put(MediaStore.MediaColumns.IS_PENDING, 0)
        }, null, null) == 1)
        destination.toString()
      } catch (error: Exception) {
        // Only the row created by this attempt is eligible for rollback.
        try { resolver.delete(destination, null, null) } catch (_: Exception) {}
        throw error
      }
    }
    AsyncFunction("available") { value: String ->
      try { resolver.openInputStream(Uri.parse(value))?.use { it.read() >= 0 } ?: false }
      catch (_: Exception) { false }
    }
    AsyncFunction("deleteOwned") { value: String, messageId: String ->
      check(Build.VERSION.SDK_INT >= 29)
      val uri = Uri.parse(value)
      require(uri.scheme == "content" && uri.authority == "media" && uri.lastPathSegment?.toLongOrNull() != null)
      var found = false
      var owned = false
      resolver.query(uri, arrayOf(MediaStore.MediaColumns.OWNER_PACKAGE_NAME,
        MediaStore.MediaColumns.RELATIVE_PATH, MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          found = true
          val name = cursor.getString(2) ?: ""
          val identity = if (name.startsWith("AXN_") && name.contains("__")) Uri.decode(name.substringAfter("AXN_").substringBefore("__")) else ""
          owned = cursor.getString(0) == context.packageName && identity == messageId &&
            cursor.getString(1) in listOf("Pictures/Axonic/", "Movies/Axonic/", "Download/Axonic/")
        }
      }
      if (!found) "missing"
      else if (!owned) "needs-confirmation"
      else {
        try { if (resolver.delete(uri, null, null) == 1) "deleted" else "needs-confirmation" }
        catch (_: SecurityException) { "needs-confirmation" }
      }
    }
  }

  private fun hash(input: InputStream): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(256 * 1024)
    while (true) {
      val count = input.read(buffer)
      if (count < 0) break
      digest.update(buffer, 0, count)
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
