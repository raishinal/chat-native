# Backend environments

The backend is selected by the npm command or EAS build profile. No .env file needs to be swapped between runs. Public API defaults live in `eas.json`; the command wrapper uses the same profiles as cloud builds.

| Command | Backend |
| --- | --- |
| `npm start` / `npm run start:local` | Starts Android automatically; uses `http://localhost:8000` through ADB reverse forwarding |
| `npm run start:server` | Local Metro server only, without opening an emulator |
| `npm run start:ios` | Local iOS simulator: `http://localhost:8000` |
| `npm run start:dev` | `https://chat.roshanlama.com.np` |
| `npm run start:staging` | `https://chat.roshanlama.com.np` |
| `npm run start:production` | `https://chat.roshanlama.com.np` (debug against the live backend) |

Development, staging and production currently share the one hosted server you supplied, including its accounts and messages. Build profiles do not create separate Laravel databases. Change the profile URL in `eas.json` if a separate staging backend is added later.

A development client gets JavaScript from the Metro command you start. Use `npm start` for a local backend and `npm run start:dev` for the hosted backend. Stop the previous Metro server with Ctrl+C before changing the command. Each start clears Metro's transform cache to avoid retaining the previous inlined URL.

`npm start` now passes Expo's `--android` option. Expo starts an available Android emulator when no device is connected, waits for it to boot, and opens the installed Relay development build. Your current AVD is `Pixel_10_Pro`. If an Android device/emulator is already running, Expo reuses it. Use Shift+A in the Metro terminal to choose a different device. Stopping Metro leaves the emulator open so subsequent starts are faster.

Install a development build once before using this launch flow (`npm run android`, or install an EAS development APK). Expo Go cannot run this app's native modules. Use `npm run start:server` when you only want Metro, and `npm run start:ios` for iOS.

To compile native projects locally, `npm run android` and `npm run ios` target the local backend. `npm run android:dev` and `npm run ios:dev` target the hosted backend. Windows native builds automatically use the short CMake cache described in the README; moving the repository is not required for the verified build.

## One-time public configuration

Keep the shared public Pusher key and cluster in the native repository's ignored `.env`:

```dotenv
EXPO_PUBLIC_PUSHER_KEY=your_pusher_public_key
EXPO_PUBLIC_PUSHER_CLUSTER=your_pusher_cluster
```

The wrapper carries these two public values into every environment. It does not import Laravel secrets, bearer tokens or other variables from dotenv files. Do not copy the backend .env into the native repository. TURN key IDs/tokens and Pusher secrets stay on Laravel.

You can optionally add per-environment overrides once:

| Target | Optional override file |
| --- | --- |
| Local | `.env.local` (template: `.env.example`) |
| Hosted development | `.env.development.local` |
| Staging | `.env.staging.local` (template: `.env.staging.example`) |
| Production | `.env.production.local` (template: `.env.production.example`) |

Each accepts only `EXPO_PUBLIC_API_ORIGIN`, `EXPO_PUBLIC_PUSHER_KEY`, and `EXPO_PUBLIC_PUSHER_CLUSTER`. Explicit shell variables take precedence, followed by the selected override file. Shared Pusher values fall back to `.env`. The API address in the legacy `.env` applies only to local runs; hosted runs ignore it. `.env.local` is never loaded by hosted commands. Blank origin values use the profile default. The wrapper sets `EXPO_NO_DOTENV=1` so Expo cannot merge another environment's dotenv files back in, and does not repurpose `NODE_ENV`.

Local commands use `http://localhost:8000`. Keep Laravel running on your computer's port 8000. For Android emulators and USB-debugging devices, the npm wrapper automatically configures `adb reverse tcp:8000 tcp:8000`, including devices connected after Metro starts. It checks existing mappings without rebinding active connections. Accept USB debugging authorization and ensure Android platform-tools are installed. If you run the app without the npm wrapper, run that ADB command manually. The iOS simulator reaches the Mac's localhost directly.

Physical iPhones and phones connected only over Wi-Fi need a reachable LAN address or HTTPS tunnel in `.env.local`; ADB forwarding requires an authorized ADB connection. An origin contains no `/api/v1` path; the client adds it. Hosted commands require HTTPS and reject loopback/emulator addresses.

Check the selected public configuration without launching Metro:

```powershell
npm run config:local
npm run config:dev
npm run config:staging
npm run config:production
```

The output shows the URL and whether Pusher is configured, without printing key values.

## EAS builds

| EAS profile | Build | EAS variable environment |
| --- | --- | --- |
| `local` | Development client, local backend defaults | `development` |
| `development` | Development client, hosted defaults | `development` |
| `staging` / `preview` | Standalone internal build, hosted backend | `preview` |
| `production` | Store/release build, hosted backend | `production` |

After linking the Expo project/signing configuration, build with:

```powershell
npm run build:local -- --platform android
npm run build:dev -- --platform android
npm run build:staging -- --platform android
npm run build:preview -- --platform android
npm run build:production -- --platform android
```

Replace `android` with `ios` for iOS. Local builds use the npm wrappers above; EAS builds use the explicit profile API origin. Standalone staging/production binaries keep that URL without Metro. Rebuild an installed standalone app when changing its embedded backend configuration.

Ignored local dotenv files are not uploaded to EAS. Set `EXPO_PUBLIC_PUSHER_KEY` and `EXPO_PUBLIC_PUSHER_CLUSTER` once in your Expo project's `development`, `preview` and `production` EAS environments for cloud builds. These are public values; use plaintext visibility. The API origins are already assigned in the build profiles. No Cloudflare credentials belong in EAS client configuration. Remote EAS variables/signing have not been provisioned by this repository change.

Saved bearer tokens are now scoped to the canonical API origin. Sign in once per backend after this update; switching between local and hosted servers will not forward the other server's token. The former unscoped token is not automatically migrated to an unknown backend.

References: [Expo environment variables](https://docs.expo.dev/guides/environment-variables/), [EAS build profiles](https://docs.expo.dev/build/eas-json/), [EAS environment usage](https://docs.expo.dev/eas/environment-variables/usage/).
