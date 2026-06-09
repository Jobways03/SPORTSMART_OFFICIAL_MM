# Test Sheet — D2C Seller Portal

**App:** `web-d2c-seller`  **Port:** 4003  
**Tester:** ___________________  **Date:** ____________  **Build / Commit:** ____________  
**Result key:** `P`=Pass · `F`=Fail · `B`=Blocked · `N`=N/A (dev caveat). Log failures with a defect #.

> Setup: see `docs/QA_UAT_CHECKLIST.md` §0 (Prerequisites) and §3 (dev caveats). OTPs print to the API console. Full steps/verify detail for any row is in `QA_UAT_CHECKLIST.md` under this persona.

## P0 — Must pass (core revenue / smoke path)

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 01 | Seller registration + email OTP verification ⚠ | `/register` | Account is created in an unverified state, an OTP email is sent (verificationEmailSent flag), and after entering the code the email flips to verified. | ☐ | |
| 02 | Login + cookie session | `/login` | Login sets the httpOnly sm_access_seller/sm_refresh_seller cookies; /seller/auth/me returns sellerId, status, verificationStatus, isEmailVerified, sellerType=D2C. | ☐ | |
| 03 | Onboarding KYC submit (business details, GSTIN, PAN, addresses) ⚠ | `/dashboard/onboarding` | Profile moves to UNDER_REVIEW; the seller cannot self-approve. If admin REJECTS, the reason (kycRejectionReason) shows and the form reopens pre-filled for resubmit. | ☐ | |
| 04 | First-listing wizard + add bank details (payout setup) ⚠ | `/dashboard/onboarding/first-listing` | hasBankDetails / hasFirstProduct / hasDeliveryMethod flags drive the green 'done' state on each card; once all three are set and the wizard is dismissed, future logins skip straight to /dashboard. | ☐ | |
| 05 | Create product (variants, price, HSN, submit for approval) ⚠ | `/dashboard/products/new` | Draft creation returns a product in DRAFT; 'Submit for review' transitions moderationStatus to PENDING_APPROVAL and the SKU mapping goes live only after admin approval (toast confirms). | ☐ | |
| 06 | Incoming order: accept / reject within deadline | `/dashboard/orders/[id]` | Accept moves acceptStatus OPEN->ACCEPTED; reject moves it to REJECTED (reason/note shown) and the order is reassigned. If the deadline expires it auto-rejects. | ☐ | |
| 07 | Fulfil order: pack + upload shipment evidence + mark shipped ⚠ | `/dashboard/orders/[id]` | Mark-as-Packed/Shipped is hard-blocked until 4 shipment-evidence photos exist (SHIPMENT_EVIDENCE_REQUIRED=4, enforced client + server). Self-ship sets SHIPPED with tracking; | ☐ | |

## P1 — Important

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 11 | Edit product, manage variants and images, publish/pause | `/dashboard/products/[id]/edit` | Edits persist; re-submitting re-enters PENDING_APPROVAL; self-suspend pauses sales without admin involvement; images upload via Cloudinary. | ☐ | |
| 12 | Catalog browse + map master product to seller listing | `/dashboard/catalog` | A seller-product mapping is created and (after admin approval) becomes APPROVED+active so it is sellable; pickup pincode/SLA feed serviceability. | ☐ | |
| 13 | Inventory stock update | `/dashboard/inventory` | stockQty updates and availableStock = stockQty - reservedQty recomputes immediately; low/out-of-stock counts refresh. | ☐ | |
| 14 | Self-delivery status progression | `/dashboard/orders/[id]` | Each transition updates selfDeliveryStatus and the sub-order fulfillmentStatus; reaching DELIVERED stamps selfDeliveredAt and surfaces the delivery/commission card. | ☐ | |
| 15 | Returns handling: mark received, upload QC evidence, accept/contest, escalate ⚠ | `/dashboard/returns/[returnId]` | Return moves to RECEIVED; evidence is attached; the seller can ACCEPT or CONTEST within the response window; QC approval/refund is decided by admin (QC_APPROVED/QC_REJECTED/PARTIALLY_APPROVED). | ☐ | |
| 16 | Seller-initiated B2B reversal (off-platform return) | `/dashboard/orders/[id]` | A reversal request is created PENDING_APPROVAL; nothing changes until an admin approves. On approval, stock is restored, the sub-order is adjusted, and commission/settlement (refundedAdminEarning) are reversed. | ☐ | |
| 17 | Commission statement view | `/dashboard/commission` | Each delivered item shows productEarning, platformMargin, adminEarning and commission status; settlements roll these into a payout with statutory deductions (paise as decimal strings). | ☐ | |
| 18 | Accounts: finances overview + payouts/settlements ⚠ | `/dashboard/accounts` | Overview shows gross-minus-refunds net revenue, what the platform owes (pendingAmount), overdue past-SLA exposure, and last settled date; settlements list UTR, payout due-by, failure reason, and paid date. | ☐ | |

## P2 — Edge / admin-config

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 21 | Service-areas + COD serviceability config | `/dashboard/service-areas` | Added pincodes become serviceable for this seller; COD shows at checkout only for pincodes flagged cod_eligible=true; others get ONLINE-only. | ☐ | |
| 22 | Tax: GSTIN/tax documents + TCS certificates ⚠ | `/dashboard/tax` | Tax documents list per sub-order with type, FY, totals (paise strings), IRN/e-invoice status; downloads open the signed PDF; TCS rows show gross/net taxable supply and collected TCS, and issued certificates open as HTML. | ☐ | |
| 23 | Analytics dashboard ⚠ | `/dashboard/analytics` | KPIs render from /seller/earnings/summary + pagination totals; the mix/trend is computed over the most recent batch (RECENT_LIMIT=200). | ☐ | |
| 24 | Support ticketing | `/dashboard/support` | Ticket is created OPEN with a ticketNumber; replies append messages; admin replies move it through IN_PROGRESS / WAITING_ON_CUSTOMER / RESOLVED; seller can close. | ☐ | |
| 25 | Profile management + password change ⚠ | `/dashboard/profile` | Editable fields save and bump profileCompletionPercentage; media uploads return new URLs; password change succeeds with correct current password. | ☐ | |
| 26 | Admin impersonation handoff ⚠ | `/impersonate` | An admin can view the seller dashboard as the seller; the impersonated flag is set and the token never persists in history (hash stripped). | ☐ | |

## ⚠ Dev caveats for flagged rows (expected behavior — do NOT file as bugs)

- **01 Seller registration + email OTP verification** — Email OTP delivery depends on the dev mail transport being configured; if email is stubbed, read the OTP from API logs/mail catcher. CAPTCHA is disabled by default in dev.
- **03 Onboarding KYC submit (business details, GSTIN, PAN, addresses)** — GSTIN verification is a Mod-36 well-formedness checksum only in dev (GstnProvider is a stub; sandbox adapter not wired) - it confirms format, not real GSTN registration. Admin approval is a separate manual step (use the admin app) before the seller can transact.
- **04 First-listing wizard + add bank details (payout setup)** — MAJOR GAP: there is NO bank-account UI in the D2C frontend - the wizard deep-links to /dashboard/profile?tab=bank and /dashboard/profile/delivery, but the profile page has no bank tab and the /profile/delivery route does not exist. Bank details can only be set by calling PATCH /seller/bank-details directly. Also, writes are gated on SELLER_BANK_ENCRYPTION_KEY: if it is unset in dev the API throws 400 'Bank-details encryption is not configured', so payouts are blocked until the key + a bank account exist.
- **05 Create product (variants, price, HSN, submit for approval)** — Going live requires admin catalog approval (separate admin app). HSN/GST values only flow to invoices/GSTR after admin verifies the seller's tax config.
- **07 Fulfil order: pack + upload shipment evidence + mark shipped** — Delhivery seller-side is assigned upstream (the picker only offers SELF_DELIVERY; entitlement selfDeliveryEnabled gates it). The tracking webhook is Shiprocket-shaped (/shipping tracking-webhook), so a Delhivery shipment will NOT auto-advance to DELIVERED - an admin marks delivery manually. The Download-label call can legitimately return empty right after booking (carrier propagation).
- **15 Returns handling: mark received, upload QC evidence, accept/contest, escalate** — The seller cannot approve a return/QC itself - it only marks-received, uploads evidence, and accepts/contests. The actual approve+refund is an admin action.
- **18 Accounts: finances overview + payouts/settlements** — Settlements only pay out once bank details exist AND SELLER_BANK_ENCRYPTION_KEY is configured; otherwise payable stays pending. Overview composes several endpoints, so a missing one degrades a KPI rather than 500ing.
- **22 Tax: GSTIN/tax documents + TCS certificates** — E-invoicing/IRN uses a NIC stub in dev; tax fields only become 'real' (used on GSTR filings) after admin verifies the seller's GST config.
- **23 Analytics dashboard** — No dedicated seller-analytics backend endpoint exists yet; this is a client-side composition, so trend/mix reflect only the most recent 200 orders, not full history.
- **25 Profile management + password change** — Media upload requires ACTIVE status; the profile page has NO bank-details tab despite the first-listing wizard linking to ?tab=bank.
- **26 Admin impersonation handoff** — Only reachable with a valid admin-signed impersonation token; not a self-service seller flow.

## Sign-off

| Priority | Total | Pass | Fail | Blocked | N/A |
|----------|:-----:|:----:|:----:|:-------:|:---:|
| P0 | 7 | | | | |
| P1 | 8 | | | | |
| P2 | 6 | | | | |
| **All** | **21** | | | | |

**Verdict:** ☐ Persona PASS  ☐ Persona FAIL (blocking defects open)  
**Reviewer sign-off:** ___________________  **Date:** ____________
