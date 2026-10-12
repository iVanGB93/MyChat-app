# Shared encrypted group attachments — 2026-10-12

## Contract

Manifest v2 gives each recipient its own signed grant (recipient identity/device, transfer ID, slot) over one shared ciphertext. A fresh 32-byte content key and shared ID are generated for each attachment. The content key is sent only inside each recipient's existing end-to-end encrypted chat descriptor. Custodians receive ciphertext and signed grants, never the key.

Chunk encryption remains XChaCha20-Poly1305 with 4096-byte plaintext chunks. The v2 authenticated context binds the shared ID, sender identity/device, recipient count, byte length, and chunk index. The chunk nonce is derived from that context; encryption is performed once with the fresh content key, and later recipient grants reuse those exact bytes. The signature separately binds each recipient/device and slot. Merkle proofs, checksum verification, and existing encrypted descriptor transport remain required.

Storage distinguishes a per-recipient grant digest from the shared content digest. The latter binds sender/device, shared ID/count, creation/expiry, byte length and Merkle root. Conflicting slots, recipients, or roots under the same sender/shared ID are rejected. Each authenticated recipient can retrieve only its own grant. A receipt acknowledges only that grant. An early receipt retains bytes for outstanding or not-yet-offered slots; the final receipt deletes the blob. Expiry deletes abandoned blobs within the existing 24-hour retention window.

Shared upload progress is the contiguous stored prefix, including after process restart. Out-of-order chunks cannot advance it across holes. Workers skip an already-uploaded prefix, so sequential recipient jobs at the same custodian reuse the upload. Separate custodians and direct recipient downloads still require their own network transmission; this is not network-wide multicast or a guarantee of only one physical copy everywhere.

## Compatibility and limits

Authenticated connections advertise sharedAttachments: 2. This first rollout selects v2 only when all group recipients currently advertise support and an additional compatible peer can act as custodian. Unknown, offline-at-selection, or older recipients use unchanged v1 delivery. Existing queued transfers are not rewritten. Public signed offline capability discovery remains future work.

Encryption/tree construction is shared locally, but recipient-specific directories still copy the files. This change reduces repeated encryption and shared-custodian upload traffic, not all local disk duplication. Relay metadata can correlate recipients of a shared attachment; content remains encrypted. Membership changes cannot revoke a content key already delivered to a recipient. No formal cryptographic proof or global speed guarantee is claimed.

Old binaries do not understand persisted v2 custody rows. After v2 traffic, do not roll back to an old protocol binary without draining/expiring those rows or an explicit storage compatibility plan.

## Automated validation

Mobile full check: 836 passed, 3 skipped, 0 failed; typecheck, cycles, module boundaries and consolidation passed. AoN: 147 passed, 0 failed; mobile/core source parity passed.

Tests cover identical decrypted bytes for two grants, distinct grant digests/shared content digest, signature/key/recipient tampering, unauthorized retrieval, contiguous progress, early receipt plus restart, final deletion, one encryption pass, compatibility fallback, and hosted group forwarding. A two-recipient worker test writes each of three ciphertext chunks once (3 writes rather than 6), with independent receipt completion and no key in relay requests.

Both AoNs deployed runtime SHA-256 fcfdcbbff31dc2d769ec16ddb73c7d588768c4f843f652bd3ca19b714d9fb07f; authenticated health active. SecondNeuron deployment: 653a41c1-8fba-4d99-a6b3-6930907070d8. Identities preserved. No production mobile build performed.


## Live Dev validation

Using the existing group creation and attachment queue services, an emulator created a synthetic test group with the other emulator and the connected com.axonic.dev phone. A 131,071-byte deterministic test file was sent once through the group attachment queue. Both outgoing grants used v2 and the same content digest. Both recipients reported delivered, and native SHA-256 checks matched the original file exactly. The sender recorded both independent delivery confirmations and no remaining jobs for this transfer. Pre-existing unrelated confirming jobs remained on the recipient devices.

This verifies the real mobile group preparation, encrypted descriptor transport, shared-format decryption, file integrity and receipts. It does not establish a measured live bandwidth/speed gain or prove which custodian served every chunk. The exact one-upload assertion is from the controlled worker/custody test above. No real personal media was used and the Play Store app was left untouched.


## Offline-recipient follow-up

An additional 131,071-byte synthetic group file was queued after force-stopping only the receiving phone's com.axonic.dev app. The sender no longer listed that recipient as connected. As designed, the selection used v1 compatibility fallback. The online emulator received matching bytes while the offline recipient remained pending with both networkStoredUntil and attachmentStoredUntil recorded. After reopening the Dev app, its account unlocked normally, the file arrived automatically, and the native SHA-256 check matched. No manual resend, identity reset, production install, or official-app change was needed.

Evidence: backend builds/group-offline-before.log and group-offline-reconnected-final.log (local ignored test output). These are lifecycle/offline-delivery tests, not screen-off/FCM tests: force-stop intentionally prevents background wake until explicit reopening.

The second case queued a 1,048,573-byte group file while all members advertised shared-format support, then force-stopped the receiving phone immediately after queueing. Both signed grants used v2 and the same content digest. While the phone remained stopped, the online emulator completed and verified its copy; the sender's phone-recipient job reached cursor 256 / confirming with attachmentStoredUntil set, but remained pending (not falsely delivered). After reopening Dev, the phone automatically received the complete file with a matching native SHA-256. The sender then showed both recipients delivered and no remaining jobs for this transfer. The earlier v1 test also reached both-delivered with no remaining sender jobs.

Evidence: backend builds/group-shared-offline-stored.log, group-shared-offline-verified.log, and group-offline-v1-receipts.log. Both emulators and the phone Dev app were left running and connected. No implementation changes or new build were needed for these checks. This demonstrates recovery within the normal attachment retention period; extended outages beyond expiry and network-only isolation were not tested here.
