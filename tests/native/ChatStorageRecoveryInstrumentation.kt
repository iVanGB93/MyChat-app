package com.axonic

import android.app.Instrumentation
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteBlobTooBigException
import android.database.sqlite.SQLiteCursor
import android.database.CursorWindow
import android.os.Bundle
import expo.modules.axonicappupdate.ChatStorageRecovery
import java.io.File
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
import android.content.Context
import android.content.ContextWrapper
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteException
import com.reactnativecommunity.asyncstorage.ReactDatabaseSupplier
import android.webkit.WebView
import android.webkit.JavascriptInterface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Synthetic fixtures only. Never resolves the application's RKStorage path. */
class ChatStorageRecoveryInstrumentation : Instrumentation() {
  private fun testSafety(root: File, result: Bundle) {
    var deletionAttempts = 0
    val isolated = object : ContextWrapper(targetContext) {
      override fun getApplicationContext(): Context = this
      override fun getDatabasePath(name: String) = File(root, "supplier-$name")
      override fun openOrCreateDatabase(name: String, mode: Int, factory: SQLiteDatabase.CursorFactory?, handler: DatabaseErrorHandler?): SQLiteDatabase =
        SQLiteDatabase.openDatabase(getDatabasePath(name).path, factory, SQLiteDatabase.CREATE_IF_NECESSARY, handler)
      override fun openOrCreateDatabase(name: String, mode: Int, factory: SQLiteDatabase.CursorFactory?): SQLiteDatabase = openOrCreateDatabase(name, mode, factory, null)
      override fun deleteDatabase(name: String): Boolean { deletionAttempts++; error("Unexpected database deletion") }
    }
    val constructor = ReactDatabaseSupplier::class.java.getDeclaredConstructor(Context::class.java).also { it.isAccessible = true }
    val file = isolated.getDatabasePath("RKStorage")
    val corrupt = "synthetic-not-a-database".repeat(100).toByteArray()
    file.writeBytes(corrupt)
    val badSupplier = constructor.newInstance(isolated)
    var failed = false
    try { badSupplier.get() } catch (expected: SQLiteException) { failed = true }
    check(failed && file.readBytes().contentEquals(corrupt) && deletionAttempts == 0) { "Corrupt source was changed or deleted" }
    badSupplier.closeDatabase()
    // Only the explicitly-created synthetic fixture is replaced for the next test.
    check(file.delete())
    val supplier = constructor.newInstance(isolated)
    val db = supplier.get()
    check(db.maximumSize >= 64L * 1024 * 1024)
    val owner = "axonic:1:" + "ef".repeat(32)
    val key = "@axonic_root_chat_v1:$owner"
    val large = "x".repeat(8 * 1024 * 1024)
    val reader = ChatStorageRecovery(file, File(root, "capacity-snapshot"))
    reader.checkWrite(owner, large.length.toLong())
    db.beginTransaction()
    try { db.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf(key, large)); db.setTransactionSuccessful() } finally { db.endTransaction() }
    check(reader.read(owner) == large) { "History above the old 6 MiB ceiling failed" }
    var full = false
    try { reader.checkWrite(owner, large.length.toLong(), 0) } catch (expected: IllegalStateException) { full = expected.message == "AXONIC_STORAGE_FULL" }
    check(full && reader.read(owner) == large)
    var schemaRefused = false
    try { supplier.onUpgrade(db, 1, 2) } catch (expected: SQLiteException) { schemaRefused = true }
    check(schemaRefused && reader.read(owner) == large && deletionAttempts == 0)
    // Force a real SQLite quota failure in this fixture and verify rollback.
    db.setMaximumSize(file.length())
    db.beginTransaction()
    var quotaRefused = false
    try { db.execSQL("INSERT INTO catalystLocalStorage VALUES ('over-capacity',?)", arrayOf(large)); db.setTransactionSuccessful() }
    catch (expected: SQLiteException) { quotaRefused = true }
    finally { try { db.endTransaction() } catch (expected: SQLiteException) { check(quotaRefused) } }
    check(quotaRefused && reader.read(owner) == large)
    result.putBoolean("corruptDatabasePreserved", true)
    result.putBoolean("schemaChangeRefusedWithoutDeletion", true)
    result.putBoolean("eightMiBWriteRead", true)
    result.putBoolean("lowSpaceAndQuotaPreserveOldValue", true)
    supplier.closeDatabase()
    val done = CountDownLatch(1)
    var jsResult = ""
    var web: WebView? = null
    val source = context.assets.open("storage-safety.js").bufferedReader().use { it.readText() }
    runOnMainSync {
      web = WebView(targetContext).also { view ->
        view.settings.javaScriptEnabled = true
        view.addJavascriptInterface(object { @JavascriptInterface fun finish(value: String) { jsResult = value; done.countDown() } }, "probe")
        view.evaluateJavascript(source, null)
      }
    }
    check(done.await(20, TimeUnit.SECONDS)) { "Device JS safety test timed out" }
    runOnMainSync { web?.destroy() }
    check(jsResult == "PASS") { "Device JS safety test: $jsResult" }
    result.putBoolean("deviceJsBackoffAndSafeErrors", true)
  }
  override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
  override fun onStart() {
    val result = Bundle()
    try {
      check(targetContext.packageName == "com.axonic.dev") { "Dev-only test" }
      val root = File(targetContext.cacheDir, "synthetic-chat-recovery-${UUID.randomUUID()}")
      check(root.mkdirs())
      testSafety(root, result)
      val source = File(root, "synthetic.sqlite")
      val backup = File(root, "snapshot")
      val owner = "axonic:1:" + "ab".repeat(32)
      val key = "@axonic_root_chat_v1:$owner"
      val messages = JSONArray()
      repeat(2400) { i -> messages.put(JSONObject().put("id", i).put("text", "Hola 🧠 café 中文 ".repeat(70)).put("status", "delivered")) }
      val raw = JSONObject().put("version", 1).put("messages", messages).put("contacts", JSONArray()).toString()
      SQLiteDatabase.openOrCreateDatabase(source, null).use { db ->
        db.enableWriteAheadLogging()
        db.execSQL("CREATE TABLE catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execSQL("INSERT INTO catalystLocalStorage VALUES (?,?)", arrayOf(key, raw))
        db.execSQL("INSERT INTO catalystLocalStorage VALUES ('other-setting','preserve-me')")
        var reproduced = false
        try { db.rawQuery("SELECT key,value FROM catalystLocalStorage WHERE key=?", arrayOf(key)).use {
          // Pin the window size so this regression fixture is deterministic across
          // Android/OEM versions; it is not a measurement of their default limit.
          (it as SQLiteCursor).window = CursorWindow("synthetic-recovery-test", 2L * 1024 * 1024)
          it.moveToFirst(); it.getString(1)
        } }
        catch (expected: SQLiteBlobTooBigException) { reproduced = true }
        check(reproduced) { "Fixture did not reproduce CursorWindow failure" }
        result.putBoolean("originalFailureReproduced", true)
        result.putInt("testCursorWindowBytes", 2 * 1024 * 1024)
        val reader = ChatStorageRecovery(source, backup)
        check(reader.read(owner) == raw) { "Recovery changed synthetic history" }
        val timings64 = mutableListOf<Long>()
        val timings512 = mutableListOf<Long>()
        repeat(6) { iteration ->
          for (size in if (iteration % 2 == 0) listOf(65536, 524288) else listOf(524288, 65536)) {
            val began = System.nanoTime()
            val recovered = reader.read(owner, size)
            val milliseconds = (System.nanoTime() - began) / 1000000
            check(recovered == raw) { "Chunk comparison changed history" }
            (if (size == 65536) timings64 else timings512).add(milliseconds)
          }
        }
        result.putString("read64KiBMs", timings64.joinToString(","))
        result.putString("read512KiBMs", timings512.joinToString(","))
        check(reader.read("axonic:1:" + "cd".repeat(32)) == null)
        check(JSONObject(reader.read(owner)!!).getJSONArray("messages").length() == 2400)
        check(ChatStorageRecovery(source, backup).read(owner) == raw) { "Restart read failed" }
        val changed = raw.replace("Hola", "Hello")
        db.execSQL("UPDATE catalystLocalStorage SET value=? WHERE key=?", arrayOf(changed, key))
        check(reader.read(owner) == changed) { "Subsequent write not visible" }
        // The independent backup must retain the pre-write content, including WAL data.
        check(ChatStorageRecovery(File(backup, "RKStorage.sqlite"), File(root, "verify-copy")).read(owner) == raw)
        db.rawQuery("SELECT value FROM catalystLocalStorage WHERE key='other-setting'", null).use { check(it.moveToFirst() && it.getString(0) == "preserve-me") }
        File(backup, "RKStorage.sha256").writeText("invalid")
        var refused = false
        try { ChatStorageRecovery(source, backup).read(owner) } catch (expected: IllegalStateException) { refused = true }
        check(refused) { "Unverified backup was silently accepted" }
        check(reader.read(owner) == changed) { "Failure changed source data" }
        result.putInt("syntheticMessages", 2400)
        result.putInt("syntheticBytes", raw.toByteArray(Charsets.UTF_8).size)
        result.putBoolean("exactUnicodeRoundTrip", true)
        result.putBoolean("backupPreservedOriginal", true)
        result.putBoolean("restartAndSubsequentWrite", true)
        result.putBoolean("corruptBackupFailsClosed", true)
        result.putString("fixtures", root.name)
      }
      result.putString("result", "PASS")
      finish(-1, result)
    } catch (error: Throwable) {
      result.putString("result", "FAIL")
      result.putString("error", error.toString())
      result.putString("stack", error.stackTraceToString())
      finish(0, result)
    }
  }
}
