# Axonic Dev on a physical Android phone

The optional local debug build uses `com.axonic.dev`, the launcher label
**Axonic Dev**, and the `axonic-dev` URL scheme. It has separate storage from
the installed `com.axonic` release app. Sign in separately; do not uninstall
the release app to use this build.

The `withSideBySideDev` Expo config plugin preserves this setup after prebuild.
Only debug builds with `-PaxonicSideBySide=true` receive the alternate identity.
Normal debug and release builds retain their existing identity. The Kotlin
namespace remains `com.axonic`.

Firebase project `axion-3b993` has a separately registered Android app for
`com.axonic.dev`. Local, ignored Google services configuration includes that
client and preserves the existing `com.axonic` mapping. It lives in ignored
`builds/google-services.json`; the plugin copies it into the native debug source
set. The existing release configuration remains unchanged. Do not commit the JSON.
Google sign-in additionally requires registering the development signing
certificate with the appropriate OAuth Android client.

From the mobile repository, using the configured Android SDK and Java:

```powershell
$env:SENTRY_DISABLE_AUTO_UPLOAD='true'
.\android\gradlew.bat -p android :app:assembleDebug -PaxonicSideBySide=true -PreactNativeArchitectures=arm64-v8a --console=plain
```

Verify the APK identity, label and architecture before installing on an
explicitly selected phone. Building another debug variant replaces the APK
under `android/app/build/outputs/apk/debug`, so preserve a named copy in the
ignored `builds` directory.

For USB development, reverse only Metro's port (`tcp:8081`) and launch the
development URL explicitly in `com.axonic.dev/com.axonic.MainActivity`:
`axonic-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081`.
This port mapping supplies JavaScript; peer and backend traffic still use the
phone's active network. Keep Wi-Fi and USB tethering off for cellular testing.

For this USB setup, start Metro with an explicit scheme (native manifest
placeholders cannot be inferred by Expo's QR-code scheme discovery):

```powershell
$env:REACT_NATIVE_PACKAGER_HOSTNAME='127.0.0.1'
node node_modules/expo/bin/cli start --dev-client --scheme axonic-dev
```

If Expo's cloud manifest request fails with `UnexpectedServerError`, set
`EXPO_OFFLINE=1` for that Metro process. This disables Expo CLI cloud lookups,
not the app's backend or peer networking. Avoid `--localhost` on this Windows
host: it bound only IPv6 `::1`, while ADB reverse used IPv4 `127.0.0.1`.

Verified on 2026-09-27: ARM64 build 1.0.41 installed as `com.axonic.dev`
alongside the existing `com.axonic` release. Metro loaded the app over USB and
the account screen opened; notifications permission was enabled. Chaty signed
in successfully; Expo and FCM token registration succeeded. With Wi-Fi off,
foreground text delivery passed over P2P in both directions against an emulator.
Background fallback displayed an Android notification; tapping it opened the
correct conversation. Both local databases contained one copy of each test
message and passed SQLite integrity checks. The reusable APK is
`builds/Axonic-Dev-1.0.41-arm64-20260927.apk`.
