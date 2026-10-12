# Media preparation — October 12, 2026

## Change

Android now computes the private staged content copy's SHA-256 on the existing
attachment worker pool. The API accepts a validated owner, attachment ID and
expected length, never a caller-provided filesystem path. It checks canonical
path, exact byte count, file size and interruption, and clears its read buffer.
Older development clients and other platforms retain the JavaScript checksum.
A supported native API failure aborts preparation instead of publishing a
partially prepared attachment. Account/cancellation state is checked after the
native await and throughout encryption.

Preparation copies the plaintext in native file code and encrypts/hashes that
private copy. It retains the original staged source for retry. Ciphertext remains
binary until its existing hex-serialized Merkle leaf is needed, avoiding a
hex-to-bytes round trip per chunk. Temporary buffers are cleared. The 4 KiB
encryption boundaries, XChaCha20-Poly1305 nonce/AAD derivation, Merkle format,
signed manifests, receipt checks and group v2 shared content are unchanged.
Shared recipient grants reuse the first preparation and checksum.

No AoN protocol change or production build is required for these source changes.
Native acceleration requires a new mobile binary. Only the authorized phone
Dev app and emulator development clients were rebuilt and installed locally.

## Measurements

Fixed synthetic input: 2,097,151 bytes, byte i = i modulo 251. Three alternating
baseline/current pairs per device, same active runtime and native client. The
baseline is a saved pre-change preparation implementation. Profiling wraps
preparation stages in an isolated copy; it does not send a message. All twelve
outputs passed native full-file checksum verification. These are development
measurements, not production benchmarks or a universal throughput guarantee.

Timing includes preparation, private copy, encryption, checksum, tree, signing,
publication and scheduler yields. It excludes initial picker/staging, network
transfer and chat bookkeeping. Milliseconds:

| Device | Baseline trials | Optimized trials | Median reduction |
| --- | --- | --- | --- |
| Samsung Axonic Dev | 6248, 6173, 6669 | 3537, 3788, 3578 | 42.7% |
| Emulator 5554 | 6231, 6564, 6465 | 4448, 4111, 4092 | 36.4% |

The baseline JavaScript full-file checksum alone consumed about 1.8–2.3 seconds.
Native file I/O was only milliseconds; it was not the primary bottleneck. The
remaining encryption and event-loop yields are substantial. The copy/hex cleanup
alone gave a smaller improvement before native hashing was added.

## Validation

- Full app check passed: type checking, 890 tests passed / 3 skipped, dependency
  cycles, module boundaries and consolidation.
- Added an independent original-serialization v1/v2 encryption comparison;
  the final 24 targeted preparation/protocol/group tests pass. Coverage includes
  native error/malformed result, locking across the native await, short reads,
  copy/write failures, retry source retention, and shared checksum reuse.
- Android attachment hashing tests: 3 passed, including staging path isolation
  and exact byte length; both local debug builds succeeded.
- Normal emulator-to-phone chat: 2,097,151 bytes delivered and checksum verified,
  with signed completion and no remaining jobs. Runtime preparation was 4.924 s;
  sender queue-to-signed-completion was 12.548 s. This is a functional check,
  not evidence of an overall end-to-end speedup over earlier non-paired runs.
- A 524,287-byte normal chat transfer was deliberately interrupted after its
  first direct-stream buffer. Encrypted fallback delivered the correct file;
  both ends completed, jobs cleared, and the chat axon stayed connected.
- Emulator-to-emulator 131,071-byte transfer also completed with a verified
  receiver checksum and signed receipt, leaving no jobs. Preparation took
  0.690 s, but total sender completion took 154.057 s amid the second emulator's
  repeated reconnections and 1–2 s storage checkpoints. It was foreground,
  awake and not forced idle. This existing limitation remains unresolved and
  is excluded from the preparation speed comparison. Test hooks were restored.

Local evidence is in ignored `builds/preparation-*.log` and `.jsonl` files. The
paired profiler is `builds/preparation-profile.cjs`; baseline/current modes use
the same workload. Initial phone trial output was recorded in the session before
file logging was enabled. No credentials, plaintext test keys or personal media
are part of this report.
