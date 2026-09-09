# Easier sign-in rollout

## Implemented

- Login and registration offer email-code sign-in; password flows remain.
- Email proof comes before choosing a username for a new account.
- Existing accounts retain their ID, chats, password and profile.
- First-time Google sign-in requires a mailbox code to explicitly link or create
  the account. Later Google logins resolve Google's permanent subject ID.
- Google is hidden without the public client ID or the native module. Existing
  development clients should not crash from a missing Google native module.
- Codes expire after ten minutes, allow five wrong guesses, are single-use, and
  are stored hashed. Requests have a one-minute cooldown and five/hour/email cap,
  plus IP throttling. Expired challenge records are pruned after two days by Beat.
- Account linking refuses ambiguous legacy duplicate emails, disabled accounts,
  provider conflicts and replacement of an existing Google link.
- New passwordless users can establish a password through password reset.

## Deploy email login first

1. Deploy backend changes, including migration
   `users/0018_signinchallenge_googleidentity.py`. Use the normal deployment's
   migration step; no production migrations were run during implementation.
2. Deploy Worker and Beat code as well so the new cleanup task is registered.
3. Keep the existing verified email sender and Resend/SendGrid/SMTP configuration.
   Email failures are reported without returning credentials or provider errors.
4. Test with a dedicated mailbox: existing-account login, new-account registration,
   wrong/expired code, resend, cancellation, and password fallback.

The emulator accounts were not logged out and no live verification emails were
sent during implementation. Automated tests use mocked email/Google verification.
PostgreSQL concurrent verification and live provider flows still need validation.

## Set up Google (Android)

1. Open Google Cloud Console and select the same project used by Axonic's Firebase
   Android app. Configure Google Auth Platform branding, audience and contact email.
   While in testing mode, add the Google accounts that will test sign-in.
2. Create an OAuth client of type **Web application**. Copy its **client ID**.
   Do not put a client secret in the app; this ID-token flow does not need one.
3. Create Android OAuth clients for package `com.axonic`, with the SHA-1 signing
   certificate of each actual build you test. Include the development certificate
   and Google Play's **app-signing** certificate for Play-installed releases;
   the upload-key certificate alone is not sufficient for Play-installed apps.
4. Set this backend Railway variable:

   `GOOGLE_SIGNIN_WEB_CLIENT_ID=<Web application client ID>`

5. Set this public Expo build environment variable to the identical value:

   `EXPO_PUBLIC_GOOGLE_SIGNIN_WEB_CLIENT_ID=<Web application client ID>`

6. Deploy the backend. Restart Metro after changing local public Expo variables.
   Rebuild/reinstall Android development clients **with user approval** to include
   `@react-native-google-signin/google-signin`. A JavaScript reload cannot add it.
7. Test first-time linking, returning Google login, cancelling the chooser, and a
   different Google account. Verify existing chats remain under the same user ID.

The user-created Web client was verified from the downloaded OAuth JSON and
Google Cloud's client list on September 9, 2026. Its public ID is now the default
in both backend settings and the mobile sign-in service; the environment variables
above remain optional overrides (an explicit empty value disables Google).
No client secret or service-account private key was copied into either repository.
The backend default takes effect only after deployment; Railway live variables
were not changed.

Android debug registration was created and verified in Google Cloud on September
9, 2026 as `Axonic Android development`, for `com.axonic` with SHA-1:
`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`.
This was read from the existing `android/app/debug.keystore`; confirm it again if
that keystore is replaced. Google Play's app-signing fingerprint must be registered
separately for production. Native development clients have not been rebuilt.

Google Cloud still reports incomplete branding. The user-approved Google test
account was added and verified on September 9, 2026. Branding still needs review;
production publishing and
the Play app-signing client remain outstanding. The 16 isolated backend auth tests
were rerun successfully after configuring the public Web client ID.

The user deployed the backend; Railway reports release `1.0.37` active. Production
health returned HTTP 200 and an empty POST to `/api/users/signin/google/` returned
the expected HTTP 400 missing-id-token validation error. No live sign-in, mailbox
challenge, or token verification was performed by this endpoint smoke check.

iOS/Apple sign-in is not
part of this phase; Google UI is Android-only until iOS configuration and the
appropriate App Store login options are implemented.

References:
- https://react-native-google-signin.github.io/docs/setting-up/expo
- https://react-native-google-signin.github.io/docs/setting-up/get-config-file
- https://developers.google.com/identity/sign-in/android/backend-auth

## Verification at implementation

- 77 backend tests pass (16 new auth/retention tests).
- 183 app tests pass (5 new auth-service tests).
- Strict TypeScript check passes; migration drift check reports no changes.
- No production build, deployment, app reinstall, or live account mutation run.
