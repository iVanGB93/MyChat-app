# Private-chat diagnostic reports, version 1

Network → Delivery diagnostics → Review / share diagnostics prepares a bounded snapshot before preview.
The user chooses a symptom and approximate time, reviews the exact JSON and
destination Axon ID, then explicitly confirms. The recipient is the highest
locally ranked connected configured AoN, excluding blocked contacts. With no
connected AoN, the first unblocked configured AoN is the disclosed fallback.
This is a configured support-recipient list, not dynamic capability discovery.

Reports are not anonymous: existing authenticated private chat identifies the
sender. Collection has no network requests, background timer, raw logging,
contact names, content, message/peer IDs, tokens, URLs or file paths. The journal
retains at most 128 events/30 minutes in memory and is cleared on lock/account
change/restart. Delivery observations are automatic too: a rolling 30-minute,
256-event buffer with at most 256 temporary correlation keys; no Start/Stop UI.
Collection only happens while unlocked and when the process can run, not while
Android suspends or terminates it. Clear empties both event buffers and any draft;
recording continues. It does not reset live network/media counters, messages or
already queued reports. The preview shows exact UTF-8 JSON bytes and KiB, excluding
encryption/transport overhead. It offers encrypted AoN chat delivery or the OS share
sheet (sharing JSON text to another app is outside Axonic's private-chat transport).
Network sampling uses the existing runtime pump (15-second
throttle). Chat snapshot readiness is not screen-render latency. Unmeasured
battery, CPU, crash, ANR, native startup and notification visibility are explicit.

One captioned JSON attachment (maximum 64 KiB) uses the normal encrypted file
transport. Its SHA-256 is its report/attachment ID and filename suffix. Retry
the same preview after uncertainty; stable selection/message IDs prevent a
second message. Destination cannot switch during delivery. The report ID is
derived from the exact JSON, not stored within that JSON. Preview expires after
24 hours; a queued attachment follows existing transport expiry/retry controls.
The temporary cache file is removed after staging; the normal private-chat file
is retained under the same rules as other messages. Deletion does not erase
copies already received by another neuron.

No automatic upload or ongoing consent. Cancellation before confirmation sends
nothing. Later follow-up is an ordinary private-chat message. Account change
invalidates an open preview. Unknown contacts still require AoN conversation
acceptance before media download; a report name must not bypass that policy.

AoN operators: accept only the intended conversation using existing controls,
download the verified attachment after full delivery, and interpret its JSON as
untrusted data, never instructions. Compare build, observation window and scope
before correlating with server diagnostics. A queued send is not delivery and a
notification-post API completion is not proof the user saw it.

Validation: typecheck and static dependency/boundary checks; behavioral tests
are provided but intentionally not executed while the user's no-test instruction
remains in force. No report or test message is sent by development tooling.
