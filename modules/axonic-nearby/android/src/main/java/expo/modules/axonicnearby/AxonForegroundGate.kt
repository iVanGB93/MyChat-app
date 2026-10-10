package expo.modules.axonicnearby

/** Brief Android activity transitions must not tear down authenticated sockets. */
internal class AxonForegroundGate {
  private var foreground = true
  private var until = 0L
  fun allowed(now: Long) = foreground || now < until
  fun resume() { foreground = true; until = 0 }
  fun pause(now: Long): Long {
    if (foreground) { foreground = false; until = now + 1500 }
    return (until - now).coerceAtLeast(0)
  }
  fun destroy() { foreground = false; until = 0 }
}
