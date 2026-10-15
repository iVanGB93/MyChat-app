# Local message delivery evidence

Message Info reads `messageDelivery` and, for media, `attachmentDelivery` from each local message row. Group rows retain independent evidence per recipient.

Each optional version-1 record contains `method` (`peer`, `custody`, or `mixed`), `scope` (`payload` or `receipt`), `relays` (observed relay account IDs), `at` (local observation time), and `partial` (some source evidence is missing).

- Incoming text/descriptor: recorded after authenticated payload admission, including the polled custody source. Inline push custody has no verified relay identity and is explicitly partial.
- Outgoing text/descriptor: recorded only on authenticated ACK or verified recipient receipt, not send attempts or custody storage acceptance.
- Incoming media: records sources of verified, committed chunks across resumptions. A successful whole-file stream replaces previous partial sources; final evidence is published only after whole-file verification and durable signed receipt persistence.
- Outgoing media: records the source of the verified complete-file receipt. It does not claim that the file followed that same path.
- Duplicate confirmations preserve the first observation. Legacy records remain unknown, and legacy partial downloads remain partial unless a verified whole-file stream replaces them.

These are local observations, not signed route attestations. `relays` is a set of observed sources, not an ordered end-to-end hop trace. Peer connections do not prove absence of TURN or other transport intermediaries. No IP addresses, message content or keys are added to route evidence. Signed wire formats and delivery-state semantics are unchanged.

The protocol-implementation review kept source observations separate from authenticated delivery validation. Tests cover persistence, duplicates, unknown legacy routes, per-recipient display and verified media completion; they do not establish an end-to-end route attestation guarantee.
