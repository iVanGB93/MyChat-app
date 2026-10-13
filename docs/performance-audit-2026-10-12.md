# App-wide performance audit — October 12

Trigger: the official app felt slow across screens after several minutes of use. The previously inspected installation was 1.1.11/code 54. No connected device was available when performance collection was attempted, so CPU, memory, frame timings, thermal state and a live JS profile could not be captured. This is a source audit plus synthetic desktop measurement, not a completed physical-device performance sign-off.

## Findings and changes

1. **Repeated validation of unchanged history — improved.** `rootChatLedger.read` parsed and checked the entire ledger on every read. Background services also call it, regardless of which screen is visible. Cache one successfully validated serialized value per owner-bound ledger. Reads still obtain storage, check account access before/after I/O, parse a fresh object, and validate any changed bytes. Failed validation is never cached. Group/attachment admission, expiry, signature and authorization checks outside storage validation remain unchanged.
2. **Already-delivered avatar packet construction — fixed.** `profilePackets` previously generated hashes, sliced data and serialized every packet before removing acknowledged packets. It now filters indices first. Remaining wire packets and IDs are identical.
3. **Off-screen call-history polling — fixed.** The Calls tab's mounted effect continued every three seconds after navigation. It now uses focused foreground polling with a single flight and ignores unchanged rows.
4. **Media idle-loop ledger reads — high-priority follow-up.** `rootAttachmentRuntime` polls at 200 ms when idle and still loads history, rebuilds permission indexes, checks selections and scans attachments. Its existing stream permission revision cache does not avoid the tick's full read. Profile this on-device, then make metadata refresh depend on history/selection changes while keeping active transfer throughput, cancellation and permission revocation checks intact.
5. **Repeated network housekeeping — follow-up.** Every network pump queues profile/timestamp capability persistence and profile audience discovery even if peers and history are unchanged. Recovery can also pump during its bounded wake window. Add revision/peer-set guards after measuring, with failed writes remaining retryable.
6. **Storage scaling — architectural limitation.** Own chat history is one AsyncStorage JSON value. Reads and mutations scale with history; transport jobs already use SQLite. A future indexed message store would reduce copying and serialized whole-history writes. No data migration was attempted in this audit.
7. **Avatar subscriptions — follow-up.** Mounted chat snapshot hooks subscribe to global avatar changes and reload all their contact avatars on each change. Scope loading to focused screens and changed peers if device profiling identifies material cost.

## Areas reviewed without evidence of a new regression

- Chat lists use FlatList; direct message lists already memoize their data/render tree. The workspace's UI snapshot cache avoids unchanged-history recomputation and its polling is focused/foreground-only.
- Message and attachment pumps have single-flight/concurrency bounds; custody has separate retry/receipt handling. No evidence from the available capture establishes a runaway reconnect loop.
- Signature verification already caches exact signed inputs. The changes above reduce surrounding repeated work; they do not remove cryptographic verification of new inputs.
- Transfer jobs have bounded checkpoints and archive completed jobs. Synchronous indexed job checks and file metadata queries still require live JS/native profiling under transfer load.
- Notification recovery has a separately documented foreground/background timer fix. It is not installed in the official app and cannot explain a new runtime regression caused by this session's edits.

## Measurement

`builds/performance-audit-bench.cjs` uses synthetic data only: 500 messages, 10 contacts, a 12 KB signed avatar acknowledged by all contacts, a 157,510-byte ledger, one warm-up, five runs of 200 operations each. Node on the desktop, in-memory storage adapter; excludes Android bridge, disk, network, rendering and real phone thermal behavior.

| Operation | Before, median total | After, median total |
| --- | ---: | ---: |
| 200 unchanged ledger snapshots | 93 ms | 24 ms |
| 200 pending-outbox enumerations | 139 ms | 3 ms |

These are isolated operation improvements, not whole-app speedup claims.

Validation: full workspace check passed with 960 tests passing and 3 skipped, plus TypeScript, cycle, module-boundary and consolidation checks. Tests cover snapshot mutation isolation, changed/corrupt storage rejection, locked accounts, changed avatar data rejection and byte-identical remaining avatar packets. Concurrent unrelated workspace changes were preserved.

## Required device follow-up

Reconnect the phone and first capture the official app without changing its data or installation: CPU/memory, frame statistics and process-specific logs during idle, chat navigation, typing, scrolling and media activity. Compare the same scenarios in Axonic Dev with representative test history and screen-off/foreground cycles. Keep production release readiness unconfirmed until that comparison is complete. No production build or phone installation was performed here.

## Connected-phone follow-up

Leidiana's SM-S948U1 reconnected. Official version 1.1.11/code 54 was opened without modifying data. Foreground chat-list samples showed about 7–21% of one core on `mqt_v_js`, versus effectively idle RenderThread, and thermal status 0. Initial foreground frame statistics covered only 56 frames (3 janky), which is too small a sample for a responsiveness conclusion. Background memory and warmed foreground memory are not comparable leak measurements.

Started Metro and opened the separate Dev account, preserving its identity. Its history had 36 messages and seven pending message-action packets, with four connected axons. The CDP CPU profiler was unsupported; temporary wrapper measurements were used instead and automatically removed afterward. No test messages were sent.

A 20-second Dev sample recorded 95 ledger snapshot calls, 4,737 ms accumulated asynchronous read latency, and maximum event-loop delay 114 ms. Accumulated latency includes storage/queue waiting and must not be interpreted as CPU time.

Implemented a runtime-local attachment snapshot cache in `attachmentPolicy.ts` and `rootAttachmentRuntime.ts`. Reuse is keyed by owner and chat revision; account events clear it, racing revisions discard a read, failed reads remain retryable, and stopped runtimes release the cached state. Active streams still check permission revisions and job validity. The transfer pump's cadence is unchanged.

After reloading Dev, 10-second samples still recorded 44–53 snapshot calls and roughly 92–114 ms maximum event-loop delay. This does not demonstrate an overall responsiveness improvement. Caller tracing found call-contact lookup, profile audience lookup, delivery collection/selection/recheck, and media export; the repeated attachment snapshot read was absent from that sample. Seven pending actions explain some continuing delivery work but do not establish that all remaining overhead is necessary.

New cache tests plus existing transfer scheduling tests passed, including immediate revision invalidation, account changes, lock/unlock races, retry after storage failure, and incoming transfers continuing during slow preparation. The full workspace validation result is recorded in `builds/performance-phone-followup-check.log`. Further priorities are revision-aware contact/profile housekeeping and bounded retry work, followed by longer device traces with comparable pending-work loads. No production build or official app update was made.

## Delivery and contact/profile follow-up — both Dev phones

Implemented a shared owner/revision-bound runtime snapshot for call contacts, profile audience, delivery selection and receipt lookup. Ledger mutations retain independent durable reads. Concurrent reads coalesce only for the same revision; account changes and runtime shutdown clear the view. Capability persistence now runs only when the owner or advertised peer sets change; failed writes remain retryable.

Failed outgoing attempts back off per message at 2, 4, 8 and at most 15 seconds, with bounded retry bookkeeping. New messages remain eligible immediately, a newly connected recipient clears its delay, and incoming collection remains independent. Repeated delivery confirmations no longer rewrite already-delivered text, action, group packet or avatar acknowledgement state. This avoids needless storage revisions and consequent UI/runtime refreshes without inventing delivery acknowledgements.

Full validation: 968 passed, 3 skipped, 0 failures, plus TypeScript, cycle, module-boundary and consolidation checks (`builds/runtime-idle-check.log`). Regression coverage includes revision races, lock invalidation, failed capability writes, new-message/reconnection behavior during backoff and repeated delivery receipts leaving durable storage unchanged.

Both physical Dev apps were restarted without clearing data to load the latest bundle. In the settled 10-second sample, Leidiana recorded 3 snapshot reads (2.75 ms accumulated read latency), and iVan recorded 4 (383.68 ms). Earlier comparable Leidiana samples recorded 44–53 reads; intermediate unchanged samples reached zero. These workloads are small and not an identical replay. The final event-loop maximum delays were 62 ms and 214 ms respectively; p95 was 50 ms and 167 ms. iVan therefore still has measurable responsiveness overhead. Debugger instrumentation and development mode also affect timings; this is not a release-performance sign-off.

Two labeled texts sent through normal messaging commands between the dedicated Dev identities were received and acknowledged in 1.039 seconds and 0.757 seconds, including test-control overhead (`builds/runtime-idle-live-delivery.json`). Temporary measurement wrappers restored themselves in finally blocks. The official Play Store installations were not changed, and no production build was started. Remaining investigation: iVan's longer JS/storage stalls and comparable navigation/typing/transfer traces before declaring whole-app smoothness restored.

## Stored relay validation follow-up

The next iVan capture recorded only one chat snapshot in ten seconds, but still had a 153 ms maximum event-loop delay. Instrumenting exported functions found 26 `validateCustodyRows` calls consuming 1,597 ms of synchronous time in that interval. Stored envelope digests were recomputed every time the unchanged relay rows were checked.

Added a bounded, process-local map of exact normalized envelope JSON to its digest (128 entries, keys bounded by the existing 7,000-character parser limit). This memoizes only a deterministic hash computation. Parsing, row/recipient/device/expiry bindings, duplicate detection, byte/row capacity limits and network signature admission remain unchanged. Changed bytes use a different key; no mutable packet reference is retained. Tests cover changed ciphertext/signature, wrong digest/recipient/expiry, duplicates and stricter byte limits after warming the cache.

After loading the new code in iVan Dev, a ten-second sample recorded 30 validation calls consuming 53 ms synchronous time, versus 1,597 ms for 26 calls before. This is measured validation cost, not a general app speedup. The following ten-second responsiveness sample recorded zero chat snapshots on both phones; iVan p95/max delay was 47/100 ms, versus the prior settled sample's 167/214 ms. These short Dev samples are not a controlled release benchmark.

Both Dev apps now load the change. Normal-command test messages were received and acknowledged in 853 ms and 886 ms in opposite directions. Full validation passed: 969 tests, 3 skipped, 0 failures, TypeScript and architectural checks (`builds/runtime-custody-digest-check.log`). No official installation, production build or AoN deployment was performed. Remaining scope is sustained navigation and active-media profiling; this evidence establishes a specific idle-work reduction, not complete performance sign-off.

## Three-minute navigation and media run

Ran `builds/long-navigation-media.cjs` on both physical Dev phones: approximately 184 seconds of event-loop sampling while repeatedly tapping observed Chats/Calls/Profile tab bounds and sending synthetic media in opposite directions. Evidence is in `builds/long-navigation-media-results.json`; the final Profile screen and a subsequent chat/image-viewer transition were inspected. No app-source changes were made for this test.

- A 1,363,711-byte JPEG and a 15,840-byte MP4 both arrived byte-for-byte identical. Completion was observed within 12.070 and 4.924 seconds respectively, with coarse polling between navigation actions. These are upper-bound observations and include instrumentation; no throughput or routing conclusion follows from them.
- Event-loop delay p95 was 37 ms / 33 ms; maxima 235 ms / 229 ms. Five / three samples exceeded 100 ms out of 1,711 / 1,647 samples. Synthetic fixture staging and CDP activity also contribute to this measurement.
- Post-run test texts were acknowledged in 793 ms / 741 ms. The image opened in the full-screen viewer without restarting the app. Video transfer integrity is confirmed; playback duration was too short to establish sustained playback performance.
- Thermal status was zero on both devices. Two mid-run PSS readings were 550,160→552,031 KB and 518,086→528,400 KB; this short sample cannot establish or exclude a memory leak.
- Android gfxinfo counted only 52 / 71 rendered frames, with 33 / 38 janky frames; p95 frame duration was 40 / 36 ms. Static tabs render few frames, so this is not a scroll FPS benchmark. Transition rendering remains a performance concern requiring focused frame traces.
- Recent AndroidRuntime/ReactNativeJS error buffers were empty during the run. All temporary measurement timers were stopped. No official app installation or production build was changed.
- After a brief Home/foreground cycle on both phones, the first test message took 11.477 seconds to acknowledge, with the reverse direction at 1.339 seconds. A follow-up pair returned to 855 / 1,026 ms. This suggests a resume-related delay, but the test does not isolate reconnection from outbox scheduling. No messages were lost; investigate that first-message delay separately from steady-state delivery. Recent error buffers remained empty.

## Resume scheduling and tab transitions — implementation follow-up

Additional two-phone resume traces reproduced a worse case: the first message was not present within the roughly 16-second observation window while the reverse direction subsequently worked. AoN sessions returned before the direct phone session. Existing pending maintenance traffic was present on both Dev identities. No history was erased to simplify the test.

Changes:

- Retain new-message scheduling hints until the durable outbox no longer contains that message. Previously its first failed attempt consumed the hint, leaving it competing with dozens of old packets after reconnection. Retry deadlines still prevent a zero-delay spin, and active/concurrent recipient limits remain in force.
- Scope relay-deposit backoff to the recipient/relay pair instead of disabling the entire relay after a recipient-specific quota failure. Permit at most two distinct recipient deposits concurrently, with one per recipient.
- Defer unusable receipts/envelopes for 15 seconds so they do not monopolize each polling batch. Receipt verification, digest/recipient/device binding and durable admission remain required before acknowledgement/consumption. Decryption/application exceptions cannot abort processing of all later packets. Deferred state is bounded and packets remain stored at the relay.
- On foreground resume, immediately pump the runtime and inbox; use one-second inbox polling for ten seconds, then return to the normal five-second interval. Busy polls remain single-flight.
- Refresh contact avatars only in the focused foreground screen; unchanged avatar values retain their state reference. Memoize tab options, freeze hidden tab rendering, and retain the three native tab views rather than detaching/re-attaching their trees on every switch. The visible layout is unchanged.

Validation includes regression tests for new-message priority after a failed first attempt with 30 older queued messages, retry non-spinning, per-recipient relay backoff, bounded concurrent deposits, resume single-flight, later valid packets behind unmatched/forged receipts, and later envelopes behind rejected/throwing admission. Cryptographic packet formats and verification policy were not changed.

Live results are mixed, so this is not full release sign-off:

- One resume run acknowledged both directions within 812/712 ms; another still had delayed acknowledgement. The final test was changed to record arrival and acknowledgement separately: first-direction arrival 4,196 ms, acknowledgement 8,365 ms; reverse arrival 765 ms, acknowledgement 1,136 ms (`builds/resume-priority-final.log`). Cold reconnection/acknowledgement latency is improved but not eliminated.
- A repeated three-minute navigation/media run and a later one-minute retained-tab run delivered both synthetic image/video files byte-identically. Their coarse completion observations were approximately 14–21 seconds; no media throughput improvement is claimed.
- Retained-tab media-run gfxinfo counted 19/55 and 22/54 janky frames versus the original 33/52 and 38/71. However p95 frame duration worsened to 57/42 ms in that sample. This reduction in counts does not establish consistently smooth transitions.
- Settled navigation without concurrent media had event-loop p95 43/26 ms, maxima 98/68 ms, and zero samples over 100 ms. Gfxinfo remained sparse (30/11 frames, p95 38/36 ms), so rendering outliers remain an unresolved target.

Only Axonic Dev was restarted and updated from Metro. Official installations and AoNs were untouched. Temporary tracing wrappers and runtime leases were restored/released. Further work should isolate remaining cold-route setup/ACK time and collect focused native transition traces; do not label both reported problems fully resolved from these samples.
