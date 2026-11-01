# Verification — 31 October 2026

- Native `npm test`: 41 passing tests, including the original connectivity tests, environment/session-isolation tests and Android localhost-forwarding tests.
- `npm run lint`: pass with no warnings.
- `npm run types:check`: pass.
- Expo dependency validation: installed SDK dependencies match the SDK 58 local compatibility map.
- Expo config introspection: pass; microphone and camera purpose strings, camera/microphone Android permissions, optional camera hardware declarations and custom foreground sound resource resolve.
- Android and iOS Metro/Hermes export: pass after the final sound integration.
- Existing Laravel suite: 85 passed, 2 pre-existing skipped, 379 assertions. No backend or website source changes.
- Live Laravel API smoke check: pass for token login, active-session validation, conversation/user/notification/call pages, protected admin metrics/users, current-token revocation and rejection of the revoked token. The temporary local server was stopped. This uses the same transport class as the app; it is not a native UI login test.

Android development APK: build succeeded for x86_64 from C:\rn-relay-build (751 Gradle tasks). The APK installed successfully and rendered the native login screen. Native login to the local Laravel server succeeded, rendered the authenticated conversation list, restored the SecureStore-backed session after process restart, and returned to the sign-in screen after token-revoking logout. App-specific ReactNativeJS/AndroidRuntime error logs were empty during this check. The emulator used Android API 37 and local-network permission was granted for development-server access. Initial Windows builds encountered Ninja/CMake long object paths. `plugins/with-short-cmake-paths.js` configures a 240-character CMake object-path maximum before native subproject evaluation so CMake hashes long paths. The plugin resolved the Worklets failure; the long original path still exceeded Ninja limits in gesture-handler codegen, so the successful complete build used the actual short checkout.

Not verified: iOS native compilation/signing, full native UI/device acceptance beyond the Android login/restore/logout smoke test, real Pusher delivery/suspension termination, camera/microphone permissions on physical hardware, codec playback, Bluetooth routing, real web-to-native/native-to-native audio/video, Cloudflare relay candidate selection or behavior on two different networks. No actual media connection was established. No background push/CallKit/Telecom integration is implemented or claimed. See the README acceptance checklist and Pusher user-authentication limitation.

Dependency audit: 29 advisories (2 high, 25 moderate, 2 low), including the SDK tooling Zod 3 dependency and its Expo CLI chain. The installed SDK CLI requests Zod ^3.25.76 while the advisory's fixed range starts at 4.6.6; no unsupported cross-major override was applied. These advisories still require upstream SDK/tooling review before distribution. No npm audit force upgrade was performed.

Environment configuration update: local Android/iOS addresses and hosted development/staging/production profiles were checked without contacting the hosted backend. Expo successfully exported an Android bundle through the staging command, and its compiled API origin was `https://chat.roshanlama.com.np`. Tests verify profile inheritance, per-target overrides, hosted rejection of loopback/HTTP URLs, dotenv secret filtering, and bearer storage isolation by canonical backend origin. EAS account variables, signing and remote builds were not changed or provisioned during this update. See `docs/environments.md` for the commands.

Localhost update: local profiles and the runtime fallback now use `http://localhost:8000`. Local Android npm commands maintain ADB reverse forwarding for authorized connected devices, including devices that connect after Metro starts. Tests cover device filtering, custom ports and preserving existing mappings without rebinding connections. A real device connection through this new forwarding wrapper has not been tested.

Automatic emulator startup: `npm start` and `npm run start:local` now use Expo's `--android` option. Verified with no device initially connected: Expo launched `Pixel_10_Pro`, waited for boot, and, after one-time installation of the previously compiled development APK, opened Relay and loaded the Metro bundle. ADB mappings for backend port 8000 and Metro port 8081 were present. App-specific startup error logs were empty. Lint and TypeScript checks passed. Use `npm run start:server` to start Metro without opening Android.

Windows in-place build fix: reproduced the reported `:app:buildCMakeDebug[x86_64]` failure in `C:\Users\roslm\OneDrive\Documents\chat-app-native`. Ninja reported a gesture-handler codegen filename longer than 260 characters. The Expo config plugin now sets CMake's build staging directory to a short, checkout/module-specific folder under `C:\.relay-cxx`, in addition to object-path hashing. Regenerated Android through Expo. The same Gradle build flags then passed in 1m 14s from the original checkout. `npm run android -- --no-bundler --device Pixel_10_Pro` also built successfully in 7s, installed the APK and opened it on the emulator. Lint and TypeScript checks passed. This supersedes the earlier requirement to copy the project to a shorter checkout for Windows compilation. No generated native source was edited by hand.


Chat attachment/UI follow-up: lint, TypeScript, and 46 automated tests pass, including save cancellation, save ordering, account changes, and filename safety. Android development APK rebuilt with the save-document module. iOS folder export needs device verification.

Android emulator follow-up verified: Download immediately opens Save as; saving an authenticated attachment writes 1,958,268 bytes and displays the saved confirmation. Separate Share opens the native chooser; no recipient was selected. Intent launcher is built from source through package.json autolinking so the dependency patch takes effect.

Automatic attachment previews: supported image/video/audio loads on mount from authenticated private storage, with shared in-flight fetching for preview/save/share and safe unmount handling. Android emulator confirmed an image renders inline without a Preview button. Modern audio/video/incoming-call layouts were visually reviewed using a temporary local fixture; the fixture was removed. No actual calls were placed for this UI check. Lint, type checking and all 46 tests passed.


Account management and history update: web lint/format, TypeScript and production build pass. Native lint/TypeScript and the existing 54 tests pass. Added self-service password changes, direct admin creation with passwords, optional admin password editing, email-confirmed permanent deletion and automatic scroll-up history pagination. No real account was deleted or password changed during verification. Added/updated backend feature tests in ChangePasswordTest, AdminManagementTest and ChatApiTest; final execution, PHPStan and Pint verification are pending because automatic approval review failed at its usage limit. The initial password test run passed seven cases and exposed a browser-session fixture failure; that fixture and Sanctum guard refresh were corrected but could not be re-run. Test these features with isolated accounts before deployment, including self-service browser session retention, deletion file jobs and real device scroll anchoring. Earlier starter-only native notes are historical; the adjacent native app now includes these screens.


## Message management

Sender messages expose Edit and Delete after successful delivery; each attachment has Delete file. Editing supports Save/Cancel and shows Edited after saving. Deletion requires inline confirmation and affects both participants. Deleting the final file of a message without text leaves a Message deleted placeholder. Recipients have no edit/delete controls.

Device checks: use two accounts to edit text, cancel an edit, delete one of several files, delete a message with files, and delete the last file of an attachment-only message. Background the recipient during a change and verify wake/reconnect updates the older loaded message. Verify errors preserve content and allow retry. The inbox should show Message deleted for a deleted latest message.

Automated checks: message-history.test.mjs covers history ranges, local outbox exclusion, and recovery of edits, removed files and tombstones across cursor pages. Typecheck, Expo lint and the native Node test suite pass. Android/iOS device acceptance testing remains outstanding.

## Additional native push and APK verification


## Follow-up: 1 November 2026

Native calling now includes Firebase/Telecom integration configured for local Android
testing (see native-push-setup.md). The local Android development APK built for all
configured architectures and was installed on both the Samsung SM-S918B and emulator.
A live audio call reached WebRTC/ICE connected on both devices after the ICE delivery
fix; the user confirmed connection. This supersedes the historical lack of any actual
media connection above. Two-way audio quality, iOS, and complete background/terminated
call behavior still need acceptance checks.

The phone-account setup dialog no longer opens automatically during incoming calls;
Profile has an explicit setup action. Lint/typecheck passed and all 77 automated tests
passed, including regression coverage for slow candidate delivery and dismissing setup.

## Original repository merge — 1 November 2026

The native push, lock-screen call integration, media signaling fixes, icon/media preview changes and standalone APK tooling were merged into the canonical Documents/chat-app-native repository. Existing account creation/password/deletion controls, profile password changes, automatic chat pagination, history/tombstone recovery, network diagnostics and the normalized foreground chime were preserved. Original .env, .env.local and Firebase client configuration were retained. Dependencies were installed and patches applied, Android was regenerated through Expo with the preview profile, lint and TypeScript checks passed, and all 88 combined regression tests passed. The preview build resolves https://chat.roshanlama.com.np with Firebase push enabled.

The merged original repository also passed a complete local release APK build (1,104 Gradle tasks). The resulting dist/relay-live.apk is 166,348,096 bytes, has valid archive contents and a verified Android signature, contains the live HTTPS host and bundled JavaScript, and contains no localhost API URL or Firebase service-account file. It remains development-signed for internal testing. Runtime launch on a device was not repeated during this repository merge.
