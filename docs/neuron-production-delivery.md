# Normal-chat neuron delivery rollout

Current release preparation (October 1, 2026): the production EAS profile now
enables `EXPO_PUBLIC_AXONIC_CHAT_IDENTITY=1` alongside the existing network flag.
This is ready for a production **build candidate**, not evidence that a signed
store artifact has passed device testing. No AAB was built or submitted in this
preparation step. FirstNeuron's compatible code is deployed and healthy.

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

## Dedicated normal direct channel — October 1, 2026

Added the opt-in `chat-text-v1` axon capability and `chat-message` frames, exposed
through the identity controller, connection network and LAN runtime. It uses
separate authenticated-data and key-derivation domains from experimental messages;
renaming an experimental frame cannot turn it into a normal-chat packet. Peers
without this capability decline normal sends while retaining existing features.
The recipient callback must durably accept the payload before an acknowledgement
is emitted. Normal room/contact validation remains the caller's responsibility.
The underlying static device-DH encryption still has no forward secrecy or ratchet.

Validation: the full mobile suite passed 589 tests, TypeScript passed and the
142-module dependency check passed. A subsequent composed-LAN test passed with
all 41 persistent-axon tests, proving controller/network/runtime propagation with
the experimental message channel disabled. New cases also cover capability
compatibility, ciphertext domain separation, storage failure and locking during
storage. Evidence: ignored `builds/normal-chat-channel-regression.txt` and
`builds/normal-chat-channel-tests.txt`.

The local FirstNeuron repository has matching shared protocol sources and passed
its TypeScript build and all 33 tests. Nothing was deployed or installed. This
capability is not yet attached to normal account chat: remaining work is the account
runtime composition, verified inbox/outbox adapters, custody polling and offline
retry scheduling, with exclusive ownership of native discovery. Backend deployment
and live-device validation remain deferred until that composition is ready.

## Account runtime composition — October 1, 2026

Added `normalChatRuntime.ts` and `mobileNormalChatRuntime.ts`. The existing
development-only `EXPO_PUBLIC_AXONIC_CHAT_IDENTITY=1` gate now attaches normal
conversations to the account lifecycle. No environment flag was changed in this
step. The experimental root runtime yields ownership of native LAN discovery
when this gate is selected, preventing two identities from competing for it.

The composition registers normal text attempts, connects the dedicated direct
channel to the verified normal inbox, serves custody for unrelated authenticated
neurons, polls custody receipts, and reconciles them through the normal outbox.
It uses the existing LAN/RTC/bootstrap transports and saved axon limit. Contact
authorization requires a cached two-member room and verified immutable local pin;
blocks and account/foreground changes invalidate access. Original edited, deleted,
media and reply rows are excluded. Retries run without Axion, with a ten-second
interval and at most twenty messages per batch, rotating rooms and message batches.
Stopping unregisters the bridge and closes the runtime; pending scans cannot send
after cancellation. The account lifecycle continues to lock keys on background.

Validation: all 594 mobile tests, TypeScript, the 144-module cycle check and 14
isolated backend binding/signaling tests passed. New composition tests exercise
real custody signatures and SQLite through offline delivery, recipient storage,
sender confirmation and relay cleanup. Mobile adapter tests cover verified pins,
blocks, owner changes, missing rooms and unsupported/edited rows. Evidence:
ignored `builds/normal-runtime-regression.txt` and `builds/normal-runtime-focused.txt`.
ADB reported no devices attached. No live-device delivery, deployment, reinstall,
commit, push or production build was performed. No shared hosted protocol changed
in this step; FirstNeuron's local protocol synchronization was verified previously.

Next staging validation:

1. User deploys the prepared Django `chat_identity_binding` handler. This routes
   authenticated public binding metadata; it does not replace login.
2. Use two development devices with the staging flag and existing accounts. Verify
   mutual binding, normal direct text, pending custody with recipient unavailable,
   recipient return, delayed verified receipt and no duplicate message bubbles.
3. Exercise block/logout/background/restart boundaries and custodian failover.
   A missing cached recipient public record currently prevents custody sealing
   until it is obtained through authenticated network contact; do not bypass this.
4. Review bounded outbox retention, expired-envelope behavior, bootstrap dependence
   and foreground-only lifecycle before considering production rollout. Multi-device
   fanout, a ratchet/forward secrecy, and Django-free authentication remain separate
   milestones. This staging gate is deliberately ignored by production builds.

### Live staging preparation — October 1, 2026

User confirmed the backend deployment and supplied phone R3GYC0H7PMY. Started
both named AVDs (5554/5556) without wiping data. Their old `com.axonic` 1.0.17
development clients lacked ExpoAppMetrics, so rebuilt x86_64 debug 1.1.2 with
`-PaxonicSideBySide=false` and updated both using `adb install -r` under the prior
authorization to update both test emulators. Build and installs succeeded; no
production build or phone reinstall. Evidence: ignored
`builds/normal-staging-emulator-build.log`.

Metro is running in managed session 76788 with the account-identity flag set only
in its process environment, host mode LAN and advertised address 127.0.0.1. ADB
reverse port 8081 is configured on all three devices. Initial localhost-only
Metro bound IPv6 loopback and was replaced; a stalled ADB server was restarted.
Backend health returned OK. Phone user 27 is authenticated, foreground, has native
random/scrypt/LAN support, and reports the normal text bridge ready. Its cached
test room with user 14 exists; no test message has been sent yet.

Emulator 5554 reaches login after session expiration (a refresh 401 was observed
on the emulator setup). Asked user to sign into its usual test account, user 14.
Emulator 5556 encountered an Expo development-launcher context collision; normal
activity launch recovered its launcher, but the current bundle still stalls during
startup/debugger evaluation. Tried its displayed host address 10.0.2.2 as well as
ADB reverse. Further startup diagnosis and sign-in are needed. Do not count these
preparation checks as successful direct delivery, binding, custody or failover.

### First live normal-neuron receipt — October 1, 2026

Both emulators subsequently signed in: 5554 is user 18 and 5556 is user 14.
Phone user 27 and both emulators report foreground normal-runtime readiness.
User supplied test login credentials, but both emulators were already signed in;
credentials were not needed or written to scripts/files.

The shared emulator conversation initially pinned identity in only one direction.
ADB clock measurements showed roughly half a second of skew. Challenges were
issued at exactly the verifier's maximum 60-second future window, so the faster
sender's challenge could be rejected by the slower receiver. Changed issuance to
55 seconds, leaving headroom while retaining the server/client 60-second cap and
strict expiration. Added a skew regression; TypeScript and all 595 mobile tests
passed. Both real emulators then established reciprocal immutable pins without
manual key registration or another backend deployment.

Sent one labeled synthetic message from user 18 to user 14 by saving an original
normal outbox row and calling the registered neuron bridge. It returned
`{delivered:true,peerId:14}`; both devices contained the matching message and
reported read status. Evidence: ignored `builds/normal-live-probe-evidence.json`,
message ID `892918c2-8108-4c30-9fc1-0040319b8ce5`. This exercises the normal neuron
bridge and normal databases, not a UI Send-button test. Axion stayed online for
binding and ordinary account services; no server-isolation claim is made.
Offline custody, phone-to-emulator delivery and failover remain to validate for
the newly composed normal-chat path. Earlier experimental failover results do
not substitute for those tests.

### Phone delivery and offline custody — October 1, 2026

Phone user 27 and emulator-5556/user 14 established reciprocal identity pins by
opening their existing direct conversation. A labeled original normal outbox row
sent through the neuron bridge returned `{delivered:true,peerId:14}`. Both devices
saved matching content and reported read status. Evidence: ignored
`builds/normal-phone-probe-evidence.json`, message
`3b451c20-0273-4d8e-ae6c-6d0e6168bfda`.

Force-stopped the recipient development app and sent a second labeled message
from the phone through the normal bridge. It returned `delivered:false`; the own
row stayed pending, and the durable envelope identified FirstNeuron as custodian.
A read-only, message-scoped check on FirstNeuron confirmed an encrypted envelope.
After restoring the recipient app, its saved account/identity returned, the
recipient stored matching content, and the sender changed to delivered. A second
scoped relay check found `packet:null` with no ciphertext: the verified receipt
had been consumed and only the bounded deduplication tombstone remained.

Evidence: ignored `builds/normal-custody-live-evidence.json`, normal message
`a8adf034-bd21-406a-8bbf-27fbc331e5d1`, custody transport ID
`2615cd72394bdda5bec03605bfa87ed5b7041ff550e763e536955895008b91ae`.
The recipient's cold development launch was slow; the first verification ran
before its account was restored. Subsequent database/token readiness checks and
verification succeeded without deleting data or reentering credentials.

These are live normal-bridge/database tests, not UI Send-button tests. Axion and
the other existing transports remained enabled; direct retry could race custody
polling after reconnect, so this does not establish exclusive custody-path ingress
or complete independence from Axion. FirstNeuron was the selected custodian;
ordinary-neuron failover for this new normal-chat composition remains next.
No source code, deployment, reinstall or production build was needed in this step.

### Ordinary custodian with FirstNeuron unavailable — October 1, 2026

Completed a controlled normal-chat custody test with phone user 27 as sender,
emulator-5554/user 18 as ordinary custodian, and emulator-5556/user 14 as recipient.
All three established authenticated RTC links before in-memory controls closed
their FirstNeuron sockets and prevented reconnection. The hosted service itself
remained online. Disabled direct normal delivery only for this synthetic message
and temporarily paused recipient custody polling; existing accounts/data remained.

The first attempt returned null and stayed pending. Automatic retry later stored
the encrypted envelope on user 18, while the recipient still had no message.
After resuming recipient polling, exactly one matching normal message appeared;
the sender reached delivered, and user 18 retained only a packet-null tombstone,
with no ciphertext. All three still had their two ordinary connections and no
FirstNeuron connection at final verification. Evidence: ignored
`builds/normal-ordinary-custody-evidence.json`, message
`6b36e53b-5052-4bec-8077-778c46120de5`, transport
`6eca981c7f77a9898b3cc6237b3d789104bf2cacbfc69e1fccfb10d2bfbf46a6`.

An earlier attempt exposed overlapping background receipt polling and outbox
retry: both competed for an axon's single request slot. Normal runtime maintenance
now awaits polling before retry and prevents overlapping maintenance cycles.
Added coverage for ordering and cancellation during an outstanding poll. All 596
mobile tests, TypeScript, and the 144-module service dependency check passed.
An interactive send can still encounter a busy slot; bounded retry remains needed.

During setup the emulator clocks drifted roughly eight seconds behind the phone,
beyond signaling's five-second tolerance. Android's normal network-time refresh
reduced the difference, and the full mesh then established. No verifier windows
were loosened. Clock-drift handling and initial custody latency need attention
before production: envelopes currently issue at the full 24-hour expiry cap,
which can reject an immediate deposit at a slightly slower peer.

This proves ordinary-neuron custody in an already connected foreground mesh,
including receipt-driven deletion, for the normal bridge/database path. It is
not a UI Send-button test, a recipient cold-launch test, or proof of joining a
network with no reachable bootstrap. Axion and other legacy transports remained
enabled. The new normal-account composition remains development-gated; production
rollout still requires UI/background testing and an explicit release decision.
Removed the temporary controls and verified `installed:false` on all three apps
after the test. No deployment or production build was performed in this step.

### Production candidate preparation — October 1, 2026

- New custody envelopes expire 30 seconds inside the existing 24-hour admission
  cap. A peer up to 30 seconds slower can accept them immediately; expired packets,
  invalid signatures and excessive lifetimes still fail verification.
- Each axon permits at most two local custody callers and briefly waits (at most
  80 waits of 25 ms before starting an exchange) for authentication, discovery or
  another request to release its slot. Account invalidation/closure cancels the
  wait. Existing exchange timeouts and background maintenance serialization remain.
- Account-scoped normal neurons now use an explicit release flag independently
  of development mode. Debug-only experimental identities remain development-only.
  Production-mode lifecycle coverage verifies background/account isolation.
- A held normal-neuron envelope alone cannot wake a sleeping phone. During this
  migration, held custody also submits the identical message ID to Axion when
  available, retaining push delivery and duplicate protection. An authenticated
  direct delivery receipt skips that submission. When Axion is unavailable, the
  encrypted custody copy remains pending. This release is not server-independent.

Validation: all 600 mobile tests passed, TypeScript passed, native identity guard
checks passed, and the 144-module dependency check passed. All 33 hosted-neuron
tests passed after synchronizing shared sources. Android production JavaScript
export succeeded under the release flags (ignored `builds/release-export`).

Actual Send-button testing used emulator user 18 to emulator user 14. Foreground
message `bc0f2bf7-effe-4ada-adf3-998eb70e0e72` reached delivered in both normal
stores. After the fallback fix, background message
`d467eed7-2d6c-4218-be59-e881332ecefb` reached delivered while the recipient's app
reported background; Android posted a `com.axonic` messages-channel notification.
After returning the recipient to the foreground, both stores still contained
exactly one matching row per test message. Evidence is in ignored
`builds/release-ui-evidence.json`. Earlier B/C attempts were inconclusive for
notifications during development reloads and are not counted as notification
passes. These tests validate the full send/fallback path, not exclusive neuron
transport for every UI message.

FirstNeuron deployment used `neuron-release-ready-20261001.tgz`; health and service
checks passed, the identity file hash was unchanged, and compiled custody/axon
file hashes match the tested local build. Rollback code remains at
`/opt/axonic-neuron-before-release-ready-20261001`. No proxy or backend deployment
was needed. No repository commit/push was performed.

Next: run `eas build --platform android --profile production` to create the signed
AAB (remote build number auto-increments). Test that exact artifact on the normal
phones before wider distribution: foreground delivery, background notification,
reopen without duplicates, mixed old/new clients, calls and media fallback.
The current live validation used development clients, not a signed release.
Only one physical phone was available; a two-physical-phone release check remains.
Keep automatic device time enabled: RTC signaling still deliberately rejects
proofs more than five seconds ahead; the emulator time-drift limitation remains.
