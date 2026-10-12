# Guarded streaming in normal chats — October 12, 2026

## Implemented behavior

Normal attachment delivery requests a single-file stream when the sender's
authenticated RTC connection is available and both ends implement the guarded
lane. The request uses the existing authenticated attachment control channel.
It is accepted only for the exact manifest recipient/device and a current,
allowed outgoing chat job. Unknown/older adapters return unavailable and retain
the established encrypted transfer protocol. No change to the chat UI or saved
attachment descriptor format is needed.

The media channel shares the signed RTC session but remains separate from its
identity/control channel. Only one stream channel per peer is admitted; closing
it does not close the chat axon. Native Android admission precedes bridge copies,
enforces total bytes, 16 KiB buffers and 256 KiB receive credit. The receiver
authorizes native bytes before sending ready and returns credit only for data
already written. DTLS protects the stream; plaintext is never exposed to raw
LAN sockets or custody peers.

The receiver checks the complete file's SHA-256 in an attempt-owned temporary
directory. Only then is it moved to the worker's partial-file location; normal
verification/publication and signed delivery receipts still run. Interrupted
streams discard only their own temporary directory. Failed stream attempts fall
back to the encrypted protocol, preserving any verified chunk prefix. A sender
that connects after custody download started can now replace that partial
download with a verified stream. Stream retry is throttled for 60 seconds.

Account lock, changed journal state, expiry and contact/group permission changes
revoke the transfer lease. Permission snapshots are refreshed when chat storage
changes, without rereading the whole chat history for every buffer. Attempt
directories carry a 15-minute expiry marker; orphaned directories from crashes
are reclaimed on subsequent streaming activity after expiry. This is not an
always-running background cleanup service.

## Device validation

Built locally and installed debug clients only:

- Samsung `R3GYC0H7PMY`: `com.axonic.dev` (official app untouched).
- `emulator-5554`, `emulator-5556`: existing `com.axonic` debug identities.

Synthetic, labeled files went through `queueRootAttachmentSource`, the ordinary
ledger, runtime, peer connection, file publication and signed receipt. This is
no longer the isolated signed-SDP laboratory connection.

- Emulator → Dev phone: 524,287-byte and 2,097,151-byte files delivered on both
  ends with independently matching receiver SHA-256 and native guarded-stream
  logs. Repeated final-source 2 MiB transfer also passed.
- Closing the media channel after the first binary buffer caused encrypted
  fallback. The file still delivered with matching SHA-256 and the authenticated
  chat axon stayed connected.
- Emulator → emulator: 131,071-byte guarded stream verified; both chat rows
  eventually reported delivered. An earlier 524,287-byte transfer recovered its
  encrypted partial download after restarting the receiving Dev process.
- The second emulator exhibited multi-second database writes and repeated RTC
  reconnections. Its recovery passed, but it is not a clean throughput benchmark.

Normal-path timings include preparation, queueing, transfer and signed sender
completion. Early smoke observations: 512 KiB 5.352 s; 2 MiB 11.407 s. A later
final-source 2 MiB run took 17.652 s, including 8.172 s preparing encrypted
fallback data while the host was also running tests. These are individual
observations, not controlled comparative medians or production speed promises.
The earlier isolated 2.7-second stream result excluded normal preparation and
chat bookkeeping. Eliminating that preparation is a separate future change.

## Regression checks and evidence

The tests cover native admission, exact signed peer/device binding, channel
isolation, malformed frames, hash mismatch, native admission rejection,
cancellation, lease revocation, receipt verification, older-adapter fallback,
partially downloaded upgrades and permission-version accounting. All type,
unit, cycle, module-boundary and consolidation checks pass (see final log).

Ignored local evidence:

- `builds/stream-chat-final-validation.log`
- `builds/stream-chat-first.jsonl`, `stream-chat-2mb.jsonl`
- `builds/stream-chat-final-2mb.jsonl`
- `builds/stream-chat-fallback.jsonl`
- `builds/stream-chat-emulators-confirmed.jsonl`
- `builds/stream-dev-phone-build.log`, `stream-dev-emulators-build.log`

No production build, commit, push or AoN deployment was performed. AoNs continue
using compatible encrypted custody; the direct lane is between mobile peers.
Raw LAN, relay-only, unavailable and older-peer routes retain encrypted fallback.
