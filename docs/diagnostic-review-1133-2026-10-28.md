# Diagnostic review: production 1.1.33 / 104

Reviewed the two complete phone reports received by SecondNeuron at 2026-10-29 01:17:55Z and 01:18:11Z (October 28 EDT), SecondNeuron's regular reports and live status, and read-only Android exit history/recent logcat on both USB phones. No app data, settings, messages or installations changed.

Both reports identify production 1.1.33 (104), JS hash c86a573f646e51540dadc65a8a92426c6a6329db6318a53f5baf2b297c8fb412. No runtime error or coordinator failures reported. Phone exit records show no exit following each latest package update (18:27:08 and 17:38:54 EDT); prior excessive-CPU exits do not establish a regression in this build.

Owner report 3659b166: five outgoing recipient records stored awaiting delivery, oldest 21,603 seconds. One incomplete outgoing attachment, valid authorization, peer connected, active job confirming, no receipt recorded. Priority: trace that job's receipt and recipient completion; connectivity alone does not establish delivery.

Other phone report 2888e700: 19 incomplete media recipient records (18 outgoing, one incoming), 12 with expired authorization, seven live. Twelve active jobs absent, six confirming and one cancelled. All destinations disconnected at capture. Group outgoing: 12 pending and 12 stored, oldest own pending 118,610 seconds. Counts overlap and are per recipient, not 19 unique files. Priority: distinguish retained terminal records from live recoverable transfers; do not delete or blindly resend.

Evidence limitations: reports contain only five and two recent history events, empty delivery-capture event arrays, and no media timing stages. Runtime windows differ (59 seconds and 2,061 seconds). Dropped-event counters include retention; they do not prove message loss. These reports cannot locate historical transfer stalls or prove notification latency.

SecondNeuron live: source 221af9cd, clean/runtime-bound; three peers and three confirmed replicas, no own outgoing backlog. GET chat p95 4ms; status p95 9ms, server time only. One 404 at 21:55:32Z matches the retired-route verification during cleanup, not evidence of a current chat outage. Earlier reports' 1/3 replica shortfall is not present at this observation. Diagnostic capture inactive. Relay unconfirmed receipts remain local observations, not proof of non-delivery.

Recommended next investigation: owner connected-peer attachment confirmation, then other phone expired/live media-state reconciliation; improve bounded diagnostic retention for transfer outcomes. Preserve all original messages and jobs while tracing.

## Follow-up fixes and Dev validation (October 28 EDT)

Implemented bounded direct-recipient receipt recovery while outgoing jobs are confirming. A completed receiver can return its signed receipt on authenticated direct-status; sender verifies it against the descriptor and recipient identity before completion. Invalid receipts never complete a job; probes are throttled. This closes a recovery gap but does not prove which receipt was lost in the historical production report.

Android upload admission now arms while foreground, schedules on leaving the activity, removes its notification/job on return, and does not leave a successful-transfer result notification. Paused/error results expire after 60 seconds. Background tasks advance overdue network work on their native wake, suppress unchanged progress updates, and count a staged selection and its prepublished serving job only once (failed preparation remains held, not endlessly active).

Production diagnostic reports now include bounded numeric stage timings, including direct/custody status, checkpoint queue/transaction and preparation. Pending-media summaries distinguish expired/live authorization and connected confirming jobs without receipts. Existing expired items are not deleted, reauthorized or blindly resent.

Validation:
- Full project check before final background refinements: 1,666 passed / 3 skipped / zero failed, including typecheck and architecture checks.
- Receipt/diagnostic/background focused rerun: 108 passed / 1 skipped / zero failed.
- Final background observation/task regressions: 12 passed; final TypeScript check passed.
- Native debug build succeeded. Both com.axonic.dev installations updated with existing identities/message keys retained; official com.axonic installations unchanged.
- 1 MB foreground Dev transfer: checksum matched, no upload notification (5.658 seconds observed).
- Clean 10 MB background Dev transfer: checksum matched; background notification observed then removed; both sender and receiver recorded delivered, completed job absent from active queues, pending=held=0 on both phones. Whole test including notification cleanup/foreground return: 36.113 seconds; not isolated wire throughput.
- Earlier repeats were disrupted by Metro reload/headless startup and preparation failures. Preserved synthetic jobs were resumed using original IDs; do not treat those attempts as successful background tests. No resets, history deletion, official-app installation or production build.

Remaining scope: the current official apps still run 1.1.33; fixes are Dev/source only. Shared receipt responder changes have not been deployed to AoNs in this task. Aggregate production reports do not establish delivery of each original pending item; future reports will provide the newly enabled timing evidence.

## Expired media recovery follow-up

Authorization is bounded by ATTACHMENT_TTL (24 hours); preparation subtracts 30 seconds. Expiry is a signed-grant boundary, not evidence the local file was deleted. The wife's report has 12 expired recipient records, not necessarily 12 unique files; historical timing remains insufficient to explain each expiry.

Added explicit Send again for expired, undelivered outgoing media with a local file. It rereads the authoritative message, rejects deleted/reset/completed/live/incoming records, checks the account, and uses the existing fresh-descriptor forwarding pipeline. Original history/grants are unchanged. Concurrent requests for the same record coalesce. Confirmation explains a new message and, for groups, the current audience (including members who already received the original). Existing caption is preserved. Incoming expired downloads and missing local files get actionable guidance. Expiry now outranks retained custody evidence in the upload label.

Validation: 17 focused tests pass; TypeScript, module boundaries and service cycles pass. Both Dev phones loaded the module and rejected a completed-transfer retry with their durable selection queues unchanged. No original production media was resent, deleted or modified. Live expired-to-new-send delivery and visual confirmation of the new button remain untested; the fresh-send transport itself passed the previous Dev foreground/background tests.

## Live expired-file resend acceptance

Tested on both physical com.axonic.dev phones. Created only synthetic 1,000,000-byte files with valid short-lived signed grants; original test jobs were paused before publication and allowed to expire naturally. No clock changes or edits to existing transfers. Created an isolated group containing only the two Dev identities.

Used Android UI taps on Send again and the actual confirmation dialogs for private and group retries. Both new files arrived exactly once, with SHA-256 f7c350ea256d1dfc0e19206ac82543838e49462bbffd0057c02eb259dae65fc6 and correct byte count. Both sender records reached delivered. New message IDs and later expirations confirmed; original descriptors remained byte-for-byte unchanged. The group was updated from revision 1 to 2 before retry; the new message used revision 2. Group dialog explicitly warned about sending to current members including prior recipients.

Found and fixed stale expiry UI: a paused visible attachment previously retained Resume transfer after expiration until another render. Added one deadline timer per pending visible bubble, cleaned up on unmount, and foreground refresh. A further live short-expiry fixture changed from Transfer paused / Resume transfer to Attachment expired / Send again while the screen stayed open, without navigation or refresh.

Evidence: builds/expired-resend-live.json, expired-resend-results.json, resend-confirm.xml, resend-group-confirm.xml, deadline-before.xml, deadline-after.xml. Focused 17-test suite, TypeScript, service cycles and module boundaries pass after the fix. Test files/history preserved. Official apps untouched; no production build or deployment.
