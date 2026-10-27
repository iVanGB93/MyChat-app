Axonic test inventory — reviewed 2026-10-23

Module-specific entry points and regression selections:
  ../docs/architecture/INDEX.txt
Documentation references (read-only; no device tests or source synchronization):
  node scripts/check-architecture-docs.cjs
  node scripts/check-architecture-docs.cjs --aon-root <hosted-checkout>

Maintained automated suite
  npm run check
Runs TypeScript, tests/*.test.cjs, dependency-cycle checks, module boundaries,
source consolidation and literal asset-reference validation. Keep this flat test layout: the package command
discovers it explicitly. Helpers, native fixtures and support adapters are
dependencies of these tests, not unused copies of the application.

Keep these coverage areas
  identity*, localAccount*, deviceRemoval*: identity, recovery and local locking.
  persistentAxon*, custody*, groupCustody*, rootGroups*: network delivery,
    signatures, independent receipts, offline recipients and group membership.
  attachment*, sharedAttachment*, directStream*: media integrity, reuse,
    checkpointing, retry and transfer scheduling.
  call*: signaling, recovery, audio/video state and stale-call protection.
  rootMessageWake*, rootMessageRecovery*, rootConversationNotifications*,
    rootNotification*: background recovery, previews, stale alerts and actions.
  UI/media/gesture tests: retain regression checks for the original interface.
    Source-level checks supplement behavioral tests; they do not prove device UX.

Separate manual/native checks
  scripts/test-native-identity-guard.cjs
  scripts/test-native-activity-result.cjs
  scripts/test-notification-device.cjs
  scripts/run-two-device-smoke.ps1
Inspect each tool's options before running. Device tests require the appropriate
installed Dev client and authorizations; they are not part of npm run check.

Optional benchmarks (intentionally skipped in the ordinary suite)
  AXON_JOURNAL_BENCHMARK=1 — tests/attachmentTransfer.test.cjs
  AXON_MEDIA_BENCHMARK=1 — tests/persistentAxon.test.cjs
  AXON_SCHEDULER_BENCHMARK=1 — tests/persistentAxon.test.cjs
Set the variable in PowerShell before invoking node --test for that file, and
remove it afterward. These are comparative benchmarks, not throughput promises.
  scripts/experiments/ — manual device-transfer experiments; retain dependencies.
  phone-chunk-benchmark.cjs was removed after its companion runner was retired.
  direct-stream-session.cjs remains covered by directStreamExperiment.test.cjs.

AoN suite (D:\Proyects\Axonic-neuron)
  npm test
  node scripts/sync-core.mjs --check
The shared protocol compatibility modules listed in
scripts/consolidation-exceptions.json still have hosted consumers. Their tests
must not be removed simply because the mobile entry does not import them.

Historical material
Old one-off setup, migration, deployment and diagnostic scripts were moved into
builds/archive/before-2026-10-12/historical-scripts in their original repository.
They are retained as reference, not maintained test runners. Their old paths,
devices, credentials mechanisms and API assumptions may no longer work. Do not
run them as a test suite. Bring a needed tool back deliberately and update it.

Live shared-group evidence
  builds/live-aon-group-evidence.json
  builds/shared-group-emulator-evidence.json
The matching recent scripts remain in builds, including their helper imports.
They are manual integration harnesses, not production app code. The AoN check
uses synthetic identities and public network endpoints; it mutates test custody
and must not be run silently as part of an offline unit check.

Cleanup decision
No maintained test was proven obsolete in this review. Keep the regression
suites; retire an individual test when its production consumer is removed or
equivalent coverage is demonstrated, not merely because it is old.
