# SPORTSMART_MM — Per-Persona QA Test Sheets

Printable, fill-in test sheets — one per persona/app — generated from the same trace as `../QA_UAT_CHECKLIST.md`.
Run them in the order below (each builds on data the previous one creates). Tick the **Result** column (`P`/`F`/`B`/`N`).

**Before anything:** bring up the stack (`turbo run dev --concurrency=16`, Postgres+Redis, `pnpm db:setup`), and read `../QA_UAT_CHECKLIST.md` §0 prerequisites + §1 golden path. OTPs print to the API console.

| Order | Sheet | App | Port | P0 | P1 | P2 |
|:-----:|-------|-----|------|:--:|:--:|:--:|
| 1 | [Customer — Web Storefront](./01-customer-web.md) | `web-storefront` | 4005 | 7 | 7 | 3 |
| 2 | [Storefront Ops Admin](./02-storefront-ops-admin.md) | `web-admin-storefront` | 4000 | 6 | 13 | 5 |
| 3 | [D2C Seller Portal](./03-d2c-seller.md) | `web-d2c-seller` | 4003 | 7 | 8 | 6 |
| 4 | [D2C Seller-Admin](./04-d2c-seller-admin.md) | `web-d2c-seller-admin` | 4001 | 6 | 3 | 1 |
| 5 | [Retail Seller + Retail Seller-Admin](./05-retail-seller-and-admin.md) | `web-retail-seller (portal), web-retail-seller-admin (admin)` | 4009 (seller portal), 4008 (seller-admin) | 7 | 5 | 6 |
| 6 | [Franchise Operator (POS)](./06-franchise-operator.md) | `web-franchise` | 4004 | 5 | 8 | 3 |
| 7 | [Franchise Network Admin](./07-franchise-network-admin.md) | `web-franchise-admin` | 4002 | 6 | 3 | 2 |
| 8 | [Affiliate Portal + Affiliate Admin](./08-affiliate-and-admin.md) | `web-affiliate (member portal) + web-affiliate-admin (admin)` | 4007 (web-affiliate), 4006 (web-affiliate-admin); API 8000 | 8 | 5 | 4 |
| 9 | [Tax / Finance-Compliance Ops](./09-tax-finance-compliance.md) | `web-admin-storefront` | 4000 (api 8000) | 4 | 5 | 3 |
| 10 | [Customer — Mobile (React Native)](./10-customer-mobile.md) | `mobile-storefront` | 8081 (Metro). App runs on iOS Simulator (Xcode) / Android Emulator (Android Studio) against API on :8000 | 3 | 4 | 3 |
| | **Total** | | | **59** | **61** | **36** |

Total: **156 processes** (59 P0 / 61 P1 / 36 P2) across 10 sheets.