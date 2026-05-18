# LOCAL_TESTING_GUIDE.md — How to test the whole tax flow on your machine

**Audience:** Engineering. Step-by-step recipe to exercise every Phase 0–27 surface on a dev machine. Estimated time: ~30 minutes for the happy path; ~90 minutes if you also exercise the time-bar / EWB / IRN / GSTR-8 / mode-flip paths.

**Pre-reqs:**
- API up on `http://localhost:8000` (`pnpm --filter @sportsmart/api dev`)
- Postgres `sportsmart_dev` reachable
- `psql` on PATH (only for the date-manipulation tests in §6 and §7)
- `jq` on PATH (optional — for pretty-printing JSON in the curl examples)
- All migrations applied: `pnpm --filter @sportsmart/api exec prisma migrate status` → "Database schema is up to date!"

---

## 0. One-time setup

### 0.1 Seed dev data

```bash
cd apps/api
pnpm seed:quick      # admin, RBAC, base catalog, menu, metafields
pnpm seed:smoke      # smoke customer (smoke-customer@sportsmart.test / SmokeCustomer@123)
ts-node prisma/seed/seed-tax-master.ts    # india_states + UQC + HSN stubs + tax_config + platform GST
```

### 0.2 Default credentials (dev only)

| Actor | Email | Password | Login endpoint |
|---|---|---|---|
| Super Admin | `admin@sportsmart.com` | `Admin@123` (set via `.env: ADMIN_SEED_PASSWORD`) | `POST /api/v1/admin/auth/login` |
| Customer | `smoke-customer@sportsmart.test` | `SmokeCustomer@123` | `POST /api/v1/auth/login` |
| Seller | seed manually or use existing | — | `POST /api/v1/seller/auth/login` |

### 0.3 Get tokens (run these once + export)

```bash
# Admin token
ADMIN_TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@sportsmart.com","password":"Admin@123"}' | jq -r '.data.accessToken')
echo "ADMIN_TOKEN=$ADMIN_TOKEN"

# Customer token
CUSTOMER_TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-customer@sportsmart.test","password":"SmokeCustomer@123"}' | jq -r '.data.accessToken')
echo "CUSTOMER_TOKEN=$CUSTOMER_TOKEN"
```

If a token comes back null, the login endpoint changed shape — inspect the raw response with `curl ... | jq`.

---

## 1. Verify Phase-23 mode (start in OFF — dev permissive)

```bash
curl -s http://localhost:8000/api/v1/admin/tax/mode \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
# → { "success": true, "data": { "mode": "OFF" } }
```

**What this proves:** Phase 23 wiring is live. Throughout the rest of this guide, mode stays `OFF` (default) — every Phase-22 validation runs but does NOT throw.

---

## 2. Verify Phase-1 GSTIN validator (pure)

```bash
psql sportsmart_dev -c "SELECT count(*) FROM india_states;"
# → 39 (28 states + UTs + special-region codes)

psql sportsmart_dev -c "SELECT count(*) FROM uqc_master;"
# → 44 CBIC UQC codes

psql sportsmart_dev -c "SELECT count(*) FROM hsn_master;"
# → 28 sports-goods HSN stubs

psql sportsmart_dev -c "SELECT * FROM platform_gst_profiles WHERE is_default = true;"
# → 1 row — the seeded platform GST profile
```

---

## 3. Place an order → invoice gets generated automatically (Phases 5, 8, 9)

The order flow you already test in the customer app does it end-to-end. Quick curl version:

### 3.1 Place an order

```bash
# Add a product to cart
PRODUCT_ID=$(psql -At sportsmart_dev -c \
  "SELECT id FROM products WHERE supply_taxability = 'TAXABLE' AND hsn_code IS NOT NULL LIMIT 1;")

curl -s -X POST http://localhost:8000/api/v1/customer/cart/items \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}"

# Place order (COD for simplicity — skips payment gateway)
ORDER=$(curl -s -X POST http://localhost:8000/api/v1/customer/checkout/place-order \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentMethod":"COD"}')
echo "$ORDER" | jq
ORDER_NUMBER=$(echo "$ORDER" | jq -r '.data.orderNumber')
echo "Placed: $ORDER_NUMBER"
```

### 3.2 Confirm the snapshot + invoice were written

```bash
# OrderItemTaxSnapshot (Phase 5)
psql sportsmart_dev -c "
SELECT id, hsn_code, gst_rate_bps, taxable_amount_in_paise, cgst_amount_in_paise, sgst_amount_in_paise, igst_amount_in_paise, total_tax_amount_in_paise
FROM order_item_tax_snapshots
ORDER BY created_at DESC LIMIT 1;"

# TaxDocument (Phase 9) — should be PDF_PENDING immediately, PDF_GENERATED after the cron's 5-min tick
psql sportsmart_dev -c "
SELECT document_number, document_type, status, einvoice_status, document_total_in_paise
FROM tax_documents
ORDER BY created_at DESC LIMIT 1;"
```

**Expected:** A row in `order_item_tax_snapshots` with non-zero tax values matching your product's HSN rate; a `tax_documents` row with `status = 'PDF_PENDING'` initially.

---

## 4. Verify PDF rendering + signed-URL download (Phases 19, 20)

### 4.1 Wait ≤5 min for the Phase-19 PDF retry cron

```bash
# Or trigger manually via a one-shot service call (no admin endpoint for this — use ts-node)
psql sportsmart_dev -c "SELECT status, pdf_retry_count, pdf_provider FROM tax_documents ORDER BY created_at DESC LIMIT 1;"
# → status='PDF_GENERATED', pdf_provider='stub'
```

Once status is `PDF_GENERATED`, look at the stored HTML:

```bash
ls apps/api/storage/tax-pdfs/*/PLATFORM/*/  # listed by FY / supplier / docType
# Find your invoice file and open it in a browser — you should see the DRAFT banner
```

### 4.2 Customer download endpoint (Phase 25 controller + Phase 20 scope)

```bash
DOC_ID=$(psql -At sportsmart_dev -c "SELECT id FROM tax_documents ORDER BY created_at DESC LIMIT 1;")

curl -s "http://localhost:8000/api/v1/customer/tax-documents/$DOC_ID/download" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" | jq
# → { "data": { "url": "file:///abs/path/...html?expires=...", "documentNumber": "SM-INV-...", "expiresInSeconds": 300 } }
```

### 4.3 Audit row landed

```bash
psql sportsmart_dev -c "
SELECT actor_type, actor_id, outcome, ttl_seconds, ip_address, created_at
FROM tax_document_download_audits
ORDER BY created_at DESC LIMIT 1;"
# → CUSTOMER | <userId> | ALLOWED | 300 | ::1 | ...
```

### 4.4 Scope-violation test

Try downloading the same doc as a *different* customer (the service rejects + audits):

```bash
# Register a second smoke customer or change tokens; expect 403 + DENIED_SCOPE audit row.
```

---

## 5. Verify Phase-22 e-invoice classification (B2C → NOT_APPLICABLE)

Your test order above was B2C (no `buyerGstin`). The Phase-22 service classifies it as `NOT_APPLICABLE`:

```bash
psql sportsmart_dev -c "SELECT einvoice_status, einvoice_provider FROM tax_documents ORDER BY created_at DESC LIMIT 1;"
# → einvoice_status='NOT_APPLICABLE', einvoice_provider=NULL (classifier didn't promote to PENDING)
```

### 5.1 Force a B2B invoice to exercise the IRP stub

Manually upgrade the seller's turnover above ₹5 crore + flip opt-in, then re-classify:

```bash
psql sportsmart_dev -c "
UPDATE seller_gstins
SET aggregate_turnover_in_paise = 6_00_00_000_00, einvoice_opted_in = true
WHERE seller_id IN (SELECT id FROM sellers LIMIT 1);"
```

Now place a B2B order (with `buyerGstin` set) or manually flip an existing doc's `buyer_gstin`:

```bash
psql sportsmart_dev -c "
UPDATE tax_documents
SET buyer_gstin = '07AAGCB1234C1Z5', einvoice_status = 'NOT_APPLICABLE'
WHERE id = '$DOC_ID';"
```

Then the IRN retry cron (every 5 min) picks it up:

```bash
# Wait or watch logs: tail the API stdout for "IRN minted: ..." or check the column:
psql sportsmart_dev -c "
SELECT einvoice_status, einvoice_provider, substring(irn, 1, 12) as irn_preview, ack_no
FROM tax_documents WHERE id = '$DOC_ID';"
# → einvoice_status='GENERATED', einvoice_provider='stub', irn_preview='<64-char hex>', ack_no='STUB-<epoch>-<6 hex>'
```

---

## 6. Verify Phase-11/12/13 return + credit-note + time-bar flow

### 6.1 Happy-path return + credit note

Submit a return for the order:

```bash
# Use the return-creation endpoint (path varies — check returns module)
# OR insert directly for testing:
psql sportsmart_dev -c "
INSERT INTO returns (id, return_number, sub_order_id, master_order_id, customer_id, status, refund_amount_in_paise, qc_completed_at, qc_decision)
SELECT
  gen_random_uuid()::text,
  'RET-TEST-' || extract(epoch from now())::int,
  so.id, mo.id, mo.customer_id, 'QC_COMPLETE', 50000, now(), 'APPROVED'
FROM sub_orders so JOIN master_orders mo ON mo.id = so.master_order_id
WHERE mo.order_number = '$ORDER_NUMBER' LIMIT 1;"

# Insert at least one approved return_item for that return so CreditNoteService has something to reverse
```

Then call `CreditNoteService.generateForReturn(returnId)` via a ts-node script or the upcoming admin endpoint. Verify:

```bash
psql sportsmart_dev -c "
SELECT document_number, document_type, status, original_document_number, document_total_in_paise
FROM tax_documents WHERE document_type = 'CREDIT_NOTE'
ORDER BY created_at DESC LIMIT 1;"
# → SM-CN-..., CREDIT_NOTE, PDF_PENDING, SM-INV-..., -<amount>
```

### 6.2 Phase-12 time-bar cron classification

```bash
# Manually trigger the eligibility classifier (or wait for the daily 02:00 cron):
psql sportsmart_dev -c "
SELECT id, return_number, credit_note_eligibility_status, credit_note_eligibility_checked_at
FROM returns ORDER BY created_at DESC LIMIT 5;"
# After cron runs: ELIGIBLE | TIME_BARRED | REQUIRES_FINANCE_REVIEW
```

### 6.3 Force a TIME_BARRED scenario (date-manipulation)

```bash
# Back-date a tax_document's generatedAt to before 30 Sept of FY-1 (e.g. FY 2024-25 means generated_at < 30 Sept 2025)
psql sportsmart_dev -c "
UPDATE tax_documents
SET generated_at = '2024-04-15 10:00:00+00'
WHERE id = '$DOC_ID';"

# Re-run TaxCreditNoteTimeBarCron (or update the return's classification status to NULL so the cron picks it up again):
psql sportsmart_dev -c "
UPDATE returns SET credit_note_eligibility_status = NULL WHERE id = '<your-return-id>';"

# Wait 24h for the daily cron OR trigger via a ts-node helper — then:
psql sportsmart_dev -c "
SELECT credit_note_eligibility_status, credit_note_time_bar_reason FROM returns WHERE id = '<your-return-id>';"
# → TIME_BARRED | 'Section 34 cutoff (...) has lapsed. GST output liability cannot be reduced; ...'

# An AdminTask should also appear:
psql sportsmart_dev -c "
SELECT kind, reason, sla_breach_at FROM admin_tasks
WHERE kind = 'GST_CREDIT_NOTE_TIME_BARRED' ORDER BY created_at DESC LIMIT 1;"
```

### 6.4 Phase-13 wallet adjustment for the time-barred return

`WalletAdjustmentService.requestForTimeBarredReturn(returnId)` creates a `wallet_adjustments` row in `PENDING_APPROVAL`. Verify:

```bash
psql sportsmart_dev -c "
SELECT id, kind, status, amount_in_paise, requires_dual_approval,
       would_have_been_taxable_in_paise, would_have_been_cgst_in_paise,
       would_have_been_sgst_in_paise, would_have_been_igst_in_paise,
       reason
FROM wallet_adjustments ORDER BY created_at DESC LIMIT 1;"
# → kind='TIME_BARRED_CREDIT_NOTE', status='PENDING_APPROVAL' (or APPROVED if under threshold + auto-approve flag on),
#   would_have_been_* columns populated, reason text contains 'Section 34'
```

---

## 7. Verify Phase-15 e-way bill (₹50k threshold)

### 7.1 Force a high-value order

```bash
# Update a test order's total above ₹50,000 = 50_00_000 paise (note: stored on documentTotalInPaise of the invoice):
psql sportsmart_dev -c "
UPDATE tax_documents SET document_total_in_paise = 60_00_000 WHERE id = '$DOC_ID';"
```

### 7.2 Classify + generate

There's no admin HTTP endpoint for EWB yet (Phase 25's seller integration lands the trigger). For now, exercise via ts-node:

```bash
# In a ts-node REPL or smoke script:
# eWayBillService.classifyForSubOrder(subOrderId)
# eWayBillService.generate(subOrderId, { transportMode: 'ROAD', vehicleNumber: 'KA01AB1234', distanceKm: 350 })
```

Then verify:

```bash
psql sportsmart_dev -c "
SELECT ewb_number, status, provider, transport_mode, vehicle_number, distance_km, valid_until, consignment_value_in_paise
FROM e_way_bills ORDER BY created_at DESC LIMIT 1;"
# → ewb_number='EWB-STUB-<uuid>', status='GENERATED', provider='stub', vehicle_number='KA01AB1234'
```

---

## 8. Verify Phase-16/17 TCS at settlement + Phase-18 GSTR-8 export

### 8.1 Run a settlement cycle (existing settlement flow)

```bash
# Create a cycle covering the period your test order falls in:
curl -s -X POST http://localhost:8000/api/v1/admin/settlements/cycles \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"periodStart":"2026-04-01","periodEnd":"2026-04-30"}'

# Approve the cycle — Phase 17 hook auto-computes TCS per seller:
CYCLE_ID=$(psql -At sportsmart_dev -c "SELECT id FROM settlement_cycles ORDER BY created_at DESC LIMIT 1;")
curl -s -X POST "http://localhost:8000/api/v1/admin/settlements/cycles/$CYCLE_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
# → success: true, tcs: { settlementsProcessed: N, totalTcsDeductedInPaise: ... }
```

### 8.2 Verify TCS ledger rows

```bash
psql sportsmart_dev -c "
SELECT seller_id, filing_period, status, total_tcs_in_paise, cgst_tcs_in_paise, sgst_tcs_in_paise, igst_tcs_in_paise
FROM gst_tcs_settlement_ledger ORDER BY created_at DESC LIMIT 5;"

# SellerSettlement should carry the deduction:
psql sportsmart_dev -c "
SELECT seller_name, total_settlement_amount_in_paise, tcs_deducted_in_paise, tcs_filing_period
FROM seller_settlements ORDER BY created_at DESC LIMIT 5;"
```

### 8.3 Export GSTR-8 CSV (admin)

```bash
curl -s "http://localhost:8000/api/v1/admin/tax/reports/gstr8.csv?filingPeriod=2026-04" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -o /tmp/gstr8-2026-04.csv
cat /tmp/gstr8-2026-04.csv
# → CBIC-shape CSV with header + one row per seller (or header-only NIL filing)
```

### 8.4 Export GSTR-8 JSON (NIC-payload shape)

```bash
curl -s "http://localhost:8000/api/v1/admin/tax/reports/gstr8.json?filingPeriod=2026-04&operatorGstin=29ABCDE1234F1Z5" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### 8.5 Mark TCS rows FILED + PAID (lifecycle transitions)

```bash
LEDGER_IDS=$(psql -At sportsmart_dev -c \
  "SELECT id FROM gst_tcs_settlement_ledger WHERE status='COLLECTED';" | jq -R . | jq -s -c .)

# Bulk markFiled
curl -s -X POST http://localhost:8000/api/v1/admin/tax/tcs/mark-filed \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"ledgerIds\":$LEDGER_IDS}" | jq

# Bulk markPaidToGovt
curl -s -X POST http://localhost:8000/api/v1/admin/tax/tcs/mark-paid \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"ledgerIds\":$LEDGER_IDS,\"paymentReference\":\"UTR-TEST-12345\"}" | jq
```

---

## 9. Verify Phase-18 per-seller GSTR-1 + 3B exports

```bash
SELLER_ID=$(psql -At sportsmart_dev -c "SELECT id FROM sellers LIMIT 1;")

# GSTR-1 §4 B2B
curl -s "http://localhost:8000/api/v1/admin/tax/reports/gstr1.csv?sellerId=$SELLER_ID&filingPeriod=2026-04" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -o /tmp/gstr1-b2b.csv
cat /tmp/gstr1-b2b.csv

# GSTR-1 §12 HSN summary
curl -s "http://localhost:8000/api/v1/admin/tax/reports/gstr1/hsn.csv?sellerId=$SELLER_ID&filingPeriod=2026-04" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# GSTR-1 §13 documents-issued
curl -s "http://localhost:8000/api/v1/admin/tax/reports/gstr1/section13.csv?sellerId=$SELLER_ID&filingPeriod=2026-04" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# GSTR-3B 3.1 + 3.2
curl -s "http://localhost:8000/api/v1/admin/tax/reports/gstr3b.csv?sellerId=$SELLER_ID&filingPeriod=2026-04" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## 10. Verify Phase-23 audit-readiness dashboard

```bash
curl -s http://localhost:8000/api/v1/admin/tax/audit-readiness \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
# → {
#     currentMode: 'OFF',
#     ready: <true|false>,
#     totalBlockers: <int>,
#     blockers: [
#       { code: 'product.missing_hsn', count: N, sampleIds: [...], message: '...' },
#       ... 6 more classes ...
#     ]
#   }
```

Each blocker class lists up to 5 sample IDs. Click through to the admin product / seller / tax-doc page to fix.

---

## 11. Test mode flip OFF → AUDIT → STRICT (Phase 23 + runbook)

### 11.1 Flip AUDIT

```bash
psql sportsmart_dev -c "
INSERT INTO tax_config (id, key, value, description, created_at, updated_at)
VALUES (gen_random_uuid()::text, 'tax_audit_mode', 'true', 'Local testing — AUDIT', now(), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();"

# Wait 60s for the TaxConfigService cache TTL OR restart the API
sleep 65
curl -s http://localhost:8000/api/v1/admin/tax/mode \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
# → { data: { mode: 'AUDIT' } }
```

Now any caller that uses `TaxModeService.report(...)` logs `tax_audit.violation code=... message=... context={}` instead of throwing. Tail the API output to see the lines.

### 11.2 Flip STRICT

```bash
psql sportsmart_dev -c "
INSERT INTO tax_config (id, key, value, description, created_at, updated_at)
VALUES (gen_random_uuid()::text, 'tax_strict_mode', 'true', 'Local testing — STRICT', now(), now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();"

sleep 65
curl -s http://localhost:8000/api/v1/admin/tax/mode \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
# → { data: { mode: 'STRICT' } }
```

Now:
- DRAFT banner is **suppressed** on new PDF renders (regenerate one to verify).
- `TaxModeService.report(...)` throws `TaxStrictModeViolationError` → HTTP 4xx / 5xx on the upstream endpoint.

### 11.3 Rollback (always available in one query)

```bash
psql sportsmart_dev -c "
UPDATE tax_config SET value = 'false', updated_at = now()
WHERE key IN ('tax_strict_mode', 'tax_audit_mode');"

sleep 65
curl -s http://localhost:8000/api/v1/admin/tax/mode \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
# → { data: { mode: 'OFF' } }
```

---

## 12. Test Phase-21 erasure preserves tax-document statutory hold

```bash
# Get the smoke customer's userId
USER_ID=$(psql -At sportsmart_dev -c "SELECT id FROM users WHERE email='smoke-customer@sportsmart.test';")

# Request erasure
# (uses the admin erasure endpoint OR the customer-side /me/erasure trigger — check ErasureService for the path)

# After processing, inspect the outcome:
psql sportsmart_dev -c "
SELECT subject_email_snapshot, status, outcome->'statutoryHold' as statutory_hold
FROM data_erasure_requests
WHERE subject_id = '$USER_ID' ORDER BY created_at DESC LIMIT 1;"
# → outcome.statutoryHold = {
#     preservedBy: 'CGST Section 36 / 8-year retention',
#     documentsUnderRetention: N,
#     totalDocuments: N,
#     retentionYears: 8,
#     note: 'Tax documents ... preserved as statutory evidence; ...'
#   }

# The tax_documents themselves should NOT have customer_id wiped:
psql sportsmart_dev -c "
SELECT document_number, buyer_legal_name, customer_id FROM tax_documents WHERE customer_id = '$USER_ID' LIMIT 3;"
# → buyer_legal_name still set (snapshotted at issuance); customer_id still set (statutory record).
# The users row's firstName/lastName/email/phone WERE redacted:
psql sportsmart_dev -c "
SELECT first_name, last_name, email FROM users WHERE id = '$USER_ID';"
# → '[REDACTED]', '[REDACTED]', 'redacted-<userId>@erased.local'
```

---

## 13. Test Phase-24 notifications (template missing → log + drop)

The Phase-24 service is wired but the `notification_templates` rows for `tax.*` keys are NOT seeded yet (CA / UX work in Phase 25). So today every `tax-notification.service.ts` call hits the facade's "template not found — dropping" path. Verify by tailing the API log while triggering an event:

```bash
# Re-trigger the order-placed flow from §3.1.
# In the API log, look for:
#   "Template tax.customer.invoice_issued.email not found — dropping"
# That confirms the call site is wired; once you seed the template (Phase 25 admin UI), the notification dispatches.
```

To seed manually for testing:

```bash
psql sportsmart_dev -c "
INSERT INTO notification_templates (id, key, channel, subject, body, created_at, updated_at)
VALUES (
  gen_random_uuid()::text,
  'tax.customer.invoice_issued.email',
  'EMAIL',
  'Your invoice {{documentNumber}} is ready',
  '<p>Hi, your invoice <strong>{{documentNumber}}</strong> ({{documentTotalRupees}}) dated {{documentDate}} is ready. <a href=\"{{downloadUrl}}\">Download</a></p>',
  now(), now()
);"
```

Re-trigger the flow → the notification dispatches via the existing notification worker.

---

## 14. Cleanup / reset

```bash
# Wipe TCS lifecycle for a re-run:
psql sportsmart_dev -c "DELETE FROM gst_tcs_settlement_ledger; UPDATE seller_settlements SET tcs_ledger_id = NULL, tcs_deducted_in_paise = 0;"

# Wipe e-way bills:
psql sportsmart_dev -c "DELETE FROM e_way_bills;"

# Wipe test wallet adjustments:
psql sportsmart_dev -c "DELETE FROM wallet_adjustments WHERE kind = 'TIME_BARRED_CREDIT_NOTE';"

# Full nuclear (drops EVERY tax doc + everything that hangs off it — only in dev):
psql sportsmart_dev <<SQL
DELETE FROM tax_document_download_audits;
DELETE FROM tax_document_lines;
DELETE FROM tax_documents;
DELETE FROM order_item_tax_snapshots;
DELETE FROM sub_order_tax_summaries;
DELETE FROM order_tax_summaries;
SQL
```

---

## 15. Cheat-sheet — endpoint inventory

| Surface | Endpoint | Auth |
|---|---|---|
| Mode badge | `GET /api/v1/admin/tax/mode` | Admin + `tax.reports.read` |
| Readiness dashboard | `GET /api/v1/admin/tax/audit-readiness` | Admin + `tax.reports.read` |
| GSTR-1 B2B CSV | `GET /api/v1/admin/tax/reports/gstr1.csv` | Admin + `tax.reports.export` |
| GSTR-1 section CSV | `GET /api/v1/admin/tax/reports/gstr1/:section.csv` | Admin + `tax.reports.export` |
| GSTR-3B CSV | `GET /api/v1/admin/tax/reports/gstr3b.csv` | Admin + `tax.reports.export` |
| GSTR-8 CSV | `GET /api/v1/admin/tax/reports/gstr8.csv` | Admin + `tax.tcs.export` |
| GSTR-8 JSON | `GET /api/v1/admin/tax/reports/gstr8.json` | Admin + `tax.tcs.export` |
| GSTR-8 summary | `GET /api/v1/admin/tax/reports/gstr8/summary` | Admin + `tax.tcs.read` |
| TCS markFiled | `POST /api/v1/admin/tax/tcs/mark-filed` | Admin + `tax.tcs.markFiled` |
| TCS markPaid | `POST /api/v1/admin/tax/tcs/mark-paid` | Admin + `tax.tcs.markPaidToGovt` |
| Customer invoice list | `GET /api/v1/customer/tax-documents` | UserAuthGuard |
| Customer invoice download | `GET /api/v1/customer/tax-documents/:id/download` | UserAuthGuard |
| Seller invoice list | `GET /api/v1/seller/tax-documents` | SellerAuthGuard |
| Seller invoice download | `GET /api/v1/seller/tax-documents/:id/download` | SellerAuthGuard |

---

## 16. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Admin endpoint 401 even with token | Token expired (default ~24h) | Re-login + re-export `$ADMIN_TOKEN` |
| Admin endpoint 403 with code `PERMISSION_DENIED` | Admin role lacks the required `tax.*` permission | Assign the relevant role in the admin RBAC UI (Phase 5 admin work) |
| Download endpoint 409 `DOCUMENT_NOT_READY` | PDF retry cron hasn't run yet | Wait 5 min OR check `pdf_retry_count` is below cap (default 5) |
| Download endpoint 429 `TOO_MANY_REQUESTS` | Hit the per-(actor, document) rate limit (20 / 5 min default) | Wait or tune `TAX_DOWNLOAD_RATE_LIMIT_PER_WINDOW` in `.env` |
| Customer downloaded SOMEONE else's invoice | Scope check bypassed — should never happen | Inspect `tax_document_download_audits` for `DENIED_SCOPE` rows; raise a P0 |
| Mode flip didn't take | `TaxConfigService` 60s cache TTL | Wait or restart the API |
| `prisma migrate status` shows pending | New migrations from upstream pull | `pnpm exec prisma migrate deploy` |
| `prisma migrate status` shows "drift" | Schema-vs-DB mismatch | Investigate; do NOT `migrate reset` in shared DB |
| EWB / IRN / PDF stuck in PENDING | Cron disabled via env flag | `TAX_*_CRON_ENABLED=true` in `.env`, restart API |

---

**You now have the full happy path + the failure paths + the rollback. Combined with the test suite (`pnpm jest test/unit/tax`) this is the verifiable evidence that the 28-phase implementation works end-to-end.**
