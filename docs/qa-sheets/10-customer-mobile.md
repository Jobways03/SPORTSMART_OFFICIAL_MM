# Test Sheet — Customer — Mobile (React Native)

**App:** `mobile-storefront`  **Port:** 8081 (Metro). App runs on iOS Simulator (Xcode) / Android Emulator (Android Studio) against API on :8000  
**Tester:** ___________________  **Date:** ____________  **Build / Commit:** ____________  
**Result key:** `P`=Pass · `F`=Fail · `B`=Blocked · `N`=N/A (dev caveat). Log failures with a defect #.

> Setup: see `docs/QA_UAT_CHECKLIST.md` §0 (Prerequisites) and §3 (dev caveats). OTPs print to the API console. Full steps/verify detail for any row is in `QA_UAT_CHECKLIST.md` under this persona.

## P0 — Must pass (core revenue / smoke path)

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 01 | App bring-up + cold-start login persistence (Keychain) ⚠ | `App launch (no route)` | After re-launch the user lands directly on the App tabs (Home), NOT the Login screen — the user blob + tokens were rehydrated from Keychain (com.sportsmart.storefront.* services). | ☐ | |
| 02 | Native Razorpay checkout sheet (online pay) ⚠ | `/checkout (CartTab > Checkout)` | Native Razorpay module opens an OS-level sheet. Success → handoff returns payment_id/order_id/signature → /customer/checkout/payment/verify → OrderConfirmation(paid:true). | ☐ | |
| 03 | Place order via COD (default dev path) + confirmation ⚠ | `/checkout` | Order is created with no gateway call; lands on OrderConfirmation (paid:true, cod:true) — or paid-by-wallet when payable hits 0. Idempotency key prevents a double order on retap. | ☐ | |

## P1 — Important

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 11 | Deep links via sportsmart:// scheme ⚠ | `sportsmart://product/:slug, /order/:orderNumber, /return/:id, /wallet, /cart, /support/:ticketId, etc.` | Authenticated: each URL routes to its mapped screen per src/navigation/linking.ts. Unauthenticated: the link lands on Login and the original destination is LOST (documented limitation). | ☐ | |
| 12 | Camera / gallery evidence upload on a return ⚠ | `/return/create (Account > Orders > order > Start a return)` | Native camera and photo-library pickers open (iOS perms NSCamera/NSPhotoLibrary already declared). Each picked image is downscaled (1600px/0.8q) and POSTed multipart to /customer/returns/evidence; | ☐ | |
| 13 | Wallet top-up via native Razorpay ⚠ | `/wallet/topup (Account > Wallet > Add money)` | Razorpay sheet opens; success → verify(walletTransactionId,...) → balance increases by the amount; cancel → 'Top-up cancelled' note that credit may still land. | ☐ | |
| 14 | Session-expiry reset to Auth stack | `any authenticated screen` | On a dead refresh token, onAuthFailure calls navigationRef.resetRoot to the Auth stack — the user is bounced to Login with an EMPTY history (cannot 'back' into a protected screen). | ☐ | |

## P2 — Edge / admin-config

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 21 | Invoice / data-export file handoff to system browser ⚠ | `/invoices and /account/data-export` | App fetches a signed URL then calls Linking.openURL — the OS browser handles render + Save/Share. Invoices still 'generating' are disabled with a 'Pending' label. | ☐ | |
| 22 | Crash reporting + analytics wiring (Sentry / PostHog RN) ⚠ | `App-wide (ErrorBoundary + navigation onStateChange)` | ErrorBoundary catches render errors and reportError sends to Sentry; screen views fire on each navigation; login calls identify then Auth Login Completed; checkout fires Payment Started/Succeeded/Dismissed/Failed. | ☐ | |
| 23 | PARITY NOTE — flows NOT to re-document (web-storefront equivalents) ⚠ | `Home / Browse / PDP / Cart / Wishlist / Orders / Order detail / Returns / Tickets / Addresses / Profile / Change-password / Notification-prefs` | Same REST endpoints and {success,message,data} envelope as web; same money math and state transitions. Mobile differences are presentation (NativeWind, tab bar, native pickers), not behavior. | ☐ | |

## ⚠ Dev caveats for flagged rows (expected behavior — do NOT file as bugs)

- **01 App bring-up + cold-start login persistence (Keychain)** — Keychain writes are swallowed if biometrics aren't enrolled (storage.ts) — on a fresh simulator with no passcode this is fine. There is NO biometric/Face ID gating; persistence is silent token storage only.
- **02 Native Razorpay checkout sheet (online pay)** — Requires RAZORPAY_KEY_ID in apps/mobile-storefront/.env AND restart with --reset-cache; the API's RAZORPAY_KEY_SECRET must match the same project or HMAC verify fails silently. Without the key the Pay button shows a clear config error. In the default dev env keys are unset, so COD is the realistic path — see next process.
- **03 Place order via COD (default dev path) + confirmation** — Online + partial wallet is deliberately forced to COD for the remainder (retryPayment charges full total on the current backend); this is a known client guard, not a bug to file.
- **11 Deep links via sportsmart:// scheme** — Only the custom sportsmart:// scheme works. https Universal Links / App Links are TODO (no apple-app-site-association / assetlinks.json). Lost-destination-after-login is a known gap, not a defect.
- **12 Camera / gallery evidence upload on a return** — On iOS simulator the camera is unavailable — use 'Choose from gallery' or a physical device for the camera path. react-native-image-picker predates RN 0.76 New Arch; if the build fails, pod install with RCT_NEW_ARCH_ENABLED=0.
- **13 Wallet top-up via native Razorpay** — Same Razorpay key/secret requirement as checkout. Bonus '+₹X' badges are cosmetic — do NOT file the missing bonus credit as a bug.
- **21 Invoice / data-export file handoff to system browser** — There is NO in-app PDF viewer or file save — it's a browser handoff by design. On a bare simulator with no default PDF handler the open may no-op.
- **22 Crash reporting + analytics wiring (Sentry / PostHog RN)** — Both are NO-OPS when their env vars are empty (the default) — events go nowhere and reportError just console.errors. You MUST set DSN/API key + --reset-cache to test, otherwise there is nothing to verify.
- **23 PARITY NOTE — flows NOT to re-document (web-storefront equivalents)** — Push-notification receipt, biometric login, and https Universal/App Links are NOT implemented (Firebase + iOS/Android signing are README TODOs) — do not write test cases for them. App icon/splash are RN defaults (TODO).

## Sign-off

| Priority | Total | Pass | Fail | Blocked | N/A |
|----------|:-----:|:----:|:----:|:-------:|:---:|
| P0 | 3 | | | | |
| P1 | 4 | | | | |
| P2 | 3 | | | | |
| **All** | **10** | | | | |

**Verdict:** ☐ Persona PASS  ☐ Persona FAIL (blocking defects open)  
**Reviewer sign-off:** ___________________  **Date:** ____________
