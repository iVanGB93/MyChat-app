# Phone preparation and storage follow-up

## Measurement correction

The previous 8.5-second pre-enqueue value was not app preparation. The live benchmark generated random-looking bytes and SHA-256-hashed them in Hermes before invoking the app. A separated 10 MiB trace measured 915 ms generation, 3 ms fixture write, 6,713 ms fixture hashing, 18 ms selection/staging and 53 ms actual app preparation. Subsequent app preparation samples were 47–95 ms.

`benchmark-live-transfers.cjs` now exposes fixture creation separately, and `benchmark-transfer-scaling.cjs` creates the phone fixture before starting the send clock. Fixture timing, selection timing, sender stages and receiver stages are saved separately. Hosted fixture upload still belongs to the hosted send duration. Do not compare these corrected totals to the old synthetic-inclusive totals as a software speedup.

## Changes in Dev

- Added aggregate-only checkpoint timing for queue wait, transaction, capacity count, writes and publication. Stage times can overlap parent stages and cannot simply be added together. Async durations include JS/native scheduling, not just disk execution.
- Capacity reads use bounded indexed synchronous queries inside the already private journal transaction, avoiding extra native scheduling turns. Durable writes, commit/rollback, revision checks, account-lock checks and retirement semantics remain intact. No schema migration, deletion or queue reset.
- Fixed the file-hashing race during automatic shared-storage adoption. A private file hash may be queued just before export removes that private duplicate. On failure, hashing now resolves the canonical file again and accepts only the actual shared-storage handoff, requiring existence and the expected byte count and computing a fresh hash. No success is invented, no missing file is recreated, and failures without a handoff remain failures.

## Findings and limits

The checkpoint queue and publication observers contributed essentially zero time. Transaction elapsed time remains variable (roughly 1–3 seconds across several receiving checkpoints in sampled runs). Actual INSERT/DELETE execution and capacity reads are usually much smaller. One asynchronous capacity read took 1.4 seconds; bounded reads subsequently measured 0–1 ms. This removes one avoidable wait but does not establish a consistent overall transfer speedup or prove that all remaining transaction latency is physical storage.

A final-matrix attempt stopped on an export/hash race for a 5 MiB received file. The preserved file was independently inspected afterward: canonical shared-storage file exists, delivered status, and full SHA-256 matches the descriptor. Evidence is in `builds/preparation-file-inspection.json`; it was not resent or deleted. The fix is covered by adopted, unchanged, deleted and wrong-size regression cases.

## Validation

- TypeScript typecheck passes.
- Journal/transfer/scheduling/batch suite: 99 pass, 1 optional skip, zero failures.
- File/storage regression suite after handoff fix: 17/17 pass.
- Rollback/concurrency regression verifies failed transactions never publish progress, revisions remain isolated and concurrent saves preserve compare-and-set.
- Changes loaded only in the already installed `com.axonic.dev` through Metro. No native build was necessary; no AoN deployment, normal-app update, production build, data reset or unrelated commit was performed.

Live traces: `builds/phone-preparation-trace-20261026.log`, `phone-storage-trace-20261026.log`, `phone-storage-detail-20261026.log`, `phone-preparation-final-20261026.log`, and final verification `phone-preparation-verified-20261026.log`. All test files/history are retained.

## Final live results

Evidence: builds/transfer-scaling-1793057316769.json. All six transfers passed independent checksum and sender-receipt checks. All baseline message keys survived: phone 221→231, FirstNeuron 295→311 (background messages also arrived).

| MiB | Phone→1N total | 1N→phone total | Phone actual preparation |
|---:|---:|---:|---:|
| 1 | 6.641 s | 6.705 s | 64 ms |
| 5 | 10.083 s | 24.870 s | 49 ms |
| 10 | 15.925 s | 18.161 s | 63 ms |

Selection/staging was 19/13/52 ms. Receiving checkpoint totals were 1.650/1.455/1.788 seconds, including asynchronous scheduling and transaction overhead; capacity reads were 1/2/0 ms. The slow 5 MiB hosted send included 8.444 seconds of fixture upload/preparation. Final 10 MiB receive-stream time was 10.466 seconds. These are variable single samples, not evidence that the whole path became consistently faster. Further work should distinguish JS scheduling, transaction begin/commit, and network delays rather than treating the old synthetic hash time as a production bottleneck.
