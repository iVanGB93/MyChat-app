# Direct media streaming experiment — 2026-10-12

## Scope

This is an isolated Dev experiment, not an enabled app feature. The app's normal transfer protocol, native identity-channel guard, UI, ciphertext custody and fallback remain unchanged. No AoN deployment or production build is required for these experiment scripts.

The experiment establishes a separate reliable ordered WebRTC data channel between the test emulator and the phone's `com.axonic.dev`. Each endpoint signs its SDP with its existing local identity. The other endpoint checks the signature, intended recipient, expected sender, session nonce, validity period, SDP constraints and current known identity record before accepting it. Signed SDP binds the DTLS certificate fingerprint. The desktop transports these signed signals as a test fixture; production discovery/signaling is not part of this test. Raw signals, private keys and addresses are not written to the result logs.

The media is synthetic data, not personal phone media. It is not additionally encrypted into Axonic's per-chunk attachment format. WebRTC DTLS still encrypts the connection. No plaintext media is handed to an AoN or other relay.

## Streaming contract

- One file offer and one verified completion receipt per transfer, up to 8 MiB in this lab.
- Read and write the file through open handles using either 16 KiB or 64 KiB binary buffers. There is no application request/proof/encryption operation for every 4 KiB of media.
- Bound outstanding data to 256 KiB with cumulative acknowledgements. Do not load an entire video into memory for transmission. Synthetic fixture generation is outside the transfer timer.
- Hash the source, transmit its size and SHA-256 over the authenticated channel, then verify the complete destination file before acknowledging completion. An independent desktop hash of the synthetic source also checks the received file outside the timing interval.
- Reject invalid offers, unexpected data, oversized frames, invalid acknowledgements and incorrect hashes. Close the experimental lane on failure. Delete incomplete receiving fixtures on disconnection. Stop on account locking or failed connection; cleanup removes only explicitly tracked synthetic fixtures.

Splitting a file into transport buffers does not require splitting it into independently encrypted attachment objects. This experiment tests streaming and a simpler transfer workflow together; it cannot attribute all improvements to removing the extra encryption layer.

## Measurement method

`scripts/experiments/compare-direct-stream.cjs` runs three repetitions per mode in rotated/interleaved order. Small files contain 524,287 bytes; large files 2,097,151 bytes. Endpoints are a Windows-hosted Android emulator and a Samsung Android phone over established RTC connections. Both use development builds and Metro, not release builds. Each configuration has its own connection, so this is an end-to-end architecture comparison, not a controlled comparison of one cryptographic primitive or guaranteed identical ICE paths.

Normal-path timing starts before the ordinary attachment queue call and ends when the sender processes the verified delivery receipt; it includes preparation, staging and scheduling. Direct timing starts before source hashing and ends at the verified completion receipt. Fixture generation and channel setup are excluded from both. Setup latency, discovery, cold start, push wake, background execution, chat persistence and relay fallback are not demonstrated by the direct timer.

Raw results, per-run observations and source fingerprints are stored in `builds/direct-stream-comparison-1791821491530/`. The initial direct 512 KiB smoke test is separate from the repeated comparison.

## Results

All 15 repeated transfers completed and matched the independently calculated SHA-256. Times are seconds, with three repetitions per row. The slower observations remain in the dataset.

| File size | Mode | Individual times | Median |
| --- | --- | --- | --- |
| 524,287 bytes | Normal attachment queue | 34.052, 8.367, 9.187 | 9.187 |
| 524,287 bytes | Direct stream, 16 KiB buffers | 0.662, 0.857, 0.669 | 0.669 |
| 524,287 bytes | Direct stream, 64 KiB buffers | 3.417, 0.768, 0.921 | 0.921 |
| 2,097,151 bytes | Normal attachment queue | 28.883, 68.057, 29.827 | 29.827 |
| 2,097,151 bytes | Direct stream, 64 KiB buffers | 3.132, 2.992, 2.415 | 2.992 |

The experiment supports investigating direct streaming. It does not establish a production speed guarantee or that encryption alone causes the difference. Larger buffers were not uniformly faster. Native binary bridging, channel setup and differing scheduling/queue/fallback behavior still need profiling. The normal queue performs additional durable-delivery work omitted from the prototype.

After measurement, RTC statistics showed a selected UDP path with host/peer-reflexive candidates (no TURN relay) and observed RTTs of 4–7 ms. This is a post-measurement snapshot, not per-run path telemetry. A fresh valid signed offer was accepted; altered target, session, expiry and SDP were all rejected. The forced-interruption test closed the channel after its first binary frame: the sender reported failure, no completion receipt was produced, and the partial receiving fixture was deleted once channel closure completed. An initial snapshot during closing still showed the partial fixture; the final snapshot confirmed deletion. Raw observations are in `builds/direct-stream-interrupted*.jsonl`.

The full app check passed with 852 unit tests and three intentionally skipped benchmarks, plus type/dependency/module/consolidation checks. The six dedicated streaming tests also passed after the live run. Both experiment channels and all tracked direct-stream fixtures were cleaned up; normal-path timing hooks were restored. Metro remains available in the development session. No private identities or existing chats were removed.

## Before production integration

This laboratory lane deliberately uses the standard WebRTC binary-channel adapter. It does **not** implement the production identity channel's native pre-bridge frame/rate admission for binary traffic. JavaScript bounds in the experiment are not a substitute for that protection. A production integration needs native admission tied to the authenticated recipient/session, bounded binary buffering, fair scheduling with calls/control traffic, approved incoming-conversation policy, durable message state/receipts, cancellation, resume, and an encrypted custody fallback before involving any intermediary. Unknown capabilities and insecure raw LAN sockets must use the existing encrypted format.

A successful direct stream is not proof that the full production fallback, recovery or group-sharing behavior has been preserved. Those integrations must be implemented and tested separately before enabling this path in the app.
