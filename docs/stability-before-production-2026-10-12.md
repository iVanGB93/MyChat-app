# Stability changes before the next production build

## Call recovery

Temporary ICE `disconnected` events retain media and show “Reconnecting…”. After
five seconds the caller may initiate one ICE restart; `failed` starts that attempt
immediately. The callee waits for the caller's offer. Both sides now use a thirty-five-second
recovery deadline that repeated state events cannot extend. A successful connection
cancels recovery timers; hangup cancels queued recovery. Restart negotiation uses
the existing serialized signaling queue and does not overlap an outstanding offer.

The existing forty-five-second initial connection deadline remains separate.
Failed restart signaling during the recovery window no longer ends the call early.

## UI refresh work

- The account shell polls only a primitive connection count. Detailed diagnostics
  refresh within the focused network screen instead of refreshing the navigator.
- Foreground UI polling serializes refreshes, cancels background timers and rejects
  stale asynchronous results. Network runtime lifetime is unchanged.
- Chat-list row callbacks are stable. Direct-chat history and its list element are
  memoized independently of composer text, while message, transfer, theme, identity
  and blocked-state changes still refresh the list.
- Chat storage polls only when focused and foregrounded; file-size observations
  are cached outside render and still refresh when an attachment finishes.
- Notification navigation polling pauses in the background and checks foreground
  state again after asynchronous reads.

## Render failures

Explicit boundaries cover the app shell, navigation screens and call UI. They show
a retry screen without exception text or data deletion. Reporting goes through the
existing Sentry privacy sanitizer. React render boundaries do not catch native
crashes or arbitrary asynchronous errors. A boundary retry remounts its affected UI;
media cleanup still runs if the call UI fails.

## Validation and release limitation

Regression coverage includes transient ICE recovery, failed ICE restart, repeated
events, deadlines, hangup, foreground timer lifecycle, stale results and fallback
retry. Full TypeScript, unit and architecture checks run via `npm run check`; log:
`builds/stability-prerelease-check.log`.

Live emulator call setup did not reach the receiving emulator; it remained in
`finding` before it was ended. The Dev phone debugger was unavailable for the
alternate test. No live media recovery or actual network handoff pass is claimed.
Repeat that release check with two reachable Dev peers before calling recovery
fully device-validated. Temporary call instrumentation was restored.

These are mobile changes; no AoN deployment or production build was performed.
Each production build still requires explicit user confirmation.

## Follow-up: two physical Dev phones

Both phones were connected and their existing Dev identities unlocked without
reinstalling or clearing data. Normal voice calling reached ringing immediately;
both sides connected and native inbound/outbound audio byte counters increased.
A simulated transient ICE event retained the live call.

A real Wi-Fi-to-cellular change on the caller exposed a release blocker. After
seven seconds both sides still reported connected/completed. By fifteen seconds,
the caller's inbound audio counter had stopped at 68,941 bytes and the recipient
reported disconnected while the UI call remained ready. After Wi-Fi restoration,
both calls ended. Wi-Fi was restored to its original enabled state.

A subsequent video test exchanged audio and 188 decoded/encoded video frames on
the sampled caller, but the recipient had already ended its call. This is not a
video stability pass. Both calls were ended and test hooks restored. Sampled
ReactNativeJS/AndroidRuntime error logs contained no crash entries.

The current full check still passes: 944 tests, three skipped, plus TypeScript and
architecture checks. These passes do not override the live failures. Production
readiness is withheld. Investigate asymmetric ICE recovery and the coordinator's
ten-second route-gap deadline versus the twenty-second media-recovery deadline;
the deadline mismatch is a code finding, not yet a proven cause of these calls.

## Instrumented recovery fix

The follow-up trace confirmed coordinator termination with `Peer disconnected`
after native ICE reconnected. It also captured a restart offer failing after the
local connected event had already cleared recovery state.

Established routed calls now allow a 45-second signaling-route gap; initial setup
retains ten seconds. Essential offers/answers retry transient failures, bounded
to twelve attempts and a 25-second elapsed budget checked after failed attempts.
Optional trickle candidate failures no longer terminate media. Hangup cancels
pending waits, and newer SDP supersedes older retries. Signature, selected-device,
call-binding and replay checks remain enforced.

Validation: 948 mobile tests passed, three skipped; all 155 hosted tests passed.
The physical video handoff recovered through retried offer/answer delivery, with
both peers connected and increasing audio/video counters afterward. Caller decoded
frames increased from 890 to 1,403 in post-recovery samples. Recovery took about
30 seconds: this is recovery from an interruption, not seamless handoff.

Both AoNs subsequently deployed the matching tested runtime
`3f24b369bd6c042fa793973cdbab2d7d68424895810f1285f00bca506319beb1`.
Authenticated status/chat verification succeeded for each: active network, five
connected peers, and no own queued messages at the time of verification. Identities
were preserved. No production mobile build or official-app installation occurred.

Final voice retest also passed after a five-second Wi-Fi interruption on the
recipient phone. Both peers remained ready/connected after recovery. In successive
samples, caller inbound audio grew from 72,476 to 102,174 bytes and recipient
inbound audio from 62,137 to 90,231 bytes; outbound counters also increased.
Both calls were ended, instrumentation restored and both Wi-Fi settings verified
enabled. Sampled JavaScript/Android error logs were empty.

The earlier call-recovery release blockers are cleared by these Dev phone tests.
The next production build is ready for user approval. Recovery can still cause
an audible/visible interruption, and these checks are not an all-carrier guarantee.
