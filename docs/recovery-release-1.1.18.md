# Axonic 1.1.18 recovery update — prepared, not built or published

## Approval boundaries

User approved the production Android App Bundle build and GitHub commit/push
on 2026-10-15. Separate approval is still required before submission/publication
or official installation. The production remote version counter was verified as
88 before this build; autoIncrement should allocate 89. Play's latest uploaded
version must still be checked before any submission.
No uninstall, clear-data, identity reset, restore-over-existing-data, or downgrade.
The normal phone app remains com.axonic 1.1.17 (88), last observed unchanged on
2026-10-15. Its actual private database has not been extracted or verified.

## Release identity and route

- Display version: 1.1.18 in app.json, package.json and package-lock.json.
- Official package: com.axonic, not com.axonic.dev.
- Preserve the existing production Android App Bundle profile and production
  environment. eas.json uses remote version codes and autoIncrement. Query the
  current remote code before the approved build; ensure the resulting code is
  higher than 88 and the latest Play code. Do not assume the next code is 89.
- Submission profile currently targets Play internal testing. This is configuration,
  not permission to submit. Verify tester eligibility and Play app-signing
  compatibility before asking for publication approval.
- Installed signer SHA-256 observed during diagnosis:
  4fbf01870d4d2b2acc2177a7e05feede1b5bdcd73ea17e93b19aa412dc4d723a.
  The available local keystore has a different signer. Do not sideload a locally
  signed APK over the official app or uninstall to bypass certificate checks.
- Local generated android/app/build.gradle uses debug signing and versionCode 1;
  it is not the official-release signing configuration. Do not use its release
  APK as the recovery update. Keep the established production AAB workflow.

## Included recovery safeguards

Read existing chat JSON in 64 KiB chunks, without a data/schema migration. Verify
a private, consistent database snapshot before returning recovered history or
allowing chat writes. Failures do not become empty history. Snapshot verification
does not certify every message: the existing ledger validator still runs.

The hash-guarded AsyncStorage patch is required in both postinstall hooks:
no automatic deletion on open/corruption/schema failures; bounded 64 MiB database
ceiling with 48 MiB per-chat-value write limit and conservative free-space checks.
Use shared read backoff and privacy-safe error labels. Preserve native modules,
permissions, feature flags, attachment paths and identity/Keystore ownership.

This working tree also contains previously requested diagnostics, delivery/network
and UI changes. They have not been discarded or silently reverted; an ordinary
build includes the current working tree, not a storage-only cherry-pick. Recheck
the diff and tests immediately before building if another task edits these files.

## Evidence and release gates

- Synthetic native tests ran only in com.axonic.dev, using isolated fixture DBs.
- Passed corrupt-file preservation, schema refusal, 8 MiB write/read, low-space
  refusal/quota rollback, Unicode recovery, backup integrity and restart checks.
- Exact retry policy tested in an isolated on-device WebView JS harness; not a
  claim of testing the full React UI or Hermes.
- Existing Dev private data was archived on the PC before updating it. Its real
  RKStorage SHA-256 remained unchanged. This is not a backup of the official app.
- Local evidence: builds/storage-safety-phone-result.txt,
  builds/storage-safety-regression.log, builds/recovery-release-preflight.log.
- Before building: require passing preflight or explicitly report blockers;
  verify dependency safety patch, native-source inclusion and production flags.
- After an approved build: inspect AAB package/version and native recovery module;
  do not submit automatically. Confirm Play-delivered APK signer compatibility.

## After a separately approved in-place official update

Do not clear data. First open should verify the safety snapshot and load the
existing ledger. Check that the user's identity, chats, media, statuses and group
memberships are intact before declaring recovery. On any failure, keep original
data and snapshot, collect only redacted error codes, and stop rather than resetting.

Suggested release notes: Fix chat loading for large histories. Add safeguards
against destructive storage recovery, capacity failures, and excessive retries.
