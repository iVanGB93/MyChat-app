package expo.modules.axonicnearby

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class IdentityKdfTest {
  // Independent Node/OpenSSL scrypt vectors at the production vault parameters.
  @Test fun matchesPortableVaultDerivation() {
    val salt = "07".repeat(32)
    assertEquals("7a2b1c84064fd05e768fe2120bca10ef86196b88482dbfe24dec67dcedcee60b",
      IdentityKdf.derive("Axonic test password 2026", salt))
    assertEquals("9a1dc7d36c3464862dc5cc4777acfb9a70db20f68701cb79b40e3ad1ebdfa82d",
      IdentityKdf.derive("contraseña 🔑 test", salt))
    assertEquals("68ce463a1a8e94db6b653147f9841034855b64317035f35efea1a82e4a0df70f",
      IdentityKdf.derive("surrogate test \uD800", salt))
  }
  @Test fun rejectsUnboundedInputs() {
    assertThrows(IllegalArgumentException::class.java) { IdentityKdf.derive("short", "07".repeat(32)) }
    assertThrows(IllegalArgumentException::class.java) { IdentityKdf.derive("x".repeat(257), "07".repeat(32)) }
    assertThrows(IllegalArgumentException::class.java) { IdentityKdf.derive("valid password", "ff") }
  }
}
