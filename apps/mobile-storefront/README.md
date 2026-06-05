# @sportsmart/mobile-storefront

React Native 0.76 customer-facing mobile app. Talks to the same
`/api/v1` REST endpoints as `apps/web-storefront`. iOS + Android,
TypeScript, NativeWind, React Navigation, TanStack Query, Razorpay
native checkout, Keychain auth, Sentry crash reporting.

---

## Quickstart

```bash
# From the monorepo root
pnpm install
cp apps/mobile-storefront/.env.example apps/mobile-storefront/.env

# iOS — once per fresh clone (installs CocoaPods deps)
cd apps/mobile-storefront/ios
bundle install
bundle exec pod install
cd ..

# Start Metro (port 8081)
pnpm start

# In a second terminal, launch the app
pnpm ios      # iOS simulator
pnpm android  # Android emulator
```

The app expects the API to be reachable. From the repo root:
```bash
pnpm dev  # brings up the API + 10 web frontends
```

---

## Prerequisites

| Tool | Why | Install |
|---|---|---|
| Node ≥22 | Match monorepo engines | `nvm install 22 && nvm use 22` |
| pnpm ≥10 | Workspace package manager | `corepack enable && corepack prepare pnpm@10 --activate` |
| Xcode (full IDE) | iOS sim + builds | Mac App Store |
| CocoaPods | iOS native deps | `brew install cocoapods` |
| OpenJDK 17 | Android build tooling | `brew install openjdk@17` |
| Android Studio + SDK 34 + an AVD | Android sim + builds | `brew install --cask android-studio`, then through the IDE |
| Ruby + Bundler | Pod install via `bundle` | macOS includes Ruby; `gem install bundler` if missing |

`react-native doctor` (run from `apps/mobile-storefront/`) checks all of these.

---

## Environment

Copy `.env.example` → `.env` and fill in:

| Var | What | Required? |
|---|---|---|
| `API_URL` | API base. Defaults to `http://localhost:8000` (iOS sim) or `http://10.0.2.2:8000` (Android emulator). Override for staging or ngrok. | Optional |
| `RAZORPAY_KEY_ID` | Razorpay key — test keys start with `rzp_test_`. Without it, the Pay button shows a clear error instead of opening the sheet. | Required for checkout / wallet topup |
| `SENTRY_DSN` | Sentry DSN. Empty = Sentry is a no-op. Use a dev project DSN to validate the integration. | Optional |
| `SENTRY_ENVIRONMENT` | Tag attached to every Sentry event (e.g. `development`, `staging`, `production`). | Optional |

Env vars are loaded via `react-native-dotenv` (babel-time). **After
editing `.env` you must restart Metro with `--reset-cache`**, otherwise
old values stay baked into the bundle:

```bash
pnpm start --reset-cache
```

---

## Architecture

```
src/
  components/        Reusable UI (CachedImage, ProductCard, Skeleton, ...)
  context/           React contexts (AuthContext)
  lib/               Cross-cutting helpers (api-client, razorpay, imagePicker, sentry, format, ...)
  navigation/        React Navigation stacks + types + linking config
  queries/           TanStack Query hooks (use*.ts) + keys
  screens/
    auth/            Login, Register
    app/             Home, Browse, ProductDetail, Cart, Checkout, Account, Orders, ...
  services/          REST API wrappers (one .service.ts per backend module)
```

Each `services/*.service.ts` calls the backend through the **shared API
client** at `packages/shared-utils/src/api-client.ts`. The client
auto-refreshes 401s once, handles the `{success, message, data}`
envelope, and uses a pluggable storage adapter (Keychain on mobile,
sessionStorage on web).

---

## Common commands

```bash
pnpm start                  # Metro bundler (port 8081)
pnpm ios                    # iOS sim build + launch
pnpm android                # Android emulator build + launch
pnpm typecheck              # tsc --noEmit
pnpm lint                   # ESLint
pnpm test                   # Jest

# Bundle compile check — matches what CI runs. Outputs to /tmp/.
pnpm bundle:check
```

From the monorepo root, the same commands work via pnpm filter:
```bash
pnpm --filter @sportsmart/mobile-storefront start
pnpm --filter @sportsmart/mobile-storefront typecheck
```

---

## Native config — what's been done, what's left

| Concern | Status | Notes |
|---|---|---|
| Bundle ID (`com.sportsmart.storefront`) | done | Both platforms |
| iOS `NSAllowsLocalNetworking` | done | HTTP localhost works in dev sim |
| iOS camera + photo library permissions | done | `NSCameraUsageDescription`, etc. |
| iOS URL scheme (`sportsmart://`) | done | `CFBundleURLTypes` in Info.plist |
| Android `INTERNET` permission | done | Default RN template |
| Android `sportsmart://` intent filter | done | MainActivity in AndroidManifest |
| App icon + splash screen | TODO | Currently RN defaults — design task |
| iOS code signing / provisioning | TODO | Set up team in Xcode before TestFlight |
| Android signing keys | TODO | Generate before Play Store |
| Universal Links / App Links (https://) | TODO | Needs `apple-app-site-association` + `assetlinks.json` hosted on sportsmart.com |
| Firebase / push notifications | TODO | Needs Firebase project + GoogleService files + backend device-token endpoint |

---

## Deep link testing

Once the app is running on a sim/device:

```bash
# iOS sim
xcrun simctl openurl booted "sportsmart://product/some-product-slug"

# Android emulator / device
adb shell am start -W -a android.intent.action.VIEW -d "sportsmart://product/foo"
```

Supported routes (see `src/navigation/linking.ts` for the full map):

| URL | Lands on |
|---|---|
| `sportsmart://home` | Home tab |
| `sportsmart://browse` | Browse tab |
| `sportsmart://product/:productSlug` | PDP |
| `sportsmart://cart` | Cart |
| `sportsmart://order/:orderNumber` | Order detail |
| `sportsmart://return/:returnId` | Return detail |
| `sportsmart://wallet` | Wallet |
| `sportsmart://wishlist` | Wishlist |
| `sportsmart://addresses` | Address book |
| `sportsmart://support/:ticketId` | Ticket thread |

Unauthenticated users hit Login first and lose the destination — that's
a known limitation of the current `App` ↔ `Auth` switch. Post-launch
work could persist the intent and replay after login.

---

## Troubleshooting

**Metro bundles an old `.env` value.**
You forgot `--reset-cache`. `pnpm start --reset-cache`.

**iOS build fails on `react-native-fast-image` / `react-native-razorpay` / `react-native-image-picker` Pod.**
These three predate RN 0.76's New Architecture being default-on. If
`pod install` fails, try `RCT_NEW_ARCH_ENABLED=0 bundle exec pod install`
or set `newArchEnabled: false` in `ios/Podfile.properties.json` for now.
Drop the override once upstream catches up.

**Android build fails with `peer react-native@0.81 - 0.85` for `react-native-worklets`.**
Cosmetic warning. The worklets babel plugin is build-time only; the
native module isn't invoked. Resolves naturally when you bump RN to 0.81+.

**Razorpay sheet opens but the order never verifies on the API side.**
Check that the backend's `RAZORPAY_KEY_SECRET` matches the project of
the `RAZORPAY_KEY_ID` you set in `.env`. HMAC verification fails
silently if they're mismatched.

**`sportsmart://` URLs do nothing.**
The URL scheme is registered on first build only. Rebuild after
modifying `Info.plist` or `AndroidManifest.xml`.

**"You attempted to import the Node standard library module..." errors at Metro start.**
A workspace dep imported a Node-only module (`fs`, `path`, etc.). RN
can't polyfill these. Find the importing file and use the RN equivalent
or guard with `Platform.OS`.

---

## File map cheat sheet

Where to add the most common things:

| Need to add… | Edit |
|---|---|
| A new API call | `src/services/<module>.service.ts` |
| A new TanStack Query hook | `src/queries/use<Thing>.ts` (+ key in `queries/keys.ts`) |
| A new screen | `src/screens/app/<Name>Screen.tsx` |
| A new route | `src/navigation/types.ts` + register in the relevant `*Stack.tsx` |
| A new deep link | `src/navigation/linking.ts` (mirror the new route) |
| A new shared component | `src/components/<Name>.tsx` |
| A new env var | `.env.example` + `src/env.d.ts` |

---

## Phases shipped

This app was built in 10 phases, each ending with both iOS and Android
bundles compiling cleanly:

1. Scaffold + auth (Login/Register, Keychain, navigation skeleton)
2. Home + Browse + PDP + Cart, backed by real catalog API
3. Search + pagination + wishlist + profile + pincode check on PDP
4. Address book + Orders + Returns (read-only)
5. Wallet + Tickets + Create-return-from-order flow
6. **Razorpay native checkout** end-to-end
7. Wallet topup + invoice download + image caching
8. Search filters + evidence file upload + deep links
9. Pincode auto-fill + change password + notification prefs + skeletons + error boundary
10. Sentry crash reporting + CI workflow + this README
