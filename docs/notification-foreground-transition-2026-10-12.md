# Generic message notification after a foreground/background transition

Observed on the connected phone's official `com.axonic` installation, version 1.1.11/code 54:

- 19:31:20 device local time: verified message wake entered recovery.
- 19:31:22: generic notification displayed; no new recovery grant appeared.
- 19:35:07, immediately after bringing the existing Activity forward: an earlier recovery released its runtime, then the queued recovery obtained a grant and resumed.
- 19:35:10: decrypted preview published.

This confirms wake receipt and a stalled recovery queue, rather than a missing push. The preceding recovery's start had rolled out of the captured JS logs, so its initial app state cannot be independently proved from this capture.

Code inspection found a matching failure: `rootMessageRecovery` captured foreground/background state once. A foreground-started task used frame-driven JS timers for its entire lifetime and had no native background transport lease. Going to the background could suspend it and strand the serial queue. The notification deadline had the same timer-selection problem.

Changes:

- Use native wait completions whenever available, including when recovery starts in the foreground.
- Acquire/release the existing bounded native transport grant for verified recovery in either initial app state.
- Preserve lock policy, verification, existing 20-second recovery budget, and metadata-only fallback until a message is decrypted.

Regression coverage exercises foreground-to-background transition with no working JS frame timers, checks that the next queued recovery finishes, and checks the notification deadline also completes. Existing tests cover locked accounts, notification policy, preview replacement and deduplication.

No production installation, new message, or push retry was performed. The official app was opened after collecting evidence. The fix is source-only pending live Dev verification and a separately approved production release.
