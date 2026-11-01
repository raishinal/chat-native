# Background messages and calls

The app and Laravel backend now contain native push registration, message delivery,
notification-to-conversation routing, system incoming calls, Answer/Decline/Mute,
call cancellation and expiry, and background call audio integration. These paths
are enabled for local and hosted development on Android. Production and iOS remain pending release/provider configuration. This is source integration;
lock-screen and cold-start behavior still requires signed builds and real-device QA.

## 1. Firebase (Android and iOS message notifications)

Create a Firebase project and register Android package `com.relay.privatechat`.
Download `google-services.json` into the mobile project root (git-ignored).
Enable Firebase Cloud Messaging HTTP v1 and create a service-account JSON key with
permission to send FCM messages. Store that private key on the backend, outside
the public directory. Do not put it in the app or in an `EXPO_PUBLIC_*` variable.

For iOS, register the same bundle ID, put `GoogleService-Info.plist` in the mobile
root (git-ignored), and upload an APNs authentication key in Firebase's Cloud
Messaging settings. iOS messages use FCM/APNs; incoming calls use PushKit directly.

Set backend environment values:

```dotenv
FIREBASE_CREDENTIALS=/private/path/firebase-service-account.json
APNS_KEY_PATH=/private/path/AuthKey.p8
APNS_KEY_ID=your-apple-key-id
APNS_TEAM_ID=your-apple-team-id
APNS_TOPIC=com.relay.privatechat
APNS_SANDBOX=true
```

Use `APNS_SANDBOX=false` for TestFlight/App Store builds and `true` for development
provisioning. The server needs HTTP/2 support in cURL for Apple VoIP requests.

## 2. Apple account (iOS incoming calls)

An Apple Developer account and an App ID with Push Notifications enabled are
required. Create an APNs authentication key, configure signing through EAS, and
use a physical iPhone. The config plugin generates PushKit delegation, immediate
CallKit reporting, background audio/VoIP modes, and the SDK 58 scene startup path.
EAS signing selects the appropriate development/production push entitlement.

## 3. Backend deployment

From the Laravel project:

```sh
composer install
php artisan migrate --force
php artisan config:cache
php artisan queue:work --queue=push,default --tries=3
```

Keep the queue worker under a process supervisor. Use a real queue connection
such as `database` or `redis`; avoid `sync` in production. Existing call-expiry
scheduling and Pusher configuration must also remain running. Push is dispatched
after the database transaction commits. Worker failures intentionally omit tokens
and credentials from exception messages. Monitor failed jobs and retry after fixing
provider configuration. Message previews contain sender name and “New message”,
not message text. Device tokens are encrypted and tied to an unexpired mobile login;
revocation, account suspension, or a different login on the installation stops old
delivery. Devices registered by older app versions must register again.

## 4. Mobile build

Set in the selected `.env.<environment>.local` or EAS environment:

```dotenv
EXPO_PUBLIC_NATIVE_PUSH_ENABLED=true
# Optional paths, including EAS file-environment variable paths:
GOOGLE_SERVICES_JSON=./google-services.json
GOOGLE_SERVICES_PLIST=./GoogleService-Info.plist
```

Build with `npx eas-cli@latest build --profile development --platform android`
or `--platform ios`. Supply Firebase app files through EAS file environment
variables when building in the cloud. Use Node 24.12 or newer for the installed
Firebase dependency versions. This feature needs a new native binary; an OTA
update or Expo Go is insufficient. If building from the existing generated
`android/` directory, regenerate it with `npx expo prebuild --platform android`
before the EAS build so the config plugins are applied. Do not edit generated
manifests or app delegates manually.

Sign in, allow notifications and microphone access, and on Android open Profile > Set up lock-screen calls and enable Relay
in the system phone accounts. Calls never reopen this setup automatically. Android uses the system Telecom call
screen. Audio can continue in the background through the call service; the camera
is disabled when leaving the app and can be turned on again after returning.

## Release verification (pending provider accounts and devices)

- Two signed-in devices: send a message with the recipient app foregrounded,
  backgrounded, normally closed, and the screen locked; tap to open its conversation.
- Call in each state; answer, decline, mute, and hang up from system UI and app UI.
- Cancel before answer, let ringing expire, and answer on a second logged-in device.
  Confirm stale pushes cannot leave a call ringing.
- Start an outgoing call, switch apps, lock the phone for several minutes, then
  return; verify two-way audio, heartbeat leases, Bluetooth and speaker routing.
- Exercise permission denial, phone account disabled, network loss/recovery,
  expired sessions, sign-out, account switching and token rotation.
- Verify both development and TestFlight/release push environments. Android
  force-stop, denied permissions, offline devices and OS power restrictions can
  prevent or delay delivery. Force-stop is different from closing normally.

References: [Expo notifications](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/),
[CallKeep Expo setup](https://github.com/react-native-webrtc/react-native-callkeep/blob/master/docs/guides/expo.md),
[React Native Firebase](https://rnfirebase.io/),
[FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api).

## Implementation verification

Mobile lint and TypeScript checks pass; the mobile regression suite passes 71 tests.
Android production JavaScript bundles exported with push disabled and enabled.
Backend regression tests pass (129 passed, 2 skipped). Changed backend files pass
PHPStan; the full run still reports the existing always-true token check in
`PasswordController.php:30`. Signed native builds and real-device push/call tests
remain pending provider accounts and credentials.

## Current local Android setup

Firebase Android client configuration is in the native workspace root and is
excluded from Git. `.easignore` includes that client file in EAS build uploads while
excluding all service-account keys. The service-account key is stored only in the
Laravel project's ignored `storage/app/private/push/` directory; its path is set
in the local backend `.env`. Google authorization and an FCM validation-only send
request succeeded; no test notification was sent.

The `local` and `development` profiles enable native push for Android. Development
uses https://chat.roshanlama.com.np; production remains disabled until release verification.
Node 24.12 is selected for EAS builds to match the Firebase dependencies.
Use `npm start` for the local API through ADB reverse forwarding. Use `npm run
android` to rebuild/install the development client. This development build needs
Metro running; test a release build with bundled JavaScript before release.

The local database migration has been applied. For subsequent sessions, start
MySQL in Laragon, then run from the backend directory:

```sh
php artisan serve --host=127.0.0.1 --port=8000
php artisan queue:work --queue=push --tries=3 --timeout=60
```

Keep the existing default queue worker and scheduler running when testing all app
features. The push-only worker intentionally processes only native push jobs.
The private service key is never included in mobile builds. iOS still needs an
Apple Developer account, APNs setup, and Firebase's iOS app configuration.

## Call connection and setup prompt fixes (1 November 2026)

After increasing initial ICE gathering to 1.5 seconds, prioritizing relay candidates
in the trickle queue, and avoiding ICE restarts while signaling is busy, the live
Samsung-to-emulator test reached WebRTC connected on both ends. The user confirmed
the call connected. Broader network and background-call verification remains pending.

Android phone-account registration now uses passive APIs during startup and incoming
calls. The interactive setup dialog is available only from Profile > Set up lock-screen
calls. Selecting Later no longer resets registration or causes the next ringing update
to prompt again. Existing enabled phone accounts are detected automatically.

Final checks: lint and TypeScript passed; 77 tests passed, including delayed TURN
candidate delivery, signaling recovery gating, and repeated passive setup after Later.

## Hosted development testing

The hosted development profile is enabled after the server setup was confirmed by
the user. The HTTPS API responds with the expected 401 for an unauthenticated request.
Run `npm run start:dev` to use the hosted backend, or `npm start` for local testing.
Switching origins uses a separate saved session: sign in with live-server accounts.
The existing rebuilt development client includes Firebase and does not need another
native rebuild merely to change backend origin or the JavaScript push flag. Keep
Metro running while using this development build. End-to-end hosted push delivery
still needs a message/call test with a registered device and the app backgrounded.
