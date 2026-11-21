# Axonic app and network boundary — private text

## Send to Delivered

1. App. RootPrivateChatScreen calls messaging.sendText. The command assigns a
   message ID, publishes optimistic UI state, and asks the ledger to persist
   the pending message. The ledger checks the recipient, block status and
   quoted reply, then publishes the queued event after saving.
2. Handoff. neuronRuntime subscribes to queued events. createMessageDelivery
   reads a revision-cached delivery view, picks pending work and tries a
   connected recipient before custody. The durable message ID survives retries.
3. Network. identityNetwork sends over the authenticated session. If direct
   delivery is unavailable or times out, custodyCourier selects an eligible
   custodian, seals the payload, and pins the relay before depositing so an
   ambiguous response can be retried against the same relay.
4. Receiving handoff. Direct and custody paths reach the same incoming
   admission and ledger callback. A direct acknowledgement depends on app
   acceptance. Custody verifies and opens the envelope before the callback,
   and produces a signed receipt after the app accepts the message.
5. App. The ledger validates and saves the incoming message. Wake completion
   and notification preview work follow the durable commit. On the sender,
   a direct acknowledgement or verified recipient receipt updates delivery
   status. Custodian storage is a separate observation.

## Boundary findings

- The delivery coordinator under modules/messaging owns scheduling, direct
  and custody fallback, and retries. It formerly read app-shaped snapshots and called ledger mutations directly.
  The deliveryOutbox adapter now handles those responsibilities.
- The chat ledger combines history, policy, wire encoding and durable pending
  work. Keep the existing atomic app write for now. A second independent write
  at Send could strand a message if the process stops between the writes.
- The phone inbox adapter acknowledges after storage commits and runs preview
  work separately. Background wake recovery can await presentation when needed.
- neuronRuntime wires the phone inbox and delivery receipt adapters to the
  shared transport contracts. The adapters own notification projection and
  chat ledger mutations. AoNs supply their own storage and presentation adapters.

## First refactor — implemented on the phone sender

The app-side deliveryOutbox now projects the existing durable ledger into a
narrow delivery view. The scheduler reads that view and reports direct
acceptance through a callback. The incoming acceptance callback is unchanged. Carry the recipient,
stable ID and encoded payload on outgoing requests. Report direct acceptance,
custodian storage and verified recipient receipts distinctly. Keep local
transport timeout and retry state on the network side. Preserve account-change
guards, policy rechecks, and idempotency across direct timeout and custody
fallback. Then trace group messages and attachments before generalizing.

This pass covers private text in the mobile source. It does not certify the
entire app or compare the implementation line by line with the AoN runtime.

## Receiving and hosted comparison

- Phone direct delivery waits for authenticated app acceptance before sending
  its ACK. Custody likewise waits for app acceptance before signing a receipt.
  Both reach incomingMessageAdmission, which coalesces concurrent identical
  payloads and leaves durable deduplication with the ledger.
- The phone currently awaits notification preview and wake completion work
  after the ledger commits. Slow presentation therefore extends the ACK and
  receipt path. Preserve wake completion and duplicate handling when measuring
  or separating that work.
- The hosted receiver also waits for ledger acceptance. The hosted sender
  has its own scheduler in hostedRootChat, with a hosted interaction-policy
  check before fallback. It still derives pending packages from chat state.
  Share the delivery interface first and preserve the platform-specific
  policy before considering a common scheduler.
- Verified 161 focused tests for the phone scheduler, incoming admission,
  ledger, and custody. The AoN comparison was a source review against f7093e1.

## Group text audit — November 13, 2026

The app validates group membership and saves one durable delivery row per
recipient under a shared logical message ID. The sender's timeline collapses
those rows into one bubble. Message Info keeps the original recipient list and
shows each recipient's status separately. The bubble can show Stored while some
recipients have received the message. The existing Partial indicator currently
applies only to attachments.

The network tries connected recipients directly. Shared custody can store a
single encrypted group payload with separate recipient grants, pinned to one
relay before deposit. When sharing is unavailable or only one recipient remains,
the scheduler can use per-recipient custody. The shared-job path therefore does
not establish a single relay for every fallback combination.

Live Dev group composer, emulator to phone. With both devices online, the
phone received one copy directly while the other two recipient rows were stored
on SecondNeuron. With the phone offline, all three rows recorded SecondNeuron
as their only custodian after about 5.5 seconds. After connectivity was restored,
the phone saved one copy via SecondNeuron and the sender marked that recipient
Delivered after about 14.5 seconds. The other two recipients remained pending
with custody recorded. This verifies the observed delivery routes; it does not
independently verify the push submission or shared-job selection for this run.

## Shared group custody capability

The offline Dev test used three independent recipient deposits. The sender
previously needed a remembered session capability for each recipient.
Updated senders can also verify a device-signed shared-custody capability from
the recipient identity record, including records discovered through the
directory. The proof is checked for the actual device receiving the grant.
The original root signature format and device IDs are unchanged.
Group text uses one timestamp format across the recipient rows so differences
in previously observed timestamp support cannot split a new shared body.
Existing sealed jobs keep their route and format. Recipients without verified
or previously observed support retain individual custody.

Validation covered offline capability in a fixture, a copied proof rejection,
and hosted storage regressions. Live rollout and relay inventory verification
remain pending.

## Group photo audit — November 13, 2026

Axonic Dev captured and sent a 19,773-byte photo through the group composer
with both recipients offline. Both sender manifests used the same content digest
and recorded FirstNeuron as the only attachment custodian. The phone and the
second emulator independently verified the downloaded file checksum against the
sender's checksum. FirstNeuron's read-only inventory showed two signed receipt
records and zero remaining blocks under the shared content digest.

The live script expected SecondNeuron and restored both recipients after seeing
FirstNeuron, so it missed the between-receipts inventory. The focused custody
suite (14 passing) verifies that a single uploaded blob survives the first
receipt and is deleted after the final receipt. Source staging is keyed by
shared content ID, with separate references for the recipient jobs. The live
run did not count sender file copies or block uploads.

### Group video live verification

A 10,886,564-byte emulator screen-sharing recording was selected and sent from
the normal Dev group picker. SecondNeuron stored two grants and one shared set
of four encrypted blocks while both recipients were offline. After the phone
reconnected and verified its checksum, the relay recorded one receipt and
retained all four blocks. After the second emulator reconnected, its checksum
also matched and both outgoing rows showed Delivered. The final read-only
inventory showed two receipts and zero blocks. Both recipient devices' radio
settings were restored.

## Calls boundary — initial trace

The phone UI requests permissions and calls the application commands. The
commands subscribe to account/network readiness, resolve the selected peers,
and hand the call request to the runtime. The network owns signed call control,
direct/relay routing and delivery retries. The phone journals accepted control
events, owns microphone/camera/screenshare and maps coordinator events to the
call UI. The group coordinator publishes participant and transport changes
through the call subscription; the visible elapsed timer is presentation only.
Next verification: a real three-device call with one participant leaving and
rejoining, checking that the other two remain connected.
