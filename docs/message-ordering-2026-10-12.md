# Message ordering — 2026-10-12

New timestamp-capable messages carry the original UTC Unix-millisecond creation time as the fifth field of their existing encrypted application payload. The transport still authenticates the sender and encrypts the entire payload. No sequence number or extra message round-trip was added. Retries preserve the persisted payload and reject conflicting timestamps for an existing incoming ID.

Presentation sorts ascending by creation time, then the existing message ID using ordinal comparison, then author identity for the degenerate cross-author ID collision. Group presentation uses the common group message ID, not the per-recipient delivery ID. Group fan-out assigns one timestamp before iterating recipients. Mobile reviewed attachments preserve selection time through preparation; hosted forwarding preserves its initial selection time. Editing, receipts and download completion do not move a message.

Compatibility: hello advertises messageTimestamps:1; only authenticated connected peers are remembered in the local account's bounded timestampPeers list. Once remembered, support survives app restart and an offline recipient. A successfully received timestamped message also establishes support. The encoding choice is persisted per message and is never upgraded on retry. Unknown/older recipients keep the previous four-field format. Historical messages without sender timestamps retain their saved local time; their true original send order cannot be reconstructed. An identity downgraded to an older binary after advertising support needs to upgrade again to read timestamped traffic.

A millisecond timestamp plus ID produces deterministic order for the same messages; it does not establish true physical send order across incorrect or changing clocks. Simultaneous messages can be ordered by random ID rather than the user's tap order. Valid timestamps are finite nonnegative integer milliseconds within JavaScript Date's range. They are not treated as network expiry, authorization, or an activity lease.

Sorting is shared through rootChatView for mobile and AoN; the web delta cache and history-page boundaries follow time/common message ID ordering too. Existing encryption algorithms and temporary custody retention are unchanged.

Validation: final full mobile check passed 842 tests (3 skipped), typecheck, cycles, module boundaries and consolidation. Includes five message-order tests plus an equal-time group notification-order regression test. AoN suite passed all 147 tests. Covered reverse arrival, equal-time ID ties, group IDs, immutable retries, capability persistence, old-client encoding, invalid timestamps, and delayed media preparation. 


## Live validation and deployment

Sender emulator queued labeled A, B, C through the normal group ledger and encrypted delivery runtime. Temporary Dev-only receive hooks returned no acknowledgement for A while permitting B and C; no signed payload or timestamp was edited. Both the other emulator and the connected phone (com.axonic.dev) actually admitted B, C, A. Their rootChatView/rootGroupMessages output was A, B, C, matching the sender's millisecond timestamps and common group IDs exactly. All messages reached delivered status on all three devices. Both temporary hooks were restored after the test. Logs: backend builds/order-live-before.log and builds/order-live-after.log.

Both AoNs report active network status and runtime SHA-256 15e9f884fe7aa6252238519a026e47f0fdeedf20475317655a80e85d554cddea (short revision 15e9f884fe7a). Final SecondNeuron deployment c54c0638-041d-4982-b940-39b2cfdca56a. FirstNeuron identity hash was unchanged by deployment. Both use the same shared core; hosted history pagination is also aligned. The final mobile notification-only refinement does not change the shared core.

No mobile production build, official-app installation, account reset, or real-user message was performed. The Play Store version needs a future authorized release to gain this feature. Old messages without transmitted timestamps cannot have their original sending order reconstructed by this update.
