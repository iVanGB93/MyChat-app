package expo.modules.axonicappupdate

import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.database.DatabaseErrorHandler
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID

/** Reads the unchanged AsyncStorage format without loading a whole value into CursorWindow.
 * Never creates, repairs, migrates, deletes or writes the source database.
 */
class ChatStorageRecovery(private val source: File, private val backupDirectory: File) {
  private var verified = false
  companion object {
    private val lock = Any()
    const val CHUNK_BYTES = 512 * 1024
    const val MAX_DATABASE_BYTES = 64L * 1024 * 1024
    private fun openRead(file: File) = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY,
      DatabaseErrorHandler { throw SQLiteException("AXONIC_STORAGE_CORRUPT") })
    // VACUUM INTO was added in SQLite 3.27. Check the actual engine, not an OEM/API guess.
    val supported: Boolean by lazy {
      SQLiteDatabase.create(null).use { db -> db.rawQuery("SELECT sqlite_version()", null).use { cursor ->
        check(cursor.moveToFirst()); val parts = cursor.getString(0).split('.').map { it.toInt() }
        parts[0] > 3 || parts[0] == 3 && parts[1] >= 27
      } }
    }
  }
  private fun digest(file: File): String {
    val hash = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input -> val buffer = ByteArray(CHUNK_BYTES); while (true) {
      val count = input.read(buffer); if (count < 0) break; hash.update(buffer, 0, count)
    } }
    return hash.digest().joinToString("") { "%02x".format(it) }
  }
  private fun preserve(db: SQLiteDatabase) {
    if (verified) return
    check(backupDirectory.exists() || backupDirectory.mkdirs()) { "Recovery snapshot directory unavailable" }
    val snapshot = File(backupDirectory, "RKStorage.sqlite")
    val checksum = File(backupDirectory, "RKStorage.sha256")
    if (snapshot.exists()) {
      check(checksum.exists() && checksum.readText() == digest(snapshot)) { "Recovery snapshot verification failed" }
      verified = true
      return
    }
    // VACUUM INTO creates a consistent SQLite snapshot, including committed WAL content.
    // It runs outside the read transaction and never changes the source schema or rows.
    val pending = File(backupDirectory, "snapshot-${UUID.randomUUID()}.pending")
    try {
    db.execSQL("VACUUM INTO ?", arrayOf(pending.absolutePath))
    FileOutputStream(pending, true).use { it.fd.sync() }
    openRead(pending).use { copy ->
      copy.rawQuery("PRAGMA integrity_check", null).use { result ->
        check(result.moveToFirst() && result.getString(0) == "ok" && !result.moveToNext()) { "Recovery snapshot is not valid" }
      }
    }
    val hash = digest(pending)
    // Publish checksum first. An interrupted publication never treats a partial file as a backup.
    FileOutputStream(checksum).use { it.write(hash.toByteArray(Charsets.US_ASCII)); it.fd.sync() }
    check(pending.renameTo(snapshot)) { "Could not finalize recovery snapshot" }
    check(digest(snapshot) == hash) { "Recovery snapshot changed during publication" }
    verified = true
    } finally {
      // Only this attempt's incomplete output; never the original or published snapshot.
      if (pending.exists()) pending.delete()
    }
  }
  fun read(owner: String, chunkBytes: Int = CHUNK_BYTES): String? = synchronized(lock) {
    require(chunkBytes in 64 * 1024..CHUNK_BYTES) { "Invalid read chunk size" }
    require(Regex("axonic:1:[a-f0-9]{64}").matches(owner)) { "Invalid chat owner" }
    if (!source.exists()) return@synchronized null
    openRead(source).use { db ->
      try { preserve(db) } catch (error: Exception) { throw IllegalStateException("AXONIC_BACKUP_FAILED", error) }
      db.execSQL("BEGIN DEFERRED")
      try {
        val key = "@axonic_root_chat_v1:$owner"
        val length = db.rawQuery("SELECT length(CAST(value AS BLOB)) FROM catalystLocalStorage WHERE key=?", arrayOf(key)).use { cursor ->
          if (!cursor.moveToFirst()) return@use null
          check(!cursor.isNull(0)) { "Chat value is null" }; cursor.getLong(0)
        } ?: return@synchronized null
        check(length <= Int.MAX_VALUE) { "Chat value exceeds supported size; original preserved" }
        val result = ByteArrayOutputStream()
        var offset = 0L
        while (offset < length) {
          val chunk = db.rawQuery("SELECT substr(CAST(value AS BLOB),?,?) FROM catalystLocalStorage WHERE key=?",
            arrayOf((offset + 1).toString(), chunkBytes.toString(), key)).use { cursor ->
            check(cursor.moveToFirst()) { "Chat value disappeared" }; cursor.getBlob(0)
          }
          check(chunk.isNotEmpty() && chunk.size <= chunkBytes && offset + chunk.size <= length) { "Incomplete chat read" }
          result.write(chunk); offset += chunk.size
        }
        // Decode once: a chunk can end inside a multi-byte emoji or accented character.
        Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(result.toByteArray())).toString()
      } finally { db.execSQL("ROLLBACK") }
    }
  }
  /** Conservative capacity checks, before a write. SQLite transactions remain the final guard. */
  fun checkWrite(owner: String, bytes: Long, availableBytes: Long = source.parentFile!!.usableSpace) = synchronized(lock) {
    require(Regex("axonic:1:[a-f0-9]{64}").matches(owner))
    check(bytes >= 0 && bytes <= 48L * 1024 * 1024) { "AXONIC_HISTORY_TOO_LARGE" }
    check(availableBytes >= 2 * maxOf(source.length(), bytes) + 8L * 1024 * 1024) { "AXONIC_STORAGE_FULL" }
    if (source.exists()) openRead(source).use { db ->
      try { preserve(db) } catch (error: Exception) { throw IllegalStateException("AXONIC_BACKUP_FAILED", error) }
      fun scalar(sql: String): Long = db.rawQuery(sql, null).use { check(it.moveToFirst()); it.getLong(0) }
      val used = (scalar("PRAGMA page_count") - scalar("PRAGMA freelist_count")) * scalar("PRAGMA page_size")
      val oldBytes = db.rawQuery("SELECT length(CAST(value AS BLOB)) FROM catalystLocalStorage WHERE key=?", arrayOf("@axonic_root_chat_v1:$owner")).use { if (it.moveToFirst()) it.getLong(0) else 0L }
      check(used - oldBytes + bytes + 1024 * 1024 <= MAX_DATABASE_BYTES) { "AXONIC_STORAGE_FULL" }
    }
  }
}
