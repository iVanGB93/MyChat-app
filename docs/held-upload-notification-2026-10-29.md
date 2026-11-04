# Held upload notification review

The Dev phone had one outgoing queued job (360,016 bytes, revision 0, no custodians) whose source file remained present but whose outgoing message was absent. The transfer worker requires that message; background notification accounting did not. Thus it kept a background task alive for ineligible work. The historical reason the message is absent has not been established.

Changes:
- Missing outgoing message means held work, not active upload or successful completion. No job, source file, or message is deleted or recreated.
- Apply authenticated message actions to scoped history before observing deletion/read status.
- Blocked/unaccepted contacts and group membership/recovery/approval restrictions hold background work using the existing group permission helper.
- Existing selection accounting still owns preparation. Existing ledger/selection events re-evaluate eligibility; no new polling timer.

Checks: full mobile check passed with 1,727 passed and 3 skipped before the final group guard; the final focused suite passed 19 tests, plus TypeScript and module boundary checks. The Dev APK embeds updated JS for headless operation.

Live evidence: baseline job hash and post-update hash match, owner unchanged, source file remains present. Observation changed from pending=1/held=0 to pending=0/held=1, native scheduled=false. After backgrounding Dev, no upload notification 42732 or 42733 remained. Official app still versionCode 105, last update 2026-10-29 08:39:16.

This fixes notification/lifetime accounting, not the missing historical message. The file is retained without silently creating or sending a replacement message.
