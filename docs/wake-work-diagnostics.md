# Wake work and retry scheduling

Do not report an undifferentiated attempt count as network traffic or phone wakeups.

## Counter meanings

- `schedulerChecks`: local tick invocations, including checks skipped while busy or backing off.
- `storeReads`: reads of the durable custody queue.
- `selectedItems`: scheduler selections, including repeated selections of the same item.
- `localGatewayCalls`: invocations of the local gateway, without a remote transport request.
- `remoteGatewayCalls`: remote gateway adapter invocations; these can fail before transmission.
- `requestPayloadBytes` / `responsePayloadBytes`: serialized application payload bytes, not measured network-wire bytes. Local calls are included.
- `elapsedMs`: accumulated gateway call elapsed time, not CPU time or battery use.
- `outcomes`: final gateway results, with an inline-envelope compatibility fallback grouped into the original gateway result. Request counters count both adapter calls.
- `trackedEnvelopes`, `backingOff`, `acceptedEnvelopes`: current gauges, not lifetime unique-message counts.
- `pendingSample`: at most eight current pending items, with request counts, latest outcome/time and next eligible retry time. No message/account identifiers; sample positions are not stable identifiers. A new gateway can make an item eligible earlier.

AoN's existing `wakeForwarding.attempts` remains for compatibility and equals local plus remote gateway calls. `messageWake.providerCalls` explicitly names the existing gateway `attempts` counter: actual provider-send function calls, distinct from gateway retry decisions. `retryReasons` and `rejectionReasons` are fixed local decision categories, not remote packet-level traces. Counters cover their respective network-runtime or gateway-process lifetime; reset report baselines on the corresponding epoch change.

Private and group sections describe message-custody wakes. They do not identify media versus text (the relay cannot infer that from encrypted content), and do not include call wakes. Gateway acceptance, provider acceptance, device receipt and notification display remain separate facts.

## Narrow scheduling change

Authenticated gateway retry replies optionally carry `retryAfterMs` for the remaining receipt/reservation lease. The shared scheduler honors it per gateway, bounds it to fifteen minutes and packet expiry, and continues to try other eligible gateways. Older gateways without this field retain the existing exponential schedule. New gateways still receive one prompt attempt; reconnecting a known gateway does not reset backoff. Signed payloads and receipts are unchanged; no custody is deleted by wake acceptance.

No-authorized-destination backoff is not increased here: safely responding to registration changes needs additional evidence and an explicit invalidation path. This change does not claim measured battery/bandwidth savings. Deterministic tests verify suppression during advertised leases, bounded malformed hints, alternate-gateway recovery and retention. Production and phone measurements remain necessary.

Reports should separate private/group purposes, local/remote calls, gateway outcomes, provider calls and reason counts. Include tracked/backoff gauges and sampled retry times instead of interpreting `retries / attempts` as a notification failure rate.
