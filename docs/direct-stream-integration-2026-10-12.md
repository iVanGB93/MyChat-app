# Direct attachment stream integration — October 12, 2026

Status update: the guarded lane is now wired into normal mobile attachment
delivery and installed/tested on Axonic Dev and both emulators. See
[normal-chat validation](direct-stream-normal-chats-2026-10-12.md) for current
results and limits. The staged notes below document the preceding milestones.
Neither AoN nor the official phone app was changed in this work.

## Implemented

- A single-use ordered stream pinned to the expected attachment digest, length
  and checksum from the private chat descriptor. Unsolicited/mismatched offers,
  premature acknowledgements and oversized frames fail closed.
- 16 KiB transport buffers, 256 KiB outstanding credit, 128 KiB cooperative
  scheduling bursts. This streams one file; it does not build a Merkle proof or
  encrypt each application buffer. The required underlying channel is DTLS
  authenticated to the exact intended account/device, never the raw LAN socket.
- Receiver file readback SHA-256 before stream completion; idle and overall
  deadlines; account/job liveness; single-owner temporary-file cleanup.
- Optional `createAttachmentTransfer` adapter for incoming jobs at cursor zero,
  only from the manifest sender. It retains normal final file verification,
  publication, signed receipts and custody acknowledgement. Failure falls back
  to encrypted chunk delivery, with a 60-second stream retry cooldown.
- Existing encrypted preparation, manifests and resumable custody remain intact.
  The stream acknowledgement is not itself a signed delivery receipt.

## Evidence

`tests/directAttachmentStream.test.cjs`: byte equality for 1 byte through
2,097,151 bytes, tails, checksum mismatch, cancellation during hashing, idle
expiry, account invalidation, exact-offer checks and invalid frames/controls.
`tests/attachmentTransfer.test.cjs`: verified signed receipt after stream,
unavailable/disconnected fallback, corruption, cancellation and exclusion of
custodian routes. These adapter tests are synthetic, not mobile chat tests.

The candidate core was injected through `core-send` in the existing **isolated
lab** harness on emulator 5554 and the authorized Samsung `com.axonic.dev` app.
It still uses signed SDP exchanged by the test harness and an unguarded native
lab channel; it does **not** validate production native binary admission.

| Workload | Sender elapsed | Receiver independent SHA-256 |
| --- | ---: | --- |
| 2,097,151 bytes, yield every buffer | 5.317 s | match |
| 2,097,151 bytes, bounded-burst yield | 2.711 s | match |
| 524,287 bytes, bounded-burst yield | 0.903 s | match |

These are single smoke observations, not repeated throughput estimates or
release performance claims. Sender timing starts after fixture generation and
receiver authorization, and ends at the receiver's verified stream completion.
It excludes normal chat preparation, discovery, custody and ledger publication.
The selected test path was UDP host/prflx, with observed RTT around 5–6 ms.

Closing the lane after the first binary frame rejected the sender, produced no
verified completion and removed the receiver's incomplete file. All synthetic
fixtures and test connections were cleaned afterward. Evidence under ignored
`builds/direct-stream-core-*.jsonl`; full check log:
`builds/direct-stream-integration-final.log`.

## Activation milestones (completed in the normal-chat follow-up)

1. Install and exercise the compiled native guard on Dev clients. It admits a
   single `axonic-stream-v1` channel only after the identity channel has been
   authenticated. Binary frames require explicit byte-count authorization;
   16 KiB frame, 256 KiB outstanding and total-file limits apply before bridge
   copies. Credit uses a monotonic consumed offset, bounded by received bytes.
   Existing identity/control guards are unchanged. Never ship the lab's
   unguarded adapter.
2. Negotiate capability and connect the runtime/file adapter to `directStream`.
   Pin account/device, owner lock state, manifest expiry, contact/group policy
   and journal revision. On failure close/drain the lane and discard its partial
   file before allowing encrypted fallback to write.
3. Verify normal chat UI delivery, signed receipts, reconnect/lock/process death,
   old-client fallback and concurrent calls on Dev devices. Rebuild Dev clients
   for native changes. No production build is authorized by this work.

Lazy encrypted preparation can be considered afterward, separately: the current
stage deliberately preserves encrypted custody compatibility and recovery.

## Native admission follow-up

- `scripts/native/AxonicStreamDataGuard.java` and the exact, reversible
  `patch-webrtc-stream.cjs` extension preserve pinned upstream source validation.
  Tampered and partial patches fail; repeat application is supported.
- Binary copies respect ByteBuffer position/limit. Invalid UTF-8 controls,
  oversized frames, pre-authorization binary bytes and credit overruns reject
  permanently. A rejected stream closes its own channel.
- `directAttachmentStream` awaits native authorization before `ready`, and
  awaits native credit before each cumulative acknowledgement. Authorization
  failure never opens a destination file.
- Java admission tests and bridge patch tests pass. The real Android WebRTC
  source compiled with `:react-native-webrtc:compileDebugJavaWithJavac`.
  Evidence: `builds/direct-stream-native-compile.log`,
  `builds/direct-stream-native-check.log`.
- No new production build, phone installation or AoN deployment was performed.
