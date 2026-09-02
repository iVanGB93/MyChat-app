# Axonic two-device smoke suite

Both emulators must already contain the development build and be signed in to
the two test accounts. Install Maestro, then run from the app repository:

```powershell
.\scripts\run-two-device-smoke.ps1 `
  -SenderSerial emulator-5554 `
  -ReceiverSerial emulator-5556 `
  -SenderChatName "Receiver username"
```

Add `-IncludeCall` to verify that a voice-call request creates the receiver's
incoming-call notification. The harness ends the outgoing test call after the
notification check. It never resets app data or changes the signed-in users.

The harness warms the receiver before putting it in the background. This makes
sure Metro, Axion authentication, and push-token registration are ready, so a
failure reflects Axonic delivery rather than a cold development-client launch.
