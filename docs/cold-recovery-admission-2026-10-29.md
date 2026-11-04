# Incoming admission and cold recovery

Concurrent byte-identical incoming messages now share an in-flight admission within one account. Durable ledger validation remains authoritative; conflicting payloads and subsequent retries still enter it separately. Account changes invalidate results. The bounded map bypasses coalescing when full without dropping work. No new timer is introduced.

Added content-free timings separating pre-admission dedup, ledger receive, and presentation elapsed time. These include queue waits and must not be interpreted as raw disk timings. Recovery logs include setup time and completion reason.

Validation: full mobile checks passed (1,726 passed, 3 skipped); four admission regressions passed again after installation. Rebuilt and installed only com.axonic.dev with its embedded headless bundle.

Warm pre-change trace: recovery completed in 5,602 ms, with message commit approximately 4,302 ms after recovery start. Overlapping receive work was visible. Trace includes control traffic, so not every operation belongs to the test message.

Cold run: builds/cold-recovery-1793311699924.json. Dev process 13263 was confirmed absent before sending; recovery ran in new process 14313. Signed receipt verified and notification preview displayed. Recovery reported 15,234 ms, setup 14,279 ms, wait lag 0, reason receipt_complete. Sender observed receipt after 19,765 ms (polling observation, not exact receipt creation time). The explicit wake gateway returned retry, so this is successful cold-process recovery under existing wake/retry activity, not an isolated FCM latency benchmark. Several concurrent ledger operations waited seconds; incoming timing records contain no message IDs and cannot all be attributed to the test message.

The cold test does not establish a speed improvement. Remaining startup/admission contention needs further targeted measurement. No data was cleared or restored. Dev identity and pre-existing job IDs verified preserved. Official com.axonic remains versionCode 105, lastUpdateTime 2026-10-29 08:39:16. No production build or official installation.
