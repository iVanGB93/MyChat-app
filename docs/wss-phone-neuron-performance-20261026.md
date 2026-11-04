# Binary WSS phone integration and AoN reporting contention

## Scope and releases

Updated only the separate `com.axonic.dev` phone application, preserving its identity and history. No production build or official-app installation. FirstNeuron and SecondNeuron now run source commit `242688d6167e4513d1dba37c6008c324687eface`, runtime `52c204e62539`, package 0.2.0, clean/runtime-bound metadata. Both public health endpoints returned HTTP 200 with `ok: true` after testing. ThirdNeuron was not changed.

Server commit is pushed on `codex/wss-binary-20261026`. It follows the binary WSS release `922626c`. FirstNeuron retained recovery files under `/var/backups/axonic-wss-242688d6167e`; Railway deployment is `69350737-2508-4f49-bf01-6b9c7d983c9b` (SUCCESS). Existing queues and configuration were retained.

## Changes

- Android's existing WSS connection now carries negotiated binary attachment records, using the same shared stream implementation as hosted neurons. Control records remain text. Native and JS admission checks, bounded allocations/queues, identity authentication, encryption, ordered sequence checks and integrity verification remain in force. LAN does not acquire the WSS binary capability.
- Android native module accepts and sends bounded byte arrays without text/base64 serialization for these stream records. No second connection is created.
- Chat delivery reporting previously called the complete network snapshot twice per message. A response with 250 messages could rebuild it about 500 times. The server now takes one consistent network snapshot per response. A regression test verifies exactly one read with 5,000 messages and a fresh read on the next request.

## AoN measurements

Stored source files were forwarded under fresh attachment identities. The receiver did not already have each destination digest. SHA-256, file size, direct-peer delivery metadata and actual socket byte deltas were checked. No cached destination reuse or deletion was used.

These are decimal MB, measured from sender queued timestamp to delivery receipt, not raw network bandwidth. Three 10 MB samples per direction:

| Direction | Before snapshot fix, seconds | After, seconds | Median before → after |
|---|---|---|---|
| 1N → 2N | 2.275, 2.070, 2.040 | 1.751, 2.232, 1.877 | 2.070 → 1.877 |
| 2N → 1N | 2.186, 2.249, 3.749 | 1.726, 1.611, 1.615 | 2.249 → 1.615 |

The final 1/3/5 MB samples were 1.175/1.189/1.467 seconds 1N→2N and 1.114/1.286/1.359 seconds 2N→1N. All 12 final transfers passed. FirstNeuron process CPU during the three 2N→1N measurements dropped from 2.11/2.21/4.01 CPU-seconds to 1.45/1.44/1.38. Those intervals also include observation requests and background work; they are not pure stream CPU measurements. The evidence supports reporting contention contributing to the earlier direction asymmetry, not a universal speed guarantee.

An exploratory CPU-profile run was excluded from timing comparisons: closing the temporary inspector briefly stalled the service and the final observation returned 502. The inspector was confirmed closed. Its two transfers were retained, not replayed or deleted.

## Dev phone measurements

MiB means 1,048,576 bytes here, unlike the AoN table. These totals include fixture creation, sender preparation, persistence, API/debugger polling and receiver completion. Single samples per matrix cell; intermediate binary-only measurements confirm the improvement but also show remaining variability.

| Direction | MiB | Before binary, seconds | Final, seconds |
|---|---:|---:|---:|
| Phone → 1N | 1 | 7.108 | 5.065 |
| Phone → 1N | 5 | 32.309 | 11.900 |
| Phone → 1N | 10 | 25.937 | 18.612 |
| 1N → phone | 1 | 6.601 | 6.475 |
| 1N → phone | 5 | 9.070 | 9.156 |
| 1N → phone | 10 | 16.551 | 11.701 |

Phone receive-stream time alone improved from 1.476/5.062/11.197 seconds to 0.976/3.014/6.491 for 1/5/10 MiB. The final session recorded 582 incoming binary WSS records from FirstNeuron. Every final file matched its checksum and sender receipt. Phone baseline messages 199→205 and FirstNeuron 261→267, all baseline keys retained.

Correction from the subsequent preparation investigation: the roughly 8.5-second pre-enqueue measurement included synthetic fixture generation and JS hashing in the benchmark, not just app preparation. A separated 10 MiB trace measured 915 ms generating bytes, 3 ms writing the fixture, 6,713 ms hashing it in the test script, 18 ms selecting/staging, and 53 ms actual runtime preparation. The benchmark now creates/hashes the phone fixture before starting the send timer. Older totals remain valid only for the old measurement definition and must not be compared directly to the corrected totals as an app speedup. Receive completion still adds persistence/checkpoint and scheduling time beyond the stream; these waits remain variable.

## Validation and evidence

- AoN: 332/332 tests pass; build passed.
- Mobile: typecheck passed; full suite 1,556 passed, 3 optional skipped, 0 failed. Focused stream/native transport tests passed.
- Android: 43 tests, 1 skipped, 0 failures/errors; Dev APK build and in-place installation passed. Only a documentation comment changed after that build.
- Evidence under ignored `builds/`: `aon-snapshot-after-20261026.json`, `aon-binary-direction-cpu-20261026.json`, `phone-binary-session-evidence.json`, `transfer-scaling-1793055262498.json` (phone baseline), `transfer-scaling-1793056007235.json` (binary intermediate), `transfer-scaling-1793056334680.json` (final), and corresponding test logs.

No unrelated mobile changes were committed or reset. Metro remains available for Dev testing.
