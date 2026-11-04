# Stream variability investigation — 2026-10-26

Scope: Axonic Dev on the connected phone and FirstNeuron, foreground transfers. Existing data preserved; normal app untouched; no AoN deployment or production build.

## Repeated baseline

`builds/transfer-scaling-1793058744177.json`: two independent transfers per size/direction, fresh synthetic content, complete-file SHA-256 plus sender receipt checks. All 12 passed and all baseline message keys remained present.

| Size | Phone → FirstNeuron | FirstNeuron → phone |
| --- | --- | --- |
| 1 MiB | 3.861–4.525 s | 3.368–4.148 s |
| 5 MiB | 5.545–6.339 s | 6.072–7.057 s |
| 10 MiB | 11.182–11.898 s | 13.167–17.002 s |

The previous 5 MiB > 10 MiB observation did not reproduce. This does not establish its exact historical cause; two repetitions are not a latency distribution. Checkpoints ranged 163–934 ms. Receiver direct-stream elapsed: 1.035–1.156 s / 3.150–3.473 s / 8.805–11.785 s for 1/5/10 MiB.

Totals exclude phone synthetic fixture creation/hash but include real preparation, control requests, receiver completion observation and polling. Hosted fixture upload remains included. These are not raw link throughput.

## Diagnostic correction

Added bounded local aggregate phases for WSS stream seal/open, source read, destination write, hash, burst yields and idle waits. They contain no identifiers, file paths, content or keys. Disabled timing leaves operations unchanged. Existing stream windows, authenticated encryption, sequence checks, durable lease checks, checksum verification and publication guards are unchanged.

Do not label idle elapsed as pure network wait: it overlaps JS receive/decrypt work and event-loop scheduling. Do not sum it with those phases. This distinction prevents optimizing the network for phone CPU time.

Live instrumented 5 MiB: outbound seal 3.332 s, read 12 ms, burst yields 667 ms, idle wait 927 ms; inbound open 3.641 s, writes 5 ms, hash 8 ms, total stream 5.152 s. These establish substantial JS crypto processing cost; no cryptographic behavior was changed in this investigation. Native stream record processing is a candidate requiring implementation, equivalence/security tests and a Dev native rebuild before speed claims.

## Validation

45 focused tests pass (stream integrity, tampering, revocation, bounds, wake behavior, scheduling, diagnostic aggregates); typecheck passes. The first instrumented matrix completed 1/5 MiB both ways, then the inspector evaluation ended during the 10 MiB phase. Pending work was preserved, not reset. A separate 10 MiB rerun follows in `builds/stream-phase-ten-live.log`.

No new speedup is claimed from diagnostics. The earlier export-maintenance improvement remains in place. Foreground tests do not certify background FCM recovery.

The separate 10 MiB attempt also hit a Dev session timeout before a new measured result. ADB still lists the phone, but no responsive Dev evaluation is available. Requested reopening Dev; the 12-transfer baseline remains complete and valid. Detailed 10 MiB phase validation remains pending.

## Resumed phone session

Opening Dev alone left the inspector unresponsive. Restarted only com.axonic.dev (no clear-data/reinstall), restored Metro reverse, then completed both 10 MiB transfers in builds/transfer-scaling-1793059203502.json. Checksums, sender receipts and baseline preservation all passed.

Cold outbound was 29.652 s and is not a clean full-stream sample: only 24 data reads/25 sealed records occurred, followed by block reads and repeated status calls. History snapshot aggregate was 11.341 s, checkpoint 163 ms. These overlapping aggregates do not establish the exact fallback cause.

Inbound completed in 11.200 s: stream 6.541 s, 321 opened records, JS open/decryption 5.205 s, file writes 13 ms, hash 8 ms, checkpoint 225 ms. Idle elapsed 6.470 s overlaps decryption and is not network-only time. This is direct evidence that phone record processing is a major bottleneck even when file I/O and journal waits are small.

Warm repeat: builds/transfer-scaling-1793059285049.json, both checksums and receipts passed, baseline records preserved. Phone→FirstNeuron 9.234 s (321 seals, 320 data reads; seal 5.431 s; reads 107 ms; checkpoint 356 ms; history 473 ms). FirstNeuron→phone 13.032 s (321 opens; open 6.289 s; stream 8.208 s; checkpoint 410 ms). Thus the 29.652 s cold outbound fallback is not representative of the full-stream warm route. Remaining CPU processing is repeatable; network/scheduling variation still exists. All four resumed transfers completed successfully, with no deletion or normal-app changes.
