# Axonic app modules

The active identity-based app uses five module boundaries. The original screens,
styles, local schemas, cryptographic formats and network protocols are retained.
This is a code-organization change, not an account migration or a new interface.

| Module | Public entry | Owns |
| --- | --- | --- |
| UI | Existing `screens/`, `components/`, `navigation/`; native selectors in `modules/ui/` | Rendering, user input, camera/gallery/file selection, microphone recording, permission prompts |
| Messaging and calls | `modules/messaging/index.ts`, `notifications.ts` | User commands, message IDs, group commands, call readiness, outbox scheduling, attachment staging and notification workflows |
| Network | `modules/network/index.ts` | Participation lifecycle, connection settings, discovery inspection and network diagnostics |
| Identity and security | `modules/identity/index.ts` | Creation/recovery, local unlock, biometric/session policy, identity presentation and backup confirmation |
| Local storage | `modules/storage/index.ts`, `chatStore.ts` | Own chat persistence, call history, own downloaded files and local profile photos |

`src/composition/neuronRuntime.ts` is the composition root: it wires the existing identity,
transport, custody, directory, call and attachment implementations together. It
also owns the shared foreground/headless runtime leases. It is not imported by
screens. Keeping that integration in one place prevents each screen from creating
its own connection or background worker.

## Commands and delivery

Screens call `messaging.sendText`, `act`, `markRead`, `createGroup`, `updateGroup`,
`leaveGroup`, `sendGroupText` or `actGroup`. These operations capture the account,
allocate IDs, recheck ownership after asynchronous work, and persist through the
existing ledger. They do not require a network connection. `conversations()`
exposes reads and local preferences, not raw enqueue/receive methods or wire IDs.

`createMessageDelivery` owns the outbox pump. Its injected transport first tries
direct delivery, then key resolution and encrypted custody. A custody deposit is
not a recipient acknowledgement. Offline or failed work stays pending with the
same ID. Overlapping ticks do not duplicate work; invalidation/stop cancels late
acknowledgements and deposits. Message validation, blocks, signed identities and
receipt checks stay in the existing tested implementations.

`calling.start` receives a UI permission callback. After permission it checks the
account, active axon, verified peer identity and current call runtime before
initiating the call. UI retains the familiar incoming/outgoing/active call screens.

UI selectors pass a local URI and recipient to attachment staging. Key validation,
encryption, chunk transport and receipts happen later in the existing attachment
worker. Selecting/recording is not a delivery acknowledgement.

## Existing implementations and FirstNeuron

The many existing files under `services/identity/` are retained as internal protocol
and platform implementations, not all physically moved in this change. The former
`localAccountNetwork` and `rootMediaPicker` entry points forward to the new locations
for older internal callers. Legacy Django screens are outside this fresh-account
boundary and were not rewritten.

The messaging command, delivery and call-command factories accept dependencies
instead of importing React Native, sockets or phone storage. This gives a hosted
neuron a reusable orchestration boundary. FirstNeuron's web/native storage adapters
still need separate integration; this refactor does not deploy or claim that the
hosted service now imports these new modules.

## Enforced boundaries and verification

`npm run check:modules` rejects internal identity-service, native Axon bridge,
composition-root and AsyncStorage imports in the migrated active UI. Only the app
lifecycle screen, Network screen and axon-limit setting may import the network API. It also checks that
the portable messaging factories do not import platform/composition dependencies
and that persistence adapters do not depend on UI or networking. Existing theme,
media playback and sensor libraries remain UI concerns.

`npm run check:cycles` now includes `src/composition` and `src/modules` as well as services.
Both commands are included in `npm run check`. The regression tests exercise actual
ledger persistence, offline sends, blocked contacts, account switches, group
commands, interrupted delivery, missing routes and invalid peer identities.

Add new features through these APIs. Internal protocol files can be moved behind
their owning module in later focused changes without forcing another UI rewrite.

## Validation completed October 7, 2026

- All 925 unit tests passed, including 17 new messaging/call/delivery boundary tests.
- TypeScript, cycle detection (233 files), and module boundaries (16 active UI files) passed.
- Both existing development emulator identities and chats survived fresh app launches.
- A text sent using the public messaging command reached the other emulator.
- An encrypted attachment arrived with decrypted bytes matching the source.
- A video invitation initiated through the call-command API was received and accepted.
  This verifies signaling, not end-to-end camera/audio quality.
- A voice message recorded and sent through the normal chat interface was delivered
  on both sides with the same ID. Its 155,512-byte transfer exceeded the initial
  30-second polling window and was confirmed on the subsequent status check.
- Recent current-process error scans on both emulators reported zero matching
  ReactNativeJS/AndroidRuntime error entries.

During testing Metro needed a cache restart to discover the new folders. The two
emulators also required process restarts after an interrupted session accumulated
stalled ADB status queries. No emulator data was wiped or restored from snapshots.
The composition directory is deliberately named `composition`, avoiding Expo's
special `app` directory convention. No production build, phone installation,
FirstNeuron deployment, commit or push was performed for this refactor.

## Follow-up validation and local APK 54 (October 7, 2026)

- All 926 unit tests, TypeScript, the 233-module cycle check, and the 16-file UI
  boundary gate passed.
- Normal chat UI text and quoted reply delivered. Live ledger checks also verified
  edits, reactions, read receipts, and deletion. Two-emulator group commands
  verified creation, invitation, acceptance, text delivery, and editing.
- A normal-UI video call reached both call screens. A test observer accepted the
  invitation because Android's idle UI dump stalls on the incoming animation.
  Both sides rendered emulator camera video; native WebRTC samples showed increasing
  inbound/outbound audio packets and decoded video frames on a TURN route. This
  establishes media flow, not physical microphone/speaker quality.
- With the receiver's AppState confirmed background, its notification contained
  message text, Reply, and Mark as read. Calling the OS reply handler twice delivered
  one reply. Typing into the Android notification reply field was not exercised.
- Profile, public identity QR, security settings, and Network screens were inspected;
  Network showed two connected axons and the default limit of five.
- A 65,536-byte attachment delivered with exact matching decrypted contents in
  11,003 ms. Sequential 4 KiB chunk transfer remains a performance limitation.
- Media forwarding no longer requires a synchronous directory lookup before local
  staging. The existing attachment worker still verifies recipient records before
  encryption. Tests cover offline staging and unavailable source bytes.
- Built signed arm64 APK locally: `D:/Proyects/Axonic/builds/Axonic-1.1.5-54.apk`,
  package `com.axonic`, version `1.1.5`/54. Signature matches APK 53. SHA-256:
  `D5F81BE61561E814C803CE16AEC839EA9640445716623E02A2ED0F7487DD2618`.

No phone installation, hosted deployment, commit, push, or data wipe. This was not
an exhaustive rerun of every picker, sticker, call-control, or biometric hardware
path. Physical-device testing and media throughput optimization remain follow-ups.
