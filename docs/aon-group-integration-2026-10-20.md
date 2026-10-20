# Real phone group integration checks — October 20, 2026

User authorized labeled text and a small image from the normal Axonic account to
the existing Superintelligent Dev Group. Physical device: R3GYC0H7PMY.
No apps were installed, no permissions changed, no messages deleted, and no
queues, histories, or identities reset. Opening the group naturally marks visible
incoming messages read.

## Test inputs

- T1: `INTEGRATION-T1-1143`, sent around 11:43:05 EDT. Asked each AI for one quoted
  reply identifying itself and distinguishing known from unknown trigger details.
  Logical group message ID:
  `79a4a4389cd9dc649b2aca3834c69569b23c78311c7fd1bfbf431f0952b66063`.
- T2: `axonic-integration-t2.png`, 6,278 bytes, sent around 11:45:57 EDT.
  Harmless fixture: red circle, blue square, green triangle, text
  `AXONIC T2 - 4827`. Caption asked all AIs to describe shapes and read the code.
  Logical group message ID:
  `a7c70908d08a66edd67551b037e9ac1258090e7942fdfac8a7f98e54f5be69b4`.

## Observations

### ThirdNeuron / ATOMiX

- T1 processed once according to durable channel state. One logical reply
  (per-recipient outgoing records are not duplicate replies).
- Correct identity and quoted logical message ID.
- Phone Message Info: reply received 11:43:29 EDT, read 11:43:35.
- Reply incorrectly overstates trigger precision: “automated intake (SSE)”.
  Per-turn metadata explicitly says SSE versus polling/catch-up is not recorded.
- T2 manifest visible, but delivery remains Pending / Receiving attachment on
  ThirdNeuron at inspection. No model processing or media read acknowledgment.
- Independent code gap: group eligibility matches `message.text` only, not
  `attachment.caption`. The prompt builder also substitutes a generic attachment
  placeholder without the caption. Once media finishes, this test still lacks
  a usable mention/caption path. Do not diagnose missing vision from this alone.

### SecondNeuron / Axon

- T1 received at 15:44:10.428Z, about 65 seconds after sender creation.
- T2 fully delivered at 15:46:04.010Z, about six seconds after creation.
- No T1/T2 reply or read acknowledgment at inspection.
- Adapter sync ready, retained events increased from 107 to 110, but processed
  declarations remained 12 and completed operations remained 14.
- Summary says two active subscriptions but does not expose expiry, filter,
  cursor, or per-subscription delivery outcomes. Source counts the active flag
  without expiry; this is insufficient proof of a live event-to-AI path.
- Root cause of missing AI processing remains unverified. Do not acknowledge
  Axon's events on its behalf or send replies pretending to be Axon.

### FirstNeuron / Muse (Sugar)

- T1 received at 15:44:13.491Z; one logical quoted reply created
  15:46:33.693Z: “Sugar, on FirstNeuron — trigger verified.”
- T2 fully received at 15:46:04.288Z; one quoted reply created
  15:48:07.563Z confirming complete receipt, but not describing the shapes or code.
- Both replies remained pending acknowledgment in all three per-recipient records
  at inspection. No duplicate logical replies observed.
- Correct identity/quoting and processing/read acknowledgments verified server
  side. Image analysis and reply arrival on the phone not passed.

## Result

Partial integration pass, not full readiness. Further test traffic is deferred
because receipt/AI-processing/response-delivery gaps already prevent a clean pass.
Next work: caption propagation/admission, Axon's event subscription health, Muse
caption/vision handling, and pending delivery evidence. Preserve these messages.
No code or service changes were made as part of this test run.

## Follow-up investigation and caption repair

The later investigation corrects the provisional missing-Axon result:

- Axon replied to T1 at 15:47:26.024Z and to T2 at 15:47:27.913Z.
  The second reply correctly identified all three shapes/colors and `4827`.
- Adapter processing declarations increased from 12 to 14; completed operations
  increased from 14 to 16. Native processing happened, but was not immediate:
  roughly 196 seconds after T1 reached SecondNeuron, and 84 seconds after T2.
  This interval includes event delivery, platform scheduling and agent execution;
  available evidence does not split those stages.
- Those replies reached ThirdNeuron at roughly 15:50:52Z. At 15:53 inspection,
  SecondNeuron's outgoing records to the phone were still pending.
- At 15:53:50Z SecondNeuron explicitly listed the normal phone's canonical ID
  as directly connected (about 169 ms response). This supports a real delivery
  stall despite connected status.
- Recent phone connections include `chat-message-rejected:unexpected-ack`.
  Source inspection shows the five-second send timeout removes pending ACK state,
  and a later ACK is rejected. This is a plausible reconnect contributor, not yet
  a reproduced explanation of every stalled test message.
- ThirdNeuron's SQLite attachment job was inspected read-only: downloading,
  cursor 0, 18 failures, no custodian acknowledged. It has not reached vision.
  Current persistence does not retain the exact exception causing each retry.

Caption repair:

- Group media admission now checks the sender caption, not the filename.
- The caption is included as sender content in the model's BodyForAgent context.
- Membership, blocking and complete-media requirements remain unchanged.
- 47 isolated channel tests pass, including caption mentions, no filename
  triggers, incomplete media rejection, and caption context propagation.
- Installed into OpenClaw after a private backup at
  `/home/ivan/.local/state/axonic-channel-backups/2026-10-20T15-54-13.197Z`.
  Gateway restarted; channel connected, zero sync failures, no pending turn.
- No AoN deployment, phone installation, queue reset, or message deletion.
- Caption fix has not yet passed a live end-to-end image test because the original
  ThirdNeuron attachment remains incomplete. Normal phone is 1.1.24 / code 95.

Protocol-review scope: inspected the existing encrypted packet/ACK state machine.
No cryptographic primitive, authentication check, receipt semantics, or protocol
code changed. Late-ACK handling requires a focused authenticated regression test
before any proposed relaxation; connection health alone must never imply delivery.
