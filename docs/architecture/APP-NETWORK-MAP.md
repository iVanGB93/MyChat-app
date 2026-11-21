# Axonic architecture — phone app and network core

The phone app owns message meaning, local data and presentation. The network core authenticates peers and moves packages. Phones and AoNs share the network core through platform adapters. Some source directories contain code from both areas.

## Area 1 — Phone app

| Responsibility | Start here | Owns |
| --- | --- | --- |
| Startup, lifecycle and updates | index.ts, LocalAccountApp, appMaintenance, modules/maintenance | App startup, foreground/background lifecycle, Google Play updates, permissions |
| Account and device | modules/identity, localAccount, identityVault, localIdentityController | Local Axonic unlock, password and biometric checks, remembered unlock, and local setup and recovery UI |
| Chats and contacts | modules/messaging/commands, deliveryOutbox, rootChatLedger, rootGroups | Message meaning and validation, group membership, contacts, drafts, history, local pending intents, read and delivery presentation |
| Media | modules/media, rootAttachmentSelections, rootAttachmentFiles, rootMediaExport | Picking, editing, staging local files, preview, saving to gallery, stickers and recordings |
| Calls | modules/calls, mobileCallSession, call screens | Call UI, microphone/camera, screen capture, audio routing and device permissions |
| Notifications | modules/messaging/notifications, rootMessageWake, rootMessageNotification, rootNotificationActions and Route | Preview, suppression, read/reply, navigation, notification lifecycle |
| UI and storage | screens, components, navigation, modules/ui, modules/storage, theme, contexts, hooks, localization, types and utils | Visible behavior, projections and app-owned persistence |
| Diagnostics | modules/diagnostics, diagnosticReports, report/share UI | Redaction and user-approved reports; displays network observations |

## Area 2 — Network core

| Responsibility | Start here | Owns |
| --- | --- | --- |
| Discovery and trust | identityProtocol, identityDirectory*, identityAdmission, peerIdentityResolver, identityIntroductions | Discovery, signed identity records, peer authentication and admission |
| Connections and routes | identityNetwork, persistentAxon, neuronConnections, sessionRouting, peerRanking | Authenticated sessions, live peers, capabilities, connection selection, direct and relay routes |
| Transports | internetAxonTransport, rtcAxonTransport, nativeAxonTransport, lanIdentityRuntime | WSS, WebRTC and LAN adapters |
| Message delivery | modules/messaging/delivery, custodyCourier, groupCustodyCourier, custodyProtocol, receiptConfirmation | Scheduling, retry, direct ACKs, custody handoff and receipt verification |
| Relay custody and wake | custodyService, groupCustodyService, custodyWakeForwarder, custodyEvents, pushRegistration, gatewayPushRegistration | Encrypted packages, expiry, recipient wakes and receipt-driven cleanup |
| Media transport | attachmentTransfer, attachmentRouteSelection, attachmentSchedule, attachmentCustody, relayBlockStream, wssAttachmentStreams | Streaming, encrypted relay blocks, transfer checkpoints and integrity |
| Call networking | callControlProtocol, callControlRelay, callMediaRelay, callMediaRouting, callRetryScheduler | Signed invitations, signalling, media routes and relay |
| Network observations | networkScorecard, deliveryDiagnostics, deliveryEvidence, relayInventory, trialCredits | Evidence of routing and contribution; credit observation and accounting |

## Interfaces and platform adapters

The app creates an intent and owns its meaning. The network owns delivery. The
receiving network supplies a verified sender, ID, payload and route evidence
to app admission. The app commits before acceptance. Direct acknowledgement,
custodian storage, recipient receipt and user read are distinct events.

- Outgoing: deliveryOutbox is the phone adapter over the durable chat ledger.
  Keep one durable Send commit. The worker reads eligible packages and reports
  direct acceptance back through the adapter. The mobileDeliveryReceipts adapter
  commits custody and recipient receipt transitions to phone chat storage.
- Incoming: incomingMessageAdmission coalesces concurrent identical admissions.
  The app owns block and membership decisions and durable deduplication.
  Acceptance follows the durable ledger commit. The mobileIncomingMessages
  adapter builds notification previews separately. The Android wake lease can
  wait for presentation before shutting down.
- Storage follows the data. Chat history, drafts and local media belong to the
  app. Relay ciphertext, pins and transport checkpoints belong to the network.
  The current mobile job adapters and transfer runtime connect the two.
- Local unlock controls access to Axonic on this device. The phone app owns
  password, biometric and remembered unlock, and the UI for local setup and
  recovery. The network core owns identity proofs, signed records, peer
  admission and authenticated sessions. localIdentityController unlocks the
  local vault and leases credentials through withConnectionCredentials.
  identityNetwork calls openIdentityAxon to construct the network session.
  persistentAxon authenticates the peer. Lock revokes the credential lease
  and closes both pending and established connections.
- Coordination: neuronRuntime wires connections, app admission, receipts, calls,
  push and media. rootBackgroundEntry dispatches Android wakes into the
  appropriate runtime. Keep composition as wiring rather than a third domain.
- Android packages span both areas. axonic-nearby contains sockets, crypto and
  stream code alongside notification and job adapters. axonic-app-update
  contains Play, audio and gallery adapters and chat storage recovery. The
  plugins and native manifests are the build-time integration surface.
- AoN dashboards, AI integrations and HTTP routes are host-side app adapters.
  Use the active AoN shared-source manifest to check parity. It includes app semantics such as the chat ledger alongside network code. Hosted adapters own their process lifecycle, storage bindings and API surfaces.

## Package handoff

1. The app commits the outgoing intent with a stable ID and exposes the package through its outbox. The network chooses the route, transfers the package and reports verified delivery evidence.
2. The destination network verifies the peer or relay package and passes it to app admission. The app applies its contact and group rules and commits the inbox entry before accepting it.
3. The app displays separate states for custodian storage, recipient delivery and read. For media, descriptor acceptance can precede download. Delivery of the full file requires integrity verification and the attachment receipt.
4. A verified push can acquire a bounded recovery lease. The network targets the configured custodian in the wake. The app owns local presentation and notification actions.

## Review sequence

1. Phone app: startup and identity, persistence, private and group chat,
   attachments, calls, notifications and background entry, then diagnostics
   and UI. Include native app adapters alongside the feature that calls them.
2. Network core: discovery and authentication, sessions and routing, private
   and group delivery, media streams and relay custody, then calls and wake
   recovery. Review the matching phone and hosted implementations together.
3. For each slice, trace entry point, owners, storage, events, retries, failure
   paths and test coverage. Use real Dev chat-composer traffic for live checks.

Scope: architecture inventory of the mobile source tree, native modules, plugin
entry points and selected hosted source contracts. This is an ownership and
review map. Per-file behavioral and line-by-line verification comes in the
individual reviews.
