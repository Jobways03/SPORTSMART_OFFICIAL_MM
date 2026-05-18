# UI_TESTING_GUIDE.md — Click-through testing for the tax flow

**Audience:** Engineering + QA. Pure browser-based testing — no curl, no SQL inserts in the happy path.

**Pre-reqs (all 9 ports running):**

| App | URL | Role |
|---|---|---|
| `web-storefront` | http://localhost:4005 | Customer |
| `web-admin` | http://localhost:4001 | Seller admin |
| `web-admin-storefront` | http://localhost:4000 | Super admin |
| `api` | http://localhost:8000 | Backend |

**Default dev credentials** (from seed scripts):

| Actor | URL | Email | Password |
|---|---|---|---|
| Super Admin | http://localhost:4000/login | `admin@sportsmart.com` | `Admin@123` |
| Customer | http://localhost:4005/login | `smoke-customer@sportsmart.test` | `SmokeCustomer@123` |
| Seller | http://localhost:4003/login | (seed your own) | — |

---

## ⚠️ What has UI today vs. what doesn't

**✅ Has full UI today (just click around):**
- Customer order placement (`web-storefront`)
- Customer order detail page (`web-storefront/orders/[orderNumber]`)
- Customer return submission
- Seller order list + detail (`web-admin/dashboard/orders`)
- Admin order management (`web-admin-storefront/dashboard/orders`)
- Admin returns review (`web-admin-storefront/dashboard/returns`)
- **Admin Tax dashboard** (NEW — `web-admin-storefront/dashboard/tax`) — mode badge + audit readiness + GSTR-8 / GSTR-1 / GSTR-3B exports + TCS markFiled / markPaid

**❌ NOT wired into UI yet (Phase 25 backend ships the API; frontend buttons need to be added):**
- "Download invoice" button on customer order detail page
- "Download invoice" button on seller order detail page
- Time-bar review queue
- Wallet adjustment management
- E-way bill / IRN management

These are reachable via the API directly (or via the admin Tax dashboard's CSV downloads). The customer/seller download buttons are simple wire-up work.

---

## §1 — Login as Super Admin + open Tax dashboard

1. Open http://localhost:4000/login
2. Email `admin@sportsmart.com` / password `Admin@123` → login.
3. In the sidebar (Finance section) click **"Tax / GST"** 🧾 — lands at `/dashboard/tax`.

**You should see:**
- **Current mode** badge — `OFF` in grey (default dev state).
- **Audit readiness** card — green `READY` if no blockers, red `N BLOCKERS` if any of the seven blocker classes have a count.
- **GSTR-8 (platform-side TCS)** card with a filing-period input + "Load summary" / "Download CSV" buttons.
- **GSTR-1 / GSTR-3B (per-seller)** card with sellerId + filingPeriod inputs.

If you see "Loading tax dashboard…" forever, your API isn't up — start it via `pnpm --filter @sportsmart/api dev`.

---

## §2 — Verify the audit readiness dashboard

The readiness card shows seven blocker classes (Phase 23). Each row tells you:
- **Code** — `product.missing_hsn`, `seller.missing_gstin`, etc.
- **Count** — green `0` = no issues; red number = needs fixing.
- **Message** — human-readable remediation hint.
- **Sample IDs** — up to 5 IDs you can copy-paste into the URL bar to find the offending row.

Click **Refresh** to re-poll. The report is generated on-demand per call.

---

## §3 — Place an order as Customer (UI flow)

1. Open a **new private/incognito window** (so you can stay logged in as admin in the other window).
2. Go to http://localhost:4005 → click **Login**.
3. Email `smoke-customer@sportsmart.test` / password `SmokeCustomer@123`.
4. Browse to the products grid. Click any product → **Add to cart**.
5. Go to cart (top-right icon) → **Checkout**.
6. Pick a shipping address (or add one) + **Cash on Delivery** (COD) for the simplest path.
7. Click **Place Order**.

**What happens behind the scenes (verifiable in admin):**
- Order placed (`master_orders` + `sub_orders` rows).
- Tax snapshot written (`order_item_tax_snapshots`) — Phase 5.
- Tax summary written (`sub_order_tax_summaries`) — Phase 6.
- Tax document generated (`tax_documents` row, status `PDF_PENDING`) — Phase 9.
- Within ~5 minutes the PDF retry cron renders the HTML invoice + flips status to `PDF_GENERATED` — Phase 19.

**To verify the invoice was generated, open Super Admin in another tab and:**
1. Sidebar → **Orders** → find your new order.
2. Open the order detail page.
3. (No invoice-download button exists yet on this page — see "What's missing" above; the data IS in `tax_documents`.)

---

## §4 — Submit a return as Customer (UI flow)

1. In the customer window: go to **My Orders** (top-right menu) or `/orders`.
2. Click the order you just placed → click **Initiate return**.
3. Pick a reason → submit.

**Behind the scenes:**
- `returns` row created in `REQUESTED` status.
- Eventually QC happens (admin side); once QC marks items `APPROVED`, `CreditNoteService.generateForReturn` is called and a `CREDIT_NOTE` tax document is created (Phase 11).
- The Phase-12 daily 02:00 cron classifies the return as `ELIGIBLE` / `TIME_BARRED` / `REQUIRES_FINANCE_REVIEW` per Section 34.

---

## §5 — Approve the return as Admin (UI flow)

1. Switch to the Super Admin window.
2. Sidebar → **Returns** → find the new return.
3. Click into it. Walk through: **Approve** → **Schedule Pickup** → **Mark Received** → **QC Decision**.
4. On QC Decision, mark items `APPROVED` and submit.

**What happens:**
- Credit note tax document created automatically (Phase 11).
- If the credit-note generation succeeds, the customer's wallet / refund pipeline kicks in.

---

## §6 — Export GSTR-8 (admin Tax dashboard)

Back in **Super Admin → Tax / GST**:

1. In the **GSTR-8 (platform-side TCS)** card, set the filing period (default = current month, e.g. `2026-05`).
2. Click **Load summary**.
   - If no TCS rows for the period: you'll see "No TCS rows for 2026-05 (NIL filing)" — that's normal for a fresh dev DB. TCS gets computed when a **settlement cycle is approved** (Phase 17).
3. Click **Download CSV** to get the CBIC-shape GSTR-8 CSV.

**To get TCS rows populated** (one-time):
1. Sidebar → **Commission** → look for the settlement-cycle creation UI (or use the existing admin settlement page).
2. Create a cycle covering this month + approve it.
3. Phase 17's hook auto-computes TCS for every seller in the cycle.
4. Return to **Tax / GST** → reload the summary.

---

## §7 — Mark TCS rows FILED + PAID_TO_GOVT

After loading a GSTR-8 summary with rows:

1. **Check the checkboxes** on the rows you've uploaded to NIC's GSTR-8 portal.
2. Click **Mark N row(s) FILED** — instant transition `COLLECTED` → `FILED`. Banner shows `flipped=N / requested=N`.
3. After government remittance: enter the **UTR / payment reference** in the input box, click **Mark N row(s) PAID_TO_GOVT** — transition `FILED` → `PAID_TO_GOVT`.

Both actions are idempotent — re-clicking on the same rows won't double-flip.

---

## §8 — Export GSTR-1 / GSTR-3B (per seller)

In the **GSTR-1 / GSTR-3B (per-seller)** card:

1. Paste a seller UUID into the **Seller ID** input. (Get one from sidebar → **Sellers** → copy ID from URL.)
2. Set filing period.
3. Click **§4 B2B CSV** → CSV downloads with B2B invoice rows.
4. Pick a section from the dropdown (§5 / §7 / §9B / §12 / §13) → click **Download section CSV**.
5. Click **GSTR-3B CSV** → 4-row CSV (3.1 a / b / c / e).

If the seller had no documents in the period, the CSV is header-only (NIL filing — valid CBIC behaviour).

---

## §9 — Test mode flip OFF → AUDIT → STRICT (UI + DB)

The Tax dashboard shows the **current mode** but doesn't expose a flip button (intentional — mode change is a CA-gated rollout step, see `STRICT_MODE_ROLLOUT_RUNBOOK.md`).

### Flip to AUDIT on dev

In a terminal:
```bash
psql sportsmart_dev -c "
INSERT INTO tax_config (id, key, value, description, created_at, updated_at)
VALUES (gen_random_uuid()::text, 'tax_audit_mode', 'true', 'Local test', now(), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();"
```

Wait 60 seconds (config cache TTL), then click **Refresh** on the mode badge → it should turn yellow `AUDIT`.

### Flip to STRICT
```bash
psql sportsmart_dev -c "
INSERT INTO tax_config (id, key, value, description, created_at, updated_at)
VALUES (gen_random_uuid()::text, 'tax_strict_mode', 'true', 'Local test', now(), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();"
```

After 60s + Refresh → green `STRICT`. Now PDF re-renders omit the DRAFT banner.

### Rollback
```bash
psql sportsmart_dev -c "
UPDATE tax_config SET value = 'false', updated_at = now()
WHERE key IN ('tax_strict_mode', 'tax_audit_mode');"
```

---

## §10 — Permission gating verification (Phase 25 + audit-bug-fix)

The admin Tax page shows up in the sidebar **only if** the logged-in admin has `tax.reports.read` OR `tax.tcs.read` permission.

To test:
1. Sidebar → **Users** → create / pick a non-finance admin (e.g. SELLER_SUPPORT role).
2. Log out, log in as that admin.
3. The "Tax / GST" sidebar item should be **hidden**.
4. Even if they navigate to `/dashboard/tax` directly, the API calls will return `403 PERMISSION_DENIED` and the page will show errors.

---

## §11 — What's still missing in the UI (and how to wire it)

| Surface | What's needed | Effort |
|---|---|---|
| Customer order detail → "Download Invoice" button | Add a `<Link>` to `/api/v1/customer/tax-documents/:id/download` that triggers a fetch with the customer's auth token, opens the signed URL in a new tab | 30 min |
| Seller order detail → "Download Invoice" button | Same pattern, seller route | 30 min |
| Admin time-bar review queue | List page filtered by `creditNoteEligibilityStatus = 'REQUIRES_FINANCE_REVIEW'`; per-row "Approve credit note" / "Issue wallet adjustment" buttons | 2-4 h |
| Wallet adjustment approval queue | Admin page over `wallet_adjustments WHERE status='PENDING_APPROVAL'` with approve/reject actions | 2-4 h |
| E-way bill admin panel | Per-order EWB status, generate / cancel / override buttons | 2-4 h |
| IRN admin panel | Per-doc IRN status, retry / cancel-within-window | 2 h |

All of these have the backend API in place (per the endpoint inventory in `CA.md §9`). The frontend work is straightforward — a Next.js engineer can build them in one sprint.

---

## §12 — Troubleshooting

| Symptom | Fix |
|---|---|
| Sidebar "Tax / GST" item missing | Your admin role lacks `tax.reports.read`. Sidebar → Users → Edit role. |
| Tax dashboard shows "Loading…" forever | API down. `pnpm --filter @sportsmart/api dev`. |
| Mode badge stuck on OFF after DB flip | TaxConfigService 60s cache. Wait or restart API. |
| GSTR-8 CSV downloads but is empty | No TCS rows for that period. Run a settlement cycle. |
| Mark FILED button does nothing | You haven't checked any boxes. Or the rows are already FILED (transition only runs on COLLECTED→FILED). |
| Order placed but no tax_documents row | `TaxDocumentService.generateForSubOrder` probably failed. Check API logs. |
| PDF download URL gives 404 | PDF retry cron hasn't run yet. Wait 5 min or check `status='PDF_GENERATED'` in DB. |

---

**Bottom line:** the tax admin dashboard at `/dashboard/tax` is the single UI surface I shipped for testing. Everything in §6–10 is click-through. §3–5 use the existing customer + admin order/return UIs you already have. The "Download invoice" buttons on the customer + seller order pages are a small follow-up — until then, the admin's GSTR exports + raw `tax_documents` rows are the visible artefacts.
