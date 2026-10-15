# Oversized Android chat-row recovery

The official phone reported SQLiteBlobTooBigException while AsyncStorage queried
`SELECT key,value FROM catalystLocalStorage WHERE key IN (?)`. Own chat history
is one JSON value. CursorWindow cannot materialize an arbitrarily large row;
an empty UI after restart does not establish that the row was deleted.

## Minimal, non-migrating fix

`ChatStorageRecovery` opens the existing RKStorage database read-only. Before
returning chat data it makes a consistent `VACUUM INTO` snapshot of the whole
database (including committed WAL data), fsyncs it, runs integrity_check, and
records/verifies SHA-256. A failed snapshot or read is an error, never empty history.
The snapshot is private, in noBackupFilesDir/axonic-chat-recovery-v1. It contains
sensitive app data, is not uploaded, and is not a portable Android Keystore backup.
Attachments and all original database rows remain in place and are not migrated.

Reads use 64 KiB BLOB substrings inside one SQLite read transaction, then decode
UTF-8 once, preserving characters split across chunk boundaries. UI, call policy,
message notification policy, and notification routing use the same reader.
Existing ledger validation and AsyncStorage writes remain unchanged. No recovery
code executes DELETE, UPDATE, REPLACE or CREATE against the source database.

This fixes the CursorWindow read limit, not all capacity/performance limits:
the JSON still occupies JS memory, writes use a bounded 64 MiB shared database
ceiling (formerly 6 MiB), and existing ledger message/action limits still apply. It is not a
claim of unlimited storage. A future normalized storage migration is separate.

An explicit remove-account operation removes the private rescue snapshot because
it may contain the removed account; other live accounts are not removed. The
snapshot is otherwise immutable, not a rolling backup. Backup validation is
cached for the native module lifetime and repeated after process restart.

## Validation

`tests/chatStorageRecovery.test.cjs` verifies native selection, fail-closed behavior,
older native fallback, and shared background-reader wiring. Existing call,
notification, revision and account-removal tests cover unchanged semantics.

`tests/native/ChatStorageRecoveryInstrumentation.kt` targets **com.axonic.dev only**.
Copy into android/app/src/androidTest/java/com/axonic, set testInstrumentationRunner
to com.axonic.ChatStorageRecoveryInstrumentation, and build assembleDebug plus
assembleDebugAndroidTest with axonicSideBySide=true and arm64-v8a. Run its
instrumentation only after backing up Dev and verifying both APK target IDs.
It creates a UUID-named synthetic database under Dev cache, never the actual
RKStorage path. It checks original failure, exact Unicode recovery, unchanged
original backup, restart, subsequent writes, missing owner and corrupt-backup
refusal. Fixtures are retained as evidence; no real messages are sent.

The native module requires a new build. Old native builds and SQLite engines
older than 3.27 retain the old reader; the capability checks the actual engine.
Dev success does not verify the official phone's actual history. Its release
signing certificate must match before any in-place official update is attempted.

Phone evidence (2026-10-15): native fixture passed with 2,400 synthetic records,
3,966,130 UTF-8 bytes and an explicitly fixed 2 MiB test CursorWindow. This is a
deterministic reproduction, not a measurement of the OEM default window size.
It verified original failure, exact Unicode round trip, snapshot preservation,
restart/subsequent-write reads and corrupt-checksum refusal. The initial fixture
using the OEM default did not exceed its window and correctly failed its
reproduction precondition; no recovery claim was made from that run.

## Additional safeguards (2026-10-15)

The hash-guarded `patch-async-storage-safety.cjs` is registered in postinstall and
the existing EAS postinstall hook (no EAS build is required). It removes automatic
database deletion on open retries and implicit schema changes, replaces Android's
destructive corruption handler, and propagates failed clears rather than deleting
the database. The recovery reader likewise supplies a non-destructive corruption
handler. Unknown dependency versions stop the patch for review.

Chat writes check safety-backup availability, estimate shared-database usage, and
reserve free space for journaling before calling AsyncStorage's transaction. The
shared ceiling is 64 MiB; an individual chat JSON write is limited to 48 MiB, with
1 MiB estimated database-overhead headroom. Free-space reserve is twice the larger
of current database size and new value size plus 8 MiB. These are conservative
preflight estimates, not a guarantee against another process filling the disk;
SQLite rollback remains the final guard. A refusal never truncates old history.

Shared per-owner read gates coalesce concurrent reads and back off at 2, 4, 8, 16,
32, then 60 seconds. Successful writes invalidate old flights so subsequent ledger
reads cannot join a pre-write snapshot. The visible chat poll also backs off;
account lock/background/unfocus cancels its timer. The banner uses allowlisted
reasons (backup, capacity, corrupt/schema, busy, locked or unavailable), never raw
paths, SQL or account IDs. Successful reads restore normal polling.

Run `node scripts/prepare-storage-safety-test.cjs` before the Dev test build. It
generates the test asset from the exact production retry source. The on-device
JavaScript checks use an isolated Android WebView runtime, not the React screen
or Hermes. Native fixtures instantiate the patched real AsyncStorage supplier
with an isolated Context, never the application's RKStorage. They check corrupt
bytes survive open failure, schema refusal, an 8 MiB write/read, simulated no-space
preflight, and real SQLite quota rollback. No real messages are transmitted.
