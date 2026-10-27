package expo.modules.axonicnearby

import java.security.MessageDigest
import org.bouncycastle.crypto.modes.XChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.KeyParameter

/** v4 block primitive only. JS owns manifest/AAD validation, signatures and commit.
 * Hash the exact input being encrypted; never trust a separate file hash here. */
internal object AttachmentBlockEncryption {
  fun decrypt(ciphertext:String,keyHex:String,canonical:String):ByteArray {
    require(ciphertext.length in 34..6_000_032 && ciphertext.length%2==0)
    require(keyHex.matches(Regex("[0-9a-f]{64}")))
    require(canonical.length in 1..1024 && canonical.all { it.code<128 })
    require(canonical.startsWith("[\"axonic-attachment-block-v4\",") || canonical.startsWith("[\"axonic-attachment-shared-block-v4\","))
    fun nibble(c:Char):Int=when(c){in '0'..'9'->c-'0';in 'a'..'f'->c-'a'+10;else->throw IllegalArgumentException("Invalid block encoding")}
    val encrypted=ByteArray(ciphertext.length/2) { (nibble(ciphertext[it*2])*16+nibble(ciphertext[it*2+1])).toByte() }
    val key=ByteArray(32) { (nibble(keyHex[it*2])*16+nibble(keyHex[it*2+1])).toByte() }
    val plain=ByteArray(encrypted.size-16)
    try {
      val aad=canonical.toByteArray(Charsets.US_ASCII)
      val nonce=MessageDigest.getInstance("SHA-256").digest(aad).copyOf(24)
      val cipher=XChaCha20Poly1305()
      cipher.init(false,AEADParameters(KeyParameter(key),128,nonce,aad))
      var count=cipher.processBytes(encrypted,0,encrypted.size,plain,0)
      count+=cipher.doFinal(plain,count)
      check(count==plain.size)
      return plain
    } catch(error:Exception) { plain.fill(0);throw error }
    finally { key.fill(0);encrypted.fill(0) }
  }
  fun encrypt(plain:ByteArray,keyHex:String,expectedHash:String,canonical:String):ByteArray {
    require(plain.size in 1..3_000_000)
    require(keyHex.matches(Regex("[0-9a-f]{64}")) && expectedHash.matches(Regex("[0-9a-f]{64}")))
    require(canonical.length in 1..1024 && canonical.all { it.code<128 })
    require(canonical.startsWith("[\"axonic-attachment-block-v4\",") || canonical.startsWith("[\"axonic-attachment-shared-block-v4\","))
    val key=ByteArray(32) { keyHex.substring(it*2,it*2+2).toInt(16).toByte() }
    val expected=ByteArray(32) { expectedHash.substring(it*2,it*2+2).toInt(16).toByte() }
    try {
      require(MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(plain),expected)) { "Attachment source changed" }
      val aad=canonical.toByteArray(Charsets.US_ASCII)
      val nonce=MessageDigest.getInstance("SHA-256").digest(aad).copyOf(24)
      val cipher=XChaCha20Poly1305()
      cipher.init(true,AEADParameters(KeyParameter(key),128,nonce,aad))
      val encrypted=ByteArray(plain.size+16)
      try {
        var count=cipher.processBytes(plain,0,plain.size,encrypted,0)
        count+=cipher.doFinal(encrypted,count)
        check(count==encrypted.size)
        return encrypted
      } catch(error:Exception) { encrypted.fill(0);throw error }
    } finally { key.fill(0);expected.fill(0);plain.fill(0) }
  }
}
