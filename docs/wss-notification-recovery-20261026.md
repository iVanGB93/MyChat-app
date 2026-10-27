# WSS admission and background notification/media recovery — 2026-10-26

## Changes

1. Attachment request admission and stream lease refresh now retry once when a concurrent ledger write invalidates a permission snapshot. They never reuse the rejected snapshot, keep the same owner/runtime generation, remain bounded, and propagate storage failures. This reproduces and fixes one code path that returned unavailable before WSS could start. It is not proof that every prior no-stream case had this cause.
2. The shared work pump exposes runDue(), allowing the existing native-clock message recovery loop to execute overdue attachment work while Android suspends frame-based JS timers. No early run, overlapping worker, new polling service or permanent background lease is introduced; future/idle deadlines stay asleep.
3. A completed message receipt no longer ends recovery while that message's attachment job remains pending. The original 20-second recovery budget and 30-second native window remain bounded. Complete/cancelled/expired jobs release recovery normally; unfinished work remains durable for later recovery.
4. Fixed content-free inline-persisted/fetch-required logs distinguish actual inline admission from receipt of a hint. Media is still fetched independently; a notification does not contain a 5/10 MiB file.

## Live background results

Tests used FirstNeuron and com.axonic.dev on R3GYC0H7PMY. Phone was backgrounded with Home, not force-stopped, and remained backgrounded through completion. Network snapshot showed zero sessions before each qualifying test. This is real FCM/background evidence with a connected debugger; it is not a force-stopped/Doze/locked-account or production-build certification.

Before the fix, the 5 MiB descriptor and notification arrived, but the file remained pending for the full 90-second observation and resumed on foregrounding. Existing data and pending work were preserved.

After the fix:

| Case | Notification observed | Full content observed |
| --- | --- | --- |
| Short text, inline encrypted envelope | 4.140 s | 2.487 s |
| 5 MiB, fetch-required | 10.361 s | 16.230 s |
| 10 MiB, fetch-required, disconnected rerun | 12.066 s | 19.913 s |

Media files matched independent complete-file SHA-256. Later read-only FirstNeuron checks confirm delivered status for all these messages and attachment receipts. Initial receipt observations were pending and were not misreported as immediate confirmation.

The first 10 MiB background result (7.352 s) had two already-connected sessions from another wake. It is retained as a background-connected test only, excluded from the disconnected table. The rerun explicitly waited for zero sessions and recorded wake_verified, authentication starting, fetch-required, message commit, notification posting and verified native WSS receipt.

The 5 MiB recovery had a WSS attempt fail with reason revoked after 2.032 s, then safely completed through encrypted blocks. This remaining authorization/session invalidation has not been pinpointed; do not claim all fallbacks eliminated. The disconnected 10 MiB WSS attempt verified in 4.121 s.

Times run from sender invocation to host observation (including fixture upload/preparation and polling), not pure FCM or socket latency. Notification evidence is Android/Notifee's active-notification list plus posting journal, not a human screen observation. Inline text was durably admitted before the notification was observed. All baseline history/account checks passed, and Dev was returned to foreground.

## Final foreground regression matrix

All six transfers used verified native WSS, matched checksums, received sender receipts and preserved baseline data:

| Size | Phone → FirstNeuron | FirstNeuron → phone |
| --- | --- | --- |
| 1 MiB | 3.060 s | 3.680 s |
| 5 MiB | 3.507 s | 4.192 s |
| 10 MiB | 4.532 s | 6.382 s |

## Validation and evidence

- Full mobile suite: 1,569 passed, 3 optional skips, zero failures. Typecheck passed.
- Regression cases: invalidated snapshot retry, repeated invalidation bound, account change, storage failure; native-driven overdue work with suspended JS timers, no early/duplicate/idle work; attachment-aware receipt completion and bounded pending-media lease.
- builds/notification-recovery-1793060392887.json — before fix.
- builds/notification-recovery-1793060691112.json — inline text, 5 MiB, connected-background 10 MiB.
- builds/notification-recovery-1793060917967.json — disconnected 10 MiB.
- builds/notification-receipt-audit.json — final sender evidence.
- builds/transfer-scaling-1793061014734.json — foreground matrix.
- builds/wake-media-full-tests.log, wake-media-boundary-tests.log, wake-media-typecheck.log.

No data was deleted/reset, no normal-app installation, no AoN deployment, and no production build. Runtime changes were loaded in the existing native-enabled Dev client through Metro. Unrelated workspace changes preserved.

## Follow-up: session revocation and suspended stream waits

Added content-free guard classifications to bounded WSS outcomes and fixed a concurrency bug: a successful in-flight durable check can no longer restore authorization after another check has failed. A regression drives two overlapping checks, failing the newer one before resolving the older one successfully; both refuse and no file commits.

Warm notification startup now checks lock policy without rereading the secure credential when the account is already unlocked. Cold/locked startup still authenticates normally.

First repeated disconnected background media run (notification-recovery-1793061479001.json) completed 5/10 MiB in 13.438/11.067 seconds with matching checksums and verified native WSS. The next run (1793061672686) delivered inline text in 2.539 seconds and 5 MiB in 10.600 seconds, but 10 MiB remained pending after 90 seconds. Do not exclude this failure from the result.

The foreground follow-up (notification-pending-followup.json) revealed guard=peer-session on the stalled 10 MiB WSS attempt (67.176 seconds), followed by a verified retry (6.801 seconds) and a matching full-file checksum. This was session replacement, not a rejected contact/owner policy. Recovery had hit its bounded 20-second deadline during CPU/queue contention (about 12 seconds process CPU, up to 3.330 seconds wait lag); notification posting also queued behind other work. The file was preserved and completed without resending it.

The WSS stream's burst and idle waits were still JS timers. They now use the existing native message clock when backgrounded, while foreground/AoN behavior retains normal timers. This lets the stream advance and check session validity even when RN frame timers pause. Native callbacks are idempotent: a late clock completion cannot consume a newer signal. The recovery budget, peer identity binding, policy checks, encryption, and integrity checks remain unchanged. New tests explicitly suspend JS timers and resolve the native clock, including late-callback ordering.

Final native-clock run: builds/notification-recovery-1793061998466.json. Both began disconnected/backgrounded and completed without foreground assistance; baseline preservation passed.

| Size | Notification observed | Full file observed | Stream outcome |
| --- | --- | --- | --- |
| 5 MiB | 10.134 s | 22.701 s | durable-lease revoked after 3.329 s; encrypted block fallback completed |
| 10 MiB | 8.174 s | 10.640 s | native WSS verified in 1.900 s |

The 5 MiB failure is now identified: `snapshot-invalidated` occurred twice. Concurrent ledger writes invalidated both bounded admission snapshot reads. This is a conservative refusal to use unverified policy, not evidence that a contact was denied. Stable policy reads under write contention remain unresolved; no stale-cache bypass or unbounded retry was introduced. Therefore neither uniformly fast background delivery nor elimination of fallbacks is claimed.

All seven messages from these three follow-up runs now have confirmed delivered receipts on FirstNeuron (builds/notification-guard-receipt-audit.json); all media checksums passed, including the earlier foreground-recovered file. Final suite: 1,573 passed, 3 optional skips, zero failures; typecheck passed (recovery-native-wake-full-tests.log and recovery-native-wake-typecheck.log). Display-off/Doze and production execution were not verified. Normal app and existing data remain untouched; no commit, deploy, or production build performed.

## Permission snapshot queue contention fix

The original snapshot revision was captured before entering the serialized ledger queue. Writes already ahead of the read could complete, causing a newly read current snapshot to be rejected against the old revision. Added `revisionSnapshot` to the shared ledger: capture revision inside the serialized operation, read/validate state, and reject any revision change during that actual read. The attachment cache accepts that stamped revision only if the owner, epoch and current revision still match after return. The older unstamped read path remains conservative for consumers without this capability. Mobile transfer admission now uses the stamped read. No retries were added and no permission/lease checks were removed.

Regressions verify two writes ahead of the read (including contact blocking) produce one current read, and changes during/after capture, locking, account switches and epoch clearing still reject. Full suite: 1,576 passed, 3 optional skips, zero failures; typecheck passed. Evidence: permission-snapshot-tests.log, permission-snapshot-full-tests.log, permission-snapshot-typecheck.log.

Live run `notification-recovery-1793062403201.json`: disconnected background 5 MiB notification observed at 8.466 s, complete checksum-verified file at 13.933 s. Native WSS verified in 6.631 s with guard=none; no stream fallback. The 10 MiB fixture upload failed on FirstNeuron with HTTP 400 before a send ID returned. A separate retry (`notification-recovery-1793062550887.json`) also failed before send completion. These are NOT completed phone tests.

Read-only server inspection found `/dev/vda1` completely full (24 GB used, zero available), with 15 GB in `/var/backups`. Two test uploads remain preserved in staging, one at 8,126,464 bytes and another fully uploaded at 10,485,760 bytes. No server data or backups were removed. Approval requested to clear only 191 MB of downloadable APT archives before continuing the 10 MiB test. Dev returned to foreground, normal app untouched.

### Authorized cleanup and completed 10 MiB retest

The owner subsequently authorized the package cache cleanup AND removal of old backups. Removed the 22 explicitly inventoried Axonic backup entries under `/var/backups` after checking resolved paths and rejecting symlinks/mount points. Ran `apt-get clean`. Live `/var/lib/axonic-neuron` data and installed software were not targeted; system package-manager backup files were left intact. Disk changed from 24 GB used/zero available to 8.1 GB used/16 GB available (35%). The neuron remained active and public HTTPS `/health` returned `{"ok":true}`.

`builds/notification-recovery-1793063057015.json`: 10 MiB, zero connected sessions before sending, phone stayed backgrounded through completion. Notification observed at 8.396 s; complete file at 14.035 s; native binary WSS verified in 4.876 s, guard=none, no fallback. Full-file checksum matched and phone/neuron baseline identities/history were preserved. Dev returned to foreground afterward; normal app untouched.

Both post-fix 5/10 MiB tests now have verified WSS delivery without permission fallback. FirstNeuron's final outgoing delivered receipts were independently checked in `builds/permission-snapshot-final-receipt-audit.json`. These are limited background Dev runs, not a guarantee against every fallback or a production/Doze certification. Timing includes sender fixture preparation and host observation, not just socket throughput. No additional source changes or deployments were needed after the 1,576-pass suite and successful typecheck.

## Notification processing and timing breakdown follow-up

`finishRootMessageWake` now obtains blocked/muted policy from one fresh history read instead of two. Suppressed/read/control events skip preferences and history reads entirely, retaining the existing silent notice/cancellation handling. Visible previews still require unlocked matching account, fresh policy and notification preferences. Blocking uses the existing any-matching-contact rule. No persistent policy cache was introduced.

Added a start timestamp to the bounded content-free WSS outcomes, and retained sender preparation/upload phases in the live test report. These are observations, not additional transfer work or backups.

Live report: `builds/notification-recovery-1793063489314.json`:

| Phase from sender invocation | 5 MiB | 10 MiB |
| --- | --- | --- |
| Sender call completed | 2.171 s | 2.637 s |
| First verified wake | 3.572 s | 3.874 s |
| Incoming message committed | 5.206 s | 6.168 s |
| WSS started | 6.976 s | 9.274 s |
| WSS duration | 7.323 s | 1.864 s |
| Notification observed | 9.058 s | 10.033 s |
| Complete file observed | 16.133 s | 12.696 s |

Both files verified by full checksum, no fallback, baseline history/identities preserved, and sender delivered receipts confirmed (`notification-policy-receipt-audit.json`). Both started with zero sessions and stayed backgrounded until completion. End-to-end elapsed includes fixture preparation and host polling; the 1.6–1.8 seconds after stream completion includes final processing AND observation lag, not proven storage time alone. Cross-device wall-clock phase alignment is approximate. These results are variable: the 5 MiB result is slower than the preceding run, so no uniform speedup is claimed. History/attachment-job scheduling before stream start remains a priority.

Validation: 1,577 tests passed, 3 optional skips, typecheck passed. Final any-matching-contact semantics adjustment rechecked all 44 notification tests. Evidence: notification-policy-full-tests.log, notification-policy-typecheck.log, notification-policy-final-tests.log.

## Owner-authorized remaining backup cleanup

Owner explicitly requested no routine backups and deletion of remaining AoN/local app backups. Removed 8 FirstNeuron archived-history/peer/dist-backup entries, 4 SecondNeuron archive directories, 18 ThirdNeuron/OpenClaw backup entries, and 20 local project backup files/database-copy directories. Targets were inventoried and resolved before removal; live databases, identities, queues, installed runtime, current source and release packages were not selected. Historical diagnostic reports and deployment packages are not state backups and were retained. Local deleted paths: `builds/removed-local-backup-paths.txt` (metadata only). No backup copies found by the Dev app's files-directory backup-name scan; normal app was not accessed.

All three AoNs returned healthy after cleanup; FirstNeuron remained active with 16 GB free. Routine backup preference recorded in START-HERE.txt. This does not disable protocol recovery records or platform-internal automatic safety mechanisms. No production build, phone reinstall, commit, or deployment was performed.

## History handoff and revision-bound ledger cache

Follow-up baseline: `builds/notification-recovery-1793063984771.json`. Per-transfer timing deltas (not cumulative runtime totals) showed attachment history snapshot work of 3,426/1,047 ms and ledger storage-read work of 5,415/4,166 ms for 5/10 MiB. Aggregate queue times can overlap and must not be added to end-to-end time.

A committed-state event now hands the exact durable serialized history to the attachment snapshot cache, guarded by owner/current revision. Attachment jobs wake from that event. The first event-only run (`notification-recovery-1793064209896.json`) eliminated attachment rereads but did NOT improve end-to-end speed: 23.644/25.509 s; other ledger consumers still accumulated 9.0/9.9 s of storage reads. This intermediate regression is retained as evidence.

The shared ledger now optionally reuses serialized persisted bytes under a storage revision counter. Each read still checks account access and parses a fresh mutable object. Successful writes populate the cache only when the revision advances exactly once; overlapping writes prevent both caching and committed-state handoff. Uncertain writes invalidate before dispatch. Mobile lock/account changes invalidate the cache. Consumers without a revision provider retain existing storage-read behavior. Mobile history writes found in source go through ownChatStore (including reset storage); account removal invalidates on the session transition. No permissions, integrity checks, recovery budget, or wire formats changed.

Final background run: `builds/notification-recovery-1793064867124.json`:

| Measurement | 5 MiB | 10 MiB |
| --- | --- | --- |
| Baseline complete-file observation | 15.343 s | 17.901 s |
| Final complete-file observation | 11.083 s | 12.072 s |
| Native WSS verified duration | 0.967 s | 1.468 s |
| Incoming commit to WSS start | 1.373 s | 2.395 s |
| Attachment history snapshot aggregate delta | 15 ms | 16 ms |
| Additional ledger storage reads during transfer | 0 | 0 |
| Ledger mutation queue aggregate delta | 1.228 s | 0.802 s |

Both started backgrounded with zero sessions, completed without foreground assistance, passed full-file checksums, guard=none, and preserved baseline identities/history. FirstNeuron delivered receipts independently verified in `history-cache-receipt-audit.json`. Final Dev app brought to foreground. Two earlier attempts failed at debugger initialization before sending; Dev reload restored the connection without reinstall/reset.

These are two live samples, not a throughput guarantee. Host observations include fixture preparation, polling, and scheduling; notification and completion observed together do not establish simultaneous internal completion. Stream start is still 5.680/7.375 s after sender invocation. The remaining 1.4–2.4 s after message commit includes job admission/scheduling and network setup; not all of it is measured storage work. The 10 MiB commit-to-stream interval did not improve relative to this baseline, despite faster complete delivery.

Validation: 1,583 passed, 3 optional skips, zero failures (`history-cache-full-tests.log`); 61 focused tests passed; typecheck passed. Regressions include fresh independent snapshots, external-write invalidation, concurrent-write handoff rejection, account locking, blocked policy, uncertain-write rereads, observer failure, and durable-only handoff. No backup, commit, deployment, production build, normal-app change, or history deletion performed.

## Background job wake and ready-stream selection

The attachment pump's event wake still used a zero-delay React Native frame timer. Background frame timers can pause, leaving native recovery polling to discover the scheduled work. Mobile attachment events now call the existing single-flight `runDue` immediately when backgrounded. Foreground fairness and periodic/burst scheduling are unchanged. Regression tests deliberately never fire frame timers and verify incoming work starts, repeated events coalesce, blocked contacts remain rejected, and stopped runtimes cannot restart.

Added bounded aggregate `jobIdentity` and `rtcStreamAttempt` timings. The first live run (`notification-recovery-1793065424724.json`) passed hashes/preservation but was variable: 5/10 MiB observed completion 14.071/13.168 s; commit-to-WSS 2.746/0.811 s. Identity reads consumed only 8/5 ms, reconciliation 195/11 ms, and RTC-before-WSS attempts 393/2 ms (per-transfer deltas). These timings overlap other phases and are not additive. Timer change alone did not establish an end-to-end speedup.

Mobile now selects an already open RTC lane first, otherwise an existing WSS session for the exact sender device before attempting RTC setup. WSS unavailability can still fall through to RTC; an actual failed stream retains normal encrypted-block fallback instead of starting another competing stream. Each adapter retains its permission, device and session validation. The shared transfer worker and durable job/receipt rules are unchanged. Added selection regressions for ready RTC, ready WSS, disappearing/unavailable WSS, failed WSS, and a wrong-device observation.

Final route-selection run: `builds/notification-recovery-1793065697490.json`.

| Phase | 5 MiB | 10 MiB |
| --- | --- | --- |
| Commit to WSS start | 1.589 s | 1.306 s |
| WSS start from sender invocation | 5.592 s | 5.978 s |
| Verified native stream | 0.855 s | 1.289 s |
| Notification observed | 8.723 s | 11.981 s |
| Complete file observed | 12.484 s | 11.981 s |
| Job reconciliation aggregate delta | 253 ms | 159 ms |
| Identity read aggregate delta | 12 ms | 6 ms |
| RTC attempt aggregate delta | 0 | 0 |

Both background/disconnected-start tests passed full checksums, no stream fallback, and baseline preservation. `job-startup-receipt-audit.json` verifies sender delivered receipts for all four files across both rounds. Dev returned foreground. One stale-debugger initialization attempt sent nothing; Dev was reloaded without reinstall/reset.

Compared with the previous final run, the 10 MiB commit-to-stream gap decreased from 2.395 to 1.306 s; 5 MiB changed from 1.373 to 1.589 s. Complete-file observations are 12.484/11.981 s versus 11.083/12.072 s previously. Thus no uniform end-to-end speedup is claimed. Identity lookups are not the dominant delay. Remaining startup involves history snapshot queue waits, durable job/route checkpoints, native calls and session readiness; aggregates overlap and do not fully isolate those causes. Host observation overhead is also substantial after the stream finishes.

Final validation: 1,589 passed, 3 optional skips, zero failures (`job-startup-full-tests.log`); 31 focused scheduling/selection tests passed; typecheck passed. No commit, deployment, backup, production build, normal-app change or history deletion. Existing AoN runtime unchanged; these changes apply to mobile's attachment adapter and use the existing shared worker.

## Events arriving during checkpoints and maintenance invalidation

The prior background `wake` + `runDue` shortcut did not cover an event that arrived while the worker was running: the pump's finalizer still armed a zero-delay frame timer. Added an explicit shared `wakeNow` path that coalesces real events onto one microtask, retains the immediate wake across an in-flight operation, and never overlaps workers. Mobile uses it in background. Default foreground/AoN scheduling and progress-only fairness yields remain unchanged; retry/expiry deadlines remain timers. Tests suspend all frame timers, inject repeated events during an unresolved checkpoint, verify exactly one follow-up pass, and confirm stop and retry deadlines.

Mobile maintenance no longer rescans unchanged queues merely because its former 60-second eligibility interval elapsed. Journal instances share a process-local change revision; new jobs and terminal transitions invalidate maintenance observations after durable commit. Progress-only checkpoints do not invalidate them because descriptor expiry is immutable. The next real expiry invalidates naturally, empty queues remain dormant, and process restart scans afresh. Maintenance remains inside the shared writer queue, rechecks authorization, retains transactional rollback and archives completed/expired rows without deleting receipt history. Tests cover two journal instances, unchanged idle queues, progress, failed CAS, exact expiry and lock rollback.

Initial live event/checkpoint run: `notification-recovery-1793066189890.json`. 5/10 MiB files completed backgrounded from disconnected sessions; full hashes, sender delivered receipts and baseline identity/history preservation passed. Commit-to-stream gaps were 3.002/0.881 s, streams 3.574/1.841 s, full-file observations 14.318/13.125 s. Checkpoint queue aggregate delta was 0 ms in both; maintenance 223/9 ms and reconciliation 472/153 ms. No stream fallback. This does not establish a uniform latency improvement; the 5 MiB sample worsened.

The full suite exposed an unrelated probabilistic fixture error: replacing a random ciphertext prefix with `ff` sometimes did not mutate it. The fixture now XORs a bit so validation always receives changed bytes. No custody validation was changed. After that correction: 1,592 tests passed, 3 optional skips, zero failures (`event-checkpoint-full-tests-final.log`); typecheck passed. Separate stream-setup aggregate instrumentation and its assertion passed all 15 WSS tests afterward.

Added `streamSetup` around receive-side random ID creation, native salt generation, and initial lease/session validation before the existing stream outcome timer starts. This aggregate carries no payload, identity or credential data and does not remove validation. It will distinguish this unmeasured setup from storage/worker scheduling.

Final setup-instrumented run: `notification-recovery-1793066419469.json`:

| Measurement | 5 MiB | 10 MiB |
| --- | --- | --- |
| Incoming commit → stream start | 1.220 s | 1.975 s |
| WSS pre-stream setup | 8 ms | 401 ms |
| Job reconciliation aggregate | 349 ms | 306 ms |
| Queue maintenance aggregate | 18 ms | 12 ms |
| Checkpoint writer queue aggregate | 0 ms | 0 ms |
| Verified WSS stream duration | 5.485 s | 4.021 s |
| Complete-file observation | 15.310 s | 18.376 s |

Both passed hashes, no fallback, disconnected/background start and preservation checks. Four sender receipts across both rounds confirmed delivered in `event-checkpoint-receipt-audit-final.json`. No claim of consistent end-to-end speedup: this second round was slower overall despite lower maintenance overhead. Stream durations and async setup still vary; the 10 MiB setup aggregate includes native dispatch and lease checks, not just cryptographic computation. Startup phases overlap, and aggregate write timings include post-transfer checkpoints, so they cannot be added into an exact startup decomposition.

The implemented outcome is removal of the timer dependency for real events arriving during checkpoints, and removal of elapsed-minute maintenance rescans for unchanged queues. Remaining waits require finer native/worker attribution; neither disk write-queue contention nor WSS setup alone explains every sample. No checkpoints, security checks, retry/expiry recovery or history were removed. No backup, commit, deployment, build, phone reinstall, or normal-app change was performed. Dev was returned to foreground.

## Event-driven notification recovery observation

Notification recovery previously checked completion every 300 ms, competing with the attachment worker even when no state had changed. It now subscribes to committed message state, terminal checkpoints for the target attachment, and account changes. Those events interrupt a shared native safety wait immediately. Receipt paths without completion events retain a 1-second fallback; network pumping stays bounded to its existing cadence, and the same absolute 20-second recovery budget, account/receipt checks, deduplication and reference-counted leases remain.

Subscribers are removed on every exit. A late native timer completion cannot consume a subsequent wait or finish recovery twice. Regression tests prove terminal events release recovery before the timer fires, quiet missing-event recovery still terminates at 20 seconds, and all prior inline admission, duplicate hints, locking, receipt and cleanup behavior remains. Full suite: 1,594 passed, 3 optional skips; typecheck passed (`recovery-events-full-tests.log`, `recovery-events-typecheck.log`).

First live event-driven recovery round (`notification-recovery-1793066918809.json`) passed both full-file checksums, no fallback and baseline preservation: 5/10 MiB observed complete at 11.010/11.560 s, commit-to-stream 1.151/0.995 s, native streams 1.388/1.674 s. These improve over the preceding slow samples, but two files alone do not establish a stable speedup.

Added bounded receiver outcome fields `firstRecordMs` and `firstDataMs`: elapsed from stream start to first authenticated/decrypted inbound record and first data record, respectively. They do not contain content or peer identifiers; failed authentication does not count as arrival. Existing stream checks and wire protocol remain unchanged. All 15 WSS tests, including field ordering/one-setup assertions, and typecheck pass after instrumentation.

Final instrumented round: `notification-recovery-1793067128326.json`.

| Phase | 5 MiB | 10 MiB |
| --- | --- | --- |
| Commit → stream start | 1.554 s | 0.947 s |
| Pre-stream setup aggregate | 745 ms | 4 ms |
| First authenticated record after stream start | 308 ms | 25 ms |
| First data record after stream start | 429 ms | 255 ms |
| Verified stream duration | 4.129 s | 1.874 s |
| Full-file observation | 13.864 s | 13.093 s |

Both hashes, no-fallback guards and baseline preservation passed. Four sender delivered receipts across both rounds verified in `recovery-events-receipt-audit.json`. Dev returned to foreground. A brief FirstNeuron resource check showed 16 GB free, load average 0.15, no swapping, and no sustained CPU saturation in that short sample; it cannot exclude earlier spikes.

Evidence narrows the variability to at least two phases: native/async pre-stream setup varies (745 vs 4 ms), and much of the slow 5 MiB stream elapsed after first data (3.7 s). First-record delays do not explain the whole slow stream. `streamIdleWait` overlaps processing and cannot be called network RTT. Decryption/open aggregates were 320/677 ms and job reconciliation 116/114 ms; neither alone accounts for total observed time. Completion observations include host polling and sender fixture preparation. No uniform speed guarantee is claimed.

Implemented change: event-interruptible recovery observation replaces fixed 300 ms completion polling with actual durable/account events plus a 1 s safety fallback. Tests: 1,594 full-suite passes, 3 optional skips; 15 WSS tests and typecheck pass after timing-only additions. All data preserved. No backup, deployment, commit, production build or normal-app modification.
