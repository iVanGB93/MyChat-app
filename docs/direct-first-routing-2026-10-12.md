# Direct-first routing audit — October 12, 2026

## Policy and paths

| Traffic | Connected recipient | Unavailable recipient |
| --- | --- | --- |
| Text, edits, deletes, reactions, read receipts | Shared durable outbox → authenticated encrypted chat channel → acknowledgement | Peer discovery, direct retry, encrypted custody |
| Group membership, messages and actions | Same outbox, independently per recipient | Same encrypted custody, independently per recipient |
| Attachment descriptors, including stickers/voice notes | Same chat outbox | Same custody path |
| File bytes | Authorized direct RTC stream with checksum and receipt | Existing encrypted chunk protocol/custody and resume |
| Typing/activity | Authenticated chat channel, bounded transient lifetime | Drop stale activity; do not store it for later |
| Call invitation/acceptance/end | Signed call-control exchange | Existing call relay/recovery, with expiry |
| Call SDP/ICE signaling | Exact authenticated target device's call-bound forwarding endpoint | Existing live call-media relay |
| Call audio/video | WebRTC media transport | ICE/TURN where available; never message custody |
| Identity lookup/replication and introductions | Existing authenticated neighbor directory/control requests; verify signatures | Discover/retry other available neurons; public records are not private-message custody |
| Push registration/wake-up | Dedicated authenticated control operations | Push gateway/FCM remains necessary for sleeping Android apps |

The UI does not own these connections. The network runtime and durable messaging
module remain independent of screen navigation. Bootstrap HTTP, Android push,
and platform app-update checks are not interchangeable with peer file streams.

## Gaps fixed

The shared message dispatcher previously had one global in-flight send. It now
allows at most two recipients concurrently, with only one attempt per recipient.
An offline recipient's discovery/deposit no longer necessarily blocks a newly
queued connected conversation. Urgent notifications remain bounded at 64 and
are retained while their recipient is busy. Inbox collection remains separate.
This is bounded concurrency, not unlimited sends or a guarantee against both
slots being occupied by slow recipients.

After discovery the dispatcher rechecks the current owner/generation and durable
pending message, including blocking/cancellation, then retries the same message
ID directly. Only a recipient acknowledgement marks delivery. Failed discovery
does not prevent custody from using previously verified keys. Failure preserves
the outbox and existing encrypted custody semantics.

Call-bound SDP/ICE previously always used the relay loop. It now first selects
the connected target account AND target device supporting the existing
call-media-forward capability. The exact signed bytes are unchanged. Route
parsing is not identity verification: the receiver still verifies the signed
signal, selected call, acceptance and lifetime. Direct failure falls back to a
relay, with account-generation checks preventing a stale operation continuing
after lock/switch. No peer protocol version change is required.

## Responsiveness and limits

Large direct files already use a separate bounded RTC data channel. Chat messages
do not join that file's stream queue; legacy encrypted batches are bounded and
paced. This does not eliminate shared CPU, disk, radio or SCTP congestion, and it
does not promise a fixed small-message latency. Authentication and signature
checks remain mandatory; using a direct route does not remove encryption.

## Validation

- Full check after both source changes: 902 passed, 3 skipped, with type checking,
  cycle checks, module boundaries and consolidation passing.
- Additional authenticated-network integration test passed: a signed call media
  signal reaches the exact connected recipient without any relay provider;
  wrong-device and tampered-signature cases are rejected.
- Dispatcher tests cover direct retry, discovery failure, blocking during
  discovery, account invalidation, duplicate protection, two-recipient capacity,
  wake-up fairness, and direct group membership/text/reactions and message edits.
- Dev emulator → Dev phone: labeled small text and a 4,194,303-byte attachment
  both delivered; attachment checksum verified, signed receipt recorded and jobs
  cleared. This run checks coexistence, not a quantified latency guarantee.
- Live emulator → Dev phone voice-call setup reached `ready` at both ends.
  Both peers recorded `call-media-forward` request/response traffic on their
  direct session. The test call was ended afterward. This verifies signaling;
  audio quality or packet throughput was not measured in this audit.

Only development runtimes were used. No production build, official phone app
installation, database wipe, commit or deployment was performed for this audit.

## AoN follow-up release

The subsequently requested AoN update synchronizes the shared protocol sources
and adds the same bounded two-recipient dispatch policy to hosted chat. Each
recipient remains serial; inbox collection is independent. After peer discovery,
the same message ID is retried directly before encrypted custody, with pending,
blocking and runtime checks repeated. Hosted call signaling uses the shared
exact-account/device direct-first routing helper.

Hosted attachments retain their authenticated encrypted WebSocket batches.
Sharing the direct-first routing policy does not give Node.js the Android native
RTC file-stream implementation. This release does not remove encryption.

Validation: all 150 hosted tests passed, including direct retry, an independently
progressing recipient while another stalls, and blocking during a failed direct
attempt. Shared source consistency and TypeScript compilation passed.

Expected release: package `0.2.0`, runtime `734d7a328c13`, 106 modules;
full SHA-256 `734d7a328c13c699ee65f155cb78d6cfbedaca20f35960eaca072bc849f24c24`.

Deployment packaging must use `deploy/Dockerfile.railway`, the `deploy/railway-*`
files and the existing Railway configuration for SecondNeuron. The generic
Dockerfile lacks its proxy and runtime credential initialization. Initial
deployment attempts exposed this packaging mistake; the corrected rollout is
verified successful. Both AoNs report the exact expected runtime hash, active
network state, readable authenticated chat/status APIs, and empty own outgoing
queues. FirstNeuron's existing identity checksum was preserved; SecondNeuron
reused its existing persistent volume without a data reset.

SecondNeuron successful Railway deployment:
`b613e2a2-0f82-4211-84e8-a6628a2d5618`. It had four connected axons at verification.
FirstNeuron rollback copy: `/opt/axonic-neuron-before-direct-first-20261012`.
No new messages were sent to real users during the hosted deployment checks.
