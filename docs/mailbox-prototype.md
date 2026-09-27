# Encrypted peer mailbox prototype — 2026-09-27

Status: public HTTPS custody and full cellular phone-to-phone delivery passed.
Explicitly approved peer settings can now be remembered per account and restored
when the app reopens in the foreground. This remains an Android development
experiment, not a production encryption rollout or completed distributed Axion network.

## Current hosted connection and saved pairing

FirstNeuron accepts signed peer exchanges at `https://143.198.121.2/v1/exchange`.
Phone traffic no longer uses the computer's SSH tunnel. Administration remains
private through that tunnel. The host trusts the four explicitly paired test
accounts; it does not accept arbitrary user IDs as identity proof.

`rememberMailboxPairing(pairs, neuron)` validates and pins the explicit public
identities, activates participation, and saves versioned public routes in the
account's SQLite configuration row. It stores no password, token, or private key.
On local account/foreground hydration, `initializeMailboxRecovery()` restores that
account's routes without waiting for Axion authentication. The first exchange runs
immediately and retries continue every 15 seconds while eligible. Backgrounding
and active calls still pause participation; OS background delivery is not added.

Restoration repeats endpoint validation and immutable key checks. Invalid versions,
wrong-account records, insecure remote HTTP, changed keys, and stale asynchronous
loads fail closed. Logout stops the active session. `forgetMailboxPairing()` stops
participation and removes saved routes, preserving immutable pins and pending
messages. `mailboxSessionStatus()` reports local runtime ownership/restoration/error;
an active runtime is not proof that the remote peer is online.

The initial neuron pairing is still explicit developer provisioning. That trusted
neuron can now introduce locally cached direct-chat contacts, with immutable key
checks and block filtering. See [trusted contact discovery](neuron-contact-discovery.md)
for its delegated trust model and bounds. General network discovery, multi-hop
routing, and a pairing UI remain future work.
Existing `startMailboxPrototype()` remains available for temporary sessions.

Cellular proof: PC (22) sent `b61a0759-5628-4dad-b1de-5076cbca0fc9` while
Chaty's development app (27) was force-stopped. Both phones had Wi-Fi off.
FirstNeuron held the envelope while PC showed pending, with no Axion `send_message`
frame. PC was then force-stopped; Chaty reopened, retrieved and persisted the text,
and deposited its signed receipt. With Chaty stopped again, PC reopened and fetched
the receipt, changing the original outgoing row to delivered. Evidence is in ignored
`builds/neuron-cellular-manual-evidence.json`. USB carried Metro/debugging, not peer
traffic; only port 8081 was forwarded.

Automatic restoration proof: after saving the same approved peer routes on all four
test accounts, PC was fully restarted and reported an active mailbox session with
no developer test handle. It sent `0b5fbba4-d710-4e45-bd03-33e816770d56` while
Chaty was stopped. PC was then stopped and Chaty restarted: its saved pairing
restored automatically, the normal chat row was persisted, and the signed receipt
reached FirstNeuron without calling a pairing or poll helper. With Chaty stopped,
PC restarted again and automatically changed the outgoing row to delivered at
`2026-09-27T22:29:03.434Z`. Both phones retained Wi-Fi off. Evidence is in ignored
`builds/neuron-cellular-restoration-evidence.json`. Opening the Metro entry in
Expo's development launcher was still necessary after a cold app launch; that is
development-build loading, separate from peer pairing and message transport.

Validation for saved pairing: 405 mobile unit tests, TypeScript, and the service
dependency check (95 modules) passed. The sections below retain earlier milestone
details; references there to tunnel-only hosting describe the previous deployment.

## What this adds

- An originator encrypts one text for a pinned recipient and deposits it with a
  paired custodian. The custodian stores ciphertext in a separate SQLite database.
- While the prototype is enabled in the foreground, a 15-second retry loop offers
  retained ciphertext to reachable recipients and returns signed receipts through
  paired custodians. Offline peers stop a batch after one failed attempt.
- The recipient verifies the sender signature, decrypts, checks the original
  cached direct-room membership and block list, and saves through normal chat
  ingestion. Only then does it sign a receipt tied to the encrypted envelope.
- The sender's prototype status remains `pending` after a custodian accepts data.
  Only a matching recipient signature changes it to `delivered`.
- With explicit test pairing active, the normal Send button tries direct P2P,
  then encrypted mailbox custody, then the existing server path if neither accepts.
  Custody leaves the original outgoing bubble pending. Only a verified recipient
  receipt confirms delivery on that same bubble. Media, replies and group messages
  retain their existing transport behavior.

## Crypto and trust boundaries

AndroidKeyStore holds separate per-account RSA-2048 decryption and P-256 ECDSA
signing keys. Public keys are exportable; private identity keys are not returned
to JavaScript. Each envelope uses platform SecureRandom for a fresh AES-256 key
and 96-bit GCM nonce; the routing header is authenticated as AAD. RSA-OAEP wraps
the AES key with SHA-256 and explicit MGF1 SHA-1 for AndroidKeyStore compatibility.
SHA256withECDSA signs a canonical envelope. Receipts sign its SHA-256 digest and
original sender, recipient, ID and expiry. Plaintext is limited to 4096 UTF-8 bytes.

This follows the platform algorithms and explicit OAEP parameters documented in
[Android cryptography](https://developer.android.com/privacy-and-security/cryptography)
and [Android Keystore](https://developer.android.com/privacy-and-security/keystore).
The new application protocol has not had an independent security audit and has
no forward secrecy, multi-device identity, key rotation, recovery, or revocation
distribution. Protected keys are not guaranteed to be hardware-backed on every
test device. Existing direct P2P chats outside this prototype are unchanged.

Public keys must be explicitly paired through a trusted out-of-band test setup.
The first persisted pin is immutable; changed keys fail closed. No keys are learned
from arbitrary relays. At most four identities participate in one local test.
This is not decentralized login, and self-claimed user IDs are not sufficient
authentication. Custodians can see routing metadata and can drop/delay data.

## Transport, retention and lifecycle

Mailbox connections have a distinct `axonic-mailbox-v1` DataChannel and a negotiated
SDP marker. Text sessions reject mailbox offers/channels and vice versa. They reuse
the existing bounded P2P session implementation, but never feed relay ciphertext
into ordinary chat ingestion. Only SDP/ICE passes through current Axion signaling;
mailbox payloads never fall back to server messaging on a failed P2P attempt.

Fresh connections currently require Axion signaling and cached direct rooms between
each communicating pair. Host-only ICE is tried first, then STUN-assisted direct
ICE. This mailbox does not yet use the native LAN discovery controller, DHT,
multi-hop routing, TURN, or internet-independent bootstrap. Do not describe this
as fully serverless or universally reachable across cellular networks.

The mailbox database is `axonic_mailbox_dev_v1.db`, isolated by owning account.
It retains ciphertext and signed receipts for at most 24 hours, with separate
per-account limits of 100 envelopes and 100 receipts, 800 records globally, and
10,000-character wire limits. Expired records are deleted on access. Immutable
inserts and transactions prevent collisions from replacing stored envelopes.
Outgoing chat bindings retain a digest of the original ID, room, content and
timestamp plus a custody flag, separately scoped to the sending account. This
prevents edited/deleted rows from reusing an envelope or inheriting its receipt.
Bindings are bounded to 400 records globally and expire with their envelopes.
Normal messages retain their original timestamp; messages older than the 24-hour
mailbox lease use the existing fallback path. Custody remains pending through
outbox/hydration retries and process restarts, including before test pairing resumes.
Existing valid custody suppresses server fallback until its lease expires.
Starting/restarting the app still requires explicitly resuming the paired prototype
for mailbox forwarding; automatic trusted-peer participation is a later step.

Only originators may deposit with custodians; custodians cannot recursively
deposit with other custodians. Receipt records suppress further ciphertext retry.
Retrieval is a push to a paired route; there is no unauthenticated fetch endpoint.

Backgrounding and calls suspend participation and reset connections. Signing out
stops the prototype and invalidates old callbacks; previous account storage is
never exposed to the new account. Data remains account-scoped until expiry.
Closed-app/background delivery and an always-on distributed service remain future work.

## Test entry points and device procedure

`mailboxComposition.mailboxPublicIdentity()` returns only public key material.
`startMailboxPrototype(pairs)` accepts up to three other public identities, with
the locally cached direct `roomId` for each communicating neighbor. Every node
must pin the sender and recipient even when its only direct route is a custodian.
The returned controller provides `create(id, originalRoomId, recipient, text)`,
`deposit(id, custodian)`, `flush(peer)`, `status(id)`, and `stop()`.
Pairing routes must come from actual test-room membership, never invented IDs.

Prepared ignored development APKs:

- `builds/Axonic-Dev-mailbox-arm64-20260927.apk`: com.axonic.dev, both physical phones.
- `builds/Axonic-mailbox-x86_64-20260927.apk`: com.axonic, both emulators.

Both APKs were installed in place on the four authorized test devices after the
user approved installation. Accounts and existing data were preserved. No backend
change or deployment was required.

Procedure: inspect current accounts/screens, update the four development
apps, export/pin public keys between authorized test accounts, verify the required
cached-room triangle, take recipient offline, deposit at custodian, restart the
custodian, reconnect recipient, and verify one normal incoming message plus a
recipient-signed receipt at sender. Verify a fourth device cannot decrypt or forge
delivery. Restore the original network topology and stop the test prototype.
The procedure below verified AndroidKeyStore identity creation, encryption,
signing, decryption, identity stability across app restarts and real P2P custody.

## Completed validation

Mobile tests cover offline store-and-forward with real Node crypto and SQLite,
closed/reopened on-disk ciphertext retention, tampering, forged/mismatched receipts,
wrong recipient, expiry, duplicates, quota, account isolation, immutable pins,
blocked peers, failed persistence, unsupported native builds and protocol isolation.
The Node crypto adapter uses its supported OAEP digest settings; it is not a claim
of AndroidKeyStore interoperability. Four Kotlin JVM tests exercise the actual
native sealing and verification implementation, explicit OAEP parameters, Unicode,
fresh randomness, tamper rejection, wrong private key and input bounds. Keystore
operations were subsequently checked on the devices below. Both development APKs compile, their
package IDs and ABIs are verified, and TypeScript/service-cycle checks pass.

## Four-device result — 2026-09-27

Installed both development updates with `adb install -r`. Existing signed-in
accounts remained 22 (PC phone), 27 (Chaty phone), 14 (emulator-5556) and 18
(emulator-5554). The two phones stayed on cellular throughout; emulator networking
was unchanged. The workstation coordinated the test and exchanged only public
identity keys; actual custody and delivery payloads travelled through WebRTC.

Created the authorized test-only direct room between 22 and 14, completing the
cached-room triangle with the existing 22–27 and 27–14 rooms. Explicitly pinned
all four public identities. Test message ID:
`e9b830f2-293f-40e7-86d6-c8ea8403180a`.

1. Force-stopped recipient app 14. Sender 22 encrypted and deposited with custodian
   27; deposit succeeded and sender status remained `pending`.
2. Custodian 27 and fourth device 18 both failed native decryption. Device 18
   signed a forged recipient receipt; sender rejected it.
3. Force-stopped sender 22 and restarted custodian 27. Re-pairing confirmed its
   original public keys; its SQLite ciphertext survived the full app restart.
4. Restarted and paired recipient 14. Custodian forwarded the saved envelope while
   sender remained stopped. Recipient decrypted and stored one normal incoming
   chat message, with an unread badge, and returned its signed receipt to custodian.
5. Force-stopped recipient again. Restarted sender and confirmed unchanged keys.
   Custodian forwarded the stored receipt; sender status became `delivered` while
   recipient remained stopped, proving the receipt also traversed the custodian.
6. Restarted recipient, verified unchanged keys, and resent the original envelope
   over P2P. Receipt succeeded; recipient still had exactly one matching message.
7. Stopped prototype participation on all four devices and removed test globals.
   All four mailbox/message database snapshots pass `PRAGMA quick_check`.
   Custodian and sender have ciphertext plus receipt, no ordinary chat row for
   this prototype send. Recipient has exactly one chat row; fourth device has none.

Here "offline" means the respective app was fully force-stopped, not that all
device radios or Axion infrastructure were disconnected. Fresh sessions used
the current Axion signaling service. This validates the isolated mailbox, not
serverless bootstrap or background/closed-app delivery.

Evidence (ignored development artifacts): `builds/mailbox-live-evidence.json`,
`mailbox-device-db-verification.json`, `mailbox-device-db/`, and
`mailbox-final-readiness.json`. Repeated early checks briefly ran before restarted
apps had registered their debugger targets; retrying after startup succeeded and
did not require an application code change. The existing 383 mobile tests and
four native crypto tests remain the code baseline for these builds.

## Normal Send-button integration verified — 2026-09-27

The transport manager now tries direct P2P, mailbox custody and legacy Axion in
that order. A durable outgoing binding protects the original content/identity;
custody is reported as queued, without a server-acceptance timer or delivered UI.
Verified recipient receipts reconcile the normal database row, peer receipt state,
outbox acceptance and chat/chat-list delivery indicators. Account changes, blocked
peers, deleted/edited rows and unsupported message features fail closed for this
prototype route. Existing server behavior remains the final transport fallback.

The live test used the actual Send button on PC (22), with recipient 14 stopped
and Chaty (27) as custodian. Message `ce1b6949-7af8-4af5-a755-ef60a37b185c` kept its
original timestamp `2026-09-27T19:44:00.510Z` across every step:

- Sender displayed one pending bubble; relay had ciphertext; observed outgoing
  WebSocket `send_message` frames were empty.
- Sender restarted before re-pairing. The durable custody guard kept its normal
  outbox pending. Explicit outbox recovery also produced no server message frame.
- With sender stopped, recipient restarted and resumed paired participation. The
  relay automatically delivered the original text and retained the signed receipt.
- Recipient stopped again; sender restarted and resumed pairing. The relay returned
  the signed receipt, the original outgoing row became delivered, and the normal
  chat list and message bubble showed their delivery checkmark.
- Final snapshots contain exactly one normal row on sender and recipient, none
  on custodian/fourth device, original timestamps, and eight passing database
  integrity checks. Sender outbox acceptance is persisted; the separate `sync`
  field retains its existing content-consistency semantics.

395 mobile tests pass, TypeScript passes, and the 94-module dependency check passes.
One existing timing-sensitive background video test failed during a loaded run;
its isolated rerun and the complete final suite passed without changes to it.
No native update, reinstall or backend deployment was needed for this integration.
All four devices are restored to signed-in foreground chat lists with Axion ready;
test participation and temporary monitors are stopped. Phones stayed cellular.
Evidence: ignored `builds/normal-mailbox-evidence.json`,
`normal-mailbox-db-verification.json`, `normal-mailbox-pending.png`,
`normal-mailbox-delivered-bubble.png` and `mailbox-final-readiness.json`.

Remaining next step: restore trusted mailbox participation automatically after
app restart. New connections still depend on Axion signaling; general discovery,
background participation, production identity/security review and broader rollout
remain separate work.

## Hosted neuron custody verified — 2026-09-27

`D:\Proyects\Axonic-neuron` now runs a TypeScript custodian on DigitalOcean
`143.198.121.2`, backed by FirstNeuron account 34. Mobile `mailboxProtocol.ts` and
`neuronExchange.ts` are vendored byte-for-byte into the portable service; its sync
script and SHA-256 manifest detect source drift. No mobile private keys or account
tokens are sent to the custodian. Requests and responses prove possession of pinned
P-256 device keys; envelopes and recipient receipts retain the existing protocol.

`startMailboxPrototype(pairs, endpoint)` optionally adds the hosted route to the
normal outbox. The endpoint includes `{url,node,user,signing}` and must match the
paired identity. HTTPS is required except for localhost development tunnels. Hosted
custody does not require a chat room with FirstNeuron or Axion signaling. It pauses
for background/calls/account changes and respects the blocked-neuron state.

Live test 18 → FirstNeuron → 14 passed through hosted restart and separately
stopped sender/recipient apps. Protocol ID `aa4c0ead-d654-494a-8a36-7430d97cb947`.
Normal send-function test ID `658ddc8a-d335-441b-99be-4b6c50381a01` queued with no
legacy server send frame and later changed its original outgoing row to delivered
after receiving the stored recipient signature. This test invoked the normal send
function from the development session; it was not a physical Send-button tap.

Evidence: ignored `builds/neuron-protocol-evidence.json`, `neuron-normal-evidence.json`
and `neuron-live-evidence.json`. Only public identity information is stored in the
test pairing files. Historical receipts belonging to unpaired users are skipped by
flush so they cannot block the current trusted queue. Regression coverage added.

Final checks: 398 mobile tests, six hosted tests, TypeScript, dependency-cycle
check (95 modules), and shared-source parity all pass. Test helpers and explicit
participation were stopped after testing; no native build or backend deployment.

Limitations: hosted listener is private, accessed through a computer's SSH tunnel
and temporary ADB reverse for emulator testing. It is not yet independently
reachable from phones over the internet. Peer discovery is limited to paired online
status; no general discovery/signaling, live relay or FirstNeuron-owned chat UI is
implemented. Next: an authenticated public HTTPS peer endpoint while keeping the
administrative dashboard private. Foreground-only explicit mobile pairing remains.

End-of-session readiness: users 14, 22 and 27 remain signed in and connected.
Sender emulator-5554 (user 18) returned to its login screen during the final reload,
after the normal message's delivered state was verified. Reauthentication is needed
before further live tests on that emulator. No reinstall, data wipe or password
change was performed. Temporary 18080 ADB mappings were removed; the dashboard SSH
tunnel remains open. The older mailbox-final-readiness.json belongs to the previous
test session and must not be used as evidence for this session.
