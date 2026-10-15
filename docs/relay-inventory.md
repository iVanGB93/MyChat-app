# Relay packet inventory

Network → Advanced diagnostics → Packets held for others inspects the current identity's relay databases, excluding records sent by or addressed to that identity. The AoN dashboard exposes the same projection at Network → Advanced · Packets held for others. Its GET `/api/relay-inventory?offset=0` endpoint requires a dashboard session; scoped bot credentials are not sufficient.

Coverage: single-recipient envelopes/receipts/consumed markers; group shared payloads and recipient grants/receipts/markers; attachment manifests/receipts and actual persisted chunk aggregates; temporary call-control relay events/receipts. Identity caches, own outboxes, own messages/files, push credentials and transient live audio/video streams are not part of this inventory.

Media chunks are grouped by content digest, not individually rendered or decrypted. Shared chunks are counted once. SQL supplies current chunk count, first/last index and serialized stored bytes without loading chunk payloads. First/last indices do not imply a contiguous range. Manifest checkpoint counts and declared file size are separate from current physical chunk storage. Unlinked chunk groups remain visible; the diagnostics never clean them up.

The allowlisted schema includes kind, local state, storage lifetime, IDs, visible routing identities, available timestamps, recorded replica/source identities and applicable byte/chunk counts. It excludes ciphertext, plaintext, signatures, nonces, encryption material and push tokens. Missing timestamps and unobserved routes are not synthesized. Expired rows and empty cleanup markers are labeled rather than counted as waiting messages.

The phone clears displayed data on account-state changes and checks the identity again after reads. AoN responds only to authenticated dashboard requests. Both paginate at 50 entries and refresh every ten seconds only while the inventory is visible in the foreground. Pages are live views, not an atomic historical snapshot across all stores; entries can move between refreshes.

No protocol admission, receipts, expiry rules, retention or delivery behavior changes. The protocol-implementation review constrained this feature to local allowlisted projections and metadata-only reads. Tests validate projection exclusions, pagination, actual SQL aggregates and access control; this is not a cryptographic proof or a phone UI test.
