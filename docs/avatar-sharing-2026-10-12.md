# Private avatar sharing

An avatar is optional profile content, separate from the public identity record.
The owner publishes a bounded JPEG thumbnail to accepted, unblocked chat partners
and accepted group members. Local contact nicknames remain local. Peers must
advertise `profileUpdates: 1`; older clients do not receive unknown controls.

## Protocol and storage

- The root signing key signs the fixed `axonic-private-avatar-v1` manifest domain,
  root public key, timestamp revision, SHA-256 content hash, length and JPEG type.
- Images are normally resized to 128 by 128, with a 16 KiB encoded limit and a
  256 by 256 decoded-dimension limit. The zero-byte signed form removes an avatar.
- Recipient-bound `axonic-avatar-part-v1` controls use the existing encrypted
  direct-first chat transport and custody fallback. Each contains at most 640
  image bytes so it fits the existing 2 KiB control frame limit.
- The recipient verifies the sender identity, signature, version, packet ID,
  chunk bounds and completed image hash before exposing the new image. An
  incomplete newer version does not replace the current displayed avatar.
- Duplicate and out-of-order delivery is supported. Older revisions cannot
  replace newer ones; conflicting hashes at the same revision are rejected.
- Signed controls are not public-directory records, visible chat messages, or
  notification-generating messages. Relays use existing encrypted custody and
  expiration rules. Recipients retain their own local avatar cache.
- A receiver requests a missing or changed avatar after reconnecting. Identical
  cached hashes avoid retransmitting the image. Capability memory, requests and
  outgoing acknowledgements persist across process restarts.
- Blocking prevents future sharing; it cannot erase a copy already received by
  another user. Recovery does not reconstruct a lost owner's original photo.

## App and AoN integration

Profile photo changes/removal publish through the messaging module. Chat lists,
headers, contact information, call UI/history and group participants read the
same local cache. Both AoNs use the same protocol core and support dashboard
photo upload/removal and peer avatar display.

## Verification on October 12, 2026

- Full mobile check: 918 passed, 3 skipped; TypeScript, dependency cycles, module
  boundaries and consolidation checks passed.
- Hosted suite: all 152 passed.
- Focused protocol coverage: tampering, wrong signer, bounds, malformed chunks,
  duplicates, out-of-order packets, persistence, removal, recovery requests,
  blocking and legacy capability behavior. These are functional/security
  regression tests, not a cryptographic security proof.
- Live emulator to Axonic Dev phone: all four packets acknowledged and the
  receiving cache contained the exact published SHA-256 hash. Temporary test
  photo was subsequently removed through the normal profile API.
- A second emulator's old outbox backlog delayed its avatar delivery; successful
  phone delivery is not evidence of bounded delivery latency under backlog.
- No official phone app was replaced and no production mobile build was made.

AoN release fingerprint: `d21fe564fa1279c4875792db5c121bd378b8d49bda167b8965310625ab85581e`.
