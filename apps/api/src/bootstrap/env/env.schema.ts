import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(8000),

  APP_NAME: z.string().default('sportsmart-api'),
  APP_URL: z.string().default('http://localhost:8000'),
  CORS_ORIGINS: z.string().default('http://localhost:4005'),

  // Database
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string().min(1),

  // JWT — separate secret per actor type (security: a compromised secret
  // cannot be used to forge tokens for a different actor type). 32 chars
  // minimum for ~256-bit entropy; generate with `openssl rand -base64 32`.
  JWT_CUSTOMER_SECRET: z.string().min(32),
  JWT_SELLER_SECRET: z.string().min(32),
  JWT_FRANCHISE_SECRET: z.string().min(32),
  JWT_ADMIN_SECRET: z.string().min(32),
  JWT_AFFILIATE_SECRET: z.string().min(32),
  // App-layer key for encrypting affiliate PAN / Aadhaar / bank
  // account numbers at rest. 32 bytes (64 hex chars or 44 base64
  // chars) for AES-256. Generate with `openssl rand -hex 32`.
  AFFILIATE_ENCRYPTION_KEY: z.string().min(32),
  // Phase 10 — App-layer key for encrypting admin TOTP secrets at
  // rest. Same 32-byte / AES-256 shape as the affiliate key. Now
  // listed in requiredInProd (PR 10.8) so prod refuses to boot
  // without it — the PR 10.6 login-time challenge reads this on
  // every MFA-enrolled admin login. Optional in dev/staging so
  // local development without MFA can skip generating a key.
  ADMIN_MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32),
  // Phase 3 (PR 3.3) — tightened from the pre-PR default of '7d'.
  // A stolen access token is now valid for at most 1 hour against
  // a still-active session; renewals go through the (hashed,
  // rotation-on-use) refresh flow from PR 3.2. Operators can still
  // override per-env, subject to the cross-field validation below.
  JWT_ACCESS_TTL: z.string().default('1h'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // S3 - optional in dev
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  // Razorpay - optional
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  // Phase 4 (PR 4.7) — webhook replay window in seconds. The
  // controller compares `payload.created_at` against the server
  // clock and rejects events outside ±this many seconds. 300 (5 min)
  // matches Stripe's default; tighter values (60s, 30s) are sensible
  // in high-paranoia environments.
  RAZORPAY_WEBHOOK_REPLAY_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),

  // Shiprocket - optional
  SHIPROCKET_EMAIL: z.string().optional(),
  SHIPROCKET_PASSWORD: z.string().optional(),
  SHIPROCKET_WEBHOOK_TOKEN: z.string().optional(),
  // Phase 1 (PR 1.4) — HMAC-SHA256 secret for Shiprocket webhook
  // signature verification. When set, the controller requires the
  // `X-Shiprocket-Signature` header in Stripe-style `t=<ts>,v1=<hmac>`
  // format. When unset, the controller falls back to the legacy
  // `x_token` body-bearer check with a deprecation warning. Move all
  // environments to HMAC by setting this and coordinating with
  // Shiprocket dashboard config; the bearer-token path will be
  // removed in a follow-up release.
  SHIPROCKET_WEBHOOK_HMAC_SECRET: z.string().optional(),

  // iThink Logistics
  ITHINK_USE_SANDBOX: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  ITHINK_BASE_URL: z.string().default('https://pre-alpha.ithinklogistics.com'),
  ITHINK_TRACK_URL: z.string().default('https://pre-alpha.ithinklogistics.com'),
  ITHINK_ACCESS_TOKEN: z.string().optional(),
  ITHINK_SECRET_KEY: z.string().optional(),
  ITHINK_DEFAULT_LOGISTICS: z
    .enum(['delhivery', 'bluedart', 'xpressbees', 'ecom', 'ekart', 'fedex'])
    .default('delhivery'),
  ITHINK_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  ITHINK_HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  ITHINK_TRACKING_POLL_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(29)
    .default(25),
  ITHINK_TRACKING_POLL_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // OpenSearch - optional
  OPENSEARCH_NODE: z.string().optional(),

  // Cloudinary - optional in dev
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // WhatsApp - optional
  WHATSAPP_API_URL: z.string().optional(),
  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  // Gemini AI - optional
  GEMINI_API_KEY: z.string().optional(),

  // Mail (Nodemailer)
  MAIL_HOST: z.string().default('smtp.gmail.com'),
  MAIL_PORT: z.coerce.number().default(587),
  MAIL_SECURE: z.string().default('false'),
  MAIL_USER: z.string().optional(),
  MAIL_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  // Admin Seed
  ADMIN_SEED_NAME: z.string().optional(),
  ADMIN_SEED_EMAIL: z.string().optional(),
  ADMIN_SEED_PASSWORD: z.string().optional(),

  // Commission — reject return reversals more than N days after a settlement
  // has been paid. 0 disables the guard.
  COMMISSION_REVERSAL_WINDOW_DAYS: z.coerce.number().default(30),

  // Settlement cycle automation. Off by default; enable in staging/prod to
  // let the API roll cycles forward without manual intervention.
  SETTLEMENT_AUTO_CYCLE_ENABLED: z.string().default('false'),
  SETTLEMENT_CYCLE_PERIOD_DAYS: z.coerce.number().default(7),
  SETTLEMENT_AUTO_CYCLE_INTERVAL_MINUTES: z.coerce.number().default(60),

  // Order acceptance SLA. If a sub-order stays OPEN longer than this,
  // a background job auto-rejects it and triggers re-routing. 0 disables.
  ORDER_ACCEPTANCE_SLA_MINUTES: z.coerce.number().default(60),
  ORDER_ACCEPTANCE_SLA_CHECK_SECONDS: z.coerce.number().default(60),

  // Routing engine scoring weights. Must sum to 1.0 — the engine
  // normalises if they don't, but round-number thirds are cleaner.
  ROUTING_DISTANCE_WEIGHT: z.coerce.number().default(0.7),
  ROUTING_STOCK_WEIGHT: z.coerce.number().default(0.2),
  ROUTING_SLA_WEIGHT: z.coerce.number().default(0.1),

  // Refund poller + auto-retry. Polls Razorpay for pending refund status
  // and retries failed gateway calls on a schedule. 0 disables.
  REFUND_POLL_INTERVAL_SECONDS: z.coerce.number().default(120),
  REFUND_RETRY_BACKOFF_MINUTES: z.coerce.number().default(15),

  // Stale-return auto-close. Returns stuck in non-terminal states
  // beyond this many days are escalated or auto-closed.
  RETURN_STALE_DAYS: z.coerce.number().default(30),
  RETURN_STALE_CHECK_INTERVAL_MINUTES: z.coerce.number().default(60),

  // Payment poller. Checks Razorpay for orders stuck in PENDING_PAYMENT
  // and auto-cancels orders past the payment window.
  PAYMENT_POLL_INTERVAL_SECONDS: z.coerce.number().default(60),
  PAYMENT_WINDOW_MINUTES: z.coerce.number().default(30),

  // Number of reverse-proxy hops to trust for req.ip (used by the throttler
  // to rate-limit per client IP). 0 = don't trust X-Forwarded-For (dev).
  // 1 = trust one hop (typical: ALB / nginx in front). Higher if chained.
  TRUST_PROXY_HOPS: z.coerce.number().default(0),

  // ── Phase 1.1 — Idempotency (ADR-003) ──────────────────────────────
  // Endpoints decorated with @Idempotent() require X-Idempotency-Key
  // when this flag is on. Off by default for backward compatibility;
  // staging flips it on first, then prod after a 2-week soak.
  IDEMPOTENCY_ENABLED: z.string().default('false'),
  // Sweeper cron interval (minutes). Deletes COMPLETED rows past
  // expires_at and PENDING rows older than 60s (assumed crashed).
  IDEMPOTENCY_SWEEP_INTERVAL_MINUTES: z.coerce.number().default(15),
  // TTL for completed idempotency entries. Industry default is 24h.
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),

  // ── Phase 1.3 — Problem-Details (RFC 7807) error envelope (ADR-005) ─
  // When ON, every error response uses application/problem+json with
  // the {type, title, status, detail, instance, errors[]} shape.
  // OFF preserves the legacy {success, message, code, timestamp} shape
  // so existing frontends keep parsing successfully during cutover.
  PROBLEM_DETAILS_ENABLED: z.string().default('false'),
  // Base URI for problem-type slugs. RFC 7807 says it SHOULD be a
  // dereferenceable URI; we serve a static markdown page per type.
  // Override in dev / staging if you host docs elsewhere.
  PROBLEM_DETAILS_BASE_URI: z
    .string()
    .default('https://api.sportsmart.com/problems'),

  // ── Phase 1.5 — Business-duplicate prevention (ADR-006) ──────────────
  // When ON, return/dispute/ticket creation paths run a duplicate-active
  // check and reject with a 409 problem-type if a matching active case
  // already exists. Each rejection is logged to `case_duplicates`.
  // OFF (default) preserves today's behaviour — duplicates land silently
  // and are caught only by status-history audits later.
  CASE_DUPLICATE_PREVENTION_ENABLED: z.string().default('false'),

  // ── Phase 1.4 — Money paise dual-write (ADR-007) ─────────────────────
  // When ON, MoneyDualWriteHelper.applyPaise(...) augments write
  // payloads with paise siblings for every money Decimal column. The
  // schema-side ALTER TABLE migrations are unconditional; this flag
  // only controls whether NEW writes populate the paise columns.
  // After the staging soak, flip ON. PR 1.4-extended swaps reads to
  // paise. PR 1.7 drops the Decimal columns once parity holds for 2 weeks.
  MONEY_DUAL_WRITE_ENABLED: z.string().default('false'),

  // ── Phase 2 — Transactional Outbox (ADR-008) ─────────────────────────
  // OUTBOX_ENABLED runs the publisher worker that drains outbox_events.
  // OUTBOX_DUAL_WRITE: EventBusService writes outbox row in tx AND emits
  //   in-process for backward compat. Use during the dual-write soak.
  // OUTBOX_AUTHORITATIVE: only outbox writes; publisher is sole emitter.
  //   Flip ON after consumers are confirmed reading from publisher path.
  // EVENT_DEDUP_ENABLED: handlers wrapped with @IdempotentHandler() do an
  //   atomic INSERT into event_deduplication; P2002 = already-consumed,
  //   silently skip. Effective exactly-once at the handler boundary.
  OUTBOX_ENABLED: z.string().default('false'),
  OUTBOX_DUAL_WRITE: z.string().default('false'),
  OUTBOX_AUTHORITATIVE: z.string().default('false'),
  EVENT_DEDUP_ENABLED: z.string().default('false'),
  // Publisher cadence (ms). Lower = lower latency, higher polling cost.
  // Default 1000ms gives <2s end-to-end p99 latency under normal load.
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().default(1000),
  // How many pending rows the publisher pulls per tick. Caps the per-tick
  // worst-case latency to (BATCH × handler_p99); 100 is a balanced default.
  OUTBOX_BATCH_SIZE: z.coerce.number().default(100),
  // Hard cap before a row goes to outbox_dead_letters. Total time-to-DLQ
  // with default exp-backoff (1s, 2s, 4s, … capped at 1h) is roughly 5h.
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().default(10),

  // ── Phase 3 — Unified Refund System (ADR-009) ────────────────────────
  // REFUND_SAGA_ENABLED: when ON, RefundSagaService orchestrates execution
  //   of refund instructions through createInstruction → execute → notify.
  // REFUND_INSTRUCTION_REQUIRED: when ON, dispute decisions + return
  //   refunds create a RefundInstruction instead of calling the wallet
  //   directly. Off → legacy DisputeRefundHandler / ReturnService paths.
  // Both flags together drive the migration to "all refunds go through
  // the saga, all wallet credits trace to an instruction id".
  REFUND_SAGA_ENABLED: z.string().default('false'),
  REFUND_INSTRUCTION_REQUIRED: z.string().default('false'),

  // Saga retry budget for transient failures inside a single step
  // (gateway timeout, etc.). DLQ-equivalent doesn't exist for sagas —
  // FAILED is terminal and human-actionable.
  REFUND_SAGA_MAX_STEP_ATTEMPTS: z.coerce.number().default(5),

  // ── Phase 12 (ADR-017) — Finance approval gate ─────────────────────
  // Refund instructions whose amount exceeds this threshold (in paise)
  // queue as PENDING_APPROVAL instead of running the saga inline.
  // Default ₹10,000. Set to 0 to gate every refund (no auto-path).
  REFUND_AUTO_APPROVE_THRESHOLD_PAISE: z.coerce.number().default(1_000_000),
  // When 'true', GOODWILL_CREDIT remedies always queue regardless of
  // amount — finance signs off on every non-recoverable platform hit.
  REFUND_GOODWILL_REQUIRES_APPROVAL: z.string().default('true'),

  // Phase 13 (P1.8) — return seller-response sweeper. Cron flips
  // PENDING → EXPIRED past sellerResponseDueAt. Default 'true' since
  // the sweep is read-mostly + only flips rows past their due date.
  RETURN_SELLER_RESPONSE_SWEEPER_ENABLED: z.string().default('true'),

  // Phase 3 (PR 3.5) — reconciliation crons. Each independently flagged
  // so a noisy job can be paused without disabling the others.
  WALLET_LEDGER_RECON_ENABLED: z.string().default('false'),
  WALLET_LEDGER_RECON_INTERVAL_MINUTES: z.coerce.number().default(24 * 60),
  REFUND_GATEWAY_RECON_ENABLED: z.string().default('false'),
  REFUND_GATEWAY_RECON_INTERVAL_MINUTES: z.coerce.number().default(60),
  COD_REFUND_PENDING_ENABLED: z.string().default('false'),
  COD_REFUND_PENDING_INTERVAL_MINUTES: z.coerce.number().default(4 * 60),
  COD_REFUND_PENDING_STUCK_HOURS: z.coerce.number().default(48),

  // Sprint 2 Story 1.4 cleanup — guardrail thresholds layered on top of
  // the admin-editable cod_rules engine. Engine still owns the dynamic
  // policy; these are hard upper / lower bounds so a misconfigured rule
  // set can't silently push COD limits to extreme values. Override per
  // env if business needs to shift the absolute envelope.
  //
  // Bounds matter — without min/max, an ops typo like
  // `COD_FALLBACK_MAX_ORDER_VALUE_INR=-1` would silently allow every
  // order through (orderValue is always > -1), bypassing the guardrail.
  // Same shape for the abuse counters — non-positive values would
  // either disable the guard or block legitimate customers forever.
  COD_FALLBACK_MAX_ORDER_VALUE_INR: z.coerce.number().int().positive().default(10000),
  COD_FALLBACK_MIN_ORDER_VALUE_INR: z.coerce.number().int().nonnegative().default(100),
  // Repeated-cancellation guard: if a customer has this many COD orders
  // cancelled in the lookback window, COD is blocked. The window is in
  // days.
  COD_ABUSE_RECENT_CANCEL_LIMIT: z.coerce.number().int().positive().default(3),
  COD_ABUSE_LOOKBACK_DAYS: z.coerce.number().int().positive().default(30),

  // Phase B (P0.3) — discount-redemption expiry cron. Lazy expiry
  // is the primary correctness mechanism; this cron keeps the
  // active-reservation count fresh for the admin UI and metrics.
  DISCOUNT_RESERVATION_CRON_ENABLED: z.string().default('true'),

  // Sprint 4 Story 3.4 — auto-detect low-stock conditions every 30 min.
  // Off in dev / staging by default if you want to test the manual
  // /admin/inventory/alerts/sweep endpoint in isolation; left on by
  // default because the steady-state correctness path needs it.
  LOW_STOCK_SWEEP_CRON_ENABLED: z.string().default('true'),

  // Sprint 6 Story 5.1 — delegate /search/products to OpenSearch when
  // ON. Default OFF so the proven Prisma path keeps running until ops
  // stands up OpenSearch + runs POST /admin/search/reindex backfill.
  SEARCH_OPENSEARCH_ENABLED: z.string().default('false'),

  // Return window in days. Customer can file a return up to this many
  // days after sub-order delivery. **PROD MUST SET 14** — the previous
  // hard-coded 2-minute value (`RETURN_WINDOW_MS = 2 * 60 * 1000` in
  // orders.service.ts) was a dev/demo override to test the commission
  // confirm path quickly without waiting two weeks. Local dev can keep
  // 0.0014 (~2 min) by setting `RETURN_WINDOW_DAYS=0.0014`.
  RETURN_WINDOW_DAYS: z.string().default('14'),

  // Phase B (P0.1, P0.5) — feature flag for the new allocation/
  // reservation pipeline at checkout. When OFF, the legacy
  // incrementUsedCount path runs (existing behavior). When ON,
  // checkout reserves before order creation, allocates after,
  // and writes the discount/tax/liability ledger atomically.
  // Default OFF so the existing checkout flow is preserved until
  // we explicitly enable in staging → prod.
  DISCOUNT_ALLOCATION_ENABLED: z.string().default('false'),

  // Phase E (P1.4) — coupon fraud / rate-limit. When ON, every
  // call to /customer/coupons/validate writes a row to
  // coupon_attempts and a sliding-window threshold blocks
  // repeated invalid attempts.
  DISCOUNT_FRAUD_TRACKING_ENABLED: z.string().default('true'),
  DISCOUNT_FRAUD_WINDOW_MINUTES: z.coerce.number().default(15),
  DISCOUNT_FRAUD_INVALID_THRESHOLD: z.coerce.number().default(10),

  // ── Phase 4 — Authorization (ADR-010) ──────────────────────────────
  // PermissionsGuard mode.
  //   false: log-only soak (logs a WARN with event=authz.deny when an
  //     actor would fail a permission check, but lets the request through).
  //   true:  enforce — failed permission checks return 403 with the
  //     `permission-denied` problem-type.
  // Plan: ship false, soak for 2 weeks while logs are reviewed, flip true.
  PERMISSIONS_GUARD_STRICT: z.string().default('false'),
  // Phase 4 (PR 4.3) — ABAC resource-policy evaluator runs after
  // PermissionsGuard. Off by default; flips on with PR 4.5.
  ABAC_ENABLED: z.string().default('false'),
  // Phase 4 (PR 4.4) — write a row to authorization_audits for every
  // guard decision (allow + deny). Default ON: incident-response value
  // outweighs the small write cost, and the buffer batches writes so
  // there's no per-request DB hit. Set false to disable temporarily.
  AUTHZ_AUDIT_ENABLED: z.string().default('true'),

  // Phase 5 (PR 5.4) — minimum number of evidence images required at
  // QC submission. 0 = off (legacy behaviour). Set to 2 once the QC
  // tooling reliably uploads multi-angle shots for every inspection.
  RETURN_QC_MIN_EVIDENCE: z.coerce.number().int().min(0).default(0),
  // Phase 5 (PR 5.4) — restocking-fee rate in basis points (1bps = 0.01%).
  // Applied only to "buyer-fault" reasons (CHANGED_MIND, SIZE_FIT_ISSUE).
  // 0 = off (no fee deducted from refund). 1000 = 10%.
  RETURN_RESTOCKING_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(0),

  // Phase 5 (PR 5.5) — customer-abuse soft-hold threshold.
  //   - Below CUSTOMER_ABUSE_MIN_RETURNS in 90d: no flag, regardless of rate.
  //     (avoids flagging a brand-new customer with 1 return on 1 order = 100%)
  //   - At/above the floor AND the rate exceeds CUSTOMER_ABUSE_RATE_THRESHOLD_BPS:
  //     the customer's next return goes to manual approval instead of auto.
  //   - Both flags 0 = off.
  CUSTOMER_ABUSE_MIN_RETURNS: z.coerce.number().int().min(0).default(0),
  CUSTOMER_ABUSE_RATE_THRESHOLD_BPS:
    z.coerce.number().int().min(0).max(10000).default(0),

  // Phase 6 (PR 6.2) — SLA breach detector cron. Off by default. Flip
  // on after seeding the example policies (see PR 6.5 + the Phase 6
  // runbook). Crons are no-ops when disabled.
  SLA_BREACH_DETECTOR_ENABLED: z.string().default('false'),

  // Phase 0 (PR 0.14) — admin-task SLA-breach detector. ON by default
  // so refund-instruction failures escalate within 24h of the dispute
  // decision. Flip off only to suppress noisy escalations during ops
  // incidents.
  ADMIN_TASK_SLA_BREACH_ENABLED: z.string().default('true'),

  // Phase 1 (PR 1.5) — Stuck-saga sweep cron. ON by default so a
  // crash-mid-saga can never silently strand a customer's refund.
  // Set false to pause auto-escalation during an ops incident where
  // many sagas are legitimately running long.
  REFUND_SAGA_SWEEP_ENABLED: z.string().default('true'),
  // Sagas in STARTED / IN_PROGRESS older than this many minutes are
  // FAIL-and-escalated. Default 5 min — Razorpay's hard refund
  // timeout is 30s, leaving 9.5× headroom for the longest legit run.
  REFUND_SAGA_STUCK_MINUTES: z.coerce.number().int().min(1).default(5),

  // Phase 1 (PR 1.8) — Franchise reservation cleanup cron. ON by
  // default so a crash-mid-checkout doesn't strand franchise stock
  // forever. Set false to pause during ops incidents where the
  // franchise inventory ledger is being manually reconciled.
  FRANCHISE_RESERVATION_SWEEP_ENABLED: z.string().default('true'),

  // Phase 7 (PR 7.2) — retention enforcer. Off by default. Two flags
  // here so the cron can soak in DRY-RUN mode (writes execution audit
  // rows but doesn't mutate files) before going live.
  RETENTION_ENFORCER_ENABLED: z.string().default('false'),
  RETENTION_ENFORCER_DRY_RUN: z.string().default('true'),

  // Phase 12 GST — Section 34 credit-note time-bar cron. Classifies
  // QC-approved returns into ELIGIBLE / TIME_BARRED / REQUIRES_FINANCE_REVIEW
  // and opens AdminTask rows for the latter two. ON by default in dev so
  // engineers can exercise the flow end-to-end without flipping a flag;
  // ops sets to 'false' to silence during incidents.
  TAX_CREDIT_NOTE_TIMEBAR_CRON_ENABLED: z.string().default('true'),
  // Returns within this many days of the Sec 34 cutoff are flagged as
  // REQUIRES_FINANCE_REVIEW so finance can chase the credit note out
  // the door before the deadline. Default 7 days matches the working
  // assumption in docs/tax/CREDIT_NOTE_TIME_BAR_POLICY.md.
  TAX_CREDIT_NOTE_TIMEBAR_APPROACHING_DAYS: z.coerce.number().int().min(0).default(7),
  // Per-tick scan cap. The cron is best-effort — if the QC backlog
  // ever exceeds this, the next tick catches the remainder. Keeps
  // connection-pool pressure bounded.
  TAX_CREDIT_NOTE_TIMEBAR_SCAN_LIMIT: z.coerce.number().int().min(1).default(500),

  // Phase 13 GST — wallet adjustments. Adjustments above this paise
  // threshold require the explicit `wallet.adjustment.approve`
  // permission to move PENDING_APPROVAL → APPROVED, even when the
  // caller has `wallet.adjustment.create`. Default ₹5,000 = 500_000
  // paise. Set to 0 to require approval on ALL adjustments.
  WALLET_ADJUSTMENT_DUAL_APPROVAL_THRESHOLD_PAISE:
    z.coerce.number().int().min(0).default(500_000),
  // When true, small TIME_BARRED_CREDIT_NOTE adjustments below the
  // dual-approval threshold auto-approve at creation (one-shot
  // request-then-post). When false, even small TIME_BARRED rows
  // sit in PENDING_APPROVAL — finance reviews every single one.
  // Default true matches the dev-permissive mode; CA should flip
  // this off in prod once the audit shape settles.
  WALLET_ADJUSTMENT_AUTO_APPROVE_BELOW_THRESHOLD:
    z.string().default('true'),

  // Phase 15 GST — E-way bill provider selector. 'stub' produces
  // placeholder EWB numbers + logs the would-be NIC payload to
  // `e_way_bills.raw_request_json`; 'nic' wires the real CBIC
  // e-Waybill API (lands in a later phase tied to e-invoicing). Keep
  // 'stub' in dev/test so engineers can exercise the ship-block + retry
  // UI without NIC credentials.
  EWAY_BILL_PROVIDER: z.enum(['stub', 'nic']).default('stub'),

  // Phase 19 GST — tax-document PDF storage provider. 'stub' writes
  // rendered HTML to `apps/api/storage/tax-pdfs/...` so dev can open
  // the file directly; 's3' / 'cloudinary' wire real cloud storage
  // once the upstream adapters land. Switching is single-line at boot
  // — the service-layer code is identical across providers.
  TAX_PDF_STORAGE_PROVIDER: z.enum(['stub', 's3']).default('stub'),
  // Phase 19 GST — PDF render retry cron. ON by default in dev so a
  // freshly-generated invoice has its PDF rendered within ~5 minutes
  // without manual intervention; ops disables during incidents.
  TAX_PDF_RETRY_CRON_ENABLED: z.string().default('true'),
  TAX_PDF_RETRY_CAP: z.coerce.number().int().min(1).default(5),
  TAX_PDF_RETRY_COOLDOWN_MINUTES: z.coerce.number().int().min(1).default(5),
  TAX_PDF_RETRY_SCAN_LIMIT: z.coerce.number().int().min(1).default(50),

  // Phase 20 GST — Tax-document download rate limit (per-actor +
  // per-document, sliding window). Defaults: 20 downloads in 5
  // minutes. SYSTEM actors (cron jobs / internal services) bypass.
  TAX_DOWNLOAD_RATE_LIMIT_PER_WINDOW:
    z.coerce.number().int().min(1).default(20),
  TAX_DOWNLOAD_RATE_LIMIT_WINDOW_MINUTES:
    z.coerce.number().int().min(1).default(5),
  TAX_DOWNLOAD_SIGNED_URL_TTL_SECONDS:
    z.coerce.number().int().min(30).default(300),

  // Phase 21 GST — Statutory retention window for tax documents +
  // audit trails. Default 8 years per CGST Section 36 / Rule 56. CA
  // can adjust without code change (rate-snapshot is per-row so this
  // only affects future calculations, not historical filings).
  TAX_DOCUMENT_RETENTION_YEARS:
    z.coerce.number().int().min(1).max(50).default(8),

  // Phase 22 GST — E-invoice provider selector. 'stub' produces
  // deterministic IRN fixtures so the full lifecycle (generate /
  // cancel / retry) is exercisable in dev/test without NIC creds.
  // 'nic' wires the real CBIC IRP API (crashes loudly until wired
  // — see TaxModule factory).
  EINVOICE_PROVIDER: z.enum(['stub', 'nic']).default('stub'),
  // Phase 22 GST — IRN retry cron flags.
  TAX_EINVOICE_RETRY_CRON_ENABLED: z.string().default('true'),
  TAX_EINVOICE_RETRY_CAP: z.coerce.number().int().min(1).default(5),
  TAX_EINVOICE_RETRY_COOLDOWN_MINUTES: z.coerce.number().int().min(1).default(5),
  TAX_EINVOICE_RETRY_SCAN_LIMIT: z.coerce.number().int().min(1).default(50),
  // Phase 22 GST — applicability threshold. 0 = use the policy default
  // (₹5 crore = 5_00_00_000_00 paise). Override to a different paise
  // value to lower / raise the gate per CBIC notification updates.
  TAX_EINVOICE_TURNOVER_THRESHOLD_PAISE:
    z.coerce.number().int().min(0).default(0),

  // Phase 23 GST — two-stage flag rollout from dev-permissive to
  // prod-strict. tax_config table is the canonical source; these envs
  // are boot-time fallbacks for when the config row hasn't been
  // seeded yet. The rollout order is:
  //   1. ship code with both OFF.
  //   2. flip TAX_AUDIT_MODE=true on staging — soak the violation logs.
  //   3. flip TAX_STRICT_MODE=true on prod once CA signs off — DRAFT
  //      banner suppresses + hard validation begins.
  TAX_AUDIT_MODE: z.string().default('false'),
  TAX_STRICT_MODE: z.string().default('false'),

  // Phase 7 (PR 7.4) — erasure processor cron. Off by default; flip on
  // after compliance signs off on the cooldown window + outcome shape.
  ERASURE_PROCESSOR_ENABLED: z.string().default('false'),

  // Phase 7 (PR 7.5) — periodic file-integrity verifier.
  //   - ENABLED: master switch.
  //   - BATCH_SIZE: per-tick file count. Default 100.
  //   - REVERIFY_DAYS: how often to re-hash a file we already verified.
  INTEGRITY_VERIFIER_ENABLED: z.string().default('false'),
  INTEGRITY_VERIFIER_BATCH_SIZE: z.coerce.number().int().min(1).default(100),
  INTEGRITY_VERIFIER_REVERIFY_DAYS:
    z.coerce.number().int().min(1).default(30),

  // Phase 8 (PR 8.1) — periodic Merkle anchor of the audit hash chain.
  // Off by default; flip on once the verify-chain-fast endpoint has
  // been smoke-tested with the seeded anchor.
  AUDIT_CHAIN_ANCHOR_ENABLED: z.string().default('false'),

  // Phase 8 (PR 8.3) — heartbeat-of-crons. Walks cron_heartbeat_targets,
  // emits `cron.silent` events for jobs that haven't succeeded within
  // their tolerance window. Off by default; flip on once the targets
  // table is seeded with the expected job names + intervals.
  CRON_HEARTBEAT_ENABLED: z.string().default('false'),

  // Phase 8 (PR 8.4) — Prometheus scrape endpoint bearer token.
  // Unset = /metrics returns 404 (endpoint disabled). Set to a long
  // random string in environments where Prometheus / OTLP collectors
  // scrape us. Rotate by deploying a new token; scrapers re-auth
  // automatically.
  METRICS_BEARER_TOKEN: z.string().optional(),

  // Phase 10 (PR 10.1) — fallback rate-per-minute for API keys that
  // don't carry an explicit `rate_limit_per_minute` override. Token
  // bucket allows a 2× burst above this rate.
  API_DEFAULT_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(60),

  // Phase 10 (PR 10.2) — webhook delivery cron. Off by default so
  // partner integrations don't fire from staging by accident. Flip on
  // once partner endpoints are seeded.
  WEBHOOK_DELIVERY_ENABLED: z.string().default('false'),
  WEBHOOK_HMAC_SECRET: z.string().optional(),
}).superRefine((env, ctx) => {
  // Phase 3 (PR 3.3) — JWT TTL policy. Cross-field validation:
  //   - both TTLs parse to a positive duration
  //   - REFRESH_TTL > ACCESS_TTL (otherwise refresh is useless)
  //   - in production, ACCESS_TTL <= 24h (backstop against operator
  //     reverting to a multi-day default)
  //
  // Same `<digits><unit>` grammar the login use-cases use. Keep
  // parseDurationSeconds local — it's intentionally not exported so
  // the schema is the single owner of the "is this string a valid
  // TTL" check.
  const parseDurationSeconds = (value: string | undefined): number | null => {
    if (!value) return null;
    const m = /^(\d+)(s|m|h|d)$/.exec(value);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (n <= 0) return null;
    const unitToSec: Record<string, number> = {
      s: 1, m: 60, h: 3600, d: 86400,
    };
    return n * unitToSec[m[2]];
  };

  const accessSec = parseDurationSeconds(env.JWT_ACCESS_TTL);
  const refreshSec = parseDurationSeconds(env.JWT_REFRESH_TTL);

  if (accessSec === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_ACCESS_TTL'],
      message: `JWT_ACCESS_TTL must be a positive duration like '15m', '1h', '24h' (got '${env.JWT_ACCESS_TTL}')`,
    });
  }
  if (refreshSec === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_REFRESH_TTL'],
      message: `JWT_REFRESH_TTL must be a positive duration like '7d', '30d' (got '${env.JWT_REFRESH_TTL}')`,
    });
  }
  if (accessSec !== null && refreshSec !== null && refreshSec <= accessSec) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_REFRESH_TTL'],
      message: `JWT_REFRESH_TTL must be greater than JWT_ACCESS_TTL (refresh is useless if it expires first). Got access=${env.JWT_ACCESS_TTL}, refresh=${env.JWT_REFRESH_TTL}.`,
    });
  }

  // Phase 3 (PR 3.5) — JWT secret pairwise uniqueness. The six secrets
  // exist precisely to keep per-actor token forgery independent: a
  // leaked customer secret must not be reusable to forge admin tokens.
  // AnyAuthGuard's verify-against-each-secret loop makes collisions
  // especially damaging — the first match wins, so a collision
  // silently misroutes the token's actor type.
  //
  // Pairwise distinctness check runs on EVERY env (not prod-only)
  // because a colliding dev/staging env masks the prod misconfig
  // (operator clones a dev config and forgets to rotate).
  const jwtSecretKeys: Array<keyof typeof env> = [
    'JWT_CUSTOMER_SECRET',
    'JWT_SELLER_SECRET',
    'JWT_FRANCHISE_SECRET',
    'JWT_ADMIN_SECRET',
    'JWT_AFFILIATE_SECRET',
    'JWT_REFRESH_SECRET',
  ];
  const reportedKeys = new Set<keyof typeof env>();
  for (let i = 0; i < jwtSecretKeys.length; i++) {
    for (let j = i + 1; j < jwtSecretKeys.length; j++) {
      const a = jwtSecretKeys[i];
      const b = jwtSecretKeys[j];
      const va = env[a];
      const vb = env[b];
      if (typeof va !== 'string' || typeof vb !== 'string') continue;
      if (va !== vb) continue;
      // Add ONE issue per colliding key, but include the partner name
      // in the message so ops sees both sides. Tracking which keys
      // have been reported avoids N² duplicate issues when many keys
      // share a single value (the "all six identical" worst case).
      if (!reportedKeys.has(a)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [a],
          message: `JWT secret collision: ${String(a)} and ${String(b)} share the same value. Each actor scope must have its own secret to preserve per-actor token isolation.`,
        });
        reportedKeys.add(a);
      }
      if (!reportedKeys.has(b)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [b],
          message: `JWT secret collision: ${String(b)} and ${String(a)} share the same value. Each actor scope must have its own secret to preserve per-actor token isolation.`,
        });
        reportedKeys.add(b);
      }
    }
  }

  // Phase 2 (PR 2.5) — outbox safety interlocks. Run on EVERY env (not
  // just prod) because misconfiguring these in dev silently corrupts
  // local development too. Catching here is far cheaper than discovering
  // hours of silent event loss.
  const truthy = (v: unknown) => String(v).toLowerCase() === 'true';
  if (truthy(env.OUTBOX_AUTHORITATIVE) && !truthy(env.OUTBOX_ENABLED)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OUTBOX_AUTHORITATIVE'],
      message:
        'OUTBOX_AUTHORITATIVE=true requires OUTBOX_ENABLED=true (otherwise nothing drains the outbox and every event silently sits forever).',
    });
  }
  if (truthy(env.OUTBOX_AUTHORITATIVE) && !truthy(env.OUTBOX_DUAL_WRITE)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OUTBOX_AUTHORITATIVE'],
      message:
        'OUTBOX_AUTHORITATIVE=true requires OUTBOX_DUAL_WRITE=true (otherwise nothing writes to the outbox and every event is dropped).',
    });
  }

  // Prod-only hardening. In dev / test / staging these integrations are
  // optional so you can boot the API without accounts; in production a
  // missing secret caused silent failures deep inside the checkout flow
  // (e.g. RAZORPAY_KEY_SECRET missing → HMAC verify comparing against
  // an empty-key digest) rather than a loud boot-time error. Fail fast
  // on start instead.
  if (env.NODE_ENV !== 'production') return;

  // Phase 3 (PR 3.3) — prod-only cap on JWT_ACCESS_TTL. A 24h ceiling
  // is the explicit operational policy: longer-lived access tokens
  // turn every cross-device logout into a 24h vulnerability window.
  // Dev / staging stay flexible so debugging long-running flows
  // doesn't require constant re-logins.
  if (accessSec !== null && accessSec > 24 * 3600) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_ACCESS_TTL'],
      message: `JWT_ACCESS_TTL must be <= 24h in production (got '${env.JWT_ACCESS_TTL}'). Use refresh-token rotation for longer sessions.`,
    });
  }

  // Phase 3 (PR 3.7) — strict CORS-origins policy in production.
  // Reject the three classic foot-guns:
  //
  //   - `*` (wildcard) combined with `credentials: true` in main.ts
  //     is a credential-exfiltration setup.
  //   - `http://...` allows a stripping CDN bug to send Bearer tokens
  //     in plaintext.
  //   - Malformed entries (typo'd scheme, embedded whitespace) silently
  //     misbehave inside Express's CORS middleware.
  //
  // Comma-separated list; the whole value is rejected if ANY entry is
  // invalid (fail-closed for the allow-list).
  const corsRaw = env.CORS_ORIGINS;
  if (typeof corsRaw === 'string') {
    const origins = corsRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (origins.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: `CORS_ORIGINS must be an explicit comma-separated allow-list in production (got empty).`,
      });
    }
    for (const origin of origins) {
      if (origin === '*') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message: `CORS_ORIGINS wildcard '*' is rejected in production — combined with credentials it leaks Bearer tokens to any site visited by the user.`,
        });
        continue;
      }
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message: `CORS_ORIGINS entry '${origin}' is not a valid URL.`,
        });
        continue;
      }
      if (parsed.protocol !== 'https:') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message: `CORS_ORIGINS entry '${origin}' must use https:// in production (got '${parsed.protocol}').`,
        });
      }
    }
  }

  const requiredInProd: Array<keyof typeof env> = [
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'S3_BUCKET',
    'S3_REGION',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    // PR 10.8 — Phase 10's MFA flow (PR 10.6 login challenge,
    // PR 10.7 anti-replay) reads ADMIN_MFA_ENCRYPTION_KEY on every
    // verify-challenge request to decrypt the admin's stored TOTP
    // secret. Without the key, an enrolled admin literally cannot
    // complete login — better to fail at boot than to surface that
    // as a 500 on the first MFA-required login attempt in prod.
    'ADMIN_MFA_ENCRYPTION_KEY',
  ];
  for (const key of requiredInProd) {
    const value = env[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when NODE_ENV=production`,
      });
    }
  }

  // Phase 6 (PR 6.1) — flags that MUST be on in production. The
  // feature defaults to off in dev/test/staging (cheap test harness,
  // no false-positive alerts on empty DBs) but in production the
  // off-state means losing a built-and-tested observability or
  // correctness path. Each entry carries a one-line reason; edit
  // this list when promoting a flag from dev-default to prod-required.
  const requiredOnInProd: Array<{
    key: keyof typeof env;
    reason: string;
  }> = [
    {
      key: 'CRON_HEARTBEAT_ENABLED',
      reason:
        'PRs 5.1–5.5 wired every @Cron service into the heartbeat detector. Off in prod means silent crons stay silent.',
    },
    {
      key: 'SLA_BREACH_DETECTOR_ENABLED',
      reason:
        'PR 6.2 — SlaBreachDetectorCron walks non-terminal returns/disputes/tickets every 5 min. Off in prod means stuck cases sit unflagged, missing the SLA escalation that downstream Slack/PagerDuty handlers depend on.',
    },
    {
      key: 'AUDIT_CHAIN_ANCHOR_ENABLED',
      reason:
        'PR 6.3 — AuditChainAnchorCron pins the hourly Merkle anchor that tamper-evidence verification depends on. Off in prod means no anchors land, the chain-walk verifier scans unboundedly far back, and retroactive log tampering goes undetectable for the duration of the gap.',
    },
    {
      key: 'IDEMPOTENCY_ENABLED',
      reason:
        'PR 6.4 — @Idempotent() decorates every money-mutating POST (payments, refunds, payouts, wallet credits, return approvals, disputes). Off in prod, the interceptor short-circuits and a client retry on a network timeout triggers a duplicate capture / refund / payout; the X-Idempotency-Key header becomes advisory rather than load-bearing.',
    },
    {
      key: 'INTEGRITY_VERIFIER_ENABLED',
      reason:
        'PR 6.5 — IntegrityVerifierCron is the only mechanism that catches silent file tampering (SHA-256 mismatch on KYC docs, invoices, return-evidence photos, catalog assets). Off in prod, the hourly re-hash never runs, the violation event never fires, and the legacy-row hash backfill never completes. Tamper-detection becomes manual-audit-only.',
    },
    {
      key: 'ERASURE_PROCESSOR_ENABLED',
      reason:
        'PR 6.6 — ErasureProcessorCron drains the DataErasureRequest queue that the customer-portal "delete my account" button and the support-side erasure tool both write to. Off in prod, requests sit indefinitely in PENDING and statutory windows (DPDPA Section 12, GDPR Article 17 — 30-day default) get missed silently, with monetary regulatory exposure.',
    },
    {
      key: 'WALLET_LEDGER_RECON_ENABLED',
      reason:
        'PR 6.7 — WalletLedgerReconCron asserts daily that sum(WalletTransaction WHERE COMPLETED) === Wallet.balanceInPaise for every wallet, and emits wallet.ledger.drift_detected on mismatch. Off in prod, the only signal of a service-bypass / manual SQL patch / migration bug / corruption is a downstream customer complaint or a manual finance audit — by which point the historical evidence to identify the cause is gone.',
    },
    {
      key: 'EVENT_DEDUP_ENABLED',
      reason:
        'PR 6.8 — Outbox delivery is at-least-once by design (ADR-008). EventDeduplicationService.tryConsume — the atomic INSERT into event_deduplication keyed on (eventId, handlerName) — is the mechanism that converts at-least-once delivery into effective exactly-once at the handler boundary. Off in prod, a publisher restart / consumer crash / operator replay re-fires every handler: customers receive duplicate notifications, duplicate audit rows pollute the tamper-evidence chain, and any handler whose next-layer CAS has a bug silently double-applies.',
    },
    {
      key: 'OUTBOX_ENABLED',
      reason:
        'PR 6.9 — Runs the publisher worker that drains outbox_events. ADR-008 built the outbox specifically to close the crash-loss window for in-process EventBus delivery; off in prod, the publisher never runs, the table grows unbounded when OUTBOX_DUAL_WRITE is on, and every event silently sits when OUTBOX_AUTHORITATIVE is on. Keep on so an operator flipping OUTBOX_DUAL_WRITE during the soak rollout does not have a first-batch orphan gap.',
    },
    {
      key: 'OUTBOX_DUAL_WRITE',
      reason:
        'PR 6.10 — Pairs with OUTBOX_ENABLED to complete the ADR-008 crash-safety contract: PR 6.9 ensures the publisher drains, 6.10 ensures events actually reach the outbox. Off in prod, EventBusService runs the legacy direct-bus path only and a process crash between handler-start and handler-finish drops the event entirely. This is the exact failure ADR-008 was built to close. Soak mode (DUAL_WRITE on, AUTHORITATIVE off) is the valid minimum; flipping AUTHORITATIVE on later is a clean post-cutover step.',
    },
    {
      key: 'REFUND_GATEWAY_RECON_ENABLED',
      reason:
        'PR 6.11 — RefundGatewayReconCron is the safety net against Razorpay webhook drops: every hour it scans PROCESSING RefundInstruction rows older than 24h with a gatewayRefundId and emits refund.gateway.stuck (the follow-up will GET against Razorpay and close them out). Off in prod, refunds whose webhook never landed (500, network blip, IP-allowlist miss, restart window) sit indefinitely; the only signal is a customer support escalation ("I asked for a refund 3 days ago") — a money-correctness failure visible to customers.',
    },
    {
      key: 'RETENTION_ENFORCER_ENABLED',
      reason:
        'PR 6.12 — Companion to ERASURE_PROCESSOR_ENABLED (PR 6.6): erasure is reactive (customer asks), retention is proactive (data lifecycle limits independent of any request). RetentionEnforcerCron walks each enabled RetentionPolicy daily and applies DELETE / ARCHIVE / REDACT against files older than retainDays, gated by LegalHoldService. Off in prod, every retention policy is decorative — KYC docs, support photos, return-evidence, expired-listing assets accumulate past their statutory windows (DPDPA §8(7), GDPR Article 5(1)(e) storage-limitation). RETENTION_ENFORCER_DRY_RUN stays an operator rollout lever; this gate only forces the cron to run.',
    },
    {
      key: 'ABAC_ENABLED',
      reason:
        'PR 6.13 — Forces the policy evaluator into strict (fail-closed) mode for prod. In soak mode (default), no matching ALLOW on a @Policy route lets the request through with a wouldHaveBlocked=true audit line — useful for rollout, dangerous as a durable prod posture (a new @Policy route added without proper rules, or a policy misconfiguration, silently allows traffic that the ABAC design was meant to deny). Prerequisite: the soak audit lines from staging must already drive @Policy coverage to completeness before this gate is flipped on. The audit-readiness controller exists for that purpose.',
    },
    {
      key: 'REFUND_SAGA_ENABLED',
      reason:
        'PR 6.14 — ADR-009 RefundSagaService.execute is the orchestration entry point for every refund. ON: opens refund_sagas row with each step PENDING, persists transitions, runs compensations + records failure on the row, crash leaves a resumable record the saga sweeper picks up. OFF (runWithoutSaga): no persistence, no resumability — a crash between steps lands whichever step ran (gateway hit / wallet credited) without the counter-step firing, and manual finance mop-up is the only recovery. Prerequisite: saga rewrite dual-soak validated before flipping.',
    },
    {
      key: 'COD_REFUND_PENDING_ENABLED',
      reason:
        'PR 6.15 — Pairs with REFUND_GATEWAY_RECON_ENABLED (PR 6.11) to cover both refund channels. COD orders refund via manual bank-transfer / UPI (no gateway), the refund instruction sits in MANUAL_REQUIRED until finance wires the money out-of-band. CodRefundPendingCron emits refund.cod.pending_aged every 4h for instructions stuck past 48h and surfaces the MANUAL_REQUIRED total to the dashboard gauge. Off in prod, the COD refund queue is invisible to engineering; finance discovers aged-pending refunds via customer escalations only.',
    },
    {
      key: 'MONEY_DUAL_WRITE_ENABLED',
      reason:
        'PR 7.1 — ADR-007 paise migration step 2 (dual-write base camp). MoneyDualWriteHelper.applyPaise computes the paise sibling for every Decimal money column on write and persists both in the same transaction. Off in prod, new writes drift away from the paise siblings going forward, and the step-3 backfill has to be re-run repeatedly to catch up — by the time step 4 (read-switch) lands, the only defensible posture is "every prod write has been dual-writing for the full retention window of any rows the read-switch will touch." Per-call-site wiring is a separate rollout; this gate only forces the apparatus on.',
    },
  ];
  for (const { key, reason } of requiredOnInProd) {
    if (!truthy(env[key])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${String(key)} must be 'true' when NODE_ENV=production. ${reason}`,
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;
