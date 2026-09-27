package expo.modules.axonicnearby

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/** Development mailbox v1. Private identity keys never leave AndroidKeyStore.
 * No forward secrecy or key recovery yet; this is not the production protocol. */
internal object MailboxCrypto {
  private val random = SecureRandom()
  private val oaep = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT)
  private fun encode(bytes: ByteArray) = Base64.getEncoder().encodeToString(bytes)
  private fun decode(text: String, limit: Int): ByteArray {
    require(text.length <= limit)
    return Base64.getDecoder().decode(text).also { require(encode(it) == text) }
  }
  private fun alias(owner: Int, purpose: String): String {
    require(owner > 0)
    return "axonic.mailbox.v1.$owner.$purpose"
  }
  private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  @Synchronized fun identity(owner: Int): Map<String, String> {
    val ks = store()
    val encryption = alias(owner, "encryption")
    val signing = alias(owner, "signing")
    if (!ks.containsAlias(encryption)) KeyPairGenerator.getInstance("RSA", "AndroidKeyStore").apply {
      initialize(KeyGenParameterSpec.Builder(encryption, KeyProperties.PURPOSE_DECRYPT)
        .setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA256)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP).build())
    }.generateKeyPair()
    if (!ks.containsAlias(signing)) KeyPairGenerator.getInstance("EC", "AndroidKeyStore").apply {
      initialize(KeyGenParameterSpec.Builder(signing, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256).build())
    }.generateKeyPair()
    return mapOf("encryption" to encode(ks.getCertificate(encryption).publicKey.encoded),
      "signing" to encode(ks.getCertificate(signing).publicKey.encoded))
  }
  fun sign(owner: Int, value: String): String {
    require(value.length <= 16000)
    val key = store().getKey(alias(owner, "signing"), null) as PrivateKey
    return encode(Signature.getInstance("SHA256withECDSA").run {
      initSign(key); update(value.toByteArray(Charsets.UTF_8)); sign()
    })
  }
  fun verify(publicKey: String, value: String, signature: String): Boolean = try {
    require(value.length <= 16000)
    val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(decode(publicKey, 256)))
    Signature.getInstance("SHA256withECDSA").run {
      initVerify(key); update(value.toByteArray(Charsets.UTF_8)); verify(decode(signature, 128))
    }
  } catch (_: Exception) { false }
  fun seal(publicKey: String, header: String, plaintext: String): Map<String, String> {
    require(header.length <= 2048 && plaintext.toByteArray(Charsets.UTF_8).size <= 4096)
    val key = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(decode(publicKey, 512)))
    require((key as java.security.interfaces.RSAPublicKey).modulus.bitLength() == 2048)
    val secret = ByteArray(32).also { random.nextBytes(it) }
    try {
      val iv = ByteArray(12).also { random.nextBytes(it) }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(secret, "AES"), GCMParameterSpec(128, iv))
      cipher.updateAAD(header.toByteArray(Charsets.UTF_8))
      val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
      val wrap = Cipher.getInstance("RSA/ECB/OAEPPadding")
      wrap.init(Cipher.ENCRYPT_MODE, key, oaep)
      return mapOf("wrappedKey" to encode(wrap.doFinal(secret)), "iv" to encode(iv), "ciphertext" to encode(ciphertext))
    } finally { secret.fill(0) }
  }
  fun open(owner: Int, header: String, wrappedKey: String, iv: String, ciphertext: String): String {
    require(header.length <= 2048)
    val unwrap = Cipher.getInstance("RSA/ECB/OAEPPadding")
    unwrap.init(Cipher.DECRYPT_MODE, store().getKey(alias(owner, "encryption"), null), oaep)
    val secret = unwrap.doFinal(decode(wrappedKey, 344))
    try {
      require(secret.size == 32)
      val nonce = decode(iv, 16).also { require(it.size == 12) }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(secret, "AES"), GCMParameterSpec(128, nonce))
      cipher.updateAAD(header.toByteArray(Charsets.UTF_8))
      return String(cipher.doFinal(decode(ciphertext, 5484)), Charsets.UTF_8)
    } finally { secret.fill(0) }
  }
}
