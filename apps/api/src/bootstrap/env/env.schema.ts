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
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('7d'),
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

  // Shiprocket - optional
  SHIPROCKET_EMAIL: z.string().optional(),
  SHIPROCKET_PASSWORD: z.string().optional(),
  SHIPROCKET_WEBHOOK_TOKEN: z.string().optional(),

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

  // Phase 7 (PR 7.2) — retention enforcer. Off by default. Two flags
  // here so the cron can soak in DRY-RUN mode (writes execution audit
  // rows but doesn't mutate files) before going live.
  RETENTION_ENFORCER_ENABLED: z.string().default('false'),
  RETENTION_ENFORCER_DRY_RUN: z.string().default('true'),

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

  const requiredInProd: Array<keyof typeof env> = [
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'S3_BUCKET',
    'S3_REGION',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
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
});

export type Env = z.infer<typeof envSchema>;
