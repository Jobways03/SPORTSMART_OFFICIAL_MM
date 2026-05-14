# STRICT_MODE_ROLLOUT_RUNBOOK.md

**Audience:** Engineering + Ops + CA. The step-by-step procedure for taking the GST module from dev-permissive (`OFF`) to prod-strict (`STRICT`).

**Owner:** Engineering. CA gates the cutover via the §10 sign-off checklist.

---

## 1. What "strict mode" means

Per Phase 23, `TaxModeService.getMode()` resolves to one of three modes (canonical source: `tax_config` table; env fallbacks `TAX_AUDIT_MODE` / `TAX_STRICT_MODE`):

| Mode | Behaviour |
|---|---|
| `OFF` | Permissive. Missing HSN / rate / GSTIN data passes through with fallbacks. Used in dev / test. |
| `AUDIT` | Validation runs but failures are **logged** (`tax_audit.violation code=… message=… context=…`). Used in staging to gather "what would strict mode reject?" without blocking checkouts. |
| `STRICT` | Validation **throws**. DRAFT banner is suppressed on PDF renders. Used in prod after CA sign-off. |

`STRICT` implies `AUDIT` — both flags are checked but `STRICT` wins when both are true.

---

## 2. Rollout phases (controlled cutover)

### Phase R1 — Ship code with both flags OFF

- **What:** Every deploy from this point includes the Phase 23 service + audit-readiness dashboard + Phase 24 notifications. Both `tax_audit_mode` and `tax_strict_mode` rows in `tax_config` stay `false` (or unseeded — env defaults).
- **Verify:**
  - `GET /api/v1/admin/tax/mode` → `{ "mode": "OFF" }`.
  - PDF renders show the **DRAFT banner**.
  - Order placement succeeds even on a product without HSN.
- **Duration:** Until staging deploy is green.

### Phase R2 — Flip AUDIT on staging

- **What:** Run on staging only:
  ```sql
  INSERT INTO tax_config (id, key, value, description, created_at, updated_at)
  VALUES (gen_random_uuid()::text, 'tax_audit_mode', 'true', 'Phase 23 rollout — AUDIT on for staging soak', now(), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  ```
- **Cache:** `TaxConfigService` has a 60-second TTL. Either wait 60s or call `TaxConfigService.invalidate('tax_audit_mode')` via the admin settings panel.
- **Verify:**
  - `GET /api/v1/admin/tax/mode` → `{ "mode": "AUDIT" }`.
  - PDF still shows DRAFT banner (AUDIT does NOT suppress).
  - Logs show `tax_audit.violation` lines for any caller that invoked `TaxModeService.report(...)`.
- **Soak window:** **At least 2 weeks** of real staging traffic. Three things to monitor:
  1. **Aggregate violation count** per `code` (group by `tax_audit.violation code=…`). Stable = good. Climbing = a recently-added product / seller is failing validation.
  2. **`GET /api/v1/admin/tax/audit-readiness`** — call daily; watch `totalBlockers` trend down.
  3. **Logs around the existing services**: PDF retry escalations, IRN failures, time-bar approaching — these are pre-strict signals that translate directly to strict-mode blockers.

### Phase R3 — Drive blockers to zero

The audit-readiness report's `blockers` array enumerates seven classes. Each has a remediation play:

| Blocker code | Remediation |
|---|---|
| `product.missing_hsn` | Admin → Products → filter "HSN missing" → bulk-edit. |
| `product.missing_rate` | Admin → Products → filter "Rate missing" → bulk-edit. Confirm with CA per HSN. |
| `seller.missing_gstin` | Admin → Sellers → filter "active without GSTIN" → email seller to register GSTIN; or mark seller `INACTIVE`. |
| `einvoice.unresolved` | Admin → Tax → Failed IRNs → review failure reason → retry manually or fix root cause. |
| `pdf.unresolved` | Admin → Tax → Failed PDFs → retry manually; if persistent, file a bug. |
| `tcs.unfiled` | Admin → Tax → GSTR-8 → upload to NIC + mark FILED + mark PAID_TO_GOVT. |
| `timebar.requires_review` | Admin → Returns → "Time-bar review" queue → decide credit-note vs wallet-adjustment per item. |

**Gate:** Do NOT advance to R4 until `totalBlockers === 0` AND the CA has ticked the §10 sign-off checklist.

### Phase R4 — Flip STRICT on production

- **What:**
  ```sql
  -- Production DB
  INSERT INTO tax_config (id, key, value, description, created_at, updated_at)
  VALUES
    (gen_random_uuid()::text, 'tax_audit_mode', 'true', 'Phase 23 rollout — AUDIT on (implied by STRICT)', now(), now()),
    (gen_random_uuid()::text, 'tax_strict_mode', 'true', 'Phase 23 rollout — STRICT on (CA-signed-off YYYY-MM-DD)', now(), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  ```
- **Cache:** 60s TTL. Wait or invalidate.
- **Verify:**
  - `GET /api/v1/admin/tax/mode` → `{ "mode": "STRICT" }`.
  - New PDF renders **omit the DRAFT banner**. (Existing PDF_GENERATED rows retain the old banner until re-rendered via `tax.invoice.regeneratePdf`.)
  - `TaxModeService.report({ code: 'test', message: 'rollout-verify' })` throws.
- **Monitoring (first 24h):**
  - Watch `error_rate` on every Tax-touching endpoint. A spike means a real production violation that didn't surface in staging.
  - If a critical regression appears: **roll back STRICT in one query** (set `value` to `'false'`), wait 60s for cache, verify mode is `AUDIT` again.

### Phase R5 — Backfill legacy DRAFT banners (optional)

- **Why optional:** PDF_GENERATED rows from before R4 still carry the DRAFT banner in their stored HTML. Customer-facing display is still correct via re-render.
- **Trigger:** Admin selects "Regenerate PDF" on any document; the Phase 19 service re-runs `renderHtmlForDocument` with `mode='STRICT'` and the new HTML overwrites the stored one.
- **Bulk:** A SQL update sets `status = 'PDF_PENDING'` on all PDF_GENERATED rows in a chosen FY; the Phase 19 retry cron picks them up within ~5 minutes per batch and re-renders.

---

## 3. Rollback procedure

**Single-query rollback** at any phase:

```sql
UPDATE tax_config SET value = 'false', updated_at = now()
WHERE key IN ('tax_strict_mode', 'tax_audit_mode');
```

Wait 60s for the `TaxConfigService` cache TTL, then verify with `GET /api/v1/admin/tax/mode`.

No data is corrupted by a rollback — STRICT mode only throws; it never silently mutates. Throw-exceptions surfaced before the rollback land as `TaxStrictModeViolationError` in error logs; the upstream HTTP handler returned 4xx / 5xx but the database state is unchanged.

---

## 4. Pre-flight checklist (engineering, before R4)

- [ ] `npx prisma migrate deploy` is clean — all 137+ migrations applied on prod.
- [ ] `GET /api/v1/admin/tax/audit-readiness` returns `ready: true` AND `totalBlockers: 0`.
- [ ] CA has ticked **every** item in CA.md §10.
- [ ] STRICT-mode flip date is on the change-management calendar.
- [ ] Ops oncall has a copy of this runbook + the rollback query.
- [ ] PagerDuty (or equivalent) is configured to alert on `tax_strict.violation` log lines.
- [ ] Phase 24 templates seeded — admin → Notifications → Templates shows all `tax.*` rows with subject + body filled in.

---

## 5. CA cutover sign-off (record here)

| Item | Date | Person |
|---|---|---|
| AUDIT flipped on staging | | |
| `totalBlockers` reached zero | | |
| CA §10 sign-off | | |
| STRICT flipped on prod | | |
| 24h post-cutover review | | |
| 7-day post-cutover review | | |

---

## 6. Quick reference

- **Mode endpoint:** `GET /api/v1/admin/tax/mode`
- **Readiness endpoint:** `GET /api/v1/admin/tax/audit-readiness`
- **Mode service:** `apps/api/src/modules/tax/application/services/tax-mode.service.ts`
- **Audit readiness service:** `apps/api/src/modules/tax/application/services/tax-audit-readiness.service.ts`
- **Tax config keys:** `tax_strict_mode` / `tax_audit_mode` in `tax_config` table.
- **Env fallbacks:** `TAX_STRICT_MODE` / `TAX_AUDIT_MODE` (boot-time only; tax_config wins at runtime).
- **CA.md sign-off section:** `docs/tax/CA.md` §10.
