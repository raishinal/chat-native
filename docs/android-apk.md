# Standalone Android test APK

The APK uses `https://chat.roshanlama.com.np` with Firebase push and Pusher enabled.
JavaScript is bundled in the APK, so it runs without Metro or USB. Internet access
to the hosted backend, Pusher, Firebase, and the TURN provider is still required.

Build from the native project:

```sh
npm run build:apk
```

The script resolves the `preview` Android profile and refuses to build if its host,
push flag, or Pusher settings are missing or incorrect. The output is
`dist/relay-live.apk`, with a SHA-256 checksum beside it. The preview profile is also
configured for an APK if EAS cloud builds are used later. EAS login is not required
for the local build; installed Java/Android SDK/NDK tools are required instead.

If the generated Android folder does not exist, generate it before building:

```sh
node scripts/expo-environment.mjs preview prebuild --platform android --no-install
```

Firebase Android client configuration is supplied through `google-services.json`.
Only public client settings are in the APK. Firebase service-account keys and TURN
API secrets remain on the Laravel server. Expo Router API-route export is explicitly
disabled because this app uses Laravel for its API, rather than an Expo server.

The local Android template currently signs the release-mode APK with the existing
development signing key. This is an internal testing artifact, not a Play Store
release. Set up a dedicated, backed-up release signing key (or EAS-managed signing)
before public distribution. Keeping the signing certificate consistent is necessary
for installing future updates over the existing app without uninstalling it.

Native code/resource shrinking is disabled for the preview test build because the
current WebRTC/SLF4J dependency graph has optional classes that block R8. This does
not enable Metro or development mode; the APK still contains a production JavaScript
bundle. Resolve the dependency/optimizer compatibility before a public store build.

Install the APK on Android, sign in with a live-server account, allow notifications
and microphone access, and use Profile > Set up lock-screen calls to enable Relay
in the system calling accounts. Background/closed-app call behavior still needs
real-device verification. The live website duplicate-answer fix must be deployed
separately; building this native APK does not deploy website code.

## Verified artifact (1 November 2026)

`dist/relay-live.apk` built successfully (about 159 MiB). APK archive checks and
Android signature verification passed. The manifest identifies `com.relay.privatechat`
1.0.0, minimum Android API 24, with arm64-v8a, armeabi-v7a, x86 and x86_64 libraries.
The APK is not debuggable, contains bundled JavaScript with the live HTTPS host,
and contains neither a local API URL nor a Firebase service-account file.
Lint/typecheck passed and all 77 app tests passed. The final emulator installation
attempt could not run because the emulator was disconnected; this standalone
artifact's runtime launch remains to be verified on a device.
