package expo.modules.axonicnearby

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.MGF1ParameterSpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/** JVM tests of the actual native encryption implementation. Keystore identity lifecycle
 * still requires the installed Android development build and real-device validation. */
class MailboxCryptoTest {
  private fun encode(bytes: ByteArray) = Base64.getEncoder().encodeToString(bytes)
  private fun decode(value: String) = Base64.getDecoder().decode(value)
  private fun rsa() = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
  private fun open(key: PrivateKey, header: String, sealed: Map<String, String>): String {
    val unwrap = Cipher.getInstance("RSA/ECB/OAEPPadding")
    unwrap.init(Cipher.DECRYPT_MODE, key, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT))
    val secret = unwrap.doFinal(decode(sealed.getValue("wrappedKey")))
    val aes = Cipher.getInstance("AES/GCM/NoPadding")
    aes.init(Cipher.DECRYPT_MODE, SecretKeySpec(secret, "AES"), GCMParameterSpec(128, decode(sealed.getValue("iv"))))
    aes.updateAAD(header.toByteArray(Charsets.UTF_8))
    return String(aes.doFinal(decode(sealed.getValue("ciphertext"))), Charsets.UTF_8)
  }
  @Test fun recipientCanDecryptAndEveryEnvelopeUsesFreshRandomness() {
    val pair = rsa()
    val publicKey = encode(pair.public.encoded)
    val first = MailboxCrypto.seal(publicKey, "header", "Test Unicode 🌎")
    val second = MailboxCrypto.seal(publicKey, "header", "Test Unicode 🌎")
    assertEquals("Test Unicode 🌎", open(pair.private, "header", first))
    assertNotEquals(first["iv"], second["iv"])
    assertNotEquals(first["wrappedKey"], second["wrappedKey"])
    assertNotEquals(first["ciphertext"], second["ciphertext"])
  }
  @Test fun wrongRecipientAndTamperingFail() {
    val pair = rsa()
    val sealed = MailboxCrypto.seal(encode(pair.public.encoded), "header", "private text")
    assertThrows(Exception::class.java) { open(rsa().private, "header", sealed) }
    assertThrows(Exception::class.java) { open(pair.private, "modified-header", sealed) }
    val changed = decode(sealed.getValue("ciphertext")).apply { this[0] = (this[0].toInt() xor 1).toByte() }
    assertThrows(Exception::class.java) { open(pair.private, "header", sealed + ("ciphertext" to encode(changed))) }
  }
  @Test fun signatureVerificationRejectsWrongKeyAndModifiedReceipt() {
    val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    val signature = Signature.getInstance("SHA256withECDSA").run {
      initSign(pair.private); update("receipt".toByteArray()); sign()
    }
    assertTrue(MailboxCrypto.verify(encode(pair.public.encoded), "receipt", encode(signature)))
    assertFalse(MailboxCrypto.verify(encode(pair.public.encoded), "modified", encode(signature)))
    assertFalse(MailboxCrypto.verify("bad-key", "receipt", encode(signature)))
    assertFalse(MailboxCrypto.verify(encode(pair.public.encoded), "receipt", "invalid"))
  }
  @Test fun oversizedPlaintextAndInvalidPublicKeysFailClosed() {
    val pair = rsa()
    assertThrows(Exception::class.java) { MailboxCrypto.seal(encode(pair.public.encoded), "header", "x".repeat(4097)) }
    assertThrows(Exception::class.java) { MailboxCrypto.seal("invalid", "header", "text") }
  }
}
