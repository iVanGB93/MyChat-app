# Native WSS stream cipher — 2026-10-26

## Implementation contract

Android now uses Bouncy Castle 1.86 XChaCha20-Poly1305 for bounded WSS record sealing/opening. The shared TypeScript codec still owns HKDF derivation, direction separation, fresh per-attempt salts, nonce sequence, authenticated metadata, framing, replay/order validation, plaintext type/length validation, and failure handling. No wire-format, encryption, authorization or window changes. Non-Android/older runtimes retain the reference implementation; a failing installed native primitive is not silently retried through JS.

The native primitive validates input sizes and the WSS domain, accepts at most 32,769 plaintext bytes, authenticates before returning plaintext, clears native input copies and failed output buffers. It runs synchronously for one bounded record to avoid a Promise/native-worker hop per frame; this is native processing, not a claim that the JS thread never waits. Burst yields and credit limits remain. Input-copy behavior was checked on the actual phone bridge. These are functional/equivalence checks, not a formal side-channel guarantee.

Added bounded local stream outcomes (16 entries, no identities, paths, content or keys): direction, size, binary/native path, success/failure category and elapsed time. Failures in diagnostics cannot affect delivery. Startup failures were previously swallowed into a generic false return.

## Validation

- Kotlin known-answer vectors independently generated with Noble, for 2/1,025/8,193/32,769-byte plaintexts; decrypt round trips, wrong key/nonce/AAD, tag tampering, size bounds, native copy erasure: 2 tests passed with multiple cases each.
- Actual rebuilt phone Dev: 5 mixed control/data binary records match reference ciphertext byte-for-byte; 10 tamper/replay rejections; plaintext round trips; JS key/nonce/plain inputs remain unchanged. Evidence: builds/native-stream-phone-parity.json.
- Full mobile suite: 1,564 pass, 3 optional skips, zero failures. Typecheck passes.
- Local Gradle :axonic-nearby:testDebugUnitTest and :app:assembleDebug passed. APK package independently checked com.axonic.dev, arm64-v8a, then installed in place with -r. All 306 pre-update message keys and account identity survived. No production build/install, AoN deployment, deletion or reset.

## Live tests

All 14 measured transfers across the first six-file matrix, fresh-start pair and final six-file matrix passed full-file SHA-256 and sender receipt checks. Every matrix retained baseline account/history records.

Final matrix (MiB = 1,048,576 bytes):

| Size | Phone → FirstNeuron | FirstNeuron → phone | Native seal / open |
| --- | --- | --- | --- |
| 1 MiB | 2.902 s | 2.964 s | 21 / 31 ms |
| 5 MiB | 3.924 s | 4.980 s | 132 / 216 ms |
| 10 MiB | 7.723 s | 6.517 s | 286 / 521 ms |

The last JS 10 MiB warm pair used 5.431 s sealing / 6.289 s opening; native final pair used 0.286 / 0.521 s, roughly 95% / 92% lower for those processing phases. These are individual device samples, not a guaranteed end-to-end improvement. Native 10 MiB totals across three pairs ranged 4.573–7.723 s outbound and 6.191–7.301 s inbound. Remaining network/control/history variation exists. Totals exclude phone synthetic fixture generation/hash but include actual preparation and completion observation; hosted fixture upload is included. Neither total nor idle elapsed is raw network throughput.

Evidence:
- builds/transfer-scaling-1793059765661.json — first native matrix.
- builds/transfer-scaling-1793059937051.json — fresh Dev startup pair.
- builds/transfer-scaling-1793059995837.json — final matrix, all six native WSS verified.
- builds/native-stream-dev-build.log, native-stream-full-tests.log, native-stream-typecheck.log.

## Startup fallback investigation: not fully resolved

A deliberate restart of only com.axonic.dev initially found the account still resuming; no transfer was sent until ready. The fresh-start 10 MiB pair then used native WSS both ways: 4.948 / 6.191 s end to end, 1.775 / 1.699 s stream attempt time. The previous 29.652 s partial-stream cold failure did not reproduce.

However, the first native matrix's 5 MiB outbound took 12.341 s and had no new WSS attempt at all. It used encrypted block reads (4.493 s), while direct-status request elapsed was 6.481 s and history snapshots 2.173 s. Those aggregates overlap and are not proof of the precise historical cause. Inspection confirms control requests may wait behind authentication/custody/push/call traffic and have a bounded response timeout; absence of a WSS attempt distinguishes admission/selection delay from slow native encryption. The final 5 MiB repeat streamed successfully in 3.924 s. Do not claim every startup/route fallback fixed; receiver-side admission evidence remains needed for an intermittent no-attempt case.

Foreground attachment testing does not certify live background FCM recovery. Shared authorization, replay rejection, checksums, receipt semantics and data retention remain intact.
