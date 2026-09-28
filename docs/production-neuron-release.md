# Production AAB preparation

The production EAS profile builds an Android App Bundle for `com.axonic`, with
remote version codes and auto-increment. `EXPO_PUBLIC_AXONIC_NETWORK=1` enables
the pinned, encrypted neuron path in release builds. The separate unsigned
development P2P/LAN experiment remains gated by `__DEV__`.

Profile includes an **Axonic network · Early access** section:

1. Share the installation's device code with the network administrator.
2. Register its public identity in FirstNeuron's trusted peer registry, verifying
   the account and code with that user. Never silently replace an existing key.
3. Tap **Connect to FirstNeuron**. Registration and an internet connection are
   required for the status to change to connected. Both participants must be
   registered and have their direct chat cached locally.

Public device codes contain account ID and public encryption/signing keys, never
private keys or login credentials. `com.axonic.dev` keys and saved pairing do not
transfer to `com.axonic`. An account already pinned to different keys needs an
explicit key-recovery procedure; use a separate account per test installation
until that exists. Disconnect removes saved routes but preserves messages and
immutable pins.

Registered contacts may use signed neuron signaling to establish a direct
encrypted text channel. Hosted ciphertext custody is the fallback. Participation
pauses in the background or during a call. Initial login, contact creation, calls,
media and ordinary fallback still use the existing backend. This release does not
provide decentralized authentication or guarantee OS background peer delivery.

Before building, the EAS production environment must supply the existing Firebase
configuration (`GOOGLE_SERVICES_JSON`) and Sentry upload credentials. Keep all
secret values outside source control. The local Firebase fallback exists, but
ignored files are not a substitute for the EAS environment configuration.
The production environment was checked on 2026-09-27: both
`GOOGLE_SERVICES_JSON` and `SENTRY_AUTH_TOKEN` are present. Secret values were
not printed or saved.

Build when ready: `eas build --platform android --profile production`.
This preparation does not start a cloud build or publish to Google Play. The
existing submit profile still names the internal track; choose the intended Play
track explicitly when publishing. No standalone APK is planned.

Verification: 417 mobile tests, 10 hosted tests, TypeScript checks and a production
Android Hermes bundle export. An AAB's native build/install remains a separate
verification step. Live evidence is saved in ignored `builds/controlled-neuron-*-evidence.json`.

Controlled live results (2026-09-27): emulator 18 → 14 message
`fc6c3a3d-da29-47af-a982-da8f7724c4ed` and cellular PC 22 → Chaty 27 message
`d4a28da0-9868-40f6-904b-2ae54b028d59` both reached delivered state on sender and
recipient with Axion disconnected throughout. Both sends recorded the exact
envelope ID as accepted over a fresh direct channel established through neuron
signaling; the cellular test also recorded the matching receipt over the direct
channel. No Axion message/signaling frames were sent. These tests invoked the
normal chat send function from the dev session, rather than tapping Send.

The first live runs exposed stale hot-reload callbacks and a receipt waiting
behind historical retry traffic. Fresh sessions and immediate replies for the
current envelope resolved the confirmation delay. Receiving a receipt no longer
triggers another historical receipt flush.

Production-install correction: the native bridge still required a debuggable
application for all six mailbox crypto operations. This caused Connect and Share
device code to fail before contacting FirstNeuron, despite the JS release flag.
The restriction has been removed from mailbox cryptography; unsigned LAN startup
retains its debug-only restriction. A new native AAB is required; an OTA JS update
or device registration cannot repair the already-installed native bridge.
Correction validation: 19 targeted JavaScript checks passed, and the Android
module's release compilation and `testReleaseUnitTest` succeeded. The corrected
AAB still needs to be built and validated on an installed production app.
