package expo.modules.axonicappupdate

import android.app.Activity
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.util.Base64
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.provider.OpenableColumns
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.io.File
import java.io.InputStream
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.io.FileInputStream
import android.os.ParcelFileDescriptor
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import android.util.AtomicFile
import org.json.JSONObject

/** Shared storage only; no broad permissions and no remote/network operations. */
class AxonicMediaStoreModule : Module() {
  private var deletePromise: Promise? = null
  private var pickerPromise: Promise? = null
  private val context get() = requireNotNull(appContext.reactContext)
  private val resolver get() = context.contentResolver
  private val readers = ConcurrentHashMap<Int, Pair<ParcelFileDescriptor, FileInputStream>>()
  private val nextReader = AtomicInteger()
  private fun mediaUri(value: String): Uri = Uri.parse(value).also {
    require(it.scheme == "content" && it.authority in listOf("media", "com.android.providers.media.documents"))
  }

  override fun definition() = ModuleDefinition {
    Name("AxonicMediaStore")
    Constant("supported") { Build.VERSION.SDK_INT >= 29 }
    Constant("singleCopy") { Build.VERSION.SDK_INT >= 29 }
    AsyncFunction("pickMedia") { promise: Promise ->
      val activity = requireNotNull(appContext.currentActivity)
      activity.runOnUiThread {
        if (pickerPromise != null) { promise.reject("MEDIA_PICK", "Media picker already open", null); return@runOnUiThread }
        pickerPromise = promise
        try {
          val intent = if (Build.VERSION.SDK_INT >= 33) Intent(MediaStore.ACTION_PICK_IMAGES).apply {
            putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 4)
          } else Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
          }
          activity.startActivityForResult(intent, 48174)
        } catch (error: Exception) { pickerPromise = null; promise.reject("MEDIA_PICK", "Could not open media picker", error) }
      }
    }
    AsyncFunction("original") { source: String, assetId: String, mime: String ->
      require(assetId.matches(Regex("[0-9]{1,19}")))
      val sourceUri = Uri.parse(source)
      require(sourceUri.scheme == "file")
      val file = File(requireNotNull(sourceUri.path)).canonicalFile
      require(file.path.startsWith(context.cacheDir.canonicalPath + File.separator))
      val collection = if (mime.startsWith("video/")) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      val original = ContentUris.withAppendedId(collection, assetId.toLong())
      val matches = try { file.inputStream().use { hash(it) } == resolver.openInputStream(original)?.use { hash(it) } } catch (_: Exception) { false }
      if (matches) original.toString() else null
    }
    Function("stat") { value: String ->
      try {
        val uri = mediaUri(value)
        resolver.openFileDescriptor(uri, "r")?.use { fd ->
          mapOf("exists" to true, "size" to fd.statSize.coerceAtLeast(0))
        } ?: mapOf("exists" to false, "size" to 0)
      } catch (_: Exception) { mapOf("exists" to false, "size" to 0) }
    }
    Function("openRead") { value: String ->
      check(readers.size < 16) { "Too many media readers" }
      val fd = requireNotNull(resolver.openFileDescriptor(mediaUri(value), "r"))
      try {
        val stream = FileInputStream(fd.fileDescriptor)
        val id = nextReader.incrementAndGet()
        readers[id] = fd to stream
        id
      } catch (error: Exception) { fd.close(); throw error }
    }
    Function("read") { id: Int, offset: Double, length: Int ->
      require(offset.isFinite() && offset >= 0 && offset <= 250L * 1024 * 1024 && offset == offset.toLong().toDouble())
      require(length in 1..3_000_000)
      val reader = requireNotNull(readers[id]) { "Media reader closed" }
      synchronized(reader) {
        val buffer = ByteBuffer.allocate(length)
        val channel = reader.second.channel
        while (buffer.hasRemaining()) {
          val n = channel.read(buffer, offset.toLong() + buffer.position())
          if (n <= 0) break
        }
        buffer.array().copyOf(buffer.position())
      }
    }
    Function("closeRead") { id: Int ->
      readers.remove(id)?.let { reader -> synchronized(reader) {
        try { reader.second.close() } finally { reader.first.close() }
      } }
    }
    AsyncFunction("sha256") { value: String ->
      requireNotNull(resolver.openInputStream(mediaUri(value))).use { hash(it) }
    }
      AsyncFunction("hashBlocks") { value: String, expectedBytes: Int ->
        require(expectedBytes in 1..(250 * 1024 * 1024))
        val uri = Uri.parse(value)
        val input = if (uri.scheme == "content") {
          requireNotNull(resolver.openInputStream(mediaUri(value)))
        } else {
          require(uri.scheme == "file")
          val file = File(requireNotNull(uri.path)).canonicalFile
          val root = File(context.filesDir, "axonic-own-attachments-v1").canonicalFile
          require(file.path.startsWith(root.path + File.separator) && file.name == "content")
          file.inputStream()
        }
        input.use { stream ->
          val full = MessageDigest.getInstance("SHA-256")
          var block = MessageDigest.getInstance("SHA-256")
          val hashes = ArrayList<String>()
          val buffer = ByteArray(256 * 1024)
          var total = 0
          while (total < expectedBytes) {
            val count = stream.read(buffer, 0, minOf(buffer.size, expectedBytes - total, 3_000_000 - total % 3_000_000))
            check(count > 0) { "Attachment source truncated" }
            full.update(buffer, 0, count); block.update(buffer, 0, count); total += count
            if (total % 3_000_000 == 0 || total == expectedBytes) {
              hashes.add(block.digest().joinToString("") { "%02x".format(it) })
              block = MessageDigest.getInstance("SHA-256")
            }
          }
          check(stream.read() == -1) { "Attachment source size changed" }
          buffer.fill(0)
          mapOf("bytes" to total, "checksum" to full.digest().joinToString("") { "%02x".format(it) }, "blocks" to hashes)
        }
      }
    AsyncFunction("adopt") { source: String, value: String ->
      val uri = Uri.parse(source)
      require(uri.scheme == "file")
      val file = File(requireNotNull(uri.path)).canonicalFile
      require(file.name == "content" && file.path.startsWith(File(context.filesDir, "axonic-own-attachments-v1").canonicalPath + File.separator))
      val destination = mediaUri(value)
      val reference = AtomicFile(File(file.parentFile, "media.json"))
      val previous = try { JSONObject(String(reference.readFully())).optString("uri") } catch (_: Exception) { null }
      require(previous == null || previous == value) { "Media reference already committed" }
      if (previous == null) {
        check(file.isFile && file.inputStream().use { hash(it) } ==
          requireNotNull(resolver.openInputStream(destination)).use { hash(it) }) { "Shared media verification failed" }
        val output = reference.startWrite()
        try {
          output.write(JSONObject().put("uri", value).toString().toByteArray())
          reference.finishWrite(output)
        } catch (error: Exception) { reference.failWrite(output); throw error }
      }
      // A missing gallery item after this point is a user's deletion, not a
      // reason to recreate it. Crash recovery removes only the private replica.
      if (file.exists()) check(file.delete()) { "Private media cleanup pending" }
    }
    AsyncFunction("videoThumbnail") { source: String ->
      val uri = Uri.parse(source)
      val file = if (uri.scheme == "content") { mediaUri(source); null } else {
        require(uri.scheme == "file")
        File(requireNotNull(uri.path)).canonicalFile.also {
          val root = File(context.filesDir, "axonic-own-attachments-v1").canonicalFile
          require(it.path.startsWith(root.path + File.separator) && it.name == "content" && it.isFile)
        }
      }
      val retriever = MediaMetadataRetriever()
      var frame: Bitmap? = null
      try {
        if (file != null) retriever.setDataSource(file.path) else retriever.setDataSource(context, uri)
        frame = if (Build.VERSION.SDK_INT >= 27)
          retriever.getScaledFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 440, 440)
        else retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        val bitmap = frame
        if (bitmap == null) null else {
          val scale = minOf(1.0, 440.0 / maxOf(bitmap.width, bitmap.height))
          val small = if (scale < 1) Bitmap.createScaledBitmap(bitmap,
            maxOf(1, (bitmap.width * scale).toInt()), maxOf(1, (bitmap.height * scale).toInt()), true) else bitmap
          try {
            ByteArrayOutputStream().use { output ->
              check(small.compress(Bitmap.CompressFormat.JPEG, 80, output))
              "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
            }
          } finally { if (small !== bitmap) small.recycle() }
        }
      } finally { frame?.recycle(); retriever.release() }
    }
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
      if (result.requestCode == 48174) {
        val promise = pickerPromise
        pickerPromise = null
        if (result.resultCode != Activity.RESULT_OK) promise?.resolve(mapOf("canceled" to true, "assets" to emptyList<Any>()))
        else try {
          val intent = requireNotNull(result.data)
          val uris = intent.clipData?.let { clip -> (0 until clip.itemCount).map { clip.getItemAt(it).uri } }
            ?: listOf(requireNotNull(intent.data))
          require(uris.size in 1..4) { "Choose up to four attachments" }
          val assets = uris.map { uri ->
            require(uri.scheme == "content")
            resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            var name = "Attachment"; var size = 0L
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
              if (cursor.moveToFirst()) { name = cursor.getString(0) ?: name; if (!cursor.isNull(1)) size = cursor.getLong(1) }
            }
            val mime = resolver.getType(uri) ?: "application/octet-stream"
            require(mime.startsWith("image/") || mime.startsWith("video/"))
            mapOf("uri" to uri.toString(), "fileName" to name, "mimeType" to mime, "fileSize" to size,
              "type" to if (mime.startsWith("video/")) "video" else "image")
          }
          promise?.resolve(mapOf("canceled" to false, "assets" to assets))
        } catch (error: Exception) { promise?.reject("MEDIA_PICK", "Could not retain access to selected media; please select it again", error) }
      }
      if (result.requestCode == 48173) {
        deletePromise?.resolve(result.resultCode == Activity.RESULT_OK)
        deletePromise = null
      }
    }
    OnDestroy {
      deletePromise?.resolve(false); deletePromise = null
      pickerPromise?.resolve(mapOf("canceled" to true, "assets" to emptyList<Any>())); pickerPromise = null
      readers.values.forEach { try { it.second.close() } finally { it.first.close() } }
      readers.clear()
    }
    // Resolve a granted content URI only after the user confirms sharing. Bound
    // the copy even when a provider omits or lies about its reported size.
    AsyncFunction("copyShared") { value: String ->
      val uri = Uri.parse(value)
      require(uri.scheme == "content") { "Expected a shared content URI" }
      val target = File.createTempFile("axonic-share-", ".tmp", context.cacheDir)
      try {
        var total = 0L
        requireNotNull(resolver.openInputStream(uri)).use { input ->
          target.outputStream().use { output ->
            val buffer = ByteArray(65536)
            while (true) {
              val count = input.read(buffer)
              if (count < 0) break
              total += count
              require(total <= 250L * 1024 * 1024) { "Choose a file no larger than 250 MiB" }
              output.write(buffer, 0, count)
            }
          }
        }
        require(total > 0) { "The shared file is empty" }
        Uri.fromFile(target).toString()
      } catch (error: Exception) { target.delete(); throw error }
    }
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
      // A forwarded/picked original remains the sole permanent file when its
      // granted URI still resolves to exactly the bytes that were sent.
      val origin = File(file.parentFile, "origin.json")
      if (origin.isFile && origin.length() in 1..4096) {
        val original = try { mediaUri(JSONObject(origin.readText()).getString("uri")) } catch (_: Exception) { null }
        if (original != null) {
          val matches = try { resolver.openInputStream(original)?.use { hash(it) } == digest } catch (_: Exception) { false }
          if (matches) return@AsyncFunction original.toString()
        }
      }
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
      // Picked originals belong to the user, not this message. Never remove
      // them automatically when deleting a chat or a forwarded message.
      if (uri.scheme == "content" && (uri.authority != "media" || uri.pathSegments.firstOrNull() !in listOf("external", "external_primary"))) return@AsyncFunction "needs-confirmation"
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
