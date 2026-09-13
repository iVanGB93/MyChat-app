# Axonic crash reporting

Project: https://qbared.sentry.io/settings/projects/axonic-mobile/

The public DSN in `src/services/crashReporting.ts` accepts reports, but cannot
read issues or administer the account. `EXPO_PUBLIC_SENTRY_DSN` overrides it;
an empty value disables reporting. Debug clients do not report unless
`EXPO_PUBLIC_SENTRY_DEBUG=true` is explicitly set for testing.

## Builds

- Sentry is aligned with Expo SDK 55's recommended `~7.11.0` range.
  Keep Expo dependency validation enabled. `enableLogs: false` and the
  disabled Breadcrumbs integration prevent automatic console collection;
  the version-8-only `enableAutoConsoleLogs` option is not used.
  Existing development clients containing Sentry 8 must be rebuilt before
  testing this version; do not mix the new JavaScript with the old native SDK.
- Local upload authentication is stored in the Git-ignored `.sentryclirc`.
  Never commit it, copy it into the app, or share it in logs.
- `SENTRY_AUTH_TOKEN` is configured as a project-scoped secret in the EAS
  production environment. Other build environments need their own secret
  configuration; local ignored files are not uploaded as cloud credentials.
- Organization and project default to `qbared` / `axonic-mobile` in the Expo
  config. `SENTRY_ORG` / `SENTRY_PROJECT` can override them.
- The new native dependency and plugin require regenerating native configuration
  (`npx expo prebuild --platform android`, no clean needed) and rebuilding the
  development client. An Expo reload alone is insufficient.
- Metro adds debug IDs; the Sentry plugin uploads JavaScript/Hermes source maps,
  Android mappings, and native symbols during the corresponding release build.
- Preserve matching debug artifacts for every build. Do not ignore upload
  failures in a release intended for crash reporting.
- Source maps may include application source code. They are private build
  artifacts, not chat history. Native source context uploads are disabled.

## Privacy and coverage

Sentry replay, screenshots, view hierarchy, console logging, HTTP capture,
automatic breadcrumbs, performance tracing and profiling are disabled.
No account identifier or contact information is attached. JavaScript reports
are reconstructed from allowed fields, keeping stack coordinates, a narrow
set of device/version fields and fixed technical tags. Arbitrary error text,
requests, local variables, extra data and breadcrumbs are removed.

Native crashes bypass JavaScript `beforeSend`. Native SDK technical diagnostics
therefore also require Sentry project-side scrubbing and IP removal. Do not
claim the JavaScript sanitizer covers native crash reports. SDK initialization
currently happens when JavaScript starts; pre-initialization failures and OS
kills without crash reports are not guaranteed to be captured.

Reports go directly to Sentry, not Railway. Offline reports may be delivered
on a later launch. Repeated notification-navigation exhaustion is reported
only once per operation per process. Normal reconnection attempts do not
generate error reports; only the fixed connection-state value is attached.

## Release verification

1. Deploy the updated website privacy disclosure before public rollout.
2. Review Play Data safety / future Apple privacy declarations for crash logs,
   diagnostics, identifiers and third-party processing using the final SDK
   configuration. Do not declare that no data is collected.
3. Build and install an internal test client without clearing its data.
4. Enable development reporting for that test only. Verify a harmless handled
   error arrives, then test an intentional JavaScript crash and a native crash
   separately on an emulator. Relaunch and confirm readable source locations,
   build/version tags, device information and scrubbed fields.
5. Test offline capture, later upload, and normal notification opening. Never
   deliberately crash a user's production installation.
6. Remove test triggers and disable debug reporting before release.

Existing installations receive no reporting until updated. This setup does
not authorize production builds, commits, store submissions or deployment.

## Verification status — September 13, 2026

- Both emulators delivered harmless handled JavaScript test reports to Sentry.
- Development clients were rebuilt and updated without wiping their data.
- Local build-upload authentication was verified; EAS production secret creation
  succeeded. Release artifact uploads remain to be verified in a release build.
- Android's SDK crash test explicitly requires release mode; native fatal-crash
  capture is not yet verified by the development-client test.
- Project IP storage is disabled. An additional server rule removes `user`
  because initial test events still contained approximate geography. Verify
  that rule against a fresh event before public rollout.
- Offline recovery and release-mode crash symbolication remain release checks.
- Temporary smoke-test and crash triggers have been removed from app code.
