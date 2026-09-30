# Axonic: automatic identity and network participation

Status: agreed product direction; implementation pending. This document does not
authorize a production build, deployment, or migration of existing identities.

## Target experience

- FirstNeuron is an ordinary Axonic participant hosted continuously to improve
  availability. It has no privileged identity, registration authority, exclusive
  directory, or special trust role. Its current manually pinned role is transitional.
- All participants implement the same network protocol and can verify identity proofs,
  help find peers, and temporarily carry encrypted messages within local resource and
  lifecycle limits. Hosted and mobile implementations share protocol logic; differences
  in uptime, reachability, battery, and capacity do not confer authority.
- Identity authority belongs to each account's keys. Neurons verify and distribute
  signed public records; no particular neuron grants ownership of an identity.
- Any suitable reachable participant can provide bootstrap assistance. FirstNeuron
  must be replaceable, and existing participants must continue with other reachable
  peers when it is unavailable. A fresh installation still needs a reachable entry
  point, such as nearby discovery, an invitation, or remembered/configured peers.
- No email, central username registry, or administrator approval to create an identity.
- A permanent cryptographic account identifier; contacts initially show a shortened
  identifier and each user assigns their own local nicknames.
- A local password unlocks protected account material. Never store the password itself.
- A randomly generated recovery phrase restores account authority. It does not
  restore message history without a separate encrypted backup.
- Each installation has separate device keys authorized by its account identity.
  Separate accounts per device remain supported and match the current preference.
- Automatic connection while unlocked and eligible to participate; no Connect button.
- Prefer reachable local/private routes, then other direct routes, then relay/custody.
  Private address ranges alone are not evidence of reachability or shortest distance.
- Keep personal history locally. Intermediaries retain encrypted payloads only until
  verified delivery or expiration. Bounded receipt/deduplication metadata may survive
  payload deletion temporarily. Public identity records have a separate lifecycle.

## Current baseline and limits

FirstNeuron supports signed introductions/signaling and temporary encrypted text
custody. Controlled direct text and receipt tests passed without Axion on development
devices. Production crypto's native debug-only guard was fixed and its release module
compiled/tested; complete production identity flows still need end-to-end validation.
Hosted registration currently binds Django numeric users to manually supplied device
keys. Mobile routes depend on cached Django direct rooms. Foreground participation,
existing backend fallback, and calls/media remain part of the current system.
FirstNeuron has a status dashboard, not its own chat/call client.

## 1. Specify the identity protocol and migration boundaries

Define a versioned identity ID, account authority, separate signing/encryption device
keys, signed device certificates, canonical signed encoding, domain separation,
challenge expiration/replay protection, key rotation, and recovery authority.
Choose maintained cryptographic libraries and compatible mobile/Node key formats.
Do not derive network identity from a chosen username/password or export the current
non-exportable Android Keystore keys to simulate seed recovery.

Specify account-update ordering, conflicting updates, stale revocation behavior,
certificate expiry, offline behavior, and storage quotas before implementation.
Signed records do not themselves establish a globally latest version. Decide whether
the first registry design's consistency limits are acceptable; blockchain is an option
for shared ordering, not a prerequisite or an already-selected dependency.

Completion: reviewed protocol fixtures accepted identically by mobile and Node,
including invalid signatures, replay, expired authorization, and conflicting updates.

## 2. Build local identity creation, unlock, and recovery

Create identity without Django. Implement password-protected account storage with an
appropriate password KDF and platform secure storage, unlock/lock lifecycle, generated
recovery words, recovery confirmation, and signed device authorization. Keep routine
device keys distinct from recovery/account authority. Define password-change behavior
without changing the account identifier.

Completion: identity created in airplane mode; wrong password rejected; keys excluded
from logs; process restart preserves identity; recovery on a separate test installation
preserves account ID while issuing distinct device keys. Existing data is preserved.

## 3. Replace manual neuron registration

Implement shared proof verification in mobile and FirstNeuron. A new identity proves
control of its authority and authorizes its device; no admin-maintained allowlist is
needed. Authentication proves key control, not that an identity is trustworthy.
Enforce bounded requests, per-peer and global custody limits, and abuse controls that
do not assume one identity equals one person. Keep legacy registration during transition.

Completion: a never-seen identity authenticates automatically; forged account/device
claims, replay, revoked/expired credentials under the specified freshness rules, and
resource exhaustion attempts are rejected without replacing existing keys.

## 4. Remove Django contact and conversation dependencies

Add QR/contact links carrying full identity and required verification/bootstrap data.
Show shortened IDs for display only; verify full IDs. Store local nicknames and blocks.
Define authenticated direct-conversation establishment without Django room creation.
Version message addressing so cryptographic IDs coexist safely with legacy numeric IDs.
Keep contact lists private unless explicitly needed for a chosen discovery operation.

Completion: two new users add each other and create a direct conversation without a
Django account, username lookup, contact API, or server-created room.

## 5. Connect automatically and discover reachable peers

Start participation after unlock; reconnect after eligible foreground/network changes.
Use nearby discovery, remembered peers, and multiple configurable bootstrap neurons.
Validate every discovered identity; unsigned LAN announcements never establish trust.
Measure reachability and connection success rather than assuming private IP proximity.
Replace manual setup controls with useful status and optional pause controls.

Completion: a fresh installation reaches a neuron automatically; restart and Wi-Fi/
cellular changes recover without intervention; unavailable bootstrap peers fall back
to alternatives. Background suspension is shown honestly and tested separately.
Also test with FirstNeuron shut off: another ordinary participant provides discovery
and identity-proof verification. No FirstNeuron-specific credential or approval may
be required. An isolated installation with no reachable peers reports that limitation.

## 6. Complete server-independent text delivery and cleanup

Integrate new identities/conversations into direct encrypted text, signed receipts,
retry/deduplication, and temporary replicated custody. Signed recipient receipt means
durable recipient storage, not merely that an intermediary accepted the payload.
Delete intermediary payloads on verified receipt or expiry; propagate bounded receipts
so other copies can be removed. Enforce expiration after restart as well.

Completion: Django and Axion inaccessible, two fresh identities exchange text; an
offline recipient later receives it; retries do not duplicate it; altered receipts do
not delete it; intermediary copies expire or disappear after delivery while personal
history remains. Verify behavior with both available and unavailable direct routes.
Repeat custody and later delivery through an ordinary third participant with FirstNeuron
unavailable. FirstNeuron is one deployment of these shared duties, not their sole host.

## 7. Migrate existing accounts and validate a release

Offer an explicit migration that binds a new identity to the existing authenticated
Django account for legacy contacts. Preserve messages, nicknames, blocks, and old IDs
through a mapping. No silent key replacement; handle multiple existing installations
and interrupted migration. Retain a tested recovery/rollback path.

Run fresh-install and upgrade tests on an actual non-debuggable release, including
native identity creation, recovery, enrollment, and automatic connection. Production
build/install/deployment actions require the user's explicit instruction.

Completion: new and migrated users pass the same Django-offline text scenario on
release installations, without deleting existing history or registering keys manually.

## Network design agreed with the user

Every active app is a neuron. Authenticated connections (axons) may join any two
neurons, regardless of whether their owners are contacts. The connected participants
form the Axonic network. Contact permission and access to private conversations remain
separate from permission to participate as a peer.

Start with a target of five simultaneous authenticated peer connections per device;
allow a bounded test configuration up to ten. Prefer reachable local routes, consider
private/VPN routes, and retain connectivity beyond the local cluster. Private IP
addresses alone do not establish shared reachability. Count pending dials and inbound
admissions against the limit to prevent concurrent handshakes exceeding it. Replace
failed peers with backoff; do not change identities or trust pins to reconnect.

FirstNeuron runs the same portable identity, peer-management, discovery, routing,
and temporary-custody logic as other participants. Hosting supplies continuous uptime,
persistent storage, and a web interface; it grants no authority over other identities.
Each hosted deployment has its own identity. Mobile and hosted adapters should expose
the same diagnostic definitions, with hosted logs/history supplementing the web view.
Continuous monitoring needs a separately implemented health-check system.

Profile → Network is the mobile entry point for observed status and participation
controls. Report locally known peers separately from authenticated active connections;
never present introductions as connected axons or as a worldwide neuron count. Show
traffic/storage/latency only when the runtime actually measures those values.

The first screen implementation moves the existing hosted-peer controls and the
development identity preview out of Profile. It reports the current legacy session;
the five-peer pool and contact-independent discovery are not activated yet.

The portable `neuronConnections` manager now implements five default slots (configurable
1–10), a 128-candidate bound, ten-second authentication deadlines, exponential retry
backoff with jitter, duplicate/self rejection, and replacement after disconnect or
authentication expiration. It prioritizes LAN and private routes while reserving one
non-LAN route when available and the configured limit exceeds one. A pending attempt
continues to occupy its slot after cancellation until its adapter settles; this bounds
resource use even when an adapter ignores cancellation. Periodic `tick()` is required.

The shared identity connection opener uses the existing signed mutual authentication
protocol before returning a connected link. Mobile and hosted tests exercise real
signatures, ordinary peers, durable hosted registries, and disconnect cleanup without
FirstNeuron or Django. Both modules are synchronized into the hosted repository.
Validation: 449 mobile tests and 14 hosted tests pass, along with type checking and
the service dependency check. These are controlled-transport tests, not a live overlay.

The shared HTTP identity transport and wire rules are now implemented, with an isolated
hosted listener factory and an Expo streaming-fetch adapter. Real loopback TCP tests
authenticate ordinary identities through the pool without Django. The protocol uses
exact POST `/v2/identity/describe` and `/v2/identity/authenticate` routes, 16 KB body
limits, and four-second deadlines. Admission is bounded to eight active requests,
16 requests per source per minute, 64 globally per minute, and 32 sockets. Forwarding
headers cannot spoof source identity. Behind a proxy, these conservative source limits
apply to the proxy until a separately trusted proxy policy is implemented.

Remote client origins require HTTPS; explicit loopback HTTP is test-only. Redirects,
credentials in URLs, cookies, non-JSON responses, malformed UTF-8 and non-streaming
fetch implementations are rejected. Candidate origins still require validation by
discovery before dialing; authentication alone is not an SSRF policy. Mobile's Expo
adapter is type-checked but not yet tested on-device with a remote TLS endpoint.
Validation: 455 mobile tests and 18 hosted tests pass, with matching shared sources.

HTTP here is a short-lived signed exchange channel, not a persistent axon or a liveness
monitor. The listener is a separate factory, not mounted by the deployed service, and
the Network screen still reports the legacy session. Do not present an HTTP proof as
a permanently connected neuron. No production deployment was performed.

Persistent transport checkpoint: the shared `persistentAxon.ts` now mutually
authenticates two ordinary neurons over one open connection, renews signed proofs
every 20 seconds, and closes on lock, expiry, malformed traffic or a four-second
exchange timeout. Every socket receives a fresh cryptographic instance nonce.
The hosted `persistentAxonSocket.ts` adapter bounds frames, fragmentation and outgoing
queued bytes. Real loopback WebSocket tests cover renewal, disconnects, binary and
oversized fragmented messages, and replay from a previous socket with the same identities.
Simultaneous authentication exposed a concurrent record-pinning race; a failed atomic
write is now accepted only when a fresh durable read confirms the exact same record.

Validation: 462 mobile tests and 21 hosted tests pass, alongside type checking,
the service dependency check and shared-source drift check. These are local protocol
and socket tests; this new transport is not running in the phone app or FirstNeuron.
The adapter is not a public listener. Before enabling it, reserve capacity across
incoming and outgoing sockets, restrict the upgrade path/origin, impose connection
and source limits, and integrate secure endpoint selection. Mobile still needs a
bounded transport and an opaque signing integration with its locked identity vault.

Next: runtime integration and contact-independent discovery. Bind pool lifetime to local identity unlock/lock and
participation state. Then expose the
pool's live snapshot in the mobile Network screen and hosted diagnostics. Do not route
private conversation data merely because a neuron was admitted to the pool.

## Later capabilities

Encrypted attachments with bounded temporary custody; decentralized call setup and
reachable call relays; group membership/key management; encrypted history backup;
FirstNeuron's own conversations/UI; background notification strategy. Firebase push
still needs a trusted sending service in the current architecture. Retiring Django
entirely requires replacing these remaining dependencies, not just authentication.

## First work session

Inventory numeric account/room dependencies and native key storage, finalize phase 1's
protocol and recovery decisions, then implement the smallest offline local identity
creation/unlock slice. Keep existing production authentication operational throughout.

## Implementation checkpoint — 2026-09-28

Experimental implementation now includes identity records and recovery derivation,
encrypted local vault, locking/persistence controller, development-only Profile preview,
shared signed-request admission, mutual peer verification, and mobile/hosted public
record stores. See `identity-protocol-v1.md` for exact choices and remaining constraints.
The shared protocol is synced into Axonic-neuron; no special FirstNeuron authority exists
in this new core. Live production authentication and manual enrollment are unchanged.

438 mobile tests, 13 hosted tests, type checking, and the service dependency check pass,
including ordinary-peer authentication with FirstNeuron absent. Both Android test
emulators received the updated development client with app data preserved. Local
creation, locking, wrong-password rejection, and unlocking after a JavaScript runtime
restart passed on both. Creation and unlocking measured about 1.5–1.6 seconds inside
the emulator apps; these are not physical-phone benchmarks. Temporary test identities
were removed afterward, with the legacy users preserved. Device
testing exposed slow JavaScript scrypt, so Android now uses native Bouncy Castle with
identical parameters and a compatible vault format; independent native vectors pass.
Physical-phone timing and the complete recovery UI remain unverified. Completing
steps 1–3 still requires history/freshness and abuse policy, transport integration and
device validation; the prototype is not ready to replace production authentication.

## Identity lifecycle checkpoint — 2026-09-28

The local identity controller now creates axons without exporting private keys and
owns their cleanup, including sockets waiting for secure randomness. Locking closes
all owned sessions before key destruction. A defensive ceiling of ten owned sessions
also covers pending creation; the normal connection pool still defaults to five.

`identityNetwork.ts` manages the pool across unlock, lock, participation pause and
shutdown. It drives proof renewal, discards candidates on pause and retains canceled
dial reservations until the adapter settles, including across a subsequent unlock.
Its snapshot is available for later Network-screen integration. It requires an injected
bounded transport and a periodic tick; no live transport or discovery is enabled by
this module. The phone transport must buffer early frames within limits until its
listener is attached, because secure randomness is asynchronous.

Validation: 466 mobile tests, TypeScript and service dependency checks pass. New tests
cover real cryptographic controller-owned sessions, immediate lock cleanup, locking
during random generation, delayed dial cleanup and participation/disposal. The hosted
protocol was unchanged in this step. Remaining work: bounded phone transport, runtime
composition and discovery, combined inbound/outbound admission, then real connection
counts in the Network screen and device testing. No production activation occurred.

## Android transport checkpoint — 2026-09-29

Added a development-only, outbound LAN transport in `AxonSockets.kt` and
`nativeAxonTransport.ts`, with a mobile factory ready to inject into the identity
network. Native dialing requires a canonical private IPv4 address on the current
Wi-Fi subnet and binds the socket to that network. Ten slots include connecting
sockets. Backgrounding and module shutdown close all sockets.

Frames use a four-byte big-endian byte length followed by strict UTF-8, capped at
20,000 bytes before native payload allocation. Reads are pull-based and begin only
after the identity listener attaches. Idle reads time out at 30 seconds; partial
frames and writes have four-second absolute deadlines. Incoming traffic is limited
to 64 frames/minute/socket. JavaScript serializes writes with a 40,000-byte/eight-frame
queue cap. These are public signed identity frames, not encrypted conversation data.

This LAN framing is distinct from the hosted WebSocket transport; both carry the
same identity protocol, but cannot connect directly without a matching transport.
No listener, advertisement, automatic discovery or Network-screen counts are enabled
by this change. Next implement bounded inbound LAN admission and identity-based
advertisement/discovery, then compose the runtime and perform device tests. Native
phone testing requires an authorized development-client rebuild/reinstall. Production
builds reject this experimental native dialer.

Validation: 471 mobile tests, ten Android JVM tests (including four new framing/socket
tests), TypeScript and service dependency checks pass. The Android module compiled
successfully. Socket tests use loopback and cover early frames, UTF-8 byte lengths,
allocation bounds, capacity, shutdown and a stalled partial frame. Wi-Fi binding and
Android lifecycle behavior still require device testing. No app was reinstalled.

## LAN runtime checkpoint — 2026-09-29

The development identity preview now owns a complete LAN runtime while its Network
screen is focused. Unlocking starts `_axonic-id._tcp.` advertisement and discovery
using the public cryptographic account ID, independent of legacy contacts/chat rooms.
The lower account ID dials and the higher accepts, avoiding simultaneous duplicate
connections. Claims from discovery and incoming hello frames undergo the same signed
mutual authentication. Connected/authenticating counts come from the live pool.

Native incoming and outgoing sockets share a five-slot budget; the shared pool also
reserves incoming authentication slots. Incoming source addresses never become dial
candidates. Inbound attempts are capped at 16/minute globally and eight/minute/source,
with a ten-second deadline to claim accepted sockets. Discovery tracks at most 32
services, serializes resolutions, refreshes them, and accepts only same-subnet IPv4
peers. Wi-Fi loss, locking, leaving the preview and backgrounding stop participation.

Validation: 474 mobile tests, 21 hosted tests and 11 Android JVM tests pass, alongside
TypeScript, native module compilation, source-drift and dependency checks. The full
discovery-to-authentication test uses a simulated native LAN bridge with real identity
signatures; JVM tests exercise actual loopback sockets and combined slot capacity.
Real Android NSD discovery, Wi-Fi binding, lifecycle/UI behavior and recovery after
network changes remain unverified until the development clients are updated and tested.
No app installation or production deployment was performed. This lane carries identity
proofs only. Production authentication, messaging and FirstNeuron remain unchanged.

## Emulator validation checkpoint — 2026-09-29

With user authorization, rebuilt the x86_64 development client and installed it
over both existing emulator apps. Legacy users 14 and 18 remained signed in. Both
created/unlocked temporary experimental identities and started native NSD advertising
and discovery. The installed emulator is 36.4.9; each virtual Wi-Fi network uses
10.0.2.16 independently. Cross-emulator multicast discovery therefore remains
unverified and requires two physical devices on one Wi-Fi network or a shared-network
emulator setup. No synthetic peer was presented as a discovered remote phone.

A second in-memory test identity connected to the actual native listener within one
emulator. This exposed a real Expo SQLite race: simultaneous first identity pins
could throw `database is locked`. The mobile store now serializes writes across its
instances while retaining transactional compare-and-set checks. The test adapter
now models overlapping writer failure instead of concealing it with its own queue.

After the fix, native mutual authentication passed, the actual Network screen showed
one connected axon, and the proof renewed on the same connection. Backgrounding the
app locked the identity, stopped discovery and closed the axon. Temporary local
test vaults were removed and existing app accounts were preserved. Validation:
475 mobile tests and TypeScript checks pass; the prior 21 hosted and 11 Android tests
passed before this JavaScript-only storage fix. No production changes were deployed.

## Physical-phone checkpoint — 2026-09-29

With explicit authorization, built the ARM64 side-by-side development client, verified
its application ID was `com.axonic.dev`, and updated the connected Samsung phone in
place. The existing development login (user 27) was preserved; `com.axonic` was not
updated. A temporary experimental identity created/unlocked successfully, and Android
registered its `_axonic-id._tcp.` service on the phone's Wi-Fi interface.

A second temporary in-memory identity connected to that phone's native LAN listener
through its own Wi-Fi address. Mutual authentication and repeated proof renewal passed;
the actual Network screen displayed one connected axon. Backgrounding locked the local
identity, stopped discovery and closed the connection. Test vaults, the tracked test
peer's public pin and in-memory peer keys were cleaned up. Existing login was verified
after cleanup. This validates native transport and lifecycle on physical hardware,
not discovery or connectivity between separate devices. Two-phone same-Wi-Fi testing
remains pending. No production deployment or production-account migration occurred.

## Hosted ordinary-neuron runtime prepared — 2026-09-29

FirstNeuron now has a local runtime using the shared persistent-axon protocol and
five-slot connection pool. Incoming WebSocket upgrades reserve capacity before
identity verification; outgoing operator-configured WSS seed peers share that limit.
Unknown cryptographic identities can authenticate without legacy Django/contact
registration. The existing authenticated dashboard reports public identity, axon
count, pool state and record expiry. Existing mailbox routes remain separate.

Host identity keys are generated once in the private data directory (0600), validated
on restart, and never silently replaced on corruption. This unattended OS-protected
storage is not yet the mobile password/recovery vault. Initial records expire after
30 days; automatic renewal and record-history synchronization remain pending.

Validation: 26 hosted tests pass, including real WebSocket runtime admission, claimed
account spoofing, pending-session capacity, persistent identity/corruption, expiry,
and authenticated dashboard fields. All shared protocol files match mobile exactly.
The tested artifact was uploaded, but automatic approval review blocked activation
and the public nginx route pending explicit deployment approval. Live service was
not restarted or changed. No commits/pushes, mobile reinstall or production build.

Next: approve/deploy and verify a real TLS peer; add the mobile WSS adapter to the
same identity pool with LAN preference; test phone-to-host over mobile data and
reconnection; complete identity renewal/history and two-device LAN discovery tests.
Identity axons do not yet carry decentralized chat, contact discovery or call traffic.

## FirstNeuron deployed — 2026-09-29

The user explicitly approved deployment. Installed the tested Node runtime and added
`/v2/axon` to the existing nginx TLS service. Existing private data, account and legacy
keys remain in the original directory. Previous code and nginx configuration are
retained for rollback. Health is OK and systemd reports active.

A temporary ordinary hosted-runtime peer connected over public WSS with trusted TLS,
mutually authenticated, renewed its proof on the same connection, and automatically
reconnected after a real FirstNeuron restart with the same remote cryptographic
identity. HTTPS checks confirmed unauthenticated status requires login, public health
remains hidden, and unsigned legacy mailbox/signaling requests remain rejected.
The temporary test peer was stopped and its in-memory private keys destroyed; its
public identity pin remains on the host as one test record. No real user messages sent.

All 26 hosted tests passed before deployment. Dashboard field/login integration is
locally tested; live authenticated dashboard status was not checked because automatic
review rejected obtaining credentials from the service process environment. No
credentials were accessed by that rejected command.

Next remains mobile WSS integration in the shared LAN-preferred pool, real phone-to-
host testing, record renewal/history synchronization, and cross-device LAN discovery.

## Mobile internet axons prepared — 2026-09-29

The development preview now offers FirstNeuron as an internet candidate in the same
five-slot pool as LAN discovery. The expected cryptographic account is pinned from
the verified host deployment, not a Django user ID. The bootstrap endpoint is an
explicit native/JavaScript allowlist; arbitrary remote advertisements cannot cause
internet dialing. Existing clients without the native function retain LAN-only
behavior and show an update prompt. UI includes the internet connection count.

Added a pull-based native TLS WebSocket adapter: platform trust and HTTPS endpoint
verification, no redirects/cookies/extensions/compression, bounded 8KB upgrade headers,
20KB UTF-8 text messages checked before payload allocation, 32 fragments/control frames
per read, masked client frames, shared socket capacity and bounded connect/read/write
deadlines. Framing follows RFC6455 (https://www.rfc-editor.org/rfc/rfc6455.html).
LAN cleanup now closes LAN sockets only; global app background/destruction still closes
both transports. Failed Wi-Fi startup leaves internet participation active. Existing
shared scheduling prioritizes available LAN candidates; this is not physical hop-count
measurement or a seamless migration of an already established internet connection.

Validation: 478 mobile tests; TypeScript and service-cycle checks; 17 native JVM tests,
including an opt-in live TLS upgrade and bounded hello from FirstNeuron using the new
native socket code. This verifies the real public endpoint from the JVM, not yet full
mutual authentication on Android. ARM64 side-by-side development build succeeded;
metadata confirms com.axonic.dev. No device installation or production build performed.

Next: obtain explicit permission required by AGENTS.md to update the connected phone's
Axonic Dev in place, then test mutual authentication, renewal, reconnect, and background
cleanup against FirstNeuron. Preserve production app and existing device accounts.

## Physical-phone internet validation — 2026-09-29

With explicit approval, installed the prepared ARM64 `com.axonic.dev` APK in place
on the connected Samsung phone. Existing legacy login (user 27) remained intact;
production `com.axonic` was not installed or changed. Metro was reused through USB.

A temporary local cryptographic identity automatically connected to FirstNeuron over
public WSS and mutually authenticated; proof expiry advanced on renewal. Initial
Wi-Fi disabling was undone automatically by the phone, so it was not treated as
cellular evidence. After the user manually disabled Wi-Fi, verified it stayed disabled:
LAN discovery was inactive while the same shared runtime established an internet axon
and renewed its identity proof over mobile data.

Backgrounding locked the identity and removed every pool connection. Returning via
the actual activity (`com.axonic.dev/com.axonic.MainActivity`) and unlocking the same
identity automatically reconnected over cellular. The developer-client deep link can
reload JavaScript; after an earlier reload, the precisely identified temporary test
vault was removed and a fresh test identity created. This was test-harness lifecycle
handling, not an account migration. No real messages were sent.

Removed both owned temporary vaults/secure secrets and the in-memory test password;
verified the preview is empty, LAN inactive, and the existing user still 27. FirstNeuron
retains the corresponding public test identity records. Restored Wi-Fi after testing.
Evidence is in ignored `builds/wss-cellular-evidence.json` and
`builds/wss-cellular-reconnected.json`. No new implementation changes were required.

Next: identity-record renewal/history synchronization before 30-day expiry; wider
app lifecycle participation beyond the development Network screen; then bounded
peer introductions across verified axons. Messaging/calls have not moved to the new
identity protocol yet; cross-device LAN discovery also remains to be verified.

## Identity renewal and bounded catch-up prepared — 2026-09-29

Shared identity code now issues a successor record when seven days or less remain.
Account/root and authorized device keys remain unchanged. Every successor is signed
by the root and links to the previous signed record. A bounded contiguous history
(up to eight predecessors and 8000 UTF-8 bytes) accompanies descriptions and signed
requests. Verifiers validate signatures, ordering, ancestry, timestamps, account
binding, and the existing pin before atomically replacing it with the fresh record.
Expired predecessors prove history only; they never authorize an expired session.
Missing history, conflicting pins, corrupted chains and rollbacks fail closed.

Mobile unlock renews when due and reseals/saves the vault before exposing the renewed
identity. The password is used for that operation only; it is not retained. A phone
left continuously unlocked beyond expiry still fails closed and needs an unlock to
renew. FirstNeuron's local code renews at startup and checks hourly, writes with
atomic replacement, and restarts its identity connection pool only after persistence.
A failed renewal retains the previous record and reports an event. Shutdown stops
renewal and wipes the retained signing/root key buffers.

Validation: 482 mobile tests, 29 hosted tests, TypeScript and service-cycle checks;
shared source parity confirmed. Tests cover missed multiple renewals in both protocol
directions, real SQLite and hosted-file pin updates, expiration, bounded history,
conflicts/tampering, concurrent host renewal, restart persistence and failed saves.
No native changes/reinstallation required for this step. Live FirstNeuron has not yet
been updated with renewal; explicit deployment approval is required. No real account
or wall clock was advanced for testing.

Longer offline catch-up outside the retained window requires paged history retrieval
or explicit recovery; do not silently reset a trusted pin. This bounded inline history
is the first catch-up implementation, not an unlimited history archive. After rollout,
next work is broader app lifecycle participation and peer introductions across axons.

## Renewal deployed and live-verified — 2026-09-29

With explicit approval, deployed the renewal package and restarted FirstNeuron.
Previous release: `/opt/axonic-neuron-before-renewal-20260929`. No proxy changes.
Health passed, systemd is active, and the identity file hash is unchanged: the current
record is not due for renewal. The startup/hourly renewal runtime is installed.

A temporary ordinary peer authenticated at revision 0, disconnected, and reconnected
at revision 3 with signed predecessor history. FirstNeuron accepted that catch-up
over public TLS, and its connection proof subsequently renewed. The test generated
only its own revisions; it did not advance wall clocks or modify FirstNeuron's real
identity. Unauthorized dashboard status, hidden public health and unsigned legacy
mailbox/signaling rejection retained their existing behavior. Test keys were wiped
from memory; the host retains the test account's public pin. Evidence:
`builds/neuron-renewal-live-evidence.jsonl` (ignored). Scheduled root-record renewal
at the seven-day threshold remains covered by simulated-time local tests, not forced
on the live account. No mobile reinstall, production build, commit or push.

## Foreground app-wide identity participation — 2026-09-29

Moved experimental network ownership to the development App root. One reference-
counted runtime owns the LAN/internet pool; the Network screen observes snapshots.
Navigating away keeps an already-unlocked identity participating. Returning to Network
skips vault inspection when already unlocked, preventing an inspection/busy transition
from unnecessarily restarting connections. Unfinished setup/unlock is canceled on
screen departure, and recovery/password UI fields are cleared.

A foreground guard locks keys on background/inactive state and root teardown. It also
rejects late unlocks while inactive and treats unknown startup lifecycle as inactive.
Returning to the foreground never silently unlocks. Runtime and native background
cleanup remain independent defenses. This remains development-only and separate from
legacy production sessions; no background-service participation was added.

Validation: 485 mobile tests, TypeScript and service-cycle checks pass. Tests cover
screen observer removal, inactive/unknown startup, late unlock, cleanup idempotence
and shared runtime ownership. Real phone: unlocked a temporary identity, authenticated
with FirstNeuron, navigated to Chats, and observed proof renewal while staying there.
Repeated Network visits retained the connection. Backgrounding from Chats locked the
identity, stopped LAN and cleared every pool slot; returning remained locked. Existing
login user 27 was preserved; owned test vault and in-memory test password removed.

A full Axonic Dev restart cleared stale Fast Refresh callbacks during development;
no reinstall, native changes, production build, deployment, commit or push. FirstNeuron
needed no update for this phone lifecycle change. Next: bounded peer introductions
across authenticated axons; preserve independent identity verification and route limits.

## September 29, 2026 — signed peer introductions (local verification complete)

The shared mobile/hosted axon protocol now negotiates `introductions-v1`. Authenticated peers periodically request signed observations of the introducer's current direct connections. Reports contain only public account IDs and short expirations: no contacts, addresses, messages, or transitively forwarded reports. Every response is bound to its signed request and the current socket identity. Limits: eight entries per response, eight sources in memory, sixty-second maximum retention, fifteen-second queries and ten-second server rate limit. Source disconnect, lock, and runtime shutdown clear the appropriate reports.

Both the mobile Network preview and hosted dashboard show distinct reported-neuron counts. No introduced account is pinned or added to the connection pool. A future step must add authenticated connection negotiation through an existing peer, retaining independent endpoint validation and mutual authentication. Mobile background execution and production migration remain separate work.

Verification: 490 mobile unit tests, 30 hosted tests, TypeScript checks, dependency-cycle check (119 modules), and byte-for-byte shared protocol parity pass. Tests cover signatures, request/socket binding, replay, floods, lock races, expiry, bounds, old-peer compatibility, and continued proof renewal. A real local WebSocket test with three independent neuron identities verifies reports and disconnect cleanup without Django. FirstNeuron deployment and real-phone validation of introductions are pending explicit deployment authorization; the previous deployed runtime remains compatible.

### Peer introductions deployed and phone verified — September 29, 2026

Explicit deployment approval received. FirstNeuron runs the prepared release; its identity file is unchanged and service health passed. Rollback code: `/opt/axonic-neuron-before-introductions-20260929`. Deployed and local shared-source manifest hashes match.

Live trusted-TLS test: an owned temporary identity on the physical development phone and an independent temporary Node neuron authenticated with FirstNeuron and received each other's signed account report. Both renewed their existing authenticated connections. The phone retained only its configured seed in the dial pool; reports did not add dial targets. Cleanup removed the owned temporary phone vault, cleared its directory/connections, preserved legacy user 27 and restored Chats. A subsequent report removed the disconnected phone from the other neuron's directory. Public dashboard status and health restrictions, plus unsigned legacy exchange/signaling rejection, passed.

The first attempt encountered repeated retries in the long-running development runtime. Removing its owned test vault and cleanly restarting the dev app resolved this without code changes; stale runtime state is suspected, not proven. The fresh-runtime test passed. No production app reinstall/build or messages to real users occurred. Live authenticated dashboard login was not exercised.

Evidence (ignored builds directory): `neuron-introductions-live-evidence.jsonl` (includes the earlier incomplete attempt), `introductions-phone-reports.json`, `introductions-phone-renewed.json`, and `introductions-phone-cleanup.json`. Next: authenticated connection negotiation through an existing neuron, with independent peer verification and bounded signaling, before automatic direct connections to introduced peers.

## September 29, 2026 — signed RTC negotiation and direct identity axons

Implemented `axonSignaling.ts` as a shared phone/host online-only router. Device-signed offer/answer envelopes bind source record, recipient, session, SDP and a maximum thirty-second lifetime. The router verifies source identity and pin continuity, suppresses replay, bounds concurrent verification and memory, and forwards only between currently connected peers. A sender can forward only its own signed traffic; multi-hop signaling and offline queues are not supported. Existing axons negotiate `rtc-signals-v1`; older peers remain compatible.

Added a portable RTC wire adapter and mobile composition. Introduced peers can attempt a data-only RTC link automatically, with deterministic initiator selection and the existing five-axon pool. Nearby native LAN discovery takes precedence. One signed offer/answer includes a bounded candidate set; no trickle ICE, STUN or TURN is configured yet. The RTC link must complete the existing independent mutual identity handshake before being counted as connected. The Network preview displays authenticated direct RTC axons. Locking/background shutdown disposes connections and pending attempts. Private/public route classification for RTC remains conservative (`internet` in the scheduler); it is not a measured hop count.

FirstNeuron uses the identical signing-verification/router implementation. It currently terminates WSS identity axons and forwards setup traffic; this Node host does not yet instantiate a native RTC endpoint. Shared RTC adapter source is mirrored for future host transport integration. Phones can carry out both roles. These new axons still carry identity/liveness and network setup, not production chat or calls.

Deployment: initial auto-review required explicit approval for the new release; user replied yes. The final release was deployed after local native verification. Service health passed and its identity file remained unchanged. Rollback: `/opt/axonic-neuron-before-rtc-signaling-20260929`. Shared manifest hash: `7267bd45b816fbae00f5b89df09864d04c487ef51c02286f44d0bc7c22a5f9a1`.

Verification: 495 mobile tests, 31 hosted tests, TypeScript, service cycle check (121 modules), and exact shared-source parity. A composed three-runtime test covers automatic introductions -> RTC -> mutual authentication -> lock cleanup. Real socket tests cover signed forwarding, replay, and spoofed-source rejection. Native Android testing exposed the installed WebRTC library's empty incoming protocol field (`PeerConnectionObserver.onDataChannel`); the adapter accepts that specific incoming-only case while enforcing the channel label and independent identity proof, with regression coverage.

Live test used TWO TEMPORARY IDENTITIES ON ONE PHYSICAL PHONE, not two separate devices: both connected to FirstNeuron over native WSS, exchanged signed SDP through it, established a real native RTC channel, and authenticated each other. Both FirstNeuron signaling links were then closed; direct authentication proofs continued renewing. All temporary keys were destroyed from memory, sockets/timers closed, and legacy user 27 remained unchanged with an empty experimental vault. Evidence: ignored `builds/rtc-live-connected.json`, `rtc-live-without-relay.json`, `rtc-live-renewed-without-relay.json`, `rtc-native-renewed.json`, and `rtc-final-tests.txt`.

Remaining before broader use: two-device verification, STUN-assisted reachability across separate networks, hosted RTC endpoint support, native receive-allocation/traffic hardening, and production integration. The JS RTC adapter enforces 20 KB application messages and bounded queues after native delivery; this is not a native pre-allocation limit for malicious SCTP messages. Do not present this preview as production-ready or as proof of cross-network connectivity. The live authenticated dashboard login was not exercised.

## September 29, 2026 — two physical phones verified

With explicit approval, updated only `com.axonic.dev` on R3GL10CNS1K from 1.0.41 to the prepared ARM64 1.1.2 APK (SHA-256 `56241F8986A7FE38DD08B751D80B109131C63D8CA1A3BC1ADBA036E944091A2F`) using `adb install -r`. Existing legacy user 22 survived; the other phone R3GYC0H7PMY retained user 27. Production apps were untouched. Both phones were on the same Wi-Fi, at 10.0.0.167 and 10.0.0.172.

Owned temporary experimental identities automatically discovered and mutually authenticated over native LAN while also connected to FirstNeuron. To exercise fallback, the test temporarily suppressed only development LAN discovery; Wi-Fi remained enabled. Both devices then automatically negotiated a real RTC connection through FirstNeuron and completed independent identity authentication.

The first isolation attempt lost the RTC connection; its exact cause was not established. Subsequent warm-development retries also showed authentication failures. Both temporary vaults were cleaned, both development apps restarted cleanly, and temporary closure diagnostics were added for reproduction. The clean run established RTC, renewed its proofs repeatedly, then retained the direct link after both FirstNeuron signaling connections were deliberately closed and their redial temporarily blocked. Final evidence was recorded over sixty seconds after the last FirstNeuron link closed, with each phone holding exactly one connected RTC peer and newer authentication expiry times. Some early connection retries occurred before the stable run; this is a successful controlled test, not a long-term stability claim.

Locking/removing the second phone's owned temporary identity closed the other phone's RTC link as expected. Restored all native test overrides, removed both owned experimental vaults/secrets, stopped sockets, returned both apps to Chats, and preserved users 22 and 27. Temporary diagnostic source changes were reverted exactly; shared source parity and TypeScript passed. Extended the composed-runtime regression to stop the introducing neuron and check four subsequent authentication-renewal periods; it passes.

Evidence (ignored builds files): `two-phones-lan-a.json`, `two-phones-lan-b.json`, `two-phones-rtc-a.json`, `two-phones-rtc-b.json`, `two-phone-rtc-monitor.jsonl`, `two-phone-rtc-final-a.json`, `two-phone-rtc-final-b.json`, `two-phone-rtc-peer-lock.json`. This verifies separate physical devices on one Wi-Fi. Separate-network reachability with STUN, native allocation hardening, long-running reconnection stability, and production integration remain pending. These tests used identity/liveness traffic; no user chat messages or calls were sent.

## September 29, 2026 — separate-network direct RTC verified

Enabled the same fixed STUN URLs already used by the app's existing direct transports for the development identity RTC factory: `stun:stun.l.google.com:19302` and `stun:stun1.l.google.com:19302`. No TURN is configured. This is a mobile JavaScript configuration change; it required neither a native rebuild nor another FirstNeuron deployment. Native ICE still considers local candidates, while native LAN discovery remains preferred.

Live setup: R3GL10CNS1K / legacy user 22 used mobile data (no wlan0 address; cellular rmnet interface present), while R3GYC0H7PMY / user 27 used Wi-Fi (10.0.0.172). Both development apps started cleanly with owned temporary identities. They connected to FirstNeuron, received introductions, automatically negotiated RTC, and independently authenticated their direct connection. Repeated authentication renewal succeeded. The exact selected ICE candidate pair was not captured, so this validates connectivity with STUN enabled rather than attributing success to a particular candidate type.

Both FirstNeuron signaling links were then disconnected and redial temporarily blocked in the test runtime. Five consecutive snapshots over 85 seconds showed exactly one connected RTC peer per phone, no FirstNeuron connection, and proof expiry advancing by more than sixty seconds. The direct link therefore survived multiple renewals across separate networks without the introducing neuron. This demonstrates this Wi-Fi/mobile-network combination; it does not guarantee every NAT/firewall permits direct connections.

Cleanup restored native test hooks and temporary stats instrumentation, removed both owned experimental vaults/secrets, closed test connections, retained legacy users 22 and 27, returned both apps to Chats, and re-enabled Wi-Fi on the second phone. Production apps were untouched. Validation: TypeScript, 495 mobile tests, 121-module dependency-cycle check. Evidence: ignored `builds/cross-network-connected-a.json`, `cross-network-connected-b.json`, `cross-network-isolated-monitor.jsonl`, `cross-network-regression.txt`.

Next priorities: long-running recovery across background/foreground and network changes, native RTC receive-allocation hardening, and routing application traffic over these independently authenticated axons. FirstNeuron's hosted RTC endpoint capability and production identity migration remain separate work. Current tests cover identity/liveness, not chat or calls over the new identity network. STUN and a reachable introducing peer still assist setup; neither relays the established RTC traffic in this configuration.

## September 29, 2026 — foreground recovery and stale LAN fallback

On the two physical development phones, backgrounding user 27 locked the owned test identity and closed its connections. Bringing the app back left the identity locked as intended; explicitly unlocking restored the same account and authenticated LAN/FirstNeuron connections. This does not implement unattended background participation.

A live Wi-Fi-to-cellular transition reproduced a recovery bug: Android discovery on the remaining Wi-Fi phone retained the departed peer's old LAN advertisement, suppressing RTC while LAN attempts repeatedly failed. The mobile LAN composition now remembers failed outgoing LAN routes for a bounded two-minute interval (maximum 128 entries), allowing signed introductions to offer RTC despite a stale advertisement. Existing pool backoff and independent peer authentication still apply. Native LAN remains the initial preference. A healthy RTC connection is not proactively replaced by LAN merely because Wi-Fi returns; route promotion remains future work.

The composed three-neuron regression now covers an advertised but unreachable LAN endpoint, verifies a LAN attempt precedes authenticated RTC fallback, and checks renewal after the introducing peer stops. Validation: 496 mobile tests, TypeScript, 121-module dependency-cycle check, and hosted shared-source parity passed. No native rebuild or FirstNeuron deployment is required for this mobile composition change.

The real-device repeat established RTC automatically after user 22 moved from Wi-Fi to mobile data, with user 27 still on Wi-Fi and the old LAN advertisement still visible. Subsequent snapshots showed renewed authentication on both sides. Evidence is in ignored builds/recovery-fixed-monitor.jsonl; the earlier failing transition is in recovery-transition-monitor.jsonl (its final sample was interrupted by cleanup, so use the preceding complete samples). Tests use temporary identities and identity/liveness traffic only, not user messages or calls.

Final recovery evidence: four consecutive connected samples per phone, with proof expiry advancing more than sixty seconds. Removed both owned test vaults/secrets and returned to Chats, retaining users 22 and 27.

## September 29, 2026 — authenticated promotion to a preferred route

The shared connection pool now attempts a better-ranked route for an already-connected peer using a spare slot. It retains the old authenticated connection until the replacement independently authenticates; then it closes the old connection. Incoming replacements follow the same identity validation and capacity rules. LAN ranks before private routes and internet routes. Equal or worse routes cannot replace a working link.

Both the working connection and pending replacement count against the five-slot limit. A full pool postpones promotion instead of disconnecting a healthy peer. Failed, wrong-identity, timed-out and canceled replacements leave the old connection intact when it is still usable. Pending cancellation retains its reservation until the adapter settles. Existing backoff and the mobile stale-LAN cooldown still apply, so returning to Wi-Fi may wait for that cooldown.

Tests cover outgoing/incoming promotion, identity mismatch, backoff, saturation, late success after cancellation, old-link loss during promotion, and stale callbacks. A three-runtime composition verifies RTC-to-LAN migration with real identity signatures and continued LAN proof renewal after the introducing peer stops. Validation: 501 mobile tests, 31 hosted tests, mobile/host TypeScript, 121-module dependency-cycle check and shared-source parity. FirstNeuron's local source copy is updated; its live service has not been redeployed for this pool change. The existing live service remains compatible and only assists phone-to-phone setup here.

Live controlled check: both physical phones established RTC while native LAN discovery was temporarily suppressed. Restoring discovery promoted both sides to authenticated native LAN and closed their RTC connection; renewed LAN proofs were observed. These are development identity/liveness tests, not production message or call migration. Evidence: ignored builds/lan-promotion-before.jsonl, lan-promotion-restored.jsonl, and lan-promotion-regression.txt.

The subsequent physical network cycle also passed: user 22 left Wi-Fi, both phones re-established RTC, and the existing RTC link stayed authenticated in every recorded post-return snapshot until LAN promotion completed after the two-minute failed-route cooldown. Both sides then reported native LAN and no remaining RTC connection, with unchanged public identities and at most five occupied slots. User 22's Wi-Fi return was verified at 10.0.0.167. Evidence: builds/lan-promotion-cellular.jsonl, lan-promotion-wifi-return.jsonl, lan-promotion-wifi-settled.jsonl; assertions in builds/assert-lan-promotion.cjs. This is a short controlled run, not long-term stability validation.
Cleanup removed both owned experimental vaults/secrets, restored all test overrides, and returned the development apps to Chats. Legacy users 22 and 27 and their local data were preserved; both phones remain on Wi-Fi. Metro runs in offline development mode after the online Expo manifest endpoint returned UnexpectedServerError. No production build, reinstall, commit, push, or service deployment was performed.

## September 29, 2026 — Android RTC receive guard (device installation pending)

Added a pinned, repeatable react-native-webrtc 124.0.7 Android source patch, applied by postinstall and the EAS post-install hook. It validates every upstream source hash before writing and rejects unknown versions, source drift or partial patches. Identity peer connections opt into a native policy; an exported native version method prevents older development binaries from silently enabling unguarded identity RTC. Without the method, the mobile identity runtime retains LAN/WSS but does not create RTC transports. iOS identity RTC is not enabled by this capability gate; no iOS guard is claimed.

For opted-in connections, unexpected or additional incoming data channels are closed on the WebRTC executor before registering a bridge observer. Identity receive handling rejects binary, empty, over-20,000-byte and malformed UTF-8 buffers before constructing React Native events. At most 64 messages per channel per monotonic 60-second window are accepted. Rejection is permanent for that channel and schedules native closure once. Accepted decoding respects ByteBuffer position/limit, including direct and sliced buffers, rather than copying an entire backing array. Legacy chat/call peer connections do not opt into this policy.

This bounds Java decoding/copies and bridge event volume for the identity channel. libwebrtc/SCTP and JNI already hold a buffer before this callback; their reassembly/native allocation is NOT capped by this patch. It also does not provide an acknowledgement-driven hard cap on bytes waiting in the React Native event queue. Those deeper resource limits remain separate work. JavaScript also rejects oversized strings before allocating a TextEncoder buffer, validates SDP length before splitting, and closes on empty/binary/oversized frames or pre-listener queue overflow.

Validation: standalone Java guard tests cover byte boundaries, multibyte input, malformed UTF-8, direct/sliced buffers, permanent rejection and rate windows. Mobile tests: 505 passing; hosted tests: 31 passing; TypeScript and 121-module dependency-cycle check passed. Shared RTC source copied to the local hosted repository, not deployed. Android native compilation passed; side-by-side ARM64 development APK is being prepared. No phone has been reinstalled for this change and no live native abuse test is claimed yet. Evidence: builds/rtc-guard-regression.txt, rtc-guard-hosted-tests.txt, rtc-guard-native-compile.txt and rtc-guard-dev-build.txt.

Prepared APK verified: com.axonic.dev, debug, version 1.1.2, ARM64; SHA256 77619931C14262E114DC195E6B59FF3B74FAA75032C5CA953DF8D5373A0B3BDB. Build succeeded. Installation over the two existing development apps is awaiting explicit user approval under AGENTS.md. Production apps have not been changed. Native guard tests can be rerun with npm run test:rtc-native (requires a JDK).

## September 29, 2026 — native RTC guard installed and exercised on both phones

With explicit user approval, installed the prepared com.axonic.dev ARM64 APK (SHA256 77619931C14262E114DC195E6B59FF3B74FAA75032C5CA953DF8D5373A0B3BDB) using adb install -r on R3GYC0H7PMY and R3GL10CNS1K. Both installations succeeded and native guard version 1 was reported. Existing legacy users 27 and 22 were retained. Production apps were not replaced.

Ran six controlled, real-native RTC cases separately on each phone, using local peer connections and no user chat messages. All twelve cases passed: exact 20,000-byte multibyte text reached JavaScript, the next 20,001-byte frame did not and closed the channel; binary input did not reach JavaScript; a 65-message burst delivered exactly 64 then closed; an unexpected channel label produced no incoming bridge channel; an extra identity channel was rejected while the first remained usable; a non-identity control channel without the guard accepted 20,001 bytes. The sender API always encodes valid UTF-8 for text, so malformed UTF-8 validation remains covered by the Java tests, not claimed as a live-phone injection test.

Evidence: ignored builds/native-rtc-guard-device-results.jsonl, native-rtc-guard-device.cjs and native-rtc-guard-work.txt. Test peer connections are closed in finally blocks. These checks validate the Java/React Native guard, not libwebrtc's earlier SCTP allocation bounds.

Normal two-phone RTC also passed with the native policy enabled: six successive observations per phone showed a direct authenticated RTC connection, and proof expiration advanced on both sides. Temporary development identities, passwords and native test overrides were removed; both apps returned to Chats with legacy users 22/27 preserved. Evidence: builds/lan-promotion-native-guard-rtc.jsonl and builds/assert-native-rtc-guard.cjs. Wi-Fi settings were not changed during this test. FirstNeuron assisted setup using its existing deployment; no server deployment was performed.

## September 29, 2026 — opt-in encrypted development messages over axons

Added optional test-messages-v1 capability to persistent axons. Only peers advertising it can exchange kind=test-message frames. The local identity controller supplies encryption keys internally; they are not exposed to the UI or test helper. X25519 device-key agreement uses the authenticated, currently pinned peer record, HKDF-SHA256 derives a purpose-specific key, and XChaCha20-Poly1305 encrypts each payload with a fresh 24-byte nonce. Associated data binds message kind, random 32-byte message ID, both account/device identities and both connection instance nonces. Recorded packets cannot transfer to a replacement socket. This uses static device DH and has NO forward secrecy or ratchet; it is an experimental transport probe, not the production chat encryption design.

Text is limited to 2,048 UTF-8 bytes. One outbound message per session may await an acknowledgment, with a five-second timeout and no automatic retry. The encrypted acknowledgment contains the digest of the exact received encrypted packet; only a matching authenticated acknowledgment reports success. It means accepted by the in-memory test handler, not durable save/read/user-visible delivery. A lost acknowledgment can leave a delivered message unconfirmed. Replay IDs are kept only for the current connection, bounded to 64; malformed, replayed or rejected test frames close that session.

Mobile participation is development-only, defaults to no allowed test peers, and requires explicit per-peer opt-in. The inbox retains at most 20 test entries and is cleared with peer permissions on identity lock/runtime stop. It does not write chat databases, send notifications or involve real contacts. Existing production chat/call routes are unchanged. FirstNeuron's local shared source and pinned @noble/ciphers dependency are synchronized, but no deployment was performed; the live host does not advertise this optional test capability.

Validation: 510 mobile tests, 31 hosted tests, TypeScript for both projects, and a 122-module dependency-cycle check passed. Tests cover ciphertext confidentiality on the wire, reciprocal delivery/receipts, tampering, receipt forgery, same-/cross-socket replay, payload limits, single pending delivery, lock cancellation, old-peer compatibility, and mobile peer opt-in/inbox clearing. Live physical-phone LAN exchange succeeded in both directions with encrypted acknowledgments and matching test inbox text. Evidence: ignored builds/encrypted-test-message-regression.txt, encrypted-test-message-hosted.txt, encrypted-lan-*.json. RTC and independence checks follow below.

Live RTC checks also passed on the two physical phones. After deliberate LAN suppression, both authenticated RTC and exchanged encrypted test messages/acknowledgments. Both FirstNeuron WSS links were then closed and redial blocked. With exactly one remaining authenticated RTC peer on each phone, a further encrypted exchange succeeded in both directions. Final inboxes held exactly three unique test messages each (LAN, RTC, and RTC without FirstNeuron). Evidence: builds/encrypted-rtc-*-send.json, encrypted-isolated-*-send.json, encrypted-final-*-inbox.json, encrypted-final-*-status.json and assert-encrypted-test-messages.cjs. Both phones remained on Wi-Fi in this step; this does not add a new cross-network claim.

Cleanup restored native test overrides, removed both owned experimental identities/secrets, cleared test-peer permissions and volatile inboxes on lock, and returned both development apps to Chats. Legacy users 22 and 27 were preserved. No native reinstall/build or server deployment was needed for this JavaScript-only checkpoint. Next work is a durable experimental outbox/inbox and precise receipt/retry semantics, with production encryption/key lifecycle design still separate.

### 2026-09-29 — Durable experimental inbox/outbox

Implemented separate SQLite storage for own development messages, stable logical IDs, retry backoff, commit-before-receipt, durable deduplication, conflict rejection and lock-generation cancellation. V2 negotiation prevents old volatile V1 acknowledgments from being mistaken for durable receipts. Explicit peer opt-in remains required after each unlock. Production conversations and third-party offline custody are not connected to this store.

Validation: 518 mobile tests and 31 hosted tests pass; mobile/hosted TypeScript and 124-module cycle checks pass. Real file-backed SQLite tests reopen the database and simulate receipt loss, commit failure, conflicting retries, capacity, and late receipts after locking. Authenticated protocol tests verify delayed commits, fresh encryption of the same logical ID after reconnect, no receipt after failed commit, and V1 capability exclusion. Local hosted protocol sources synchronized; no deployment.

Remaining: device results below; production storage encryption, user-facing test status, full process-restart/lost-receipt device fault testing, and ordinary-neuron temporary custody remain separate milestones.

Device validation completed on users 27 and 22 using owned temporary identities and synthetic text. Both phones persisted outgoing/incoming messages and delivery state. A new message queued while its recipient was locked remained pending across sender lock/unlock; the locked API exposed no rows. After explicit peer opt-in and reconnection over direct RTC (LAN discovery deliberately disabled by temporary test hooks), it delivered with the same ID and exactly one recipient row. Both phones were on Wi-Fi; this is not a new cross-network result. Initial hot-reloaded runtimes failed to connect; a clean development app restart restored the test. That suggests stale runtime state but does not establish its root cause.

All owned test rows/identities were removed, temporary LAN hooks restored, and both apps returned to Chats. Existing users 27/22 and their normal conversations were preserved. Evidence: `builds/durable-*-final.json`, `builds/durable-unlocked-pending.json`, `builds/durable-locked-rows.json`, and `builds/lan-promotion-durable-rtc.jsonl` (ignored local diagnostics). Full phone process termination with a queued message and deliberately dropped receipts is still the next device fault-test milestone; file reopen and dropped-receipt behavior already pass automated tests.

### 2026-09-29 — Physical-device process restart and lost-receipt checks

Completed the next fault-test milestone on both connected development phones (legacy users 27 and 22), with newly generated experimental identities and synthetic messages only.

- Queued a message while the recipient identity was locked. Terminated the sender's Android app process, verified the process was absent, and relaunched the existing development build. The process ID changed, the identity stayed locked, and the message API returned no rows until explicit unlock. Its original pending message ID survived and subsequently delivered.
- Intercepted and dropped one encrypted development receipt after the recipient had committed the message. Paused the sender by locking its identity, terminated/restarted the recipient process, and verified its saved inbox row survived. After unlocking and reallowing the test peers, the original ID retried successfully. The recipient still contained exactly one copy and the sender recorded delivery.
- Existing legacy user IDs remained 27/22. Temporary inbox/outbox rows and identities were removed at completion. Generated test passwords remained in memory only. No application source fixes, rebuilds, installations, deployments or production-message sends were needed.

Evidence: ignored local `builds/durable-fault-device.cjs` harness and `builds/durable-fault-results.jsonl` contain assertions and sanitized results. The receive fault intercepted native Axon writes only for test-message acknowledgments. These tests were on the existing Wi-Fi setup, not a fresh mobile-data/NAT experiment.

Next milestone: design and implement bounded temporary encrypted custody for unreachable cryptographic peers, with recipient-authenticated delivery receipts and deletion after delivery/expiry. FirstNeuron should use the same custody rules as every participating neuron. The current own-message test database is not a relay store or a production encrypted-at-rest vault.

### 2026-09-29 — Shared temporary custody service

Implemented an experimental signed, offline-decryptable envelope and recipient receipt protocol with identical phone/host custody rules. SQLite on mobile and atomically replaced private files on hosted neurons preserve encrypted custody across service restarts. An authenticated Axon capability exposes deposit/poll/receipt/consume without giving FirstNeuron any special authority. Payload deletion follows a verified recipient receipt; receipt consumption leaves only a TTL-bounded digest/routing tombstone. TTL and storage/peer limits are enforced without evicting pending entries. The local identity controller keeps key material private and signs receipts only after own-inbox persistence.

Validation: full mobile suite passed 524 tests, followed by an additional passing controller commit/lock-race test (525 total test cases now). Hosted suite passed 33 tests. Both TypeScript checks, 127-module cycle check, and exact shared-source parity passed. New tests cover ciphertext opacity, wrong keys, forged signatures/receipts, originator-only deposits, immutable IDs, quotas, TTL, disk failure/corruption, optional feature negotiation and commit-before-receipt. Three real local WebSocket participants deposited while the recipient was absent, restarted the hosted custodian, fetched/decrypted, verified the receipt and removed the payload. This is a local integration test, not a new deployed FirstNeuron/physical-phone custody claim.

Next: persist and reuse the sender's sealed envelope, automatically choose a connected custodian only when direct delivery is unavailable, retrieve and validate offline messages/receipts, and expose separate queued/held/delivered states. The custody protocol is now available in development; that automatic fallback is not yet connected to normal or experimental message queues. No deployment, reinstall, production build, commit or push was performed.

### 2026-09-30 — Automatic custody fallback and FirstNeuron deployment

The user explicitly authorized deploying FirstNeuron whenever needed while continuing this work. This covers FirstNeuron code deployments, not unrelated production builds/reinstalls or backend deployments.

Implemented automatic development-queue fallback after direct delivery fails, persistent/reused encrypted envelopes, locally ranked custody-capable peers, full-relay fallback, automatic offline retrieval, verified receipt processing and receipt consumption. Held and delivered remain distinct. Lock/background generation checks and explicit per-unlock test-peer permission remain in place.

Validation: full mobile suite passed 527 tests, then focused final checks passed including an additional full-relay fallback case (528 total cases). Hosted suite passed 33 tests, both TypeScript checks passed, service cycle check passed for 129 modules, and source parity passed. Courier tests cover envelope reuse after recreation, receipt-loss recovery, rejection of relay-only delivery claims, expiry/no resealing, lock cancellation and full preferred custodian fallback.

Deployed FirstNeuron with rollback `/opt/axonic-neuron-before-custody-v1-20260930`. Artifact SHA256 `8ab1f5c0de39e028342d45bb8ed084927b73a66854748a7d358cb5c3fd521a17`; deployed/local shared manifest SHA256 `18b220bf6075188c99c608baf4aa17815b1731cd9553668ac962e0814f2668e5`. Service active, internal health OK, unauthenticated public dashboard API returns 401, custody file mode 0600 owned by service user. Identity file hash remained unchanged. The shared upgrade also includes previously tested pool promotion and direct-message protocol compatibility changes.

Live validation used the two physical development phones (legacy accounts 27/22), newly generated temporary identities and synthetic traffic. The recipient was locked/offline when the sender automatically selected FirstNeuron and deposited. Then the sender was locked/offline while the recipient automatically fetched, decrypted and saved the message. The custodian replaced the payload with its signed receipt. Then the recipient was locked/offline while the sender fetched and verified that receipt, marked delivery and consumed it. FirstNeuron retained only the expiry-bounded digest/routing tombstone. Existing production conversations were untouched; temporary local identities, own inbox/outbox and sealed envelopes were cleaned up. Evidence: ignored `builds/courier-live-results.jsonl` and `builds/courier-live-device.cjs`.

Next: expose useful queued/held/delivered and connection diagnostics in the development Network screen, then broaden failover/multiple-custodian/device scenarios. This remains a development identity-network messaging path; normal production chat has not been migrated.

### 2026-09-30 — Allow axons control and Network status

Added the first Network-screen option `Allow axons: 5`, with accessible minus/plus controls, phone range 3–10 and per-device AsyncStorage persistence. It updates the active identity pool immediately and initializes future sessions with the saved limit. The local identity preview denominator now uses the real limit. Added development identity-network counters for queued, held, delivered and relay-expired outgoing messages below the setting.

FirstNeuron's dashboard uses default 10 and range 5–20, validates authenticated origin-checked updates and persists them in its data directory. The shared pool ceiling is now 20; phone validation remains capped at 10. Decreasing the cap retires surplus connections and preserves reservations for canceled in-flight handshakes until they settle, preventing an overlapping capacity bypass. Increasing the cap permits more connections without restarting the pool.

Validation: 531 mobile and 33 hosted tests passed; TypeScript and 130-module service cycle check passed. Physical user-27 development phone showed the control first; tapping plus saved 6 and changed the live runtime limit to 6. Restored the default 5 afterward. Existing accounts remained intact and no reinstall/production build occurred.

FirstNeuron code deployed with rollback `/opt/axonic-neuron-before-axon-settings-20260930`; internal health active and identity unchanged. Deployed/local shared-source SHA256 `1cfaa49a76a355628db753e11a99d4e9c127c3e0b0d225eecbb99c8a535a3621`. With explicit user approval, the proxy now allows `/api/network` and raises the per-public-IP Axon ceiling from 5 to 20; the saved application pool limit still applies. Nginx configuration validation and reload passed. Live unauthenticated POST returns 401 and wrong-origin POST returns 403; authenticated Save/persistence is covered by local HTTP tests, not a live authenticated Save test. Proxy rollback: `/etc/nginx/conf.d/neuron-https.conf.before-axon-settings-20260930`. FirstNeuron has no saved override and uses default 10.

## September 29, 2026 — four-device failover validation

Passed the controlled LAN failover test using both physical development phones and both emulators. All four initially formed an authenticated mesh. FirstNeuron connections were then blocked on these test devices, without stopping the hosted service. The receiving phone was locked; an ordinary emulator accepted the sender's encrypted message. When that custodian was locked, the sender moved the identical envelope to the other phone. The recipient unlocked, retrieved through that LAN custodian with direct RTC disabled, and stored one message. The sender verified delivery and consumed the receipt; the backup retained no payload. Cleanup succeeded on all four devices, preserving existing accounts and conversations.

Fixed preferred-custodian starvation after null, thrown or malformed responses, with backoff longer than the maximum outbox retry interval. Added tests for those failures, immutable envelope reuse, returning duplicate custody, and verified cleanup at both custodians. Repeated native SQLite handle failures during device testing were addressed by retaining a module-level opening promise per identity database and bypassing the native cached connection on initial open. Factory recreation retains one connection and isolates owner rows. The successful live run, including cleanup, had no recurrence.

Validation: 536 automated mobile tests passed, TypeScript passed, and service dependency checks passed (130 modules). Correct x86_64 side-by-side development clients were built and installed on the two authorized emulators, preserving their data. No production build or FirstNeuron deployment was performed for these mobile-only fixes.

Limits: successful live failover depended on a reachable LAN peer and an already established network. An earlier cold rejoin with only an emulator behind virtual NAT available timed out; arbitrary internet bootstrap-free discovery is not established. The original offline custodian's copy awaits its return or expiry; automatic tests cover returning duplicates and receipt cleanup, but the successful live run did not bring that custodian back. Sender-offline retrieval through FirstNeuron was validated previously; this run kept the sender online and blocked direct RTC to the recipient.

Evidence: ignored builds/four-neuron-results.jsonl, successful message d13f5cf7e2a78b5a084166a3da5fef9cf531ebb7b0d7967df0ac17a4c06b4fc5; builds/failover-regression.txt. The rollout requirements and remaining normal-chat integration are in docs/neuron-production-delivery.md. Django authentication remains unchanged; production conversation delivery on the new cryptographic network is not enabled yet.
