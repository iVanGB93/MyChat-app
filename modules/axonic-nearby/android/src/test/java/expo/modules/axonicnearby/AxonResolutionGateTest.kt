package expo.modules.axonicnearby

import org.junit.Assert.*
import org.junit.Test

class AxonResolutionGateTest {
  @Test fun stalledLookupExpiresAndNextPeerCanProceed() {
    val gate = AxonResolutionGate()
    val old = gate.begin("vanished", 100)
    assertNull(gate.expired(5099))
    assertSame(old, gate.expired(5100))
    assertTrue(gate.finish(old))
    val next = gate.begin("live", 5100)
    assertTrue(gate.owns(next))
    assertFalse(gate.finish(old))
    assertTrue(gate.owns(next))
  }
  @Test fun shutdownInvalidatesCallbacksEvenForSameNameAndTime() {
    val gate = AxonResolutionGate()
    val old = gate.begin("peer", 0)
    gate.clear()
    val next = gate.begin("peer", 0)
    assertFalse(gate.owns(old))
    assertFalse(gate.finish(old))
    assertTrue(gate.finish(next))
    assertNull(gate.current)
  }
  @Test(expected = IllegalStateException::class) fun onlyOneLookupIsAdmitted() {
    val gate = AxonResolutionGate()
    gate.begin("one", 0)
    gate.begin("two", 0)
  }
}
