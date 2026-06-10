# Test Sheet — D2C Seller-Admin

**App:** `web-d2c-seller-admin`  **Port:** 4001  
**Tester:** ___________________  **Date:** ____________  **Build / Commit:** ____________  
**Result key:** `P`=Pass · `F`=Fail · `B`=Blocked · `N`=N/A (dev caveat). Log failures with a defect #.

> Setup: see `docs/QA_UAT_CHECKLIST.md` §0 (Prerequisites) and §3 (dev caveats). OTPs print to the API console. Full steps/verify detail for any row is in `QA_UAT_CHECKLIST.md` under this persona.

## P0 — Must pass (core revenue / smoke path)

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 01 | Admin login (password + optional MFA) | `/login` | Successful login stores adminAccessToken/refreshToken/admin in sessionStorage and routes to /dashboard. Wrong password shows an inline 401 'Invalid credentials' and clears the password; | ☐ | |
| 02 | Seller list filtered to D2C only (scope boundary) | `/dashboard/sellers` | Only D2C sellers appear. listSellers appends sellerType=D2C and the backend AdminSellerScopeGuard/list filter restricts results from the admin's sellers.scope.d2c permission. | ☐ | |
| 03 | Seller KYC / verification decision (Approve & Verify or Reject) | `/dashboard/sellers/[sellerId]` | Approve sets the seller to ACTIVE + VERIFIED (backend requires GSTIN+PAN on file or it 400s). Reject sends the seller back with the visible reason and flips verification to REJECTED. | ☐ | |
| 04 | Seller approval / suspension (status change) | `/dashboard/sellers (row action) or /dashboard/sellers/[sellerId]` | Status transitions follow the allowed matrix (PENDING_APPROVAL→ACTIVE/DEACTIVATED; ACTIVE→INACTIVE/SUSPENDED/DEACTIVATED; SUSPENDED→ACTIVE/DEACTIVATED, etc.). The list/detail refetch and the status badge updates. | ☐ | |
| 05 | Product approval queue — approve / reject (with reason) / request changes | `/dashboard/products` | Approve flips moderation to APPROVED and (once active) makes the product live; Reject sets REJECTED with the reason; Request Changes sets CHANGES_REQUESTED with the note. | ☐ | |
| 06 | Returns oversight + QC/refund pipeline | `/dashboard/returns and /dashboard/returns/[returnId]` | The status advances through the FSM (REQUESTED→APPROVED→PICKUP_SCHEDULED→IN_TRANSIT→RECEIVED→QC_APPROVED/PARTIALLY_APPROVED→REFUND_PROCESSING→REFUNDED→COMPLETED). Refund amount derives from QC-approved quantities; | ☐ | |

## P1 — Important

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 11 | Pending seller-mapping approvals (approve / stop, batch from queue) | `/dashboard/products (Pending Seller Approvals tab)` | Approve activates the seller-product mapping (seller can now be allocated orders for it); Stop removes/halts it. The row disappears and the pending badge decrements on both the tab and the sidebar. | ☐ | |
| 12 | Commission rate configuration (global) | `/dashboard/commission/settings` | Settings persist and a green 'Commission settings saved successfully' banner shows. The chosen type/value drive how platform commission is computed on future delivered orders. | ☐ | |
| 13 | Commission records, per-record adjust, and settlement cycle → mark paid | `/dashboard/commission` | Records show correct margin (platform − settlement). Adjust writes an audited override and refreshes history. A cycle goes DRAFT/PREVIEWED→APPROVED; marking a seller settlement Paid records the UTR and sets it PAID. | ☐ | |

## P2 — Edge / admin-config

| # | Process | Route | What to confirm (expected) | Result | Notes / Defect # |
|---|---------|-------|----------------------------|:------:|------------------|
| 21 | Product tax-config attestation (verify / bulk) | `/dashboard/products and /dashboard/products/bulk-tax-config` | Verifying flips taxConfigVerified=true and records verifiedAt/verifiedBy; the 'Tax: unverified' pill clears. Bulk update returns a count of updated products. | ☐ | |

## Sign-off

| Priority | Total | Pass | Fail | Blocked | N/A |
|----------|:-----:|:----:|:----:|:-------:|:---:|
| P0 | 6 | | | | |
| P1 | 3 | | | | |
| P2 | 1 | | | | |
| **All** | **10** | | | | |

**Verdict:** ☐ Persona PASS  ☐ Persona FAIL (blocking defects open)  
**Reviewer sign-off:** ___________________  **Date:** ____________
