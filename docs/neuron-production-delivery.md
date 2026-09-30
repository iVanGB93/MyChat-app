# Normal-chat neuron delivery rollout

Agreed order: finish live multi-custodian/failover validation, integrate normal
conversation delivery, validate a production build on the physical phones, then
replace Django authentication. Keeping Django login during this rollout does not
make FirstNeuron an identity authority.

## Integration requirements

- Preserve the normal outbox's message UUID, room, sender, recipient and creation
  time inside the encrypted payload. Derive a domain-separated protocol ID from
  the existing message identity; retrying through another transport must not
  create another conversation message.
- Establish a verified association between an existing Django account and its
  cryptographic identity before using that identity for a normal conversation.
  A peer's unsigned claim of a numeric user ID is insufficient. Initial account
  binding can use the current authenticated service during migration; retain
  locally verified pins and reject unexpected key replacement.
- Scope the device's persistent network identity to the signed-in account.
  Switching accounts, logout, lock, and background transitions must invalidate
  pending work and never deliver another account's messages.
- Reuse the normal incoming-message persistence path and durable duplicate
  detection. Issue a recipient receipt only after the matching message is saved.
  Custody acceptance is pending delivery, not delivery confirmation.
- Carry direct delivery and custody through the same normal outgoing message.
  Preserve a held envelope and its receipt binding across process death and
  transport changes. Reconcile delayed receipts without inserting duplicates.
- Enable the initial release for bounded one-to-one text messages. Unsupported
  media, group messages, edits, replies, and recovery operations must continue
  through their existing supported paths until explicitly integrated and tested.
- Gate release participation independently of `__DEV__`; keep debugger-only
  test identities, synthetic messages, and cleanup functions development-only.

## Release checks

1. Ordinary custodian works with FirstNeuron unreachable.
2. Sender moves the identical envelope to another available custodian.
3. Recipient receives while the sender is offline; returning duplicate copies
   are acknowledged without another inbox insertion.
4. All reached custodians remove payloads on verified receipts. Unreachable
   copies remain bounded by expiry until their holders return.
5. A participant can rejoin the available network after closing all its links.
   Emulator NAT and phone LAN discovery must be distinguished in test evidence.
6. Normal chat: existing message IDs, blocked contacts, room authorization,
   delivery status, notifications, restart recovery, and mixed app versions.
7. Production artifact verification and two-phone testing before distribution.

Do not treat a development-protocol test or a flag change alone as evidence of
normal-chat production readiness. No production feature is enabled by this plan.

## Validated September 29, 2026

The four-device LAN failover run passed with two physical phones and two
emulators. After all four connected, the test blocked FirstNeuron connections
on those devices; the hosted service itself remained online. An emulator sender
queued a synthetic message while the receiving phone was locked. An ordinary
emulator accepted custody, then went offline. The sender reused the identical
encrypted envelope with the backup phone. The receiver unlocked and retrieved
it through that phone over LAN with direct RTC deliberately unavailable. The
sender verified the recipient receipt, the backup removed the payload, and the
receiver retained exactly one inbox row. Temporary identities and test data
were removed on all four devices.

This proves failover inside an established network with a reachable LAN peer.
It does not prove internet cold-start discovery with no reachable bootstrap.
The original offline custodian could not process deletion while offline;
returning-copy deduplication and both-custodian cleanup are covered by automated
tests, not this successful live run. Offline sender retrieval was previously
tested through FirstNeuron; this run kept the sender online and disabled the
receiver's direct RTC route to establish that delivery used the backup.

Fixed two issues found during validation: an unresponsive preferred custodian
now backs off long enough for another custodian to be tried, and identity SQLite
stores retain a module-owned connection rather than repeatedly opening cached
native handles. The latter stopped the observed native SQLite handle failures
in the successful live run. All 536 automated tests, TypeScript, and the service
dependency-cycle check passed. Evidence is in ignored
`builds/four-neuron-results.jsonl` (successful message
`d13f5cf7e2a78b5a084166a3da5fef9cf531ebb7b0d7967df0ac17a4c06b4fc5`)
and `builds/failover-regression.txt`.

Next implementation: connect the cryptographic network to the normal outbox
and ingress using a verified legacy-account/identity binding and an account-scoped
identity lifecycle. Django login remains in place for this rollout. Production
build and real conversation validation remain pending; the development identity
queue is not yet a normal-chat transport.

## Normal-chat boundary components — September 29, 2026

Implemented and tested, but not yet connected to the running app:

- `normalChatProtocol.ts` preserves the normal UUID, room, numeric participants,
  timestamp and content inside a canonical payload. A domain-separated transport
  ID also binds both cryptographic accounts. The entire encoded payload must fit
  the existing 2,048-byte transport limit; unsupported features return to their
  existing transport. Content changes retain the transport ID so persistence must
  reject conflicting duplicates rather than treating them as a new message.
- `normalChatBoundary.ts` requires an authorized two-member room and verified
  account pin supplied by the composition layer. Outgoing packets must match the
  original own row. Incoming packets must match the authenticated cryptographic
  sender and intended recipient. Receipt permission follows successful durable
  persistence, with session/block/pin guards passed into the storage callback.
  The callback must atomically insert or verify identical content; wiring it to
  the normal database is still required. Confirmation accepts only an already
  cryptographically verified recipient receipt, never a relay-held response.
- `chatIdentityBinding.ts` provides a device-signed, 60-second, one-use challenge
  tied to the room, both numeric users, requester's cryptographic account and
  responding identity record. Acceptance requires the sender supplied by the
  authenticated Axion connection. This does not authenticate a numeric claim
  arriving through an ordinary neuron. Pending challenges are bounded at 32.
- `chatIdentityPinStore.ts` stores immutable pins in a separate SQLite database,
  scoped by legacy account. Concurrent first pins serialize; unexpected replacement
  or aliasing one identity to another user is rejected. The store does not verify
  proofs itself: only a successful authenticated binding exchange may invoke it.
  Per-owner/global limits are 256/2,048 entries. Normal login and test vaults are
  unchanged.

Validation: 22 new tests cover canonical wire bounds, multibyte payloads,
duplicate/conflicting persistence using SQLite, wrong identity/room/recipient,
changed pins, edited outgoing rows, logout/block races, signature tampering,
authenticated-sender mismatch, replay/expiry, immutable concurrent pins and pin
capacity. Full mobile suite: 558 passing; TypeScript and 134-module cycle check
passed. Evidence: ignored `builds/normal-chat-boundary-regression.txt`.

Still required before enabling: authenticated Axion metadata routing with bounded
parsing and room/block authorization; controller-owned signing and account-scoped
identity lifecycle; atomic normal inbox/outbox adapters; shared normal-message
capability negotiation; courier/receipt reconciliation; production flag and device
validation. No normal messages currently use these new modules, and no production
build or deployment was performed for this component step.

## Authenticated binding routing — September 29, 2026

Added backend `chat_identity_binding` metadata handling to the existing Axion
consumer. It bounds frames to 12,000 bytes, checks canonical challenge/proof
structure and a 60-second expiry, rejects a challenge claiming a different
authenticated sender, and reuses direct-room membership and bidirectional block
authorization. It shares the existing 120-per-minute signaling budget. Only
public metadata is forwarded; numeric sender identity is injected by the backend.
No registry, private-key storage, or message persistence is added. Cryptographic
record/proof verification remains the receiving app's responsibility.

The app's Axion composition root now consumes this event through a dedicated
bridge instead of normal-message ingress. `chatBindingTransport.ts` handles the
challenge/proof exchange with bounded requests, replay protection, local room
authorization, and stop/logout checks. No handler is registered automatically
yet; account lifecycle ownership is the next integration step. The identity
controller exposes a binding-signature operation without exposing private keys,
and refuses signing while locked or busy.

Validation: 564 mobile tests passed, including a simulated authenticated-channel
round trip with real Ed25519 signatures, malformed/oversized requests, replay,
blocked/logged-out sessions, stale handler cleanup, and controller locking.
Four new backend tests plus ten existing signaling/room authorization tests passed
using `config.settings_test` (isolated SQLite and in-memory channels). TypeScript,
136-module dependency checks, and hosted/mobile shared-source parity passed.
Evidence: ignored `builds/chat-binding-routing-regression.txt` and the backend
test command `manage.py test chat.test_chat_identity_binding chat.test_p2p_signaling
--settings=config.settings_test --noinput`.

Backend changes are prepared locally, not deployed to Railway. FirstNeuron needs
no update for this account-binding routing step. Normal neuron delivery and the
production build remain pending until lifecycle and normal persistence integration
are complete; these automated checks are not a live-device binding test.

## Account lifecycle and normal inbox — September 29, 2026

Implemented a separate, device-bound migration vault per signed-in numeric account.
Vault ciphertext uses an account-specific AsyncStorage key; random unlock material
and device protection use separate SecureStore keys with device-only accessibility.
No Django password is read or stored. This automatic migration identity is not a
claim that the user has backed up recovery words; recovery/export remains future
work. Existing experiment vaults and legacy credentials are untouched. A saved
vault with missing protection fails closed rather than creating a replacement.

`accountIdentityLifecycle.ts` serializes opens, revokes stale session leases and
locks keys on background/logout/account switch. Provisioning is also serialized
across root remounts. Interrupted sessions cannot attach a handler. Failures enter
an error state rather than retrying in a tight loop. An explicit retry operation
is available to the composition's future diagnostics UI.

The app root now owns `mobileChatBinding.ts`, gated behind the development-only
`EXPO_PUBLIC_AXONIC_CHAT_IDENTITY=1` flag, which has not been enabled here. When
enabled it starts the account lifecycle, registers the authenticated Axion handler,
and requests an unpinned active direct-chat contact's binding at most once a minute.
Each operation refreshes local room membership and checks blocking and ownership.
It does not enable normal-message transmission or replace production login.

Added `saveVerifiedIncomingText` to the normal message database. Its transaction
checks the owner's cached direct-room membership and block state, inserts or
accepts an identical existing row, rejects conflicting/deleted rows, and rolls
back when the account guard changes during insertion. `ingestVerifiedNeuronText`
shares the existing per-message ingress queue, UI updates, unread bookkeeping and
notification path. Concurrent neuron/Axion copies present once; a rejected write
cannot authorize a neuron receipt. Outgoing transport/receipt reconciliation still
needs to be attached to this incoming adapter and the cryptographic runtime.

Validation: 577 mobile tests passed, including 13 new lifecycle/composition/storage/
ingress cases. Real SQLite tests cover duplicate conflicts, room/block isolation
and rollback after insertion; app composition tests use real identity signatures
with mocked native storage/network. TypeScript and 139-module cycle checks passed.
Evidence: ignored `builds/account-identity-regression.txt` and
`builds/neuron-ingress-tests.txt`. No live-device test, deployment, reinstall or
production build was performed. Backend deployment is still deferred until the
remaining outgoing/runtime wiring is ready for an end-to-end test.

## Normal outbox and delayed receipts — September 30, 2026

Added `normalChatOutbox.ts` and a durable SQLite mapping from normal message UUID
to cryptographic transport ID, recipient, and canonical-payload digest. This mapping
contains no extra plaintext message copy and rejects replacement of an existing
binding. It is scoped by cryptographic owner and bounded to 256 entries per owner,
2,048 globally; reaching capacity falls back to the existing transport rather than
evicting receipt evidence. Retention/capacity policy needs review before production.

The outbox adapter rechecks the original normal message and contact binding before
sending, attempts direct delivery first, and distinguishes custody from delivery.
Delayed receipts are independently signature-verified and matched against the saved
encrypted envelope, recipient device, expiry, and original payload digest. Only a
successful normal-message confirmation permits the courier to consume the receipt.
Failed local confirmation preserves relay evidence for retry. Existing development
courier callers retain their test-message path.

Added an account-owned neuron transport registration bridge. The normal text
manager now has an optional neuron route after the existing direct attempt and
before legacy mailbox/Axion fallback. Its held result keeps the original bubble
pending and skips the server acceptance timer. Offline text admission/recovery
recognizes an active neuron registration. Stale registration results and account
changes cannot authorize a handoff. No runtime registers this bridge yet.

Validation: 585 mobile tests passed, TypeScript passed, 142-module dependency check
passed. Eight new cases exercise real SQLite bindings and real custody signatures,
envelope reuse after adapter recreation, rejection of tampering/edited rows/stopped
sessions, retaining receipts after failed confirmation, verified confirmation and
relay cleanup, transport ordering/fallback, stale bridge sessions, and pending normal
bubbles without Axion. Existing test fixtures were updated for the new optional
transport dependency. Evidence: ignored `builds/normal-outbox-regression.txt`.

Remaining composition work: attach this outbox, verified normal inbox, courier,
record store and cryptographic network to the account lifecycle; supply a dedicated
normal direct-message capability (do not route production chat through the test
message capability); drive offline retries and delayed receipt polling; prevent
the experimental and account runtimes from competing for the native LAN listener.
Then enable staging, deploy the prepared backend metadata handler, and run the
device tests before changing production flags. No deployment, production build,
reinstall, or live normal-chat delivery was performed in this step.
