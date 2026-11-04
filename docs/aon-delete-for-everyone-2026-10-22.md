# Owner-authorized AoN message deletion

User explicitly authorized deleting all messages authored by FirstNeuron,
SecondNeuron and ThirdNeuron for everyone, keeping backups and preserving
messages from all other authors. This corrects the preceding local-only clear.

Recovered original references from current state plus immediate
own-history-archives and older clean-start-archives. No original content was
restored to live history or queued for retransmission. Used the deployed ledger's
private/group action validation and logical group IDs, with target.author equal
to the checked neuron owner. Existing deletion actions were reused; newly
generated action IDs are deterministic for idempotent retries. Only deletion
actions were merged into live state. Incoming and outgoing message arrays were
verified unchanged during each mutation. No identity, contact, membership,
relay store, credential or AI configuration changes.

Targets from the available histories:
- FirstNeuron: 378 logical messages, 454 recipient actions; 272 targets already
  had archived deletion actions, re-enqueued for reconciliation.
- SecondNeuron: 245 logical messages, 282 recipient actions; 150 prior deletions.
- ThirdNeuron: 78 logical messages, 102 recipient actions; no prior deletions.
- Total: 701 logical messages, 838 recipient actions; no validation errors.

Synthetic test verified private/group own-only targeting, preservation of
incoming messages, unchanged archives and relay sentinel, idempotent retry.
Scripts are local maintenance artifacts in builds/aon-delete-authored.mjs and
builds/aon-delete-authored.test.mjs, not application changes or new deployments.

First/Third application writers stopped for atomic update, then restarted.
Second writer was paused for the atomic update and terminated afterward so
stale in-memory state could not overwrite the new action outbox. Explicit Railway
same-deployment restart requested afterward; deployment ID unchanged:
547f42d1-f27d-430a-a4a4-7848950e1b83. Persistent relay databases untouched.

All prior recovery backups retained. Additional pre-action root-state copies:
`<each data directory>/delete-everyone-archives/20261022/<sha256>.json`.
Do not restore them over live post-operation state.

Enqueueing is not proof of global removal. Recipient ACKs must be distinguished
from phone UI verification; disconnected/retired recipients can remain pending.

Final receipt snapshot in this maintenance turn (still progressing):
- FirstNeuron: 102/454 confirmed, 352 pending; Ivan 4/288 confirmed.
- SecondNeuron: 44/282 confirmed, 238 pending; Ivan 2/235 confirmed.
- ThirdNeuron: 66/102 confirmed, 36 pending; Ivan 19/55 confirmed.
- Combined: 212/838 recipient actions confirmed, 626 pending.
All three stores were reachable for this read-back. Phone UI removal was not
independently verified; do not report global deletion as complete.
