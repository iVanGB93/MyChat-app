package expo.modules.axonicnearby

/** One bounded DNS-SD lookup; late callbacks must not complete a newer lookup. */
internal class AxonResolutionGate {
  data class Ticket(val name: String, val deadline: Long)
  var current: Ticket? = null
    private set
  fun begin(name: String, now: Long): Ticket {
    check(current == null)
    return Ticket(name, now + 5000).also { current = it }
  }
  fun owns(ticket: Ticket) = current === ticket
  fun finish(ticket: Ticket): Boolean {
    if (!owns(ticket)) return false
    current = null
    return true
  }
  fun expired(now: Long) = current?.takeIf { now >= it.deadline }
  fun clear() { current = null }
}
