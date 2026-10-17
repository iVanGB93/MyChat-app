# Local network work reset

Advanced diagnostics offers **Reset all local network work…**. The confirmation
explicitly warns of lost delivery and requires **Reset and close**. Do not invoke
the operation on a real account merely to test the UI.

The authenticated account commits a reset journal, locks and closes the process.
On the next cold startup, before account credentials or network workers load:

- Validate the existing chat ledger; unreadable history aborts cleanup.
- Persist cancellation metadata for pending private/group sends, actions,
  maintenance packets and incomplete media. Preserve content and historical
  receipt evidence; never manufacture delivered/read acknowledgments.
- Clear this owner's private/group custody, outgoing custody, encrypted relay
  media/chunks, attachment job journals, wake notices, staged-selection queue,
  group outbox and queued notification actions.
- Archive outstanding call signaling into display-only call history.
- Cancel this account's displayed notifications. Record the reset time.
- Remove the reset journal last. A failure keeps startup gated for an idempotent
  retry; the running process cannot execute cleanup.

Identity keys/pins, contacts, groups, chat history, downloaded/partial media files,
preferences and other owners' data are preserved. Disk space is not guaranteed
to shrink: this is a work-queue reset, not secure erasure or a media-file cleaner.
Canceled deliveries remain labeled in Message Info and are excluded from active
pending/incomplete diagnostic totals. Later verified receipts may still update
their delivery evidence. New messages are unaffected.

This is **not** a network-wide reset. AoNs/other peers can retain and retransmit
old packets. Connections, discovery and fresh maintenance resume normally;
runtime counters restart with the process. Report `networkResetAt` marks the
local reset boundary, not a global baseline or proof of better performance.

Validation: `node --test tests/networkWorkReset*.test.cjs`, then `npm run check`.
Storage tests use isolated in-memory SQLite databases and synthetic ledgers.
