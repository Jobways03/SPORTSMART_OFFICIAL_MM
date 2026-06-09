# Test Sheet — Franchise Network Admin

**App:** `web-franchise-admin`  **Port:** 4002  
**Tester:** ___________________  **Date:** ____________  **Build / Commit:** ____________  
**Result key:** `P`=Pass · `F`=Fail · `B`=Blocked · `N`=N/A (dev caveat). Log failures with a defect #.

> Setup: see `docs/QA_UAT_CHECKLIST.md` §0 (Prerequisites) and §3 (dev caveats). OTPs print to the API console. Full steps/verify detail for any row is in `QA_UAT_CHECKLIST.md` under this persona.

## P0 — Must pass (core revenue / smoke path)

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 01 | Admin login (with MFA challenge) | `/login` | Authenticated session; /dashboard shows KPI tiles (pending verification, pending settlements) and Quick actions (Catalog, Procurement, Settlements). | ☐ | |
| 02 | Franchise onboarding decision (KYC verification + activation) | `/dashboard/franchises` | Verification badge flips to VERIFIED (or REJECTED); status badge progresses PENDING->APPROVED->ACTIVE. Reason is recorded. | ☐ | |
| 03 | Pincode -> franchise mapping CRUD + priority (territory routing) | `/dashboard/franchises/[id]/pincodes` | Mapped pincode rows appear with priority + active flag; conflictsWith lists any OTHER active franchise also serving that pincode. A higher-priority mapped franchise outranks a lower-priority one for the same pincode. | ☐ | |
| 04 | Catalog mapping approval (which products a franchise can sell) | `/dashboard/catalog` | Mapping moves PENDING_APPROVAL -> APPROVED (or REJECTED / STOPPED); count chips update; bulk actions flip all matching rows in the group. | ☐ | |
| 05 | Procurement REQUEST approval -> dispatch -> settle (HQ to franchise) | `/dashboard/procurement/[id]` | Status walks SUBMITTED -> APPROVED/PARTIALLY_APPROVED -> DISPATCHED -> (RECEIVED via franchise) -> SETTLED. Totals (totalApprovedAmount, procurementFeeAmount = rate-based, finalPayableAmount) recompute on approve. | ☐ | |
| 06 | Settlement run + mark-paid with UTR (atomic, CAS-guarded) | `/dashboard/settlements` | New cycle creates per-franchise settlements in PENDING; Approve -> APPROVED; Mark Paid -> PAID with the UTR recorded and paidAt set. Status chips update. | ☐ | |

## P1 — Important

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 11 | Per-franchise procurement pricing override | `/dashboard/franchises/[id]/pricing` | Override is saved per (franchise, product, variant); 'Saved' confirmation shows. Removing it reverts to ProductVariant.costPrice. | ☐ | |
| 12 | Earnings / finance ledger oversight (+ adjustment/penalty) | `/dashboard/franchises/[id]` | Ledger lists earnings/fees/returns/adjustments with running balanceAfter; new adjustment/penalty rows appear with reason and shift the balance. | ☐ | |
| 13 | Order risk-verification queue (fraud band triage) | `/dashboard/verification` | Claimed order moves to your tray; Approve routes it onward to fulfillment; Reject cancels and restores stock. High-risk approvals are blocked without a written reason. | ☐ | |

## P2 — Edge / admin-config

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 21 | Inventory oversight (stock + ledger) | `/dashboard/inventory` | Read-only oversight: availableQty, reserved, damaged and the immutable movement ledger per franchise. | ☐ | |
| 22 | Franchise orders oversight (mark delivered / cancel) | `/dashboard/orders` | Sub-order fulfillmentStatus advances to DELIVERED; cancel cancels the franchise leg and restores reserved stock. | ☐ | |

## Sign-off

| Priority | Total | Pass | Fail | Blocked | N/A |
|----------|:-----:|:----:|:----:|:-------:|:---:|
| P0 | 6 | | | | |
| P1 | 3 | | | | |
| P2 | 2 | | | | |
| **All** | **11** | | | | |

**Verdict:** ☐ Persona PASS  ☐ Persona FAIL (blocking defects open)  
**Reviewer sign-off:** ___________________  **Date:** ____________
