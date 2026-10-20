# Dev group invitation investigation — 2026-10-20

## Scope and preservation

Physical Phone Dev, `com.axonic.dev`, and the existing Axonic Integration Test group
`9a5b5af9fea4f27ceaa10e0a87ce0ba8a4897686e73e42eb3851077be68695e9`.
No manual data deletion, queue reset, group recreation, normal-app changes,
commit, push, or AoN deployment. Ordinary authenticated delivery/receipt handling
continued normally. ThirdNeuron's exact existing test invitation was accepted
after checking its group name, administrator, and four-member audience.

## Observed cause and fix

ThirdNeuron's membership packet `453c98b7…51ff7e` and backup
`3fb2b76a…947e3` were durably held by the connected emulator
`axonic:1:97d465b730fd1b4d4c04bff33d20fbc84fd8c45b526c53fe28153f9e2b6421a3`.
Phone Dev was connected to the emulator, FirstNeuron and SecondNeuron, but not
ThirdNeuron. Introductions from both public AoNs advertised ThirdNeuron.

The courier kept preferring the saved custodian whenever it remained connected:
storage acceptance could therefore keep traffic on a relay with no observed
recipient route. Added optional recipient-reachability hints to custodyCourier,
wired to unexpired introductions in neuronRuntime. A connected eligible relay
advertising the recipient is now preferred over a saved relay without that hint.
Within the same preference tier, the saved relay remains preferred.

The original packets then moved through SecondNeuron, arrived at ThirdNeuron,
and subsequently showed delivered on Phone Dev. No invitation was fabricated
or manually marked delivered.

## Preserved protocol contract

This is relay scheduling, not a change to encryption, recipient identity,
signature checks, packet bytes, expiry, or verified receipt semantics.
The existing stored ciphertext is reused on an alternative relay. Introduction
information is a routing hint, not authenticated proof of delivery or a guarantee
that a relay will forward. Existing fallback limits and relay backoff remain.
An additional relay may hold a duplicate encrypted copy until normal receipt or
expiry handling; no plaintext is exposed. This is a scoped implementation review,
not a formal cryptographic proof.

## Validation

- `node --test tests/custody.test.cjs`: 57 passed.
- `npx tsc --noEmit --pretty false`: passed.
- New regression verifies rerouting an already-held packet, one seal only,
  byte-identical packet reuse and stable preference after rerouting.
- Dev live test verifies existing invitation receipt and group acceptance.
- DEV-G1 text reached all three AoNs.
- DEV-G1 used `ATOMiX/OpenClaw`, which does not match the channel's current
  mention delimiters. It is not evidence of failed event transport.
- Corrective DEV-G1B used `ATOMiX,`; one logical quoted reply was generated,
  with three per-recipient delivery records. Phone Dev visibly received
  “ATOMiX ThirdNeuron - Message quoted successfully.”
- DEV-G2 sent a harmless shapes/code image from the picker (2,660,764-byte PNG)
  with the caption addressed to Muse, Axon and ATOMiX. FirstNeuron and SecondNeuron
  reported received/delivered. ThirdNeuron received its descriptor and caption,
  but its incoming media job remained downloading at cursor 0, with seven
  failures at the sampled check. The root cause of that media stall is not
  established by the invitation fix.
- Muse/Axon replies in this new Dev group were not verified at the final sample.
  Do not claim full AI integration or all media tests passed.

## Remaining work

Trace ThirdNeuron's media acquisition errors and available custodians separately.
Verify Muse/Axon subscription/audience coverage for the new test group rather
than treating successful server receipt as proof of AI processing.
AoNs have not received this mobile courier change; any deployment needs user
approval and repository/build validation first.

## Follow-up investigation

The media subsequently completed on ThirdNeuron without a deployment, reset,
manual completion, or retransmission. Its sender-side checkpoint contains both
the emulator and FirstNeuron as custodians, with FirstNeuron the final relay,
cursor 650 and phase complete. ThirdNeuron independently reports delivered and
has no remaining active media job. ATOMiX produced one logical image-analysis
reply (`ab55367f…c4674bf`) at 1792513352868, about 261 seconds after the
image message's creation. This interval includes transfer and AI processing;
it is not a pure download benchmark.

The worker initially prefers a non-audience custodian for shared group media,
which favored the emulator. A sender's connected relay is not necessarily
reachable by the destination. The exact trigger for the eventual switch to
FirstNeuron was not captured; do not claim the entire delay is explained.

Test-media correction: the picker sent `74822.png`, a diagnostic screenshot of
the gallery picker containing the shapes and other gallery thumbnails, NOT the
original shapes-only PNG. ATOMiX's reference to Photos/Collections is consistent
with that screenshot. No additional media was sent after discovering this.
No deletion was performed; the user was informed.

Muse's supplied October 18 audit source filters incoming messages against
`AUTH_PEERS = {IVAN, LEIDIANA}` and adds observed IDs to seen before filtering.
Phone Dev is a different identity. This is a concrete explanation supported by
the supplied source, but Muse's current remote configuration is not inspectable
here. If changed, catch-up must explicitly reconsider the authorized test IDs;
do not clear the seen watermark or replay all history.

SecondNeuron's test group is accepted, unblocked, with four members. Text and
image are present; no outgoing Axon reply is present at the final read. Incoming
test rows now have readAt timestamps, which alone do not establish an AI turn or
its trigger. Adapter events increased from 127 to 129; processed declarations
stayed at 14 and operation count at 17. Health reports two active-flag
subscriptions but does not expose filters, expiry, callback outcomes or cursor.
Code excludes expired subscriptions from delivery even if active remains 1.
Thus health's active count is insufficient to establish a functioning listener.
Read-only Railway SSH access failed because no SSH key is registered; no key
was added. Axon's live subscription filters/expiry and platform-side handling
remain unverified. Need Axon's subscription evidence or separately authorized
adapter access/diagnostic deployment, not guessed credentials or blind resubscribe.

## Final test pass (October 20)

- Owner confirmed permission granted to Axon and Muse for the Dev group.
- Verified on Phone Dev: Axon's quoted reply `8cc12354…082da` and Sugar's
  quoted reply `a2e504ab…4f803`. Axon's text explicitly reports browser/manual
  execution after approval, not native owner-only auto-reply.
- Sent one final test, logical ID
  `563f0680bd24dbea6a0f551c4f959a1fe246b9c2e2cebdb056e45189df300392`,
  created 1792513961882. ATOMiX produced logical reply
  `9913f6e06dc7d04a8b8d0f64f583670170b88267fa501aa210d893e6b0d9e8ac`
  at 1792513980205 (18.3 seconds), with correct identity, quote and image code.
  The channel's handled count reached 64 and outbox was empty. Its generated
  claim of a "manual trigger" is not reliable telemetry: no manual agent
  invocation was made for this test. Do not infer exact SSE-versus-sync trigger.
- Reopened only com.axonic.dev using its actual launcher
  com.axonic.dev/com.axonic.MainActivity and existing Metro server. Saved group,
  completed image checkpoints and delivery states survived. First/Second
  connections reestablished. This is phone restart/reconnect evidence, not a
  live restart test of the external Muse/Axon runtimes.
- OpenClaw regressions: 47/47 passed in WSL with installed SDK via documented
  `OPENCLAW_PACKAGE_JSON=... node --import test-sdk-loader.mjs --test ...`.
  Initial invocations used an unavailable Windows SDK / incorrect loader mode;
  these were test setup errors, not counted as passing runs.
- MCP regressions: 29/29 passed with localhost test servers permitted. Initial
  sandbox run was interrupted after the localhost integration test failed.
- Regression coverage includes reconnect/catch-up, stable IDs across failed
  sends, media integrity and separate permission controls. It does not prove
  live Muse/Axon autonomous handling in the new group.
- At the final FirstNeuron sample, no Muse or Axon response to DEV-FINAL-1 was
  observed. Their earlier approved replies passed; repeat automatic response
  remains unverified. No blind replay, subscription changes or permission bypass.
- User requested unrestricted ordinary group conversation. Sent a clarification
  withdrawing the test-only "do not reply to each other" instruction. No new
  privileged-tool authority was granted and no channel configuration changed.
  Existing platform sender filters / OpenClaw mention gating remain distinct
  configuration questions, not silently claimed removed.
- No production build, deployment, commit, reset or data deletion.

## Fresh automatic-response check: DEV-AUTO-2

Sent once through Phone Dev UI after the owner reported Axon's listener-task
owner-only rule removed. Metro was not attached to the phone, so no debugger
injection was used. Normal app untouched.

- Original logical message: `da58c38bca903381cb9e1ac97fb33f203e461baeac3f630f16f9837994db9594`,
  created `1792515707276`.
- ATOMiX: one quoted logical reply `6a285c091f252e5bd51fa9341623dcc84217929cec151d6c78d5f3be456fbf6f`,
  created `1792515724596` (17.320 seconds). Visible on Phone Dev.
- Axon: one quoted logical reply `69d94a2da9db6bda37c8a5ad3d95f442d94ab6cc0a720ced2026e6c57f9bde57`,
  created `1792515841189` (133.913 seconds). Phone Dev delivery confirmed
  at `1792515846008`. Three outgoing rows are per-recipient deliveries,
  not three replies. Adapter webhook acceptance, operation count 17→18,
  and processing declarations 14→17 support native processing; its response
  also identifies a native message.ready trigger.
- Sugar: one quoted logical reply `1705ddb29752bcb11b78ae57e47914334e1c67df075b8de45982ec550d1bec16`,
  created `1792515849773` (142.497 seconds). Visible on Phone Dev. Sugar
  reports event-hook wake; her private runtime telemetry was not inspected.
- No manual AI invocation or outgoing AI reply was generated by Codex.
  All three replied to the fresh test without additional owner prompting.
  End-to-end times include delivery, platform scheduling and AI processing.
- Sugar also acknowledged ATOMiX, and ATOMiX acknowledged Sugar. These are
  distinct replies to other messages, not duplicate test responses. Monitor
  for unnecessary acknowledgment loops without forbidding ordinary conversation.

## Renewal follow-up

Official MCP contract uses events/subscribe for automatic platform refresh.
Native refresh regression passed. Added authenticated owner-bound fallback
neuron_renew_subscription and refresh observations, preserving cursors/filters,
retry state and listener count, rechecking callback and authorization.
No bypass of OAuth expiry; no disabled-listener reactivation.
All 37 MCP tests passed. Commit ba140bf pushed on
codex/mcp-event-health-20261020, MCP files only.

Authorized adapter-only deployment was attempted twice. Railway rejected both:
"Deploys have been paused temporarily". No new deployment was created; live
adapter remains deployment 17e6ab81-2e2d-474e-a265-5a78f03eb472 (4ad077d).
Staged committed source: builds/mcp-renewal-ba140bf. Initial staging copy
used wrong Dockerfile paths; corrected to integrations/mcp/deploy before
second attempt. Do not claim the renewal tool is live.

At observedAt 1792515923887, exactly two subscriptions remained eligible,
cursor 160, no backlog or retries, expiry still 1792517745000
(2026-10-20 17:35:45 UTC). No renewal occurred. Platform automatic refresh
and sustained post-expiry listening remain unverified.

### Renewal monitor, 17:36 UTC

Both existing subscriptions renewed to 1792521005000 (18:30:05 UTC,
2:30:05 PM EDT) on the unchanged live adapter, before the old expiration.
IDs and sampled cursor 162 remained intact; no Codex renewal mutation.
This confirms native renewal is operating independently of the fallback patch.
Filtered observation counts increased during refresh; historical filtered
events appear to be rescanned. No additional accepted callbacks were recorded
before the new test. Do not equate filtered counts with unique events.

Sent the one authorized post-renewal group test, DEV-RENEW-1, via Phone Dev UI:
logical ID 6ddf1e4888ab99ccc1b835b0a98a0c3af968e89aa7f545178f39bf5674ac084f,
created 1792517818509, after original expiry. Asked only Axon for one quoted
reply. SecondNeuron received it and callback accepted event
bb20200060792f43ffed5b35fcd9f0edd8c50692175d179655346f4596c58907 at
1792517824661. Cursor 163; processing declarations still 20 at initial sample.
Next monitor must inspect this test's reply, not send another test.
Railway still pauses builds; ba140bf remains undeployed.

### Post-renewal processing verified, 17:40 UTC

Axon's single logical quoted reply to DEV-RENEW-1:
0794636ebaccde3fe7a06b957696e3bb38a3af319f09055d52156dac7ce56d8b,
created 1792518003508 (185 seconds after original). Phone Dev delivery
confirmed 1792518008276. Adapter operation count 18→19 and processing
declarations 20→22 support actual processing after the original expiry.
Same two subscription IDs; expiry 1792521005000; cursor 167; no backlog/retries.
Native renewal plus post-renewal response now verified. No second test needed.

Separate unexpected behavior: ThirdNeuron also replied to DEV-RENEW-1 despite
the no-test-reply request, saying "Axon ThirdNeuron" rather than ATOMiX.
Logical ID 5f5902df337948e2484299b858354e8ec5b671762369a84a06aadacd374cb83f,
created 1792517838538. Sender is ThirdNeuron, not SecondNeuron. Preserve this
as identity/instruction-following regression evidence; no channel changes
authorized as part of the adapter-only heartbeat.
Railway remains Identified/paused. Adapter ba140bf deployment still pending.

### Adapter deployment completed, 20:46 UTC

Railway resumed builds for this workspace. Approved adapter-only release
ba140bf deployed successfully as 385d2c85-2436-4912-9e7c-dbb0aeea0153.
Deployment status SUCCESS; /health and /ready both returned ok:true.
Live neuron_capabilities exposes neuron_renew_subscription.
Both existing listener IDs survived unchanged, cursor 168, no backlog/retries.
Native renewal advanced expiry repeatedly, now to 1792530631000
(21:10:31 UTC / 5:10:31 PM EDT). Post-renewal AI processing and phone receipt
were already verified by DEV-RENEW-1 above; no additional test was sent.
New renewal observation fields correctly report not_observed for renewals
preceding this deployment; historical renewal evidence was not fabricated.
No AoN deployment, data deletion, queue reset, credential/filter change or
cursor replay occurred. Deployment and post-renewal verification are complete.
