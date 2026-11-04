# Mobile current-system cleanup - 2026-10-28

Removed the unused numeric-account mailbox exchange, signaling, room-binding and normal-chat outbox adapters, along with their test-only runtime/store copies and retired rollout guides. The identity controller no longer exposes numeric-owner chat binding. Push registration now sends only the current authenticated token registration; unused Django migration-ticket handling is removed.

Current cryptographic identity, custody, encrypted relay blocks, direct streams, notifications and history paging remain. Indexed-history migration readers remain necessary for existing user data; Expo FileSystem legacy is the installed library API, not a retired Axonic transport. Neither is removed by keyword.

The consolidation checker rejects reintroduction of the retired production files. The remaining documented support roots serve the current hosted identity protocol. No installed application or stored user data is changed by this source cleanup.
