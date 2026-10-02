# Replicated identity directory — core milestone

Implemented in mobile and hosted runtimes through the negotiated identity-directory-v1 axon capability; deployed to FirstNeuron on October 2, 2026. This is a replicated directory, not a network-wide DHT or consensus system.

## Components

- identityDirectory.ts: bounded public-record service. Only an authenticated owner may publish its root-signed record. Any authenticated peer may look up a public identity by its exact account ID. It validates signatures, history, and monotonic updates; conflicting branches are rejected. Unknown unsigned fields are rejected.
- mobileIdentityDirectoryStore.ts: separate SQLite database, atomic transactions, and serialization across store instances. No passwords, private keys, own chats, or relay messages are stored here.
- identityDirectoryReplication.ts: aims for three distinct reachable peer identities, retries failures, replaces disconnected replicas, and discards confirmations after a record changes, a lease expires, or the owner locks. Fewer available peers do not prevent publication.

A stored response is returned only after a durable commit. It is an observation delivered over an authenticated request/response channel, not a transferable signed receipt, an independent-operator guarantee, or a vote granting authority to modify an identity. The caller must provide bounded authenticated transport; this core never trusts a peer ID supplied inside the request payload.

## Retention and limits

At most 256 identity records and 3.2 million JSON characters per directory. Each record packet is limited to 12,000 characters, bounded signed history uses the existing protocol limits, and each service permits at most eight in-flight requests. Lookup availability lasts at most one hour and never exceeds record expiry; publishers refresh after expiry. Failed peers have a 30-second retry delay. The worker considers at most ten connected identities and targets three confirmed copies.

Expired records are hidden from lookup, but their signed revision anchors remain stored to prevent rollback on this replica. Capacity exhaustion rejects new owners instead of evicting anchors; current owners can update. Safe long-term compaction and admission policy remain necessary before widespread deployment. Three identities can belong to one operator, so the target is redundancy, not Sybil resistance.

## Validation

Automated tests exercise three-replica storage and ordinary-replica failover, fewer-than-three availability, retry after storage failure, signature/owner verification, stale and conflicting updates, required ancestry, commit failures and lock races, expiry, bounded requests/capacity, untrusted response rejection, and SQLite transaction serialization/rollback. These are portable integration tests with simulated peers and a mocked SQLite driver. Additional hosted integration tests exercise authenticated WebSockets, durable file reopening, failover to another ordinary replica, newer-pin rejection, and older-peer compatibility. Live Android tests confirmed native SQLite commits through successful replica acknowledgments.

## Live verification

FirstNeuron and both development emulators each confirmed two remote copies (target three). With three live neurons total, each has only two other replicas available. Phones replicated to each other over their authenticated RTC axon and to FirstNeuron over WSS. FirstNeuron replicated its own identity to both phones. Their existing accounts and chat histories remained in place.

Network screens report confirmed remote copies, including the local-account flow; the hosted dashboard reports them in axon status. Lease confirmation tolerates up to 30 seconds of clock skew and subtracts the uncertainty window before counting a copy as available. A live clock offset exposed this edge case; it now has a regression test.

Deployment health and unchanged hosted identity were verified. Original code rollback: /opt/axonic-neuron-before-directory-20261002. Public emulator evidence: ignored builds/directory-live-evidence.json. No backend or proxy change, app reinstall, or production build was required.

## Integration status and next steps

1. DONE: Added a negotiated directory capability to persistent axons, with authenticated bounded request/response framing. Do not route directory operations through legacy custody messages or advertise support from older peers.
2. DONE: Connected the same service to phone and hosted-neuron runtimes. Before serving/adopting directory records, reconcile against existing admission pins so a newer trusted pin cannot be bypassed by an older directory entry.
3. DONE: Added read-only verified lookup that compares candidates against local anchors and reports conflicts/missing ancestry. Never claim globally latest identity state or resolve a fork by counting arbitrary peer votes.
4. DONE: Replica counts and automatic publication are enabled in existing feature-flagged neuron runtimes. Live bidirectional phone/host replication passed. Full device reboot and a live four-neuron failover run remain useful follow-up checks.
5. Add distributed lookup routing, admission/rate policy, replica diversity and safe retention/compaction. Recovery still needs its explicit signed-record safeguards until recovery discovery and freshness handling are implemented.

## Verified lookup (October 2, 2026)

Find identity is available on both mobile Network screens and the FirstNeuron dashboard. The hosted UI uses the existing authenticated, origin-checked POST /api/network route with action lookupIdentity; no proxy or backend change was needed.

The shared resolver queries up to ten distinct connected directory-capable peers, validates the target account, signatures, leases and signed history, and rereads local admission pins after replies. It merges a bounded contiguous ancestry suffix, rejects signed forks regardless of the number of matching replies, and reports stale or missing-history results without selecting a record. Invalid replies do not count. Calls are single-flight and cancelled on identity/runtime invalidation. Lookup does not write admission pins or change account/device keys.

A found result means verified among the records reached, not globally newest. Returned source counts are peer identities, not independent operators. Disconnected peers and unreachable newer records remain possible. Existing manual recovery safeguards remain unchanged; automatic recovery discovery and a freshness/conflict strategy are not implemented by this read-only lookup.

Validation: 635 mobile tests and 44 hosted tests pass. Real-socket tests retrieve an offline owner's record through a replica without pinning it. Live tests: both emulators found each other's record through FirstNeuron, and FirstNeuron found each emulator's record through the other emulator. Public evidence is in ignored builds/directory-lookup-live.json. FirstNeuron deployment retained its identity and passed health checks; rollback /opt/axonic-neuron-before-lookup-20261002.


## Guarded recovery discovery (October 2, 2026)

The opt-in local-account restore screen now requires a network check of the user's saved public recovery record. A temporary, memory-only visitor identity opens an ordinary authenticated axon to the configured FirstNeuron bootstrap peer. Only public records are queried; recovery words, passwords, and restored device keys are never given to this connection. The visitor does not publish a directory record or change the recovering account. The same connection is reused for preview and commit checks, renews its authentication, and closes on cancel, background, unmount, completion, error or a five-minute lifetime limit. Individual lookups are bounded to twenty seconds.

A signed descendant can replace the supplied checkpoint in the preview only when its ancestry validates. Conflicts, older revisions, gaps, invalid signatures and unavailable results block restoration. The restore operation verifies the selected record before sealing and again before writing either device secret or vault; a changed record requires a new preview. The account controller's offline restore primitive remains available to existing internal callers/tests; the interactive local-account screen requires these network checks. A completed restore remains locked until explicitly unlocked.

This is a checkpoint-assisted flow, not words-only recovery or globally fresh consensus. It currently queries only the bootstrap peer and cannot rule out unseen later revisions or simultaneous recovery elsewhere. Multi-peer discovery, recovery concurrency policy and removing the saved-record requirement remain future work. Temporary visitors also consume ordinary peer admission pins; visitor admission/retention needs a bounded strategy before general rollout. No server protocol, proxy or native build change was needed.

Validation: 645 mobile tests, TypeScript and the service dependency check pass. Tests cover signed descendants, final-check changes, invalid/conflicting/stale/missing records, cancellation during recovery and native dialing, connection reuse and secret cleanup. The live emulator checked a public test-account record through a new visitor connection to FirstNeuron and rechecked it unchanged (builds/recovery-discovery-live.json, ignored). Existing emulator accounts were preserved; a destructive live restore and the complete opt-in screen walkthrough were not performed.
