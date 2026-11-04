# Reporting v5 and local-history fresh start — October 22, 2026

Authorized scope: deploy reporting fixes to all three AoNs, then clear local
private/group history and own pending message work. Preserve identities,
contacts/nicknames, memberships, AI configuration and all shared relay stores.

Isolated neuron branch: `codex/reporting-20261022`, based on deployed `803d778`.
Commits pushed: `bcc21e2` reporting/cleanup and `2be0412` legacy numeric owner
compatibility and mutually exclusive cleanup flags. Main dirty checkout untouched.
Final source: `2be0412aebcd553837e5694dacfb9a6a58b7f165`.
Runtime: `e98ef1b55ed15914001dae9a6ee533ede027f5689e8730bbe1a79c7f53b110bf`.
Package 0.2.0; 135 modules; guidance 5. Runtime hash excludes deployment helpers.

Validation: 239 Windows tests passed for initial reporting release; legacy-owner
fixture then passed separately. Final exact committed source: 239 Linux tests
passed, no failures/skips. This was not a new phone/message/transfer test.

Reporting adds separate Pending/Stored age summaries and unknown counts; an
explicit one-hour review threshold is not an SLA or proof of non-delivery.
Guidance corrects gauge/reset, inventory-cause, transfer-stage and HTTP-attribution
inferences. Existing AI scheduled instructions are external and were not edited.

Recovery backups (private, never committed):
- First: `/var/backups/axonic-reporting-bcc21e2/data.tar`.
- Third: `/var/backups/axonic-thirdneuron-bcc21e2/data.tar` in WSL.
- Second: `/data/operator-backups/own-history-20261022/data.tar` (157685760 bytes),
  made with the sole AoN writer paused; resumed in finally.
- Exact removed originals also remain in each data directory's
  `own-history-archives/<operation-id>`.

First cleanup: operation `own-reports-20261022-bcc21e2`, 377 records archived,
14 protected files byte-verified unchanged while stopped, 10 contacts/3 groups
preserved. Initial legacy-schema guard failed before moving any files. Final
cleanup succeeded. Rebuilt files initially belonged to root, causing EACCES on
service restart; ownership restored to axonic-neuron and health recovered.
Offline helper callers must use the service account or restore ownership before
restarting; Railway startup already performs its standard node ownership step.

Third cleanup: same operation ID, 230 records archived, 12 protected files
byte-verified unchanged, 2 contacts/2 groups preserved. Ownership restored to
axonic-thirdneuron. No OpenClaw history/config/cursors changed.

First/Third own queues were already zero BEFORE cleanup, so clearing history
must not be credited with fixing delivery. Shared relay data intentionally
survives; subsequent deliveries/reports may create new local history.

Second final deployment `547f42d1-f27d-430a-a4a4-7848950e1b83` SUCCESS.
Previous deployment was confirmed REMOVED before startup cleanup. Operation
`own-reports-20261022-2be0412` completed at 22:18:34.815Z, archived 238 records.
Live state: zero messages/own queue, 6 contacts/2 groups. Contacts, groups and
profile compare equal to the archived root state. Identity/account/transport
configuration byte-hashes match the full backup. Shared relay databases remain;
they were not cleanup targets (live background writes mean their current bytes
are not expected to equal the earlier backup). Authenticated MCP status confirms
final source/runtime, reporting v5 and active network. Cleanup flag subsequently
set empty with --skip-deploys; completion marker retained for idempotence.

First and Third health endpoints returned ok after final restart. All three
execute the same source/runtime, sourceDirty=false/runtime_bound. No phone apps,
MCP subscriptions/cursors, AI runtime history or pending AI tasks were reset.
All archived data is recoverable with writers stopped; do not overwrite any new
post-cleanup work when restoring. Protected backups are not repository artifacts.
