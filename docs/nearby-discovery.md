# Nearby Wi-Fi discovery (development experiment)

Status: two-phone local messaging and automatic recovery verified in development
builds. Application E2EE is deferred at the user's request. This is not
authenticated decentralized identity.

## Scope and behavior

- Android 13+ only, development builds, existing cached direct conversations.
- Axion-assisted P2P accepts cached direct conversations anywhere in the foreground
  app, including a fresh launch on the chat list. Navigation does not reset those
  sessions. Backgrounding, calls, account changes and actual block-list changes
  still cancel sessions; new offers and incoming messages validate cached peers.
- Native LAN discovery still advertises one room. Opening a conversation starts
  discovery automatically; leaving it for the chat list or other non-chat screens
  retains that room's scope until a different conversation is opened. The scope
  is cleared on account changes/process restart. This is not all-contact LAN discovery.
- Wi-Fi startup failures back off to at most one retry per 30 seconds. With a
  discovered peer, a single recovery task checks the local text outbox every five
  seconds and retries at most 20 eligible rows per pass using their original IDs.
- Android NSD advertises `_axonic-dev._tcp.` on one Wi-Fi network. It publishes an
  ephemeral endpoint ID, protocol version, claimed account ID and SHA-256 room
  scope. This exposes discovery metadata to that local network; it is not secret.
- Discovery is automatic within that scope. Sending the first text establishes a
  WebRTC data channel using length-prefixed JSON signaling over Wi-Fi TCP sockets.
  This path does not call Axion or use STUN/TURN. Subsequent sends reuse the peer.
- TCP carries only setup frames, not message payloads. Messages use the existing
  P2P persistence/receipt/deduplication path. Ordinary fallback remains available.
- The native implementation rejects release builds, requires active Wi-Fi IPv4,
  binds its listener/outgoing sockets to that network, and stops on background,
  network loss or address change. It bounds frame size, worker queues, discovered
  endpoints and signaling rate. It validates room/target/endpoint/source address.
- LAN identity claims are not cryptographically verified. This remains a
  development experiment for known test devices on a trusted local network. Block checks
  use local cached state. Server-side authorization is absent from this path.
- Current Android target SDK is 36. A future move to target 37 requires addressing
  Android's local-network runtime permission before enabling this feature there.
- IPv6-only Wi-Fi, iOS, public discovery, unknown contacts, new accounts, calls,
  attachments, offline relays and background discovery are outside this step.

## Validation completed

368 JS unit tests pass, including cancellation during lookup, concurrent starts,
startup failure, recovery cancellation/backoff, unchanged block-cache refreshes,
offline outbox retry and account changes during transport fallback.
Automatic initial activation and host-first selection have unit coverage.
Two-phone no-toggle and host-address runs are described below.

TypeScript and the 90-module service dependency check pass. Android ARM64 and
x86_64 debug APKs compile, and native autolinking includes AxonicNearbyModule.
The development control and native module are installed on the phone and both
emulators, with existing accounts and messages preserved (user-authorized update
on 2026-09-27). The phone's separate release app was left intact.

Prepared artifacts (ignored local builds):

- `builds/Axonic-Dev-nearby-1.0.41-arm64-20260927.apk`: `com.axonic.dev`, Axonic Dev.
- `builds/Axonic-nearby-1.0.41-x86_64-20260927.apk`: `com.axonic`, emulator debug.

Future installations require explicit user authorization under project instructions.
Use replacement installation preserving data; never uninstall the release app.
The phone must join the same Wi-Fi as the other test peer. Emulator multicast
reachability depends on its virtual network; a discovery failure there alone
cannot establish whether two physical devices can discover each other.

## Route preference

Current text delivery order:

1. Discovered LAN peer with local TCP signaling and no STUN/TURN.
2. Axion-assisted WebRTC with no STUN/TURN, testing addresses available on the
   device's interfaces. This includes private/provider/VPN addresses only when
   the platform exposes them and the peer can route to them. Public host IPv6
   addresses may also appear; this is not a private-IP filter.
3. Axion-assisted WebRTC with configured public STUN services.
4. Existing Axion text delivery.

A send made before LAN discovery finishes can use fallback. Existing ready
sessions are reused. Fresh host-only attempts get 1.5 seconds to open; ordinary
attempts get 3 seconds. The combined Axion-assisted attempt has a 7-second hard
deadline including lookup and peer-storage receipt. The LAN runtime retains its
existing 5.5-second bound, so the full sequential path can take longer.

Both updated peers acknowledge `a=x-axonic-host-only:1` in SDP. The extension is
removed before native SDP processing. Unacknowledged preferences (older clients)
close and fall back to a fresh ordinary session. Backend signaling already
preserves SDP, so no backend deployment or native rebuild is required.

This does not discover peers independently of Axion outside the LAN. There is
no subnet scan, stored private-IP directory, shortest-hop guarantee, or latency
comparison between routes. Provider isolation and VPN configurations still need
real network testing; a private IP alone does not prove peer reachability.

## Automatic startup and host-address validation — 2026-09-27

Both physical phones (PC/22 and Chaty/27) loaded the JavaScript changes without
reinstallation. Opening their existing test chat started discovery without any
call to `nearbyText.start()` or Enable action. With Axion temporarily disconnected,
bidirectional text succeeded, discovery paused in the background, and queued text
recovered automatically on return while Axion remained disconnected.

With Nearby delivery temporarily bypassed, two additional messages used an
Axion-assisted host-only session. Native WebRTC stats on both phones reported a
selected host/host pair over private Wi-Fi addresses (16 ms measured round trip).
The sender recorded `attempt_host` and peer-storage receipts; no internet attempt
was allocated. This verifies the mechanism on LAN, not an ISP or VPN topology.

Fault injection dropping host-only offers forced a fresh ordinary attempt, which
delivered two further messages with peer-storage receipts. Its selected path was
still private Wi-Fi; this verifies fallback behavior, not public NAT traversal.
All temporary instrumentation was restored after each test.

The no-toggle Wi-Fi off/on test also passed: queued text reached delivered while
Axion was still disconnected. Across background recovery, Wi-Fi recovery,
host-address success and forced host-failure fallback, all 14 messages were
present exactly once in both local databases, all read after reconnection;
both databases passed `quick_check`. Wi-Fi and normal Axion connections are
restored, automatic discovery remains active, and temporary test globals are gone.

Ignored local evidence: `autostart-{background,wifi}-evidence.json`,
`host-{first,fallback}-evidence.json`, and `host-db/` under `builds/`.

## Live results — 2026-09-27

- Native module availability verified on phone `R3GYC0H7PMY` (user 27),
  `emulator-5554` (user 18), and `emulator-5556` (user 14).
- Phone joined Wi-Fi at `10.0.0.172`. Phone and emulator-5556 successfully
  registered their room-scoped NSD services. Phone resolved the emulator's
  announcement and reported one nearby peer; the emulator did not discover the
  phone. The advertised emulator address was `10.0.2.16`, outside the phone LAN.
- Both emulators run version 36.4.9 and have the same private Wi-Fi address,
  `10.0.2.16`. A fresh discovery test between their cached test accounts, after
  clearing P2P sessions and interrupting Axion, found no reciprocal peers within
  30 seconds. The harness aborted before sending any messages and restored Axion.
  Android documents shared emulator Wi-Fi starting with version 36.5:
  [emulator interconnection](https://developer.android.com/studio/run/emulator-networking-interconnect).
- Phone Wi-Fi loss disabled Nearby. After Wi-Fi reconnection, Nearby could start
  again. Backgrounding disabled it and removed all of this app's native NSD
  requests. The development app was returned to the foreground.
- Cleanup confirmed Axion ready on all three devices, Nearby off, no remaining
  outage override, and debugger test helpers removed. Phone Wi-Fi remains on.
- Fresh LAN signaling and message delivery without Axion are **not verified**.
  Next acceptance run needs two physical Android devices on the same reachable
  Wi-Fi, or a separately validated shared emulator network. Do not interpret
  one-way discovery as successful connectivity. No production outage was induced.

## Two physical phones — passed 2026-09-27

Added the second phone `R3GL10CNS1K` on the same LAN (`10.0.0.99`) with the
separate development build. User signed in as PC (user 22); first phone remained
Chaty (user 27, `10.0.0.172`). Created and cached their direct test conversation
`8718e58d-c1d2-4e0b-911f-4608eb273759` using normal connectivity before the test.

- Cleared existing P2P sessions, disconnected Axion on both phones and temporarily
  blocked Axion reconnects with automatic restoration. Enabled Nearby afterward.
- Both devices discovered one peer. Simultaneous sends established fresh nearby
  sessions `a0780802-384c-431f-b131-634c91eb232f` and
  `5f3b8f13-a1b4-4ee9-9c1a-c425a0486dba`. Axion readiness remained false before
  and after both sends. Native LAN signaling and host-only WebRTC were used.
- PC message `c2941a10-0599-4c21-bebb-8236b71bfc82` and Chaty message
  `cf44119a-98ec-49af-a5a3-463a8d002a4f` received `nearby_peer_stored`
  acknowledgments; receiver logs confirm P2P persistence.
- Resetting Chaty's sessions with Axion still unavailable left message
  `e62d9743-00c9-4d2d-833c-5d96ce9501d7` queued. It recovered after Axion returned.
- Both local message databases passed `quick_check`; all three IDs have exactly
  one row on each phone and were marked read after recovery.
- Normal Axion readiness restored, Nearby stopped, temporary test helpers removed.
  Both regular release apps and existing data were preserved.

This verifies fresh nearby connection setup and bidirectional text without Axion
between two physical devices on this LAN. It is not an all-backend outage test:
login and initial contact/room setup still used the backend, and internet access
was not disabled. Public identity authentication, background delivery and calls
over the nearby path remain outside this milestone.

Local evidence: `builds/two-phone-nearby-evidence.json` and the two
`builds/*-nearby-log.txt` files. Lifecycle checks above cover Wi-Fi loss and
background cleanup; leaving a room during an active two-phone transfer remains
an additional resilience check.

## Router-blocked internet test — passed 2026-09-27

User blocked WAN access for both phones while retaining Wi-Fi/LAN access. Mobile
data was disabled on both phones and confirmed off. Metro/debugger remained
reachable over USB; neither discovery nor message signaling used that connection.
Cleared existing peer sessions before starting Nearby. No WebSocket override was
used in this run. Unauthenticated, cache-busted HTTPS probes to the API health
endpoint and Google's generate_204 endpoint timed out on both phones before and
after delivery; Axion readiness remained false throughout.

Both phones discovered each other and established fresh host-only WebRTC sessions
`d16e2a6b-1266-49ea-9f54-4151052c7fc9` and
`ab75b846-911e-4e6a-8442-2fed1b94a0ab`. Simultaneous messages
`f038c0e4-9114-4106-8305-c8640e4b02f2` (Chaty) and
`9b595609-d576-4902-a9c1-ab7b458b78e1` (PC) received nearby storage acknowledgments.
Both databases passed `quick_check` and held exactly one copy of each message.
Sender records were delivered; recipient records were read locally. Remote read
receipt synchronization was not established during this offline test.

After closing Chaty's peer sessions, message
`d1a530ff-0e9b-4416-9ca9-db1bb1f0ea77` remained pending only on Chaty's phone, with
no receiver copy. This is expected while both direct transport and internet are
unavailable. After the user restored internet access, recovery was verified:
the queued ID exists exactly once on both phones and is marked read. The two
offline-delivered message IDs also remain unique and now show read on both phones.
Both recovery snapshots passed SQLite `quick_check`.

Nearby was stopped and debugger helpers removed. Mobile data was restored to its
original enabled setting after evidence capture. User subsequently removed the
router blocks; Axion readiness was confirmed on both phones and both emulators,
with Nearby off and no outage overrides. Evidence:
`builds/two-phone-offline-evidence.json`, `builds/*-offline-log.txt`, and ignored
`builds/offline-db/` and `builds/offline-recovery-db/` snapshots.

This proves fresh discovery and bidirectional local text with WAN unavailable for
these two already signed-in accounts and a cached chat on this LAN. Offline login,
new-contact setup, process restart, calls, and production identity verification
remain separate work.

## Lifecycle interruption tests — passed with manual re-enable, 2026-09-27

Tested backgrounding Chaty, leaving its direct chat, and disabling/re-enabling its
Wi-Fi, one scenario at a time. Both physical phones retained the same accounts
and cached room. Each scenario began with new nearby sessions and Axion temporarily
disconnected using the existing automatically restored debugger harness. These
were Axion-interruption tests, not repeat router-blocked WAN tests.

In all three scenarios:

- Nearby stopped on the interrupted device. Background/room exit cleared its
  active room; Wi-Fi loss reported `Wi-Fi disconnected`.
- A new PC message while the peer was unavailable returned queued.
- Returning to the foreground/chat or reconnecting Wi-Fi left Nearby disabled.
  Explicitly enabling it again on both phones restored reciprocal discovery.
- New messages then delivered in both directions before restoring Axion; all
  12 before/after sends across the scenarios have nearby storage acknowledgments.
- After Axion restoration, all 15 messages (including the three queued messages)
  existed exactly once in each phone database, all marked read. Both SQLite
  integrity checks passed. This does not establish automatic offline retry of
  the queued messages solely from rediscovery.

Normal Axion readiness was restored on both phones; Wi-Fi remained enabled,
Nearby was stopped, and test overrides/helpers were removed. No application code
or native build changed for these tests. Evidence is in ignored
`builds/lifecycle-{background,wifi,room}-evidence.json`,
`builds/*-lifecycle-log.txt`, and `builds/lifecycle-db/`.

One Wi-Fi reconnection briefly reported two discovered endpoints for the single
peer. Delivery succeeded, but stale advertisement handling deserves follow-up
before automatic reconnection is introduced. Other remaining work includes
automatic foreground resumption and local outbox retry after peer rediscovery.
Tests interrupted established sessions between sends; interruption during message
persistence and process termination remain separate stress cases.

## Automatic recovery — implemented and verified 2026-09-27

`nearbyRecovery.ts` preserves session-only consent for the original account/chat,
pauses native discovery when ineligible, retries startup with bounded backoff,
and invokes the existing chat outbox send path through a composition-root hook.
The outbox task excludes deleted, non-text and already delivered rows, checks
ownership/context after async reads, and reuses the send lock and receipt logic.
No new message IDs or parallel recovery workers are created.

Live testing identified and fixed two issues: refreshing an identical block-list
object incorrectly cleared consent; native discovery could select a stale closed
port after Wi-Fi loss. Native signaling now evicts failed endpoints and tries
other known endpoints, and resolution explicitly chooses IPv4 from Android 14+
address lists. The rebuilt ARM64 client was installed on both phones preserving
data: `builds/Axonic-Dev-nearby-recovery-arm64-20260927.apk`. Emulator APKs have not
been rebuilt for these native changes.

All three final live scenarios passed: background/foreground, Wi-Fi off/on, and
chat exit/reentry. Each automatically rediscovered the peer without another
Enable action and delivered its queued message while Axion was still down:

- Background: `4a11e718-06cc-420f-9547-1324af1fe1c5`.
- Wi-Fi: `77b6bda0-2289-4b8e-82bf-01b0a0c93170`.
- Room reentry: `4d9c55eb-e438-4c40-8d22-71936ac63e21`.

All 15 final-run messages (before, queued and after in each scenario) have nearby
storage acknowledgments and exactly one row on each phone. Both databases passed
integrity checks; all rows were read after Axion restoration. Earlier failed-run
evidence is retained separately in ignored build files. The tests simulated
Axion loss; the router-wide internet block was not repeated for this revision.

350 tests, TypeScript, the 90-module cycle check, and the ARM64 native build pass.
Normal Axion restored, Nearby stopped and its consent cleared on both phones;
test helpers removed. Recovery remains foreground-only and does not survive
process termination. A raw discovered-endpoint count may temporarily include
stale advertisements; failed connection attempts now discard those endpoints.

Evidence: `builds/automatic-{background,wifi,room}-evidence.json`,
`builds/*-automatic-log.txt`, and `builds/automatic-db/`.

## Live acceptance procedure

1. Verify two known test accounts, same cached direct room, same Wi-Fi, no call.
2. Clear existing P2P sessions and temporarily interrupt Axion on both devices
   with automatic restoration, as in the previous outage test.
3. Enable Nearby on both. Verify reciprocal discovery and native module status.
4. Send in both directions. Require `nearby_session_*` and `nearby_peer_stored`
   diagnostics, no Axion-assisted setup, and exactly one database row per message.
5. Test simultaneous sends, leaving the room, Wi-Fi loss and backgrounding.
   Confirm sockets/discovery close, and unavailable delivery remains queued or
   uses the existing fallback with the original message ID.
6. Restore normal networking, disable Nearby, and verify existing Axion behavior.

References: [Android NSD](https://developer.android.com/develop/connectivity/wifi/use-nsd),
[NsdManager network scoping](https://developer.android.com/reference/android/net/nsd/NsdManager).

## Wi-Fi to cellular validation — 2026-09-27

Confirmed PC/22 on Wi-Fi (R3GL10CNS1K) and Chaty/27 on cellular only
(R3GYC0H7PMY), with the same topology verified again after the run. An initial
2-message run selected cellular but Chaty rejoined Wi-Fi during that run; it is
retained as provisional evidence, not the isolated-network acceptance result.

The confirmed run delivered two messages directly in opposite directions. The
1.5-second host-only attempt did not open; the STUN-enabled attempt succeeded.
Native selected-pair stats reported IPv6, Wi-Fi srflx/cellular host (reverse on
the other device), not a relay candidate. Sender-side test timings were about
3.0 seconds including initial setup and 1.0 second for the reverse send, including
debugger overhead. Peer-storage receipts verified direct delivery.

Then Axion was disconnected and reconnect temporarily blocked on both phones.
Two more messages succeeded with Axion readiness false and matching peer-storage
receipts. This proves the existing connection survives signaling loss on this
network pair. It does not prove a fresh connection can be established without
Axion, IPv4-only NAT traversal, or provider-private/VPN reachability.

All 6 messages (2 provisional + 4 confirmed) were present exactly once in both
local databases and both databases passed quick_check. Evidence is in ignored
builds/cross-network{,-confirmed}-evidence.json. Test hooks were removed and
normal Axion restored. Chaty remains on mobile data as requested; PC remains on
Wi-Fi. No application code, deployment, or installation changed in this test.

## Cellular-to-cellular validation — 2026-09-27

At the user's request, both physical phones used mobile data with Wi-Fi off.
Android network reports before and after confirmed only cellular connections on
both test phones. The user identifies both subscriptions as Xfinity; this test
makes no inference about the carrier's internal routing from that branding.

Two bidirectional messages succeeded. The host-only attempt failed to open within
its 1.5-second window; the STUN-enabled attempt selected an IPv4 srflx/srflx pair
on cellular interfaces. Neither selected address was in RFC1918 or carrier-shared
100.64/10 space. Native measured RTT samples were 104 ms and 94 ms. No relay
candidate was selected. First send took about 3.5 seconds and reverse send about
0.9 seconds, including debugger overhead.

With the established session kept open, Axion was then disconnected and reconnect
blocked temporarily on both phones. Two more bidirectional messages succeeded
with Axion readiness false and matching peer-storage receipts. All four messages
were present once in both local databases, all read after reconnection; database
quick_check passed on both. Axion restored, temporary hooks removed, Wi-Fi left
off on both as requested. No app code, installation, or deployment changed.

This validates direct IPv4 cellular-to-cellular connectivity for this network
pair. It does not establish a reachable carrier-private address path, prove that
such a path is impossible with a longer check, or reveal whether public-address
packets stay inside the carrier's network. Fresh setup still requires Axion.
Ignored evidence: builds/cellular-pair-evidence.json.

## Foreground participation outside chat screens — 2026-09-27

Moved the assisted runtime's eligibility from the open screen to the requested
cached room plus current foreground account. Connections remain room-bound:
ready sessions for the same peer cannot be reused for a different room. Cached
membership is checked before new sessions and again before receiving persistence.
Native single-room LAN discovery remembers its last selected scope across
non-chat navigation. Background, calls, account changes and block changes retain
teardown behavior. Production flags remain unchanged.

All four existing installations loaded the JavaScript changes without reinstall.
Both emulator users (18/14) and physical users (22/27) remained on their chat lists
with activeRoomId null. Each pair exchanged two direct messages, then two more
with Axion temporarily disconnected. Native candidate-pair stats and peer-storage
receipts confirmed direct delivery. All eight messages were stored once and
remained unread while their conversations were unopened; unread badges updated.

The phones then temporarily rejoined Wi-Fi, opened their known test conversation
for automatic LAN discovery, and both returned to the chat list. Two fresh direct
messages succeeded with Axion disconnected. Final database snapshots contain all
ten distinct messages exactly once on the intended endpoints and pass quick_check.
Axion restored, test hooks removed, phones restored to cellular-only, accounts and
data preserved. Both emulators remain on their existing network.

368 unit tests, TypeScript and the 90-module service-cycle check pass. Evidence
is under ignored builds/foreground-{phones,emulators,lan}-evidence.json;
foreground-db preserves the initial unread assertions, foreground-final-db the
final integrity/count checks. No native build or backend deployment was needed.

The encrypted three-device store-and-forward demonstration is NOT implemented.
The installed JavaScript runtime has no crypto/getRandomValues/subtle API and
expo-crypto is absent. A reviewed cryptographic library with platform-backed
randomness and protected identity keys is required before third-party storage.
The mailbox also needs authenticated/pinned recipient keys, ciphertext-only
bounded durable storage, expiry, fetch authorization, and recipient-signed
receipts distinct from custodian-storage receipts. Background/closed-app service,
network-wide discovery and replication remain separate future work.

### Encrypted mailbox implementation prepared — 2026-09-27

The next development slice is now implemented in the isolated mailbox protocol,
SQLite store, composition, and Android crypto extension. See
[mailbox-prototype.md](mailbox-prototype.md) for the exact protocol, trust model,
limits, artifacts and pending four-device procedure. The earlier paragraph above
describes the state before this implementation; live device validation is still
pending explicit permission to install the prepared native development updates.

383 mobile tests, four native JVM crypto tests, TypeScript and the 93-module cycle
check pass. Both APKs compile and have the expected package IDs and architectures.
All four devices are connected. Mailbox participation is disabled until explicitly
paired/enabled through the development entry point. No deployment or reinstall
occurred. Normal Send-button mailbox fallback, background participation, native LAN
mailbox discovery and distributed bootstrap remain future steps.

### Mailbox device test completed — 2026-09-27

User approved installation and all four development apps were updated in place.
The encrypted mailbox test passed: offline recipient, durable custodian restart,
delivery while sender was stopped, signed receipt forwarded after recipient was
stopped, wrong-device decryption rejection, forged-receipt rejection and duplicate
suppression. See mailbox-prototype.md for the exact topology and evidence. Both
phones remained cellular, all databases passed integrity checks, and all apps were
restored to signed-in foreground chat lists with Axion connected. Test mailbox
participation is stopped. This supersedes the pending-installation status above;
normal Send-button integration and serverless bootstrap remain unimplemented.

### Normal Send-button integration completed — 2026-09-27

The next slice now integrates the paired mailbox with normal plain-text sending:
direct P2P first, encrypted custody next, Axion fallback last. Custody retains the
pending bubble; recipient-signed receipts update it to delivered. The actual phone
Send-button test passed through sender/recipient restarts with the original ID and
timestamp. 395 mobile tests and all eight device database checks pass. See
mailbox-prototype.md for evidence and remaining limitations. This supersedes the
previous paragraph's Send-button status; general discovery and serverless bootstrap
are still future work.

### Hosted custody route verified — 2026-09-27

FirstNeuron (user 34) now runs the same mailbox engine in a restricted Node 22
service. The optional pinned hosted transport supports normal outbox custody and
signed recipient receipts without an Axion chat/signaling route to the custodian.
Emulator tests passed with each endpoint stopped in turn and the host restarted.
398 mobile tests and six hosted tests pass. See mailbox-prototype.md.

This test uses an SSH development tunnel, so public discovery/reachability is still
unimplemented. The next deployment step is a public HTTPS peer endpoint; general
peer introductions, automatic pairing restoration and live relay follow separately.
