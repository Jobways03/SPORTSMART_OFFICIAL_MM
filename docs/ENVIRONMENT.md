# Environment & Configuration Reference (API)

Code-verified map of **every** environment variable the API declares, derived by
auditing `apps/api/src/bootstrap/env/env.schema.ts` (the validator) **and**
grepping every actual read in the codebase.

> **Audit summary (357 declared keys):**
> - **8 hard-required** (won't boot)
> - **8 required in prod — must be SET**
> - **18 required in prod — must be `true`**
> - **70 optional** (integrations / set-to-enable)
> - **279 defaulted** (tuning / feature flags)
> - **14 declared but NOT consumed by code** (trimmable — see §8)

---

## 1. How config is loaded

The app only ever reads **`process.env`**.

| Environment | How `process.env` is populated |
|---|---|
| **Local dev** | `ConfigModule` loads `apps/api/.env` into `process.env`. |
| **AWS** | **No `.env` file.** ECS injects it: non-secrets from the task-def `environment[]` block, secrets from **AWS Secrets Manager** via `secrets[]`. |

`env.service.ts` then runs `envSchema.parse(process.env)`. The `requiredInProd` /
`requiredOnInProd` gates in `env.schema.ts` add the production-only requirements.

---

## 2. 🔴 Hard-required — app will NOT boot without these (every environment)

| Key | Purpose | Generate |
|---|---|---|
| `DATABASE_URL` | Postgres connection | — |
| `REDIS_URL` | Redis (idempotency, locks, OTPs) | — |
| `JWT_CUSTOMER_SECRET` | customer token signing (≥32 chars) | `openssl rand -base64 32` |
| `JWT_SELLER_SECRET` | seller token signing | `openssl rand -base64 32` |
| `JWT_FRANCHISE_SECRET` | franchise token signing | `openssl rand -base64 32` |
| `JWT_ADMIN_SECRET` | admin token signing | `openssl rand -base64 32` |
| `JWT_AFFILIATE_SECRET` | affiliate token signing | `openssl rand -base64 32` |
| `AFFILIATE_ENCRYPTION_KEY` | AES-256 for affiliate PII at rest | `openssl rand -hex 32` |

---

## 3. 🟠 Required in production — must be SET (blank OK locally)

Enforced only when `NODE_ENV=production` (`requiredInProd` gate). Optional in dev/staging.

`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`ADMIN_MFA_ENCRYPTION_KEY`.

> Conditionally required: if `SMS_PROVIDER` is `msg91`/`twilio` in prod, then
> `SMS_AUTH_KEY` + `SMS_SENDER_ID` (+ `SMS_API_SECRET` for twilio) are required.

---

## 4. 🟠 Required in production — must be `true` (18 flags)

Default off in dev/test/staging; the `requiredOnInProd` gate refuses to boot prod
unless each resolves `true`. Flip on in prod after each cron's staging soak.

`CRON_HEARTBEAT_ENABLED`, `SLA_BREACH_DETECTOR_ENABLED`, `AUDIT_CHAIN_ANCHOR_ENABLED`,
`IDEMPOTENCY_ENABLED`, `INTEGRITY_VERIFIER_ENABLED`, `ERASURE_PROCESSOR_ENABLED`,
`WALLET_LEDGER_RECON_ENABLED`, `EVENT_DEDUP_ENABLED`, `OUTBOX_ENABLED`,
`OUTBOX_DUAL_WRITE`, `REFUND_GATEWAY_RECON_ENABLED`, `RETENTION_ENFORCER_ENABLED`,
`ABAC_ENABLED`, `REFUND_SAGA_ENABLED`, `COD_REFUND_PENDING_ENABLED`,
`MONEY_DUAL_WRITE_ENABLED`, `PERMISSIONS_GUARD_STRICT`, `RBAC_ORPHAN_SWEEP_ENABLED`.

---

## 5. 🟢 Optional integrations — set only to enable the provider (70 keys)

Each degrades/disables gracefully when unset (app still boots).

| Integration | Keys | If unset |
|---|---|---|
| **Razorpay** | `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET` (`RAZORPAY_WEBHOOK_REPLAY_WINDOW_SECONDS` defaulted) | payments disabled (prod-required) |
| **R2 storage** | `R2_ACCOUNT_ID/ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/PUBLIC_BASE_URL` | uploads refused (prod-required) |
| **Mail / SMTP** | `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM` (`MAIL_HOST/PORT/SECURE` defaulted) | **"log-only" mail — no email sent** |
| **Bank encryption** | `SELLER_BANK_ENCRYPTION_KEY`, `FRANCHISE_BANK_ENCRYPTION_KEY` | bank-detail writes return `BANK_DETAILS_UNAVAILABLE` |
| **Admin MFA** | `ADMIN_MFA_ENCRYPTION_KEY` | MFA login 500s (prod-required) |
| **AI** | `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | AI features disabled |
| **Captcha** | `CAPTCHA_SECRET` (`CAPTCHA_PROVIDER` defaulted `disabled`) | bot-protection off |
| **OpenSearch** | `OPENSEARCH_NODE/USERNAME/PASSWORD` | falls back to Prisma search |
| **WhatsApp** | `WHATSAPP_API_URL/API_TOKEN/PHONE_NUMBER_ID/WEBHOOK_VERIFY_TOKEN/APP_SECRET` | messaging skipped |
| **SMS** | `SMS_PROVIDER/AUTH_KEY/API_SECRET/SENDER_ID/API_URL/DLT_ENFORCED` | `stub` (no SMS) |
| **NIC GST e-way-bill** | `NIC_API_BASE_URL`, `NIC_GSP_USERNAME/PASSWORD/CLIENT_ID/CLIENT_SECRET`, `NIC_TAXPAYER_GSTIN` | e-way-bill provider falls back to `stub` |
| **NIC GST e-invoice (IRP)** | `NIC_IRP_BASE_URL`, `NIC_IRP_GSP_USERNAME/PASSWORD/CLIENT_ID/CLIENT_SECRET`, `NIC_IRP_TAXPAYER_GSTIN` | e-invoice provider falls back to `stub` |
| **Shiprocket webhook** | `SHIPROCKET_WEBHOOK_TOKEN/HMAC_SECRET/IP_ALLOWLIST` | webhook unverified |
| **Delhivery webhook** | `DELHIVERY_WEBHOOK_HMAC_SECRET/TOKEN/IP_ALLOWLIST` (carrier creds live in **logistics-facade**, not here) | webhook unverified |
| **Notifications** | `NOTIFICATION_DELIVERY_RECEIPT_SECRET`, `NOTIFICATION_UNSUBSCRIBE_SECRET` | DLR / unsubscribe links fail closed |
| **Metrics** | `METRICS_BEARER_TOKEN` | `/metrics` unauthenticated/closed |
| **Affiliate key rotation** | `AFFILIATE_ENCRYPTION_KEYS`, `AFFILIATE_ENCRYPTION_ACTIVE_VERSION` | single-key (no rotation) |
| **JWT extras** | `JWT_FRANCHISE_STAFF_SECRET` (falls back to franchise secret), `AUTH_COOKIE_DOMAIN`, `RETURN_EVIDENCE_ALLOWED_HOSTS` | sensible fallback |
| **Admin seed / escalation** | `ADMIN_SEED_NAME/EMAIL/PASSWORD` (seed script), `ADMIN_ESCALATION_EMAIL`, `AFFILIATE_KYC_GATE_ENABLED` | seed skipped / no escalation email |

---

## 6. ⚪ Feature flags & tuning — all defaulted (override only when needed)

**279 keys.** Listed in full by domain (key → default). `🟠T` = prod-required-true (§4).

### Core / app
`NODE_ENV`=development · `PORT`=8000 · `APP_NAME`=sportsmart-api · `APP_URL` · `CORS_ORIGINS` · `TRUST_PROXY_HOPS`=0 (**set real hop count in prod**) · `CLUSTER_WORKERS`=1 · `SHUTDOWN_GRACE_MS`=30000 · `API_DEFAULT_RATE_PER_MINUTE`=60 · `ALLOW_ONLINE_PAYMENTS`=true · `RETAIL_LOCAL_RADIUS_KM`=50 · `HEALTH_EXTERNAL_PROBES_DEFAULT`=false · `HEALTH_PROBE_TIMEOUT_MS`=3000

### Auth / security
`PERMISSIONS_GUARD_STRICT`=true 🟠T · `GLOBAL_AUTH_GUARD_STRICT`=false · `ABAC_ENABLED`=false 🟠T · `AUTHZ_AUDIT_ENABLED`=true · `RBAC_ORPHAN_SWEEP_ENABLED`=true 🟠T · `MFA_PENDING_SWEEP_ENABLED`=true · `SESSION_ABSOLUTE_LIFETIME_DAYS`=60 · `SESSION_REVOKED_SWEEP_ENABLED`=true · `SESSION_EXPIRED_CLEANUP_ENABLED`=true · `SESSION_EXPIRED_CLEANUP_GRACE_DAYS`=30 · `JWT_ACCESS_TTL`=1h · `JWT_REFRESH_TTL`=30d · `ACCESS_LOG_RETENTION_ENABLED`=true · `ACCESS_LOG_RETENTION_DAYS`=180 · `BRUTE_FORCE_SPIKE_CRON_ENABLED`=true (+ `_WINDOW_MINUTES`=15, `_PER_ACTOR_IP`=10, `_PER_IP`=30, `_PER_ACCOUNT`=20, `_MAX_TASKS_PER_RUN`=50)

### Commission *(see §9)*
`COMMISSION_PROCESSOR_ENABLED`=true · `COMMISSION_PROCESSOR_BATCH_SIZE`=200 · `COMMISSION_PROCESSOR_CONCURRENCY`=5 · `COMMISSION_REVERSAL_WINDOW_DAYS`=30 · `COMMISSION_REQUIRE_COD_PAID`=false · `AFFILIATE_COMMISSION_CAP_PER_ORDER`=100000

### Settlement
`SETTLEMENT_AUTO_CYCLE_ENABLED`=false · `SETTLEMENT_CYCLE_PERIOD_DAYS`=7 · `SETTLEMENT_AUTO_CYCLE_INTERVAL_MINUTES`=60 · `TDS_PAYOUT_HOLDBACK_ENABLED`=true

### Orders / routing / returns *(return window: see §9)*
`ORDER_ACCEPTANCE_SLA_MINUTES`=60 · `ORDER_ACCEPTANCE_SLA_BATCH_SIZE`=100 · `ORDER_FINALIZATION_RECOVERY_ENABLED`=true (+ `_GRACE_MINUTES`=10, `_ALERT_MINUTES`=60, `_BATCH_LIMIT`=500) · `ROUTING_DISTANCE_WEIGHT`=0.7 · `ROUTING_STOCK_WEIGHT`=0.2 · `ROUTING_SLA_WEIGHT`=0.1 · `ROUTING_PINCODE_PRIORITY_WEIGHT`=0.5 · `ROUTING_MAX_DISTANCE_KM`=1500 · `RETURN_WINDOW_DAYS`=14 (**prod 14; local `.env`=7**) · `RETURN_QC_PENDING_SLA_HOURS`=48 · `RETURN_STALE_DAYS`=30 · `RETURN_STALE_BATCH_SIZE`=50 · `RETURN_STALE_EXHAUSTED_BATCH_SIZE`=20 · `RETURN_SELLER_RESPONSE_SWEEPER_ENABLED`=true · `RETURN_AUTO_RVP_ENABLED`=true · `RETURN_QC_MIN_EVIDENCE`=2 · `RETURN_SELLER_DELIVERY_CHARGE_PAISE`=10000 · `RETURN_RESTOCKING_FEE_BPS`=0 · `RETURN_EVIDENCE_ORPHAN_CLEANUP_ENABLED`=false · `CUSTOMER_ABUSE_MIN_RETURNS`=0 · `CUSTOMER_ABUSE_RATE_THRESHOLD_BPS`=0 · `SHIPMENT_EVIDENCE_REQUIRED_PHOTOS`=4

### Payments / refunds / COD / wallet
`PAYMENT_POLL_INTERVAL_SECONDS`=60 · `PAYMENT_WINDOW_MINUTES`=30 · `PAYMENT_POLL_CANCEL_BATCH`=30 · `PAYMENT_POLL_ORPHAN_BATCH`=20 · `PAYMENT_POLL_ORPHAN_BACKOFF_SECONDS`=180 · `PAYMENT_POLL_FETCH_FAILURE_ALERT_THRESHOLD`=5 · `PAYMENT_EXPIRY_SWEEP_ENABLED`=true · `REFUND_POLL_INTERVAL_SECONDS`=120 · `REFUND_RETRY_BACKOFF_MINUTES`=15 · `REFUND_MAX_RETRY_ATTEMPTS`=5 · `REFUND_STATUS_POLLER_ENABLED`=true (+ `_MIN_AGE_MIN`=15) · `REFUND_SAGA_ENABLED`=true 🟠T · `REFUND_INSTRUCTION_REQUIRED`=true · `REFUND_AUTO_APPROVE_THRESHOLD_PAISE`=1000000 · `REFUND_DUAL_APPROVAL_THRESHOLD_PAISE`=10000000 · `REFUND_APPROVAL_SLA_HOURS`=48 · `REFUND_GATEWAY_RECON_ENABLED`=true 🟠T (+ `_BACKOFF_MINUTES`=30, `_BATCH`=50, `_FAILURE_ALERT_THRESHOLD`=5) · `REFUND_SAGA_SWEEP_ENABLED`=true (+ `_STUCK_MINUTES`=5, `_BATCH_SIZE`=50) · `REFUND_PENDING_APPROVAL_SWEEP_ENABLED`=true (+ `_STUCK_HOURS`=48) · `COD_REFUND_PENDING_ENABLED`=true 🟠T (+ `_INTERVAL_MINUTES`=240, `_STUCK_HOURS`=48) · `COD_COLLECTION_PENDING_ENABLED`=true (+ `_STUCK_HOURS`=72, `_BATCH`=100) · `COD_FALLBACK_MAX_ORDER_VALUE_INR`=10000 · `COD_FALLBACK_MIN_ORDER_VALUE_INR`=100 · `COD_ABUSE_RECENT_CANCEL_LIMIT`=3 · `COD_ABUSE_LOOKBACK_DAYS`=30 · `WALLET_LEDGER_RECON_ENABLED`=true 🟠T (+ `_INTERVAL_MINUTES`=1440) · `WALLET_REFUND_SAGA_ENABLED`=true (+ `_BATCH_LIMIT`=100, `_COOLDOWN_MINUTES`=5) · `WALLET_GOODWILL_EXPIRY_ENABLED`=true (+ `_BATCH_LIMIT`=1000) · `WALLET_MAX_TOPUP_PAISE`=10000000 · `WALLET_ADJUSTMENT_DUAL_APPROVAL_THRESHOLD_PAISE`=500000 · `WALLET_ADJUSTMENT_AUTO_APPROVE_BELOW_THRESHOLD`=false · `GOODWILL_CREDIT_EXPIRY_DAYS`=180 · `MAX_GOODWILL_AMOUNT_PER_DISPUTE_PAISE`=5000000

### Disputes
`DISPUTE_REFUND_RECOVERY_SWEEP_ENABLED`=true · `DISPUTE_REFUND_RECOVERY_LOOKBACK_MINUTES`=1440 · `DISPUTE_HIGH_VALUE_DECISION_THRESHOLD_PAISE`=5000000

### Checkout / deferred order (Option B)
`CHECKOUT_DEFERRED_ORDER_CREATION`=false · `CHECKOUT_SESSION_RECONCILIATION_ENABLED`=true · `CHECKOUT_SESSION_RECONCILE_BATCH`=50 · `CHECKOUT_SESSION_STUCK_GRACE_MINUTES`=5 · `DEFERRED_CAPTURE_BATCH`=20 · `DEFERRED_CAPTURE_BACKOFF_SECONDS`=180 · `LEGACY_PLACE_ORDER_ENABLED`=false

### Platform mechanics (outbox / idempotency / money / errors)
`OUTBOX_ENABLED`=true 🟠T · `OUTBOX_DUAL_WRITE`=false 🟠T · `OUTBOX_AUTHORITATIVE`=false · `OUTBOX_POLL_INTERVAL_MS`=1000 · `OUTBOX_BATCH_SIZE`=100 · `OUTBOX_MAX_ATTEMPTS`=10 · `OUTBOX_RETENTION_DAYS`=30 · `OUTBOX_DLQ_RETENTION_DAYS`=90 · `OUTBOX_MAX_PAYLOAD_BYTES`=262144 · `OUTBOX_FAILURE_ALERT_THRESHOLD`=25 · `OUTBOX_DEBOUNCE_DEFAULT_MS`=30000 · `EVENT_DEDUP_ENABLED`=false 🟠T · `IDEMPOTENCY_ENABLED`=false 🟠T · `IDEMPOTENCY_TTL_HOURS`=24 · `MONEY_DUAL_WRITE_ENABLED`=false 🟠T · `PROBLEM_DETAILS_ENABLED`=false · `PROBLEM_DETAILS_BASE_URI` · `CASE_DUPLICATE_PREVENTION_ENABLED`=true · `DOUBLE_ENTRY_VALIDATOR_ENABLED`=true

### Inventory / discounts / cart / POS
`LOW_STOCK_SWEEP_CRON_ENABLED`=true · `LOW_STOCK_SWEEP_BATCH_SIZE`=1000 · `RESERVATION_EXPIRY_SWEEP_ENABLED`=true · `RESERVATION_EXPIRY_BATCH_SIZE`=500 · `FRANCHISE_RESERVATION_SWEEP_ENABLED`=true · `FRANCHISE_RESERVATION_CLEANUP_BATCH_SIZE`=500 · `DISCOUNT_RESERVATION_CRON_ENABLED`=true · `DISCOUNT_RELEASE_EXPIRED_BATCH_SIZE`=500 · `DISCOUNT_ALLOCATION_ENABLED`=false · `DISCOUNT_FRAUD_TRACKING_ENABLED`=true (+ `_WINDOW_MINUTES`=15, `_INVALID_THRESHOLD`=10) · `COUPON_ATTEMPT_IP_HASH_SALT` · `COUPON_ATTEMPTS_CLEANUP_ENABLED`=true (+ `_RETENTION_DAYS`=30) · `CART_ABANDONMENT_SWEEP_ENABLED`=true · `CART_ABANDONMENT_CUTOFF_DAYS`=90 · `POS_VOID_WINDOW_HOURS`=24 · `POS_RECON_MATCH_TOLERANCE_PAISE`=100 · `SEARCH_OPENSEARCH_ENABLED`=false · `OPENSEARCH_INDEX_PRODUCTS`=sportsmart_products

### Tax (e-way-bill / e-invoice / GSTN / PDFs)
`EWAY_BILL_PROVIDER`=stub · `EINVOICE_PROVIDER`=stub · `GSTN_PROVIDER`=stub · `GSTN_REVERIFY_CRON_ENABLED`=false (+ `_COOLDOWN_HOURS`=0, `_STALE_DAYS`=90) · `TAX_PDF_STORAGE_PROVIDER`=stub · `TAX_PDF_RETRY_CRON_ENABLED`=true (+ `_CAP`=5, `_COOLDOWN_MINUTES`=5, `_SCAN_LIMIT`=50) · `TAX_EINVOICE_RETRY_CRON_ENABLED`=true (+ `_CAP`=5, `_COOLDOWN_MINUTES`=5, `_SCAN_LIMIT`=50) · `TAX_EINVOICE_TURNOVER_THRESHOLD_PAISE`=0 · `TAX_DOWNLOAD_RATE_LIMIT_PER_WINDOW`=20 (+ `_WINDOW_MINUTES`=5) · `TAX_DOWNLOAD_SIGNED_URL_TTL_SECONDS`=300 · `TAX_DOCUMENT_RETENTION_YEARS`=8 · `TAX_CREDIT_NOTE_TIMEBAR_CRON_ENABLED`=true (+ `_APPROACHING_DAYS`=7, `_SCAN_LIMIT`=500) · `TAX_AUDIT_MODE`=false · `TAX_STRICT_MODE`=false · `TAX_AUDIT_READINESS_ACTIVE_SELLER_WINDOW_DAYS`=90 · `TAX_AUDIT_READINESS_DRAFT_STALE_HOURS`=24 · `TAX_READINESS_CACHE_TTL_SECONDS`=30 · `TAX_READINESS_SNAPSHOT_CRON_ENABLED`=true

> Commission **GST 18% / TCS §52 / TDS §194-O** are NOT env vars — they live in the
> `tax_config` DB table (admin-editable), read by `tax-config.service.ts`. The on/off
> toggles (`commission_gst_enabled`, `tcs_enabled`, `tds_enabled`) are also DB rows.

### Compliance / audit / retention crons (mostly 🟠T)
`CRON_HEARTBEAT_ENABLED`=false 🟠T · `SLA_BREACH_DETECTOR_ENABLED`=true 🟠T · `AUDIT_CHAIN_ANCHOR_ENABLED`=true 🟠T · `INTEGRITY_VERIFIER_ENABLED`=false 🟠T (+ `_BATCH_SIZE`=100, `_REVERIFY_DAYS`=30) · `ERASURE_PROCESSOR_ENABLED`=false 🟠T · `RETENTION_ENFORCER_ENABLED`=false 🟠T (+ `RETENTION_ENFORCER_DRY_RUN`=true) · `AUDIT_CHAIN_VERIFY_ENABLED`=true (+ `_LIMIT`=20000) · `AUDIT_EXPORT_MAX_RANGE_DAYS`=90 · `AUDIT_EXPORT_MAX_ROWS`=100000 · `AUDIT_LOG_RETENTION_ENABLED`=false (+ `_DAYS`=2557) · `MEDIA_ORPHAN_SWEEPER_ENABLED`=true (+ `_RETENTION_DAYS`=30, `_BATCH_SIZE`=200, `_DELETE_RETRY_CAP`=5) · `STUCK_JOB_DETECTOR_ENABLED`=true (+ `STUCK_TAX_PDF_HOURS`=2, `STUCK_EINVOICE_HOURS`=2, `STUCK_SETTLEMENT_CYCLE_HOURS`=24) · `RECON_STALE_RUN_REAPER_ENABLED`=true (+ `_MINUTES`=60) · `WEBHOOK_DLQ_SWEEPER_ENABLED`=true (+ `_SWEEP_WINDOW_HOURS`=2, `_ALERT_THRESHOLD`=5)

### Loyalty / NDD / verification / support / observability
`LOYALTY_ENABLED`=false (+ `_CASHBACK_BPS`=100, `_CASHBACK_MAX_PAISE`=50000, `_MIN_ORDER_PAISE`=50000, `_EARN_EXPIRY_DAYS`=180) · `NDD_ENABLED`=false (+ `_MAX_DISTANCE_KM`=50, `_CUTOFF_HOUR`=14, `_TAT_CHECK_ENABLED`=true) · `VERIFICATION_CLAIM_TTL_MINUTES`=15 (+ `_MAX_CLAIMS_PER_VERIFIER`=10, `_BULK_APPROVE_MAX`=25, `_CLAIM_EXPIRY_ENABLED`=true, `_CLAIM_EXPIRY_BATCH_LIMIT`=500, `_SLA_MINUTES`=60) · `PROCUREMENT_APPROVAL_SLA_HOURS`=48 · `PROCUREMENT_SLA_BREACH_CRON_ENABLED`=true · `SUPPORT_SLA_BUSINESS_HOURS_ENABLED`=false (+ `_HOUR_START`=9, `_HOUR_END`=19) · `SUPPORT_SLA_SWEEP_ENABLED`=true · `SUPPORT_REOPEN_WINDOW_DAYS`=30 · `SUPPORT_MIRROR_SWEEP_ENABLED`=true (+ `_LOOKBACK_MINUTES`=120) · `SUPPORT_AUTO_ASSIGN_ENABLED`=false · `ADMIN_TASK_SLA_BREACH_ENABLED`=true · `PORTAL_SSE_MAX_CONN_PER_ACTOR`=5 (+ `_PER_ADMIN`=3, `_MAX_CONN_AGE_MIN`=15) · `FRANCHISE_PENALTY_MAX_WITHOUT_APPROVAL_RUPEES`=50000 · `FRANCHISE_REPORT_TZ_OFFSET_MINUTES`=330 · `LOGISTICS_PARTNER_REGISTRATION_ENABLED`=true · `AFFILIATE_RETURN_WINDOW_CRON_ENABLED`=true (+ `_INTERVAL_MS`=60000) · `OTEL_ENABLED`=false (+ `_SERVICE_NAME`, `_EXPORTER_OTLP_ENDPOINT`, `_TRACES_SAMPLER_RATIO`=0.1) · `AI_PROVIDER_ORDER`=gemini,anthropic (+ `_REQUEST_TIMEOUT_MS`=20000, `_DAILY_QUOTA_PER_TENANT`=100, `_GEMINI_MODEL`, `_ANTHROPIC_MODEL`)

---

## 7. AWS — where each value comes from (`infra/aws/terraform/`)

| Source | Holds | Defined in |
|---|---|---|
| ECS task-def `environment[]` | non-secret runtime config | `ecs.tf` `api_base_environment` |
| Secrets Manager **`generated`** | TF-generated secrets (DB/Redis URLs, JWT, encryption keys, ADMIN_MFA, bank keys) | `locals.tf` `generated_secret_keys` |
| Secrets Manager **`external`** | operator-set creds (Razorpay, R2, Mail, Delhivery) | `locals.tf` `external_secret_keys` |
| SSM Parameter Store | build-time **public** web config (`NEXT_PUBLIC_API_URL`, Razorpay public key) | `deploy.yml` |

Mechanism: `secrets: [{ name, valueFrom: "<ARN>:<KEY>::" }]` → ECS agent calls
`GetSecretValue` (task **execution role**) → injects as env var. Never written to disk.

---

## 8. ⚠️ Declared but NOT consumed by code (14 — trimmable)

Code-verified: no `env.getX('KEY')` / `process.env.KEY` read anywhere.

**Superseded interval/limit vars** (the `@Cron` decorators use fixed expressions; the
processor reads no interval env): `COMMISSION_PROCESSOR_INTERVAL_MS`,
`IDEMPOTENCY_SWEEP_INTERVAL_MINUTES`, `ORDER_ACCEPTANCE_SLA_CHECK_SECONDS`,
`REFUND_GATEWAY_RECON_INTERVAL_MINUTES`, `RETURN_STALE_CHECK_INTERVAL_MINUTES`,
`REFUND_SAGA_MAX_STEP_ATTEMPTS`, `REFUND_GOODWILL_REQUIRES_APPROVAL`.

**Vestigial:** `JWT_REFRESH_SECRET` (refresh tokens are hashed UUIDs, not JWTs).

**Declared/provisioned but integration not wired in API code** (verify before removing —
may be reserved or read by a shared client): `LOGISTICS_FACADE_URL`,
`LOGISTICS_FACADE_API_KEY`, `LOGISTICS_FACADE_TIMEOUT_MS`, `WEBHOOK_DELIVERY_ENABLED`,
`WEBHOOK_HMAC_SECRET`, `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD` (only the Shiprocket
*webhook* keys are read).

---

## 9. Commission & return window (focused)

### Commission calculation (`commission-processor.service.ts`)
**Margin-based**, with a percentage fallback. Per order item:
- `platformPrice` = `OrderItem.unitPrice` (what the customer paid).
- `settlementPrice` = seller↔product **settlement-price mapping** if present; else
  `platformPrice − platformPrice × commissionValue%` (`commissionValue` from the
  `CommissionSetting` **DB row**, default 20%).
- **commission = (platformPrice − settlementPrice) × quantity** → `platformMargin` (admin earning).

Example: ₹1000 item, 10% setting, no mapping → settlement ₹900, **commission ₹100**.
With a ₹850 mapping → **commission ₹150** (mapping wins).

Then the settlement layer adds **GST 18% / TCS §52 / TDS §194-O** (from `tax_config` DB,
each toggleable) — adjusting the seller's net payout, not the commission base.

Commission env (all defaulted, none required): `COMMISSION_PROCESSOR_ENABLED` (cron
kill-switch), `COMMISSION_PROCESSOR_BATCH_SIZE`, `COMMISSION_PROCESSOR_CONCURRENCY`,
`COMMISSION_REQUIRE_COD_PAID`, `COMMISSION_REVERSAL_WINDOW_DAYS`,
`AFFILIATE_COMMISSION_CAP_PER_ORDER`. *(The rate itself is a DB row, not env.)*

### Return window (`RETURN_WINDOW_DAYS`, default 14, local `.env`=7)
`returnWindowEndsAt = deliveredAt + RETURN_WINDOW_DAYS`. Read in 3 services:
`orders.service.ts`, `franchise-orders.service.ts`, `return-eligibility.service.ts`.
It gates **(a)** customer return eligibility and **(b)** commission locking — the
commission processor only picks up sub-orders **past** their return window. For fast
local testing set `RETURN_WINDOW_DAYS=0.0014` (≈2 min).

---

## 10. Local quick-start

```bash
cp apps/api/.env.example apps/api/.env
for d in apps/web-*; do cp "$d/.env.example" "$d/.env"; done
# edit apps/api/.env — set only the 🔴 8 hard-required keys; everything else
# has a working local default.
```
