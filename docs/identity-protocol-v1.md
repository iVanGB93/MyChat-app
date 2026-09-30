# Experimental cryptographic identity v1

Not a deployed protocol or a completed security review. Existing production login,
registration, mailbox identities and message databases remain unchanged.

## Account and device identity

Account authority is Ed25519. Its public identifier is `axonic:1:` followed by the
lowercase SHA-256 digest of UTF-8 JSON `["axonic-account-v1", publicKeyHex]`.
Public keys are fixed-length raw 32-byte lowercase hex, not Django IDs or usernames.
Human nicknames are local labels and never participate in authentication.

Each device has independent random Ed25519 signing and X25519 encryption seeds.
Device ID hashes `["axonic-device-v1", signingKeyHex, encryptionKeyHex]`. X25519 is
reserved for the new encrypted transport; the old RSA mailbox is not silently changed.
Account and device signing keys are distinct. Verification uses strict Ed25519 rules
(`zip215: false`). Canonical signatures use explicitly ordered JSON arrays and unique
domain tags rather than incidental object property ordering.

An authority-signed record lists 1–8 devices sorted by ID, timestamps, a revision,
and the previous record digest. Records last at most 30 days. Revision zero has no
parent; later revisions name their parent. This lifetime is provisional, not a final
mobile availability policy. Automatic renewal is still to be implemented.

## Verification and consistency

Any participant can validate a new identity without an allowlist. A valid signature
establishes key control, not a person's reputation or permission to access other users'
data. No account, including FirstNeuron, is a registry authority.

Known records cannot regress. Equal-revision conflicting records fail closed; a direct
successor must link to the known digest. Missing intermediate revisions are reported
explicitly, not skipped. New peers can verify a signed current record without knowing
the entire past, but cannot prove it is the globally latest record. A partitioned or
previously unknown peer can accept an older still-valid authorization it has not seen
revoked. Gossip/history exchange, recovery conflict handling, and freshness policy
remain required before production rollout. No blockchain/consensus layer was selected.

The challenge primitive uses 32 random bytes, a 60-second lifetime, a verifier account
binding, one-time consumption and a 256-pending-challenge bound. A challenge proof
alone is not an application session or authorization to perform arbitrary operations.

The admission primitive instead verifies each complete signed request: target account,
fresh receiving-runtime instance, operation, exact payload, timestamp, nonce, record
digest and device ID. A fresh 32-byte random runtime instance prevents replay across
restarts, including future-dated requests. Requests last 60 seconds with up to 30 seconds
of future clock skew. Replay reservations occur before asynchronous storage operations.
There are at most 16 in-flight admissions and 1024 live replay reservations; saturation
rejects new traffic rather than evicting replay protection. Callers still need source
and global rate limits, byte limits before JSON parsing, and operation-specific rules.

Before returning an authorized operation, the engine atomically persists its accepted
identity record using compare-and-set. Concurrent conflicting revisions cannot both
win. A failed write or interrupted runtime yields no authorized operation. Requests do
not issue reusable bearer tokens.

The shared exchange service signs a descriptor binding the caller's nonce, peer identity,
device and runtime instance. The client verifies the expected account and persists its
record before issuing a request. The signed reply binds the exact request digest and
both identities/devices. Tampered, substituted, stale and late-after-lock replies fail.
The only implemented service action is empty-payload authentication; discovery and
chat access are not implicitly granted. Network listeners and clients must enforce
source rate limits and bounded reads/timeouts before exposing this on the internet.

## Local storage and recovery

New accounts use 256 random bits, encoded as 24 English BIP39 recovery words. The words
encode entropy; the root Ed25519 seed is an Axonic-specific HKDF-SHA256 derivation with
salt `axonic-root-v1` and info `ed25519-account-authority`. This is not an Ethereum or
Bitcoin wallet derivation and must not be advertised as wallet import compatibility.

The encrypted local vault contains entropy and independent device seeds (96 bytes).
A 12–256-character password is stretched with scrypt N=131072, r=8, p=1 and a fresh
32-byte salt. HKDF mixes the result with a separate 32-byte device secret to derive the
XChaCha20-Poly1305 wrapping key. Each write uses a new 24-byte nonce; authenticated
metadata binds algorithm choices and the public identity-record digest. Untrusted KDF
parameters are never accepted. Passwords are not normalized or stored.

Android derives the same scrypt output with Bouncy Castle `bcprov-jdk18on:1.86`
on the Expo native async queue. The JavaScript implementation remains the portable
reference; vault format and work factors are identical. Native calls accept only
12–256 UTF-16 code units, exactly 32 salt bytes, and one concurrent derivation.
UTF-8 encoding matches TextEncoder even for unpaired surrogates. Independent
Node/OpenSSL vectors verify ASCII, Unicode, and malformed-surrogate compatibility.
The native adapter is required in the development preview: an older client cannot
silently fall back to the impractically slow Hermes implementation.
Library reference: [Bouncy Castle Java](https://www.bouncycastle.org/download/bouncy-castle-java/).

Ciphertext is in a new AsyncStorage namespace. The device secret is in Expo SecureStore
with device-only/unlocked accessibility where supported. Neither is sent to a neuron.
Recovery confirmation precedes persistence. Backgrounding or leaving the development
preview locks it and clears the UI fields. Best-effort byte-buffer clearing is used;
JavaScript strings/GC copies do not provide guaranteed memory erasure. Scrypt memory
and latency, native secure randomness, and the backup UI must be tested on actual
phones before release. Password changes and a complete recovery UI are pending.

Core recovery takes the phrase plus a verified prior public record and issues a new
revision replacing authorized device keys. It does not invent a conflicting genesis,
restore old message history, discover the latest record, or silently replace existing
production pins. A complete recovery flow must retrieve and reconcile current records
before publication. The current Android Keystore mailbox keys are not exported.

## Current implementation checkpoint

- Portable protocol, encrypted vault, isolated local controller, signed-request
  admission and development-only Profile preview are implemented.
- Android `identityRandomBytes` uses SecureRandom with a 1–64-byte bound. Both test
  emulators were updated in place with the user's authorization, retaining app data.
  Testing exposed slow JavaScript scrypt on Hermes; native derivation now preserves
  the same vault format. Native interoperability and input-bound tests pass.
- Unit tests cover interoperability with Node crypto, forgery, expiration, replay,
  conflict handling, recovery, incorrect passwords/device secrets, interrupted writes,
  locking and symmetric admission among ordinary peers without FirstNeuron.
- Mobile public records use an isolated SQLite database with exclusive transactions.
  Hosted public records use bounded atomic file replacement. Both preserve known
  identity revisions and reject conflicting writes; the same portable client/exchange
  source is synchronized into the hosted repository with a drift check.
- Development Android bundle export and native release-module compilation passed.
- The updated debug client builds successfully. Local creation, lock, incorrect-password
  rejection, and successful unlocking passed on both Android emulators (legacy users
  14 and 18). The temporary test vaults are isolated from existing account/message data.
  Restarting the JavaScript runtime retained the same locked identity, which then
  unlocked with its original password. Creation measured 1562/1634 ms and unlocking
  1539/1626 ms inside the two emulator runtimes. Temporary identities were removed
  after testing. This is not a physical-phone or full Android reboot benchmark.
  Physical-phone performance and complete recovery-screen interaction remain untested.
- No live neuron identity endpoint, automatic network enrollment, migration, contacts,
  or new-identity messaging is enabled yet. Existing network enrollment stays manual.

Persistent axon prototype: `persistentAxon.ts` uses symmetric hello and signed
describe/authenticate exchanges over one bounded wire. Hello is only an account
claim; it grants no authority. Each socket has a new secure 32-byte instance nonce.
Authentication renews every 20 seconds; exchange timeout is four seconds and initial
authentication timeout is ten seconds. Locking, expired proofs, invalid frames and
disconnects close the session. Frames are limited to 20,000 UTF-8 bytes and 64 incoming
frames/minute, with one outgoing exchange and one incoming operation at a time.
There are no chat, relay or discovery frames in this transport yet.

The hosted WebSocket adapter configures payload/fragment limits, disables compression,
and caps outgoing queued data. Its caller must apply those options before opening
the socket and enforce shared admission/connection limits before upgrading. It is
tested over loopback sockets, not enabled in the production listener. The phone
runtime adapter, account-lock integration and live Network diagnostics remain pending.
Concurrent identity-record writes accept only an exact match confirmed by a fresh
store read; a conflicting revision or failed persistence still fails closed.

Next: bounded runtime transport integration and opt-in listeners for the shared
exchange; then new-identity contacts and independent conversation IDs. The new core
does not yet resolve missing revision history or replace manual live enrollment.

Renewal extension (prepared September 29, 2026): records retain their v1 signature
format. Optional `history` fields carry at most eight signed predecessors / 8000 UTF-8
bytes in identity descriptors and authentication requests. History itself needs no
new bearer authority: every predecessor is root-signed, every next.previous matches
its predecessor's digest, and the final record is already bound by the existing
request/descriptor signature. Stores validate the entire bounded chain in the same
atomic compare-and-set operation that updates the latest pin. Expired ancestors are
accepted as evidence only; the advertised final record must still be fresh.
Older implementations may accept an immediate successor but reject gaps; roll out
support on participating clients and hosts before relying on multi-renewal catch-up.

### Optional axon introductions

A hello may advertise `features: ["introductions-v1"]`. Both peers must advertise support before sending the `introductions` request operation. Its body is a normal device-signed identity request with operation `lookup` and payload `introductions-v1`, addressed to the peer account and current socket instance. The requester must already match the authenticated account/device on that axon.

The response signs the domain `axonic-introductions-v1`, version, SHA-256 of the exact request JSON, issuer account, instance, signing device, issue/expiry times, and ordered account/expiry pairs. At most eight current direct peers are reported, excluding the requester and issuer. Signatures attest only to the introducer's observation. Receivers keep reports in bounded memory for at most sixty seconds, clamped to the source proof/record expiry, removing them on source disconnect or local lock. Reports carry no dialable addresses and never establish trust, pin introduced accounts, enter the dial pool, or become transitive advertisements. Peers without the feature continue the original identity/liveness protocol.

### Optional RTC signaling

`rtc-signals-v1` allows a bounded `signal` frame on an already authenticated axon. Both sides advertise support. A signed `axonSignaling` envelope uses the domain `axonic-rtc-signal-v1` and binds record digest, authorized device, target account, secure session ID, offer/answer kind, SDP and issue/expiry times. Maximum raw envelope: 14 KB; SDP: 7 KB; lifetime: 30 seconds. Existing 20 KB wire framing also applies, so escaping/history overhead can cause an oversized envelope to be refused. Per-axon inbound signaling is capped at 16 frames/minute, with one handler at a time; the shared router permits two concurrent verifications and 128 short-lived replay entries. No offline signaling queue exists.

A relay forwards only the authenticated originating account/device's own envelope to a currently connected destination. Recipients independently verify the signature and identity record continuity; a relay's report never substitutes for origin authentication. Each RTC channel then performs a new independent identity handshake. Local transport policy accepts data-only SDP, no media, and no TURN relay candidates. Current mobile configuration uses host-only ICE, with one bounded gathering period. Setup timeouts and the ordinary five-axon pool bound pending attempts. The native adapter's protocol-field compatibility behavior is documented in the roadmap.

### Experimental test-messages-v1 frames

A peer may advertise test-messages-v1 only when it has an explicit test handler and local encryption key. Outer frame: {version:1,kind:"test-message",body:<packet JSON>}. Packet: {version:1,kind:"text"|"ack",id:<32-byte lowercase hex>,nonce:<24-byte lowercase hex>,ciphertext:<lowercase hex AEAD output>}. Text plaintext is 1..2048 UTF-8 bytes. Ack plaintext is SHA256 hex of the exact text packet JSON. AAD is JSON UTF-8 of ["axonic-test-message-v1",kind,id,[senderAccount,senderDevice,senderInstance],[recipientAccount,recipientDevice,recipientInstance]]. Key is HKDF-SHA256(X25519(localDeviceEncryptionSecret,authenticatedRemoteDeviceEncryptionPublic),SHA256(AAD),UTF8("axonic-test-message-key-v1"),32). Cipher is XChaCha20-Poly1305 with that AAD and the packet nonce. This static-DH test protocol does not provide forward secrecy, offline delivery, persistence, reconnect deduplication or a production messaging permission model. Both connection proofs must remain valid. A receipt indicates only acceptance by the volatile test handler.

## Durable development messages (2026-09-29)

The development capability is now `test-messages-v2`. V1 peers still authenticate but cannot exchange these messages or provide a durable receipt. The outer Axon frame remains version 1; encrypted packets use version 2 and the AAD/key context strings end in `-v2`.

The sender persists its own outgoing text and a secure random 32-byte logical ID before transmission. Retries keep that ID and text, but generate new ciphertext/nonces bound to the current authenticated socket. The receiver awaits a successful inbox transaction before encrypting its receipt of the exact incoming ciphertext digest. A duplicate logical ID with identical text is acknowledged without insertion; conflicting text is refused. Replaying the exact packet nonce is still rejected, and ciphertext from another socket does not authenticate.

`testMessageStore.ts` uses a separate `axonic_test_messages_v2.db`, scoped by owner, peer, direction and ID. Pending and delivered rows survive process restart. A single foreground worker attempts at most one message per tick, with 5–60 second exponential backoff; failed or lost receipts leave a message pending. Lock/account changes invalidate late callbacks. Peer opt-in is memory-only and must be repeated after unlocking. Queue admission returns an ID, not a delivery confirmation; inspect the stored state for delivery.

Limits: 2,048 UTF-8 bytes per text, 200 total rows per local experimental account and 1,000 globally. The database refuses new rows at capacity, preserving pending messages and duplicate receipts rather than silently evicting them. Explicit development cleanup deletes only the current experimental account's rows and cancels its work.

This is an own-message development inbox/outbox, not third-party custody or normal chat integration. Synthetic text is currently plaintext inside the app-private SQLite sandbox; production encrypted-at-rest storage remains outstanding. Transport encryption still uses static DH without forward secrecy or a ratchet. A durable receipt confirms the recipient's database commit, not a human read, backup, or protection against later device loss.

## Experimental offline custody v1 (2026-09-29)

Implemented `custodyProtocol.ts`, `custodyService.ts`, a separate mobile SQLite adapter, and a hosted atomic-file adapter. Both runtimes use the identical protocol and service. The optional `custody-v1` Axon feature advertises a custodian; a client may use custody without offering it. Requests run only after authenticated peer admission and share existing frame/rate/connection limits.

An envelope has a stable random message ID, sender/recipient account and device IDs, creation/expiry, an ephemeral X25519 public key, a 24-byte nonce, ciphertext and an Ed25519 sender signature. XChaCha20-Poly1305 keys derive from ephemeral-to-recipient-device DH via HKDF-SHA256 with domain separation and all routing fields authenticated. Sender authentication uses current pinned identity records, not Django IDs. Recipient decryption stays inside the identity controller. Static recipient-key compromise can expose retained envelopes; this is experimental cryptography without a ratchet or a production forward-secrecy claim.

Operations: `deposit` stores an originator-signed envelope; `poll` returns one pending envelope to its recipient or a receipt to its sender; `receipt` atomically replaces ciphertext with the recipient-device-signed receipt; `consume` removes the collected receipt. `held` means custody acceptance, never delivery. The sender must verify the recipient signature AND exact envelope digest/IDs before marking its own message delivered. The recipient controller signs only after the caller's durable own-inbox insertion/deduplication succeeds, and cancels if its identity locks while saving.

Only the authenticated sender can deposit, and only the authenticated recipient can submit receipts. No relay-to-relay propagation. Bounds per custodian identity: 128 entries, 16 per sender, 16 per recipient, 512,000 serialized characters (wire packet fields are ASCII), 2,048 plaintext UTF-8 bytes per message, 24-hour lifetime, 16 concurrent service requests. Identical deposits are idempotent; conflicts and overflow are rejected rather than evicting pending traffic. After receipt consumption, a minimal routing/ID/digest tombstone stays until the original expiry to prevent redeposit; it contains no ciphertext, plaintext or signature. Expiry runs on service requests and once per minute while active. A suspended/offline phone cannot execute deletion; expiry is enforced when service resumes. Deletion here means logical removal from the store, not a secure-erasure claim for filesystem journals/backups.

Mobile service is limited to the development cryptographic network and runs while that identity is unlocked. Hosted source uses the same service and a private per-neuron file; it is not deployed yet. Direct messages and legacy conversations are not automatically routed through custody. `requestMobileIdentityCustody`, controller seal/receive methods and the transport APIs provide experimental protocol access; automatic custodian selection, durable sender envelope/retry orchestration and user-visible custody status remain the next integration work.

## Automatic development custody courier (2026-09-30)

The development outbox now attempts direct delivery before custody. It discovers custody-capable authenticated sessions and ranks available routes LAN, private, then internet. The preferred reachable custodian is retained for an envelope; a full/rejecting custodian is skipped for 30 seconds so another eligible connection can be tried. A prior custodian becoming unreachable can leave more than one temporary copy; every custodian independently requires the recipient receipt or expiry to remove its copy.

`ownCustodyStore.ts` persists the sender's exact signed ciphertext before deposit, keyed by own account and message ID. Retries and worker recreation reuse it. Expired envelopes are not silently resealed with another lifetime. Unknown recipient records cannot be guessed; this version requires a previously verified recipient record and deterministically chooses its first device. Multi-device fanout remains outstanding. Own stored envelope capacity is 200/account, 1,000 total; explicit development cleanup clears only that owner's entries.

`custodyCourier.ts` polls at most one connected custodian every five seconds, with bounded round-robin traversal and temporary skip lists to avoid a single unprocessable message starving the queue. Recipient processing requires explicit development peer permission and the controller's verify/decrypt/persist/sign path. Sender processing verifies the recipient signature, original envelope digest, exact recipient device and expiry, then marks the own outgoing message delivered before consuming the relay receipt. A failed consume can be retried without duplicate delivery. Identity locking invalidates pending work and clears temporary peer permissions.

The diagnostic message API distinguishes pending/delivered and sealed/held/expired custody state. A relay's held/completed response never marks delivery. This is connected to the development test queue only, not production conversations. Production encrypted-at-rest own storage, UI status presentation, broader peer-record discovery, multi-device receipt policy and resilience when no known custodian can be reached remain future work.
