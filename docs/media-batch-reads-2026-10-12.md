# Media batch reads — 2026-10-12

## Change and compatibility

The 4096-byte encryption unit is unchanged. LAN bulk messages already carry up to 128 units (512 KiB plaintext). RTC currently carries three units per response with two outstanding requests, retaining the 20,000-byte native frame guard and 120,000-byte authenticated send queue.

The mobile sender now opens and reads its ciphertext file once per requested batch, rather than once per encryption unit. `readRootAttachmentChunks` validates the range, reads at most 128 units including their authentication tags, rejects short reads, and returns the original per-chunk ciphertext and Merkle proofs. No persistent handle or additional ciphertext cache is retained.

The transfer worker accepts an optional batch-read adapter. Adapters without it keep the existing single-chunk behavior. Before publishing the response it still checks account/job liveness, descriptor consistency, manifest validity, expiry, recipient/device authorization, and every chunk proof. Recipient decryption, full-file checksum, receipts, and resumable checkpoints are unchanged.

## Device measurements

Workload: synthetic deterministic bytes, 524,287 bytes per small file; emulator sender to Samsung phone running only `com.axonic.dev`. Both use the Metro development bundle, on the existing RTC route. Phone and emulator clocks are not subtracted from each other. End-to-end elapsed time is measured on the sender from queue invocation to successful attachment completion with its receipt. Preparation includes queue/scheduler delay. Each received file is checked against the desktop SHA-256 of the original bytes.

| Configuration | End-to-end seconds | Sender file-read calls |
| --- | --- | --- |
| Before, two runs | 9.300, 7.583 | 128 each |
| Experimental four outstanding batches | 23.160, 6.649, 8.505 | 128 on the two direct runs |
| Final batch-read adapter, original two-batch window | 8.852, 7.548 | 43 each |

All these received files matched the expected hash. The first four-window run also used custody upload, so it is not an isolated window comparison. Its slower result is retained, not discarded. A 2,097,151-byte four-window run took 48.778 seconds and also showed route/session churn and custody activity; it is not evidence of improved throughput. The four-window advertisement was reverted. The final version delivered a 2,097,151-byte file in 27.301 seconds, also hash verified; different route conditions and only one large-file run per configuration prevent attributing that difference to the file-read change.

In the two final small-file runs, accumulated sender file-read time was 238 and 236 ms, versus 449 and 372 ms in the baseline runs. These are stage measurements, not end-to-end gains. Overlapping network stage totals must not be added to estimate wall time. Other background jobs may contribute to aggregate stage counters.

This small, non-randomized development-mode sample establishes the reduction in file operations and successful delivery, not a reliable overall speedup or a production/mobile-data performance claim. Connection establishment, fallback/custody uploads, checkpoint latency, preparation and RTC request scheduling still need attention. Increasing the encryption unit or blindly enlarging an RTC frame is not supported by these results.

## Validation and reproduction

- `npm run check`: 846 passing unit tests, three explicitly skipped benchmarks; type, dependency-cycle, module-boundary and consolidation checks pass.
- AoN `npm run check:core` and `npm test`: shared sources match; 147 tests pass.
- Batch-file tests verify a full 512 KiB range, a short final chunk, nonzero offsets, invalid ranges and truncated ciphertext, with handles closed on error.
- Transfer tests cover the optional adapter, short/tampered results, account lock, full delivery, and the existing fallback adapter and resume paths.
- Local ignored harness: `D:/Proyects/Axonic/builds/speed-measure.cjs`, using the ordinary attachment queue and completion callbacks, restoring its observation hooks after testing.
- Raw observations: `D:/Proyects/Axonic/builds/speed-baseline-*.jsonl`, `speed-window4-*.jsonl`, and `speed-batchread-*.jsonl`.
- Final measured source fingerprints: `D:/Proyects/Axonic/builds/speed-batchread-source.json`. Temporary observation hooks were restored on both devices.

Both AoNs were updated sequentially and their authenticated status endpoints reported active with the same runtime fingerprint: `47d2f3f982eabb42d28d890cad815874fc85731151dc24d8e974dd37df1019fa` (package 0.2.0). SecondNeuron deployment `20283787-86ef-4b74-92e8-3b2167d9e8ac` succeeded. FirstNeuron's identity-file fingerprint was preserved and its previous release retained for rollback. Hosted adapters without the new optional batch-read method retain their existing behavior.

No production APK/AAB or official-phone installation was performed.
