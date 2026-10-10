package expo.modules.axonicnearby

import org.junit.Assert.*
import org.junit.Test

class AxonForegroundGateTest {
  @Test fun briefShareIntentPausePreservesConnections() {
    val gate = AxonForegroundGate()
    assertEquals(1500L, gate.pause(100))
    assertTrue(gate.allowed(101))
    gate.resume()
    assertTrue(gate.allowed(1600)) // An already queued timer cannot close a resumed app.
  }
  @Test fun sustainedBackgroundExpiresAndDuplicatePauseCannotExtendIt() {
    val gate = AxonForegroundGate()
    gate.pause(100)
    assertEquals(1000L, gate.pause(600))
    assertTrue(gate.allowed(1599))
    assertFalse(gate.allowed(1600))
    assertEquals(0L, gate.pause(1700))
    assertFalse(gate.allowed(1700))
  }
  @Test fun destroyClosesImmediatelyAndNextPauseHasItsOwnDeadline() {
    val gate = AxonForegroundGate()
    gate.pause(100); gate.resume(); gate.pause(200)
    assertTrue(gate.allowed(1600))
    assertFalse(gate.allowed(1700))
    gate.resume(); gate.pause(2000); gate.destroy()
    assertFalse(gate.allowed(2001))
  }
}
