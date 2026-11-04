# Checkpoint waits and repeated media-export work

## Finding

Checkpoint elapsed time included time waiting for JavaScript to process asynchronous native completions. Separating readiness, BEGIN, body and COMMIT showed a receiving sample spending 3,180 ms in BEGIN across five transactions, but only 9 ms in commits. An experiment with synchronous deferred BEGIN moved the wait into the first asynchronous write; it did not solve the bottleneck and was reverted. BEGIN, writes, COMMIT and ROLLBACK remain asynchronous. Detailed fixed-name aggregate phase diagnostics remain; the explicit transaction sequence matches Expo's original helper and preserves rollback semantics.

A React Native CPU trace identified repeated historical media-export maintenance and expensive Expo File/URL construction. The existing five-minute maintenance cache was not populated when a file was already in shared storage. Every chat write revisited those files, re-resolved their paths and scanned their directories for cleanup. This competed with transfers and database callbacks on the JS thread.

## Fix

`rootMediaExport.ts` now remembers successful shared-storage adoption/cleanup as well as private-file adoption. It checks the maintenance cache before constructing file objects. Cache size remains bounded at 5,000, TTL remains five minutes, changed URI/expiry/account generation cause rechecking, failed adoption is not cached, and explicit export removal invalidates that entry.

This is only a maintenance cache. Media reads still resolve the actual canonical file and validate availability; deleted shared-storage files are not recreated. No media, messages, identities, approvals or queue records were removed. No cryptographic checks, database durability settings or receipt requirements changed.

## Evidence

Bounded CPU traces of the same 1 MiB bidirectional workload, using one persistent Dev inspector connection (inclusive sampled durations, not independent values to sum):

| Stack present in sample | Before cache fix | After |
|---|---:|---:|
| adoptRootAttachmentExport | 8,413 ms | 3 ms |
| rootAttachmentFile | 4,788 ms | 23 ms |
| parseURL | 8,157 ms | 47 ms |
| Total sampled interval | 24,535 ms | 18,931 ms |

These profiles are diagnostic runs and are excluded from the unprofiled transfer table. The script now reuses one initialized inspector session instead of attaching/detaching for each poll; the delay was still present before the cache fix with that persistent session.

Final unprofiled Axonic Dev measurements (MiB = 1,048,576 bytes):

| Size | Phone → 1N | 1N → phone | Receiving checkpoints |
|---:|---:|---:|---:|
| 1 MiB | 4.278 s | 5.251 s | 525 ms |
| 5 MiB | 15.106 s | 14.289 s | 685 ms |
| 10 MiB | 9.804 s | 12.421 s | 286 ms |

Totals exclude synthetic fixture generation/hash on the phone, but include actual staging, processing, polling and receipt observation; hosted fixture upload is included in hosted sends. They are single samples, not raw bandwidth or a guarantee. The slower 5 MiB runs establish remaining variability. Receiving stream times were 1.914/9.642/7.993 s. Sender checkpoint outliers also remain. Do not infer that all network waits are fixed.

All six final files matched SHA-256 and sender delivery receipts; baseline message keys were preserved (phone 260→267, FirstNeuron 340→347, including concurrent background messages). Two later short profiled transfers also passed, with data preserved.

## Validation and scope

- Full mobile suite: 1,563 passed, 3 optional skips, zero failures; typecheck passed.
- Export regressions cover repeated shared-storage links with zero repeated path resolution, TTL expiry, account-generation reset, failed adoption retry, existing private exports and blocked/background behavior.
- Journal regressions cover uncommitted read isolation, rollback on lock, compare-and-set, terminal records and capacity limits. Wake/recovery regressions pass.
- Changes loaded into `com.axonic.dev` through Metro. No normal-app install, production build, AoN deployment or unrelated commit/reset.

## FCM scope

Code review confirms that a valid FCM wake may carry a small encrypted envelope for direct admission. If absent/unusable, recovery activates the shared peer network and fetches the durable copy. Attachments use their own journal and transfer worker after the message descriptor arrives. Reducing foreground JS contention helps the shared runtime, but these live measurements are foreground attachment tests, not a new live background-FCM certification. Export maintenance already pauses in the background.

## Local evidence

- `builds/transfer-scaling-1793058322095.json` — final unprofiled matrix.
- `builds/phone-checkpoint-trace-before-cache.json` and `builds/phone-checkpoint-trace.json` — before/after CPU traces.
- `builds/checkpoint-final-full-tests.log`, `builds/checkpoint-export-cache-tests.log`, `builds/checkpoint-export-failure-tests.log` — validation.
- `builds/checkpoint-boundary-live-20261026.log` — separate transaction phases before the fix.

The initial unsupported Profiler API attempt produced no profile. The final traces use React Native's supported Tracing API through the same session as Runtime.evaluate and stop after the bounded test. No inspector capture is left running.
