package expo.modules.axonicnearby

import org.bouncycastle.crypto.generators.SCrypt
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.util.concurrent.atomic.AtomicBoolean

/** Fixed local-vault parameters; callers cannot request arbitrary memory/CPU costs. */
internal object IdentityKdf {
  private val running = AtomicBoolean(false)
  fun derive(password: String, saltHex: String): String {
    require(password.length in 12..256) { "Invalid password length" }
    require(saltHex.matches(Regex("[0-9a-f]{64}"))) { "Invalid password salt" }
    check(running.compareAndSet(false, true)) { "Password derivation already running" }
    var passwordBytes: ByteArray? = null
    var salt: ByteArray? = null
    var key: ByteArray? = null
    try {
      // Match JavaScript TextEncoder, including replacement of unpaired UTF-16 surrogates.
      val encoded = Charsets.UTF_8.newEncoder()
        .onMalformedInput(CodingErrorAction.REPLACE)
        .replaceWith(byteArrayOf(0xef.toByte(), 0xbf.toByte(), 0xbd.toByte()))
        .encode(CharBuffer.wrap(password))
      passwordBytes = ByteArray(encoded.remaining()).also { encoded.get(it) }
      if (encoded.hasArray()) encoded.array().fill(0)
      salt = ByteArray(32) { saltHex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
      key = SCrypt.generate(passwordBytes, salt, 131072, 8, 1, 32)
      return key.joinToString("") { "%02x".format(it) }
    } finally {
      passwordBytes?.fill(0); salt?.fill(0); key?.fill(0)
      running.set(false)
    }
  }
}
