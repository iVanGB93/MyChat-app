# Trusted contact discovery — development milestone

FirstNeuron can introduce public device keys for existing direct-chat contacts.
The shared `neuronExchange.ts` client requests at most eight sorted contact IDs,
and the host returns only entries from its provisioned public-key registry.
Both the request and response cover the directory fields with signatures in
distinct signing domains. Old exchanges remain compatible.

The app verifies the response with the explicitly pinned neuron key, then checks
local direct-chat membership, blocked contacts, and immutable identity pins.
Room IDs come from the local database, never from the host. Unrelated identities,
key replacements, and callbacks from stopped/account-switched sessions are ignored.
Introductions are processed before mailbox packets from the same exchange.

This is delegated trust in FirstNeuron's introductions, not decentralized account
authentication. Contact queries disclose those IDs to the trusted neuron. The
host registry is still provisioned manually. This milestone does not implement
automatic network-wide registration or independent proof of account ownership.

Introduced keys persist in the existing pin store. Routes are rediscovered after
restart; explicit saved pairing settings remain separate. Limits are eight active
identities including self, 32 stored pins across local accounts, and four direct
sessions. The first eight sorted contacts are queried; larger directories need
pagination and a broader capacity design before production use.

Saved pairing already restores without Axion authentication. Phones reach the
peer endpoint over public HTTPS while the administration dashboard stays private.
Participation is still development-only and foreground-only. WebRTC connection
setup still uses Axion; peer-assisted signaling is the next independent milestone.

Automated verification: 408 mobile tests, nine neuron tests, both TypeScript
checks, shared-source parity, and the 95-module dependency check pass. Coverage
includes signed-field tampering/removal, unsolicited entries, legacy compatibility,
blocked/deleted contacts, pin conflicts and account changes.

Live discovery evidence is stored locally in ignored
`builds/neuron-discovery-evidence.json`. Test accounts are 14, 18, 22 and 27.
After reloading all four development sessions, account 14 automatically learned
22 and 27; accounts 22 and 27 each learned 14. Account 18 retained its existing
paired contact. No pairing or manual polling command was used. All four sessions
finished active with Axion ready and no restoration error. Phones remained on
cellular data. This verifies identity/route discovery, not Axion-free WebRTC setup.
