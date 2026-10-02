# Local-account migration

Status: opt-in development milestone; the legacy app remains the default entry.

## Implemented

- index.ts selects LocalAccountApp only when EXPO_PUBLIC_AXONIC_LOCAL_ACCOUNT=1. Otherwise it loads the unchanged legacyEntry.ts. The local branch does not initialize AuthProvider, Axion, legacy push handlers, or legacy telemetry bootstrap.
- A separate local-account vault uses the existing native secure randomness and scrypt implementation, XChaCha20-Poly1305 encryption, and a device secret in SecureStore. Existing Django accounts, migration identities, and message databases are not replaced.
- Creation requires re-entering the 24 recovery words before saving. A local display name is a device label, not a globally registered username. Passwords are 12–256 characters and never sent to peers.
- Optional biometric unlock stores the unlock credential using SecureStore requireAuthentication, a separate keychain service, and WHEN_UNLOCKED_THIS_DEVICE_ONLY. Enrollment first verifies the local password. Cancelled/ineligible/invalidated biometric credentials preserve password fallback. Deletion removes only the biometric credential, not the vault.
- Backgrounding locks the identity, closes its axons, invalidates pending biometric operations, and clears sensitive form state. iOS inactive transitions hide the form without treating the biometric prompt itself as cancellation. Cold starts require unlocking.
- Once unlocked, the app participates through LAN discovery and the pinned FirstNeuron bootstrap using signed root identity proofs. It shares the 3–10 axon limit, default 5, and bounded encrypted custody service. This composition currently does not enable RTC discovery across other internet peers.
- Public identity and signed recovery metadata can be shared. Recovery creates a replacement device under the same root, retains bounded signed ancestry, and requires an explicit unlock afterward.

## Recovery constraints

Recovery currently requires BOTH the private words and the latest signed public recovery record. A copied record is not a globally fresh authority: restoring from an old record can fork/conflict with peers holding a newer revision. The UI explicitly warns about this; it never creates a new genesis identity from the same words.

Recovery replaces all devices authorized in the supplied record. It does not link another device, restore old message history, or recover ciphertext encrypted to previous device keys. Public records renew over time, so saved metadata must be refreshed. Automatic authenticated record discovery and a conflict/revocation strategy are required before making recovery a production onboarding flow.

## Development use

Set EXPO_PUBLIC_AXONIC_LOCAL_ACCOUNT=1 for the Metro process and reload the existing development client. No dependency, manifest, or production build change is required by this milestone. Keep the flag absent for normal app testing and EAS builds. Do not reuse a normal user's recovery words for testing.

Storage namespace: @axonic_local_account_v1, @axonic_local_account_name_v1, axonic_local_account_device_v1, and the separate axonic-local-biometric-v1 keychain service. None are interchangeable with existing numeric-user identity storage or the old identity experiment.

## Validation and remaining work

- Portable tests cover creation/backup verification, cold unlock, wrong passwords, recovery ancestry/device replacement, invalid recovery input, storage failures, lock/commit races, biometric enrollment, cancellation/invalidation, and entry isolation.
- Live development tests use disposable identities and real native KDF/SecureStore on both emulators; public evidence is kept in ignored builds/local-account-live-evidence.json. Existing accounts and chats must remain intact after returning to the legacy entry.
- Physical fingerprint/face enrollment, cancellation, OS enrollment changes, and iOS background behavior still require device validation. Emulator unit tests do not prove hardware biometric behavior.
- Next: a root-addressed normal chat ledger, message requests, local aliases/blocking, and authenticated identity discovery independent of Django numeric users. Add RTC composition to this runtime and test ordinary-neuron failover.
- Then: migration that binds existing users/history to the retained cryptographic identity without silently generating a replacement; device linking/recovery conflict handling; media/calls and background delivery review.
- Only after those steps and production delivery validation should the default login flow change or Django authentication be retired.
