import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(8000),
  // Phase 10 (2026-05-16) — graceful-shutdown grace period in ms.
  // Time the process has to finish in-flight HTTP requests, flush
  // the outbox publisher, and tear down crons before SIGKILL fires.
  // Default 30s matches the Kubernetes default `terminationGracePeriodSeconds`.
  SHUTDOWN_GRACE_MS: z.coerce.number().default(30_000),
  // Node cluster fan-out (src/cluster.ts). Unset/1 = single process (default,
  // legacy behaviour). 0 = one worker per available CPU core. N = N workers.
  // Crons stay single-fire via LeaderElectedCron, so >1 is safe.
  CLUSTER_WORKERS: z.coerce.number().int().min(0).default(1),

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
  // Phase 159u (staff-auth) — optional dedicated secret for franchise-STAFF
  // tokens. Falls back to JWT_FRANCHISE_SECRET when unset (staff tokens stay
  // isolated by the FRANCHISE_STAFF roles claim + separate session table), so
  // existing deployments need no new env var to boot.
  JWT_FRANCHISE_STAFF_SECRET: z.string().min(32).optional(),
  JWT_ADMIN_SECRET: z.string().min(32),
  JWT_AFFILIATE_SECRET: z.string().min(32),
  // App-layer key for encrypting affiliate PAN / Aadhaar / bank
  // account numbers at rest. 32 bytes (64 hex chars or 44 base64
  // chars) for AES-256. Generate with `openssl rand -hex 32`.
  AFFILIATE_ENCRYPTION_KEY: z.string().min(32),
  // Optional multi-key map for rotation. Format: "v1=<64hex>,v2=<64hex>".
  // The encryption service writes new rows tagged with
  // AFFILIATE_ENCRYPTION_ACTIVE_VERSION; old rows (no tag) fall back
  // to AFFILIATE_ENCRYPTION_KEY. During rotation, declare both keys
  // in the map, flip the active version, and slowly re-encrypt as
  // ops can.
  AFFILIATE_ENCRYPTION_KEYS: z.string().optional(),
  AFFILIATE_ENCRYPTION_ACTIVE_VERSION: z.string().optional(),
  // Phase 154 — gate affiliate payouts on KYC verification (PMLA / RBI).
  // Default ON (enforced) when unset; product can set 'false' to pause the
  // gate explicitly. Read via getBoolean('AFFILIATE_KYC_GATE_ENABLED', true).
  AFFILIATE_KYC_GATE_ENABLED: z.string().optional(),
  // Phase 10 — App-layer key for encrypting admin TOTP secrets at
  // rest. Same 32-byte / AES-256 shape as the affiliate key. Now
  // listed in requiredInProd (PR 10.8) so prod refuses to boot
  // without it — the PR 10.6 login-time challenge reads this on
  // every MFA-enrolled admin login. Optional in dev/staging so
  // local development without MFA can skip generating a key.
  ADMIN_MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
  // Phase 19 (2026-05-20) — AES-256-GCM key for encrypting seller
  // payout bank-account numbers at rest. Distinct from the affiliate
  // key so a leak on one side does not impact the other. Optional in
  // dev (the bank-details PATCH route returns BANK_DETAILS_UNAVAILABLE
  // when unset, with a loud log line); required in production.
  // Generate with `openssl rand -hex 32` (or base64 32).
  SELLER_BANK_ENCRYPTION_KEY: z.string().min(32).optional(),
  // Phase 20 (2026-05-20) — same shape, dedicated franchise key so a
  // leak on one side does not cross-contaminate the other.
  FRANCHISE_BANK_ENCRYPTION_KEY: z.string().min(32).optional(),
  // Phase 21 (2026-05-20) — Removed. Refresh tokens are random UUIDs
  // hashed at rest, not JWTs, so this secret was never consumed. The
  // env var is kept as optional for back-compat with deploys that
  // still set it (so bootstrap doesn't fail); new deployments don't
  // need to set it. Drop entirely after the next major release.
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  // Phase 3 (PR 3.3) — tightened from the pre-PR default of '7d'.
  // A stolen access token is now valid for at most 1 hour against
  // a still-active session; renewals go through the (hashed,
  // rotation-on-use) refresh flow from PR 3.2. Operators can still
  // override per-env, subject to the cross-field validation below.
  // Phase 17 (2026-05-20) — code-side fallback in the use-cases
  // tightened to '15m'; this env-side default ('1h') is the "schema
  // safety net" if an operator unsets the env entirely.
  JWT_ACCESS_TTL: z.string().default('1h'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  // Phase 17 (2026-05-20) — absolute session lifetime cap.
  //
  // The refresh-rotation flow extends `expiresAt = now + JWT_REFRESH_TTL`
  // on every refresh, which makes a daily-active session effectively
  // immortal. This cap is the absolute ceiling on Session.createdAt
  // — once a session is older than this, the refresh use-case
  // refuses the rotation and the user must re-authenticate. Defaults
  // to 60 days; tighten in high-paranoia deployments.
  SESSION_ABSOLUTE_LIFETIME_DAYS: z.coerce.number().int().positive().default(60),

  // Cookie domain pinning for auth cookies (admin, seller, franchise,
  // affiliate, identity login + refresh). Blank in dev — cookies default
  // to the request host. In prod set to `.sportsmart.com` (with the leading
  // dot) so the cookie is shared across api., admin., seller.* subdomains.
  AUTH_COOKIE_DOMAIN: z.string().optional(),

  // Cloudflare R2 object storage (S3-API-compatible). Replaces the former
  // S3 integration. Either set R2_ENDPOINT directly, or set R2_ACCOUNT_ID
  // and the endpoint is derived as https://<account>.r2.cloudflarestorage.com.
  // R2_PUBLIC_BASE_URL is the optional public/custom-domain delivery base
  // for PUBLIC objects (e.g. https://media.sportsmart.com). All optional in
  // dev; the adapter is configured only when bucket + creds + endpoint are
  // present (otherwise it reports not-configured and callers fall back).
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().optional(),

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
  // Phase 86 (2026-05-23) — Gap #15. Comma-separated IPv4/IPv6 +
  // CIDR allowlist for Shiprocket webhook source IPs. Unset = pass-
  // through (HMAC + idempotency remain primary defense).
  SHIPROCKET_WEBHOOK_IP_ALLOWLIST: z.string().optional(),

  // Delhivery webhook (Phase 3 Delhivery wiring, 2026-06-02). Same
  // contract as the Shiprocket trio: HMAC secret preferred, legacy
  // bearer token fallback, optional source-IP allowlist. All unset in
  // dev → the Delhivery webhook passes through without verification
  // (production must set the HMAC secret).
  DELHIVERY_WEBHOOK_HMAC_SECRET: z.string().optional(),
  DELHIVERY_WEBHOOK_TOKEN: z.string().optional(),
  DELHIVERY_WEBHOOK_IP_ALLOWLIST: z.string().optional(),

  // OpenSearch - optional. Phase 195 (#17) — node URL plus basic-auth
  // credentials and a configurable products index. All optional so dev and
  // the default Prisma path need none of them; when ops stands up a managed
  // OpenSearch (which requires basic auth) these thread through
  // OpenSearchClient. URL scheme is validated at OpenSearchClient.onModuleInit.
  OPENSEARCH_NODE: z.string().optional(),
  OPENSEARCH_USERNAME: z.string().optional(),
  OPENSEARCH_PASSWORD: z.string().optional(),
  OPENSEARCH_INDEX_PRODUCTS: z.string().default('sportsmart_products'),

  // WhatsApp - optional
  WHATSAPP_API_URL: z.string().optional(),
  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  // Meta Cloud webhook verification + app-secret HMAC. Verify-token is
  // the static string Meta echoes back during webhook subscription
  // setup; app-secret is used for SHA-256 HMAC on every inbound payload.
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),

  // SMS — Phase 185 (#1/#4). Provider-switched transactional SMS.
  //   SMS_PROVIDER       — stub (default) | msg91 | twilio
  //   SMS_AUTH_KEY       — MSG91 authkey OR Twilio Account SID
  //   SMS_API_SECRET     — Twilio auth token (unused by MSG91)
  //   SMS_SENDER_ID      — registered DLT header / Twilio 'From' number
  //   SMS_API_URL        — override the provider base URL (tests/proxies)
  //   SMS_DLT_ENFORCED   — when 'true', SMS-channel templates without a
  //                        DLT template id are refused (TRAI compliance).
  SMS_PROVIDER: z.enum(['stub', 'msg91', 'twilio']).optional().default('stub'),
  SMS_AUTH_KEY: z.string().optional(),
  SMS_API_SECRET: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),
  SMS_API_URL: z.string().optional(),
  SMS_DLT_ENFORCED: z
    .enum(['true', 'false'])
    .optional()
    .default('false'),

  // Phase 185 (#5) — shared secret a carrier delivery-receipt (DLR)
  // webhook must present to flip a notification SENT → DELIVERED.
  NOTIFICATION_DELIVERY_RECEIPT_SECRET: z.string().optional(),

  // Phase 189 (#14) — HMAC secret for one-click email-unsubscribe links.
  // When unset, the unsubscribe endpoint fails closed (links won't verify).
  NOTIFICATION_UNSUBSCRIBE_SECRET: z.string().optional(),

  // AI providers — optional. At least one must be configured for AI
  // endpoints to work. The provider order in AI_PROVIDER_ORDER (comma
  // separated) determines fallback sequence; default is "gemini,anthropic".
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_PROVIDER_ORDER: z.string().default('gemini,anthropic'),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().default(20_000),
  // Per-tenant daily quota. Applied as `AiUsageQuota` rows keyed by
  // (subject, day) — subject is the seller/admin/user id depending on
  // which guard let the request through.
  AI_DAILY_QUOTA_PER_TENANT: z.coerce.number().default(100),
  // Gemini + Claude model overrides; defaults are the cheapest fast models.
  AI_GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  AI_ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),

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

  // Phase 178 (Outstanding Payables audit #11) — §194-O TDS payout holdback.
  // When ON (default), an hourly guard freezes any APPROVED, past-due seller
  // settlement whose TDS hook FAILED (no tdsLedgerId AND no tdsSkipReason) so it
  // is never disbursed before §194-O is handled; auto-releases once finance
  // re-runs the compute. Kill switch for ops.
  TDS_PAYOUT_HOLDBACK_ENABLED: z.string().default('true'),

  // Phase 181 (Franchise Ledger audit #11) — a punitive franchise penalty at or
  // above this rupee amount requires a SECOND admin's co-acknowledgement
  // (coApproverAdminId ≠ actor). 0 disables the gate.
  FRANCHISE_PENALTY_MAX_WITHOUT_APPROVAL_RUPEES: z.coerce.number().default(50000),

  // Phase 182 (Customer Wallet audit #2/#3) — loyalty/cashback rebate. OFF by
  // default (it emits money — opt-in is a business decision). When ON, a captured
  // order earns `bps` of its value as a LOYALTY_REBATE wallet credit, capped, with
  // an expiry, only above the min-order floor.
  LOYALTY_ENABLED: z.string().default('false'),
  LOYALTY_CASHBACK_BPS: z.coerce.number().default(100), // 100 bps = 1%
  LOYALTY_CASHBACK_MAX_PAISE: z.coerce.number().default(50000), // ₹500 cap / order
  LOYALTY_MIN_ORDER_PAISE: z.coerce.number().default(50000), // ₹500 min to qualify
  LOYALTY_EARN_EXPIRY_DAYS: z.coerce.number().default(180),

  // Phase 159r (POS void/return audit #9) — a franchise may self-void a POS
  // sale only within this many hours of the sale. 0 disables the window.
  POS_VOID_WINDOW_HOURS: z.coerce.number().default(24),

  // Phase 159s (POS report audit #4) — timezone offset (minutes east of UTC)
  // used to compute a franchise's "business day" boundaries for daily POS
  // reports. Default 330 = IST (UTC+5:30). India has no DST so a fixed offset
  // is correct and avoids server-local-TZ wrong-day bleed.
  FRANCHISE_REPORT_TZ_OFFSET_MINUTES: z.coerce.number().int().default(330),

  // Phase 242 (POS Reconciliation audit) — cash-vs-expected variance tolerance
  // (paise) within which a reconciliation is auto-flagged MATCHED rather than
  // VARIANCE. Default 100 = ₹1 (rounding slack).
  POS_RECON_MATCH_TOLERANCE_PAISE: z.coerce.number().int().default(100),

  // Order acceptance SLA. If a sub-order stays OPEN longer than this,
  // a background job auto-rejects it and triggers re-routing. 0 disables.
  ORDER_ACCEPTANCE_SLA_MINUTES: z.coerce.number().default(60),
  ORDER_ACCEPTANCE_SLA_CHECK_SECONDS: z.coerce.number().default(60),
  // Phase 80 (2026-05-22) — acceptance audit Gap #10/#11. Per-batch
  // page size for the unified SLA cron's drain-loop. Defaults to 100
  // so a single tick processes up to 1000 expired sub-orders across
  // 10 batches before yielding the lock. Operator can tune down in
  // dev to verify the drain-loop logic.
  ORDER_ACCEPTANCE_SLA_BATCH_SIZE: z.coerce.number().default(100),
  // Phase 82 (2026-05-23) — pack/ship audit Gap #20. Pre-ship
  // "proof of dispatch" photo threshold. Default 4. Per-tier tuning
  // (e.g. trusted sellers get 2) is a future ABAC concern; for now
  // the platform-wide threshold lives here so ops can adjust
  // without a redeploy.
  SHIPMENT_EVIDENCE_REQUIRED_PHOTOS: z.coerce.number().default(4),

  // Routing engine scoring weights. Must sum to 1.0 — the engine
  // normalises if they don't, but round-number thirds are cleaner.
  ROUTING_DISTANCE_WEIGHT: z.coerce.number().default(0.7),
  ROUTING_STOCK_WEIGHT: z.coerce.number().default(0.2),
  ROUTING_SLA_WEIGHT: z.coerce.number().default(0.1),
  // Phase 159m — weight of an admin pincode→franchise territory priority.
  ROUTING_PINCODE_PRIORITY_WEIGHT: z.coerce.number().default(0.5),

  // Refund poller + auto-retry. Polls Razorpay for pending refund status
  // and retries failed gateway calls on a schedule. 0 disables.
  REFUND_POLL_INTERVAL_SECONDS: z.coerce.number().default(120),
  REFUND_RETRY_BACKOFF_MINUTES: z.coerce.number().default(15),
  // Phase 101 (2026-05-23) — Refund Retry audit Gap #6 closure.
  // Cap was hardcoded in two places (service const + cron query)
  // pre-Phase-101. Single env var keeps the two in sync.
  REFUND_MAX_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  // Phase 100 (2026-05-23) — Phase 98 audit Gap #3 polling fallback.
  REFUND_STATUS_POLLER_ENABLED: z.string().default('true'),
  REFUND_STATUS_POLLER_MIN_AGE_MIN: z.coerce.number().default(15),
  // Phase 96 (2026-05-23) — Mark Received QC task SLA.
  RETURN_QC_PENDING_SLA_HOURS: z.coerce.number().default(48),
  // Phase 95 (2026-05-23) — Phase 93 evidence allowlist (comma list).
  RETURN_EVIDENCE_ALLOWED_HOSTS: z.string().optional(),

  // Stale-return auto-close. Returns stuck in non-terminal states
  // beyond this many days are escalated or auto-closed.
  RETURN_STALE_DAYS: z.coerce.number().default(30),
  RETURN_STALE_CHECK_INTERVAL_MINUTES: z.coerce.number().default(60),
  // Phase 174 — per-status batch cap for the stale-return processor's
  // auto-cancel / auto-close / escalate scans (drains backlog across ticks).
  RETURN_STALE_BATCH_SIZE: z.coerce.number().int().min(1).default(50),
  // Phase 174 — batch cap for the exhausted-refund escalation scan.
  RETURN_STALE_EXHAUSTED_BATCH_SIZE: z.coerce.number().int().min(1).default(20),

  // Payment poller. Checks Razorpay for orders stuck in PENDING_PAYMENT
  // and auto-cancels orders past the payment window.
  PAYMENT_POLL_INTERVAL_SECONDS: z.coerce.number().default(60),
  PAYMENT_WINDOW_MINUTES: z.coerce.number().default(30),
  // Phase 166 (Payment Status Poller audit #14) — per-tick batch caps, env-tunable
  // so a sale spike can be drained faster without a code change.
  PAYMENT_POLL_CANCEL_BATCH: z.coerce.number().int().min(1).default(30),
  PAYMENT_POLL_ORPHAN_BATCH: z.coerce.number().int().min(1).default(20),
  // #7 — minimum gap (seconds) between orphan-recovery polls of the SAME order,
  // so a captured-but-orphaned order isn't polled ~30× over the 30-min window.
  PAYMENT_POLL_ORPHAN_BACKOFF_SECONDS: z.coerce.number().int().min(0).default(180),
  // #13 — open an alert after this many consecutive gateway fetch failures
  // (e.g. revoked credentials would otherwise fail silently all window).
  PAYMENT_POLL_FETCH_FAILURE_ALERT_THRESHOLD: z.coerce.number().int().min(1).default(5),
  // Option B (Phase 4) — deferred-capture recovery cron (the missed-webhook
  // backstop that materializes a deferred order from a captured CheckoutSession).
  DEFERRED_CAPTURE_BATCH: z.coerce.number().int().min(1).default(20),
  DEFERRED_CAPTURE_BACKOFF_SECONDS: z.coerce.number().int().min(0).default(180),
  // Option B (Phase 5) — CheckoutSession reconciler (expire abandoned, re-link
  // or fail stuck-PAID, auto-refund FAILED). Pausable independently of the
  // deferred flag for incident response; the cron also requires the deferred
  // flag on (no sessions exist otherwise).
  CHECKOUT_SESSION_RECONCILIATION_ENABLED: z.string().default('true'),
  CHECKOUT_SESSION_RECONCILE_BATCH: z.coerce.number().int().min(1).default(50),
  CHECKOUT_SESSION_STUCK_GRACE_MINUTES: z.coerce.number().int().min(1).default(5),

  // Number of reverse-proxy hops to trust for req.ip (used by the throttler
  // to rate-limit per client IP). 0 = don't trust X-Forwarded-For (dev).
  // 1 = trust one hop (typical: ALB / nginx in front). Higher if chained.
  TRUST_PROXY_HOPS: z.coerce.number().default(0),

  // ── Phase 16 (2026-05-20) — Captcha / bot protection ────────────────
  // Provider for the captcha verifier service used on customer
  // register / verify-otp / resend-otp endpoints. Local development
  // uses 'disabled' so devs can sign up without standing up a captcha
  // provider; production MUST be 'turnstile' or 'hcaptcha'.
  CAPTCHA_PROVIDER: z
    .enum(['disabled', 'turnstile', 'hcaptcha'])
    .default('disabled'),
  // Secret key from the captcha provider (paired with the public site
  // key embedded in the frontend). Required when CAPTCHA_PROVIDER is
  // 'turnstile' or 'hcaptcha'.
  CAPTCHA_SECRET: z.string().optional(),

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
  // Defaults ON (correct-by-default): a customer/seller cannot open a
  // second active dispute for the same return or order+kind. Operators
  // that need the old silent-duplicate behaviour can opt out by setting
  // CASE_DUPLICATE_PREVENTION_ENABLED=false explicitly.
  CASE_DUPLICATE_PREVENTION_ENABLED: z.string().default('true'),

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
  // Phase 10 (2026-05-16) — promoted from default-off. The publisher is
  // listed in requiredOnInProd anyway, so a prod boot without an
  // explicit setting blew up; flipping the default to 'true' means
  // staging soak runs with the outbox draining by default, matching
  // the prod-required posture and catching configuration drift earlier.
  OUTBOX_ENABLED: z.string().default('true'),
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
  // Phase 186 (#4) — retention sweeper windows (days). PUBLISHED rows are
  // never read again → purge at 30d; dead-letters kept 90d for audit.
  OUTBOX_RETENTION_DAYS: z.coerce.number().default(30),
  OUTBOX_DLQ_RETENTION_DAYS: z.coerce.number().default(90),
  // Phase 186 (#9) — write-boundary payload cap (bytes). 256 KB is generous
  // for any real domain event; a DB CHECK at 1 MB is the hard backstop.
  OUTBOX_MAX_PAYLOAD_BYTES: z.coerce.number().default(262_144),
  // Phase 186 (#12) — consecutive per-eventName failures before a CRITICAL
  // alert fires (systemic-outage detector).
  OUTBOX_FAILURE_ALERT_THRESHOLD: z.coerce.number().default(25),
  // Phase 186 (#1) — default debounce window (ms) when a writer passes a
  // dedupeKey without an explicit window. Collapses bursts within 30s.
  OUTBOX_DEBOUNCE_DEFAULT_MS: z.coerce.number().default(30_000),

  // ── Phase 3 — Unified Refund System (ADR-009) ────────────────────────
  // REFUND_SAGA_ENABLED: when ON, RefundSagaService orchestrates execution
  //   of refund instructions through createInstruction → execute → notify.
  // REFUND_INSTRUCTION_REQUIRED: when ON, dispute decisions + return
  //   refunds create a RefundInstruction instead of calling the wallet
  //   directly. Off → legacy DisputeRefundHandler / ReturnService paths.
  // Both flags together drive the migration to "all refunds go through
  // the saga, all wallet credits trace to an instruction id".
  // Defaults flipped to 'true' 2026-05-16 — soak window complete, the
  // saga is the production refund path. Set to 'false' explicitly to
  // pin the legacy direct-wallet path in a debug deployment.
  REFUND_SAGA_ENABLED: z.string().default('true'),
  REFUND_INSTRUCTION_REQUIRED: z.string().default('true'),

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
  // Phase 125 — dual-approval (two-person rule). Refunds whose amount is
  // at/above this threshold (in paise) require TWO distinct finance
  // approvers: the first approval is recorded and the instruction stays
  // PENDING_APPROVAL until a second, different admin approves. Default
  // ₹1,00,000. Set very high to effectively disable dual approval.
  REFUND_DUAL_APPROVAL_THRESHOLD_PAISE: z.coerce.number().default(10_000_000),
  // Phase 172 (Goodwill Credit audit #9) — goodwill wallet credits lapse after
  // this many days (0 disables expiry). Refunds (money genuinely owed) never expire.
  GOODWILL_CREDIT_EXPIRY_DAYS: z.coerce.number().default(180),
  // Phase 172 (#16) — hard cap on a single dispute's goodwill amount (paise),
  // defence-in-depth against a misclick/compromise (₹50,000 default). Finance
  // approval is still required; this is an upper bound the decision can't exceed.
  MAX_GOODWILL_AMOUNT_PER_DISPUTE_PAISE: z.coerce.number().default(5_000_000),
  // Phase 170 (Refund Queue audit #6) — approval SLA. A queued instruction's
  // approvalDueBy = createdAt + this; the overdue sweep + aging report use it.
  REFUND_APPROVAL_SLA_HOURS: z.coerce.number().default(48),

  // Phase 126 — dispute-decision settlement recovery sweep. decide()
  // mints the customer's RefundInstruction AFTER its atomic status+outbox
  // txn; a crash in that window strands the refund. This sweep re-mints
  // missing instructions for decided disputes (idempotent). LOOKBACK
  // bounds the scan window in minutes (default 24h).
  DISPUTE_REFUND_RECOVERY_SWEEP_ENABLED: z.string().default('true'),
  DISPUTE_REFUND_RECOVERY_LOOKBACK_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .default(1440),

  // Phase 134 — dispute decisions awarding at/above this amount (paise) require
  // the `disputes.decide.high_value` permission (runtime, soak-aware check on
  // POST /admin/disputes/:id/decide). Default ₹50,000.
  DISPUTE_HIGH_VALUE_DECISION_THRESHOLD_PAISE: z.coerce
    .number()
    .default(5_000_000),

  // Phase 13 (P1.8) — return seller-response sweeper. Cron flips
  // PENDING → EXPIRED past sellerResponseDueAt. Default 'true' since
  // the sweep is read-mostly + only flips rows past their due date.
  RETURN_SELLER_RESPONSE_SWEEPER_ENABLED: z.string().default('true'),

  // Auto-schedule a Delhivery Reverse Pickup (RVP) when a return is approved.
  // 'true' = the existing behaviour (ReturnReverseAutoBookHandler books the
  // reverse AWB on returns.return.approved for Delhivery returns); flip to
  // 'false' as a kill-switch to force every return back to the manual
  // schedule-pickup flow without a deploy. Carrier failures already fall back
  // to manual regardless of this flag.
  RETURN_AUTO_RVP_ENABLED: z.string().default('true'),

  // Phase 3 (PR 3.5) — reconciliation crons. Each independently flagged
  // so a noisy job can be paused without disabling the others.
  // Defaults flipped to 'true' 2026-05-16 — wallet drift, stuck refunds,
  // and aged COD refunds were invisible to engineering when these were
  // off. The crons are read-mostly and idempotent; the marginal cost of
  // running them is essentially nil compared to silent money loss.
  WALLET_LEDGER_RECON_ENABLED: z.string().default('true'),
  WALLET_LEDGER_RECON_INTERVAL_MINUTES: z.coerce.number().default(24 * 60),
  REFUND_GATEWAY_RECON_ENABLED: z.string().default('true'),
  REFUND_GATEWAY_RECON_INTERVAL_MINUTES: z.coerce.number().default(60),
  // Phase 167 (Refund Execution audit #8/#16) — the recon cron now actually
  // calls Razorpay: per-row poll backoff (don't re-GET the same refund every
  // tick), batch cap, and the consecutive-fetch-failure alert threshold.
  REFUND_GATEWAY_RECON_BACKOFF_MINUTES: z.coerce.number().int().min(0).default(30),
  REFUND_GATEWAY_RECON_BATCH: z.coerce.number().int().min(1).default(50),
  REFUND_GATEWAY_RECON_FAILURE_ALERT_THRESHOLD: z.coerce.number().int().min(1).default(5),
  COD_REFUND_PENDING_ENABLED: z.string().default('true'),
  COD_REFUND_PENDING_INTERVAL_MINUTES: z.coerce.number().default(4 * 60),
  COD_REFUND_PENDING_STUCK_HOURS: z.coerce.number().default(48),
  // Phase 168 (COD Mark-Paid audit #11) — delivered-but-uncollected COD sweep.
  // Default 'true': uncollected COD cash is silent money-at-risk, the sweep is
  // read-mostly + idempotent (enqueues a deduped AdminTask), same rationale as
  // the sibling recon crons above.
  COD_COLLECTION_PENDING_ENABLED: z.string().default('true'),
  COD_COLLECTION_PENDING_STUCK_HOURS: z.coerce.number().int().min(1).default(72),
  COD_COLLECTION_PENDING_BATCH: z.coerce.number().int().min(1).default(100),

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
  // Phase 174 — per-tick batch cap for releasing expired RESERVED
  // redemptions (bounded id-scan + per-row released events, drains over ticks).
  DISCOUNT_RELEASE_EXPIRED_BATCH_SIZE: z.coerce.number().int().min(1).default(500),

  // Sprint 4 Story 3.4 — auto-detect low-stock conditions every 30 min.
  // Off in dev / staging by default if you want to test the manual
  // /admin/inventory/alerts/sweep endpoint in isolation; left on by
  // default because the steady-state correctness path needs it.
  LOW_STOCK_SWEEP_CRON_ENABLED: z.string().default('true'),
  // Phase 54 (2026-05-21) — sweep batch size. Pre-Phase-54 the
  // service hardcoded `take: 50_000` which silently truncated at
  // marketplace scale (audit Gap #5). Cursor-paginated now; the
  // env knob lets ops tune for memory + DB load without a deploy.
  LOW_STOCK_SWEEP_BATCH_SIZE: z.coerce.number().default(1000),

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
  // Default flipped to 'true' on 2026-05-16 after the soak window closed.
  // Set explicitly to 'false' in non-prod debug runs only.
  PERMISSIONS_GUARD_STRICT: z.string().default('true'),
  // Global auth safety net (GlobalAuthGuard). SOAK by default ('false'):
  // any route with neither an auth @UseGuards nor @Public() is ALLOWED but
  // logs `event=authz.unguarded`. Flip to 'true' once those logs show only
  // intended-public routes — then a forgotten guard fails CLOSED (401)
  // instead of silently exposing the endpoint.
  GLOBAL_AUTH_GUARD_STRICT: z.string().default('false'),
  // Daily RBAC drift detector: scans admin_custom_role_permissions for
  // permission keys that no longer exist in the code-side PERMISSIONS
  // registry, emits rbac.orphan_permission_detected for each. Read-only,
  // alert-only — does NOT auto-delete. Default ON; flip false only for
  // local dev when the registry is in flux.
  RBAC_ORPHAN_SWEEP_ENABLED: z.string().default('true'),
  // Phase 25 (2026-05-20) — MFA pending-secret sweep cron (every 15 min).
  // Clears mfa_pending_secret_ciphertext rows past their stamped
  // mfa_pending_expires_at so abandoned enrolments don't leave a
  // recoverable secret indefinitely. Read-only on rows past their
  // declared TTL — safe-by-construction.
  MFA_PENDING_SWEEP_ENABLED: z.string().default('true'),
  // Phase 27 (2026-05-21) — daily sweep of session rows where
  // revokedAt is older than 90 days. Active sessions are never
  // touched. The unified AuditLog retains the revoke event in full;
  // the session row past 90 days is just disk + index bloat.
  SESSION_REVOKED_SWEEP_ENABLED: z.string().default('true'),
  // Phase 209 (#17) — daily cleanup of EXPIRED (never-revoked) sessions.
  // The revoked-session sweep only touches revokedAt rows; a session that
  // simply timed out (expiresAt < now) without an explicit revoke would
  // otherwise live forever. Both are fail-closed at auth time regardless
  // (the guard checks expiresAt) — this is pure disk/index hygiene, so
  // default ON, env-gated for local-dev convenience. A grace window keeps
  // very-recently-expired rows briefly for forensic lookup.
  SESSION_EXPIRED_CLEANUP_ENABLED: z.string().default('true'),
  SESSION_EXPIRED_CLEANUP_GRACE_DAYS: z.coerce.number().int().min(0).default(30),
  // Phase 201 (#8) — daily retention sweep of access_logs. Login/refresh
  // events (TOKEN_REFRESH fires on every refresh) accumulate without
  // bound; rows older than the window have no forensic value (the unified
  // AuditLog covers compliance). Default ON; window configurable.
  ACCESS_LOG_RETENTION_ENABLED: z.string().default('true'),
  ACCESS_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(180),
  // Phase 207 (#2/#6/#15) — brute-force spike detector cron. Runs every
  // 5 minutes (leader-elected, instrumented), scans the recent
  // LOGIN_FAILURE window with three lenses — per-(account,IP), per-IP
  // (credential-stuffing / spray), per-account (distributed botnet) — and
  // on a crossing emits `security.brute_force_detected` + opens an
  // idempotent AdminTask. Default ON (read + event/task only; no money
  // movement). Thresholds are env-tunable per lens (#15) so ops can dial
  // sensitivity without a deploy. Window kept short (15min) so the signal
  // is "active attack now," not "noisy yesterday."
  BRUTE_FORCE_SPIKE_CRON_ENABLED: z.string().default('true'),
  BRUTE_FORCE_SPIKE_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  // (account, IP) pair threshold — the classic per-target burst.
  BRUTE_FORCE_SPIKE_PER_ACTOR_IP: z.coerce.number().int().min(2).default(10),
  // One source IP across many accounts (spray / stuffing).
  BRUTE_FORCE_SPIKE_PER_IP: z.coerce.number().int().min(2).default(30),
  // One account across many IPs (distributed botnet on a victim).
  BRUTE_FORCE_SPIKE_PER_ACCOUNT: z.coerce.number().int().min(2).default(20),
  // Max spike rows to escalate into AdminTasks per tick (bounds blast
  // radius if a huge attack lights up thousands of groups at once).
  BRUTE_FORCE_SPIKE_MAX_TASKS_PER_RUN: z.coerce.number().int().min(1).default(50),
  // Phase 4 (PR 4.3) — ABAC resource-policy evaluator runs after
  // PermissionsGuard. Off by default; flips on with PR 4.5.
  ABAC_ENABLED: z.string().default('false'),
  // Phase 4 (PR 4.4) — write a row to authorization_audits for every
  // guard decision (allow + deny). Default ON: incident-response value
  // outweighs the small write cost, and the buffer batches writes so
  // there's no per-request DB hit. Set false to disable temporarily.
  AUTHZ_AUDIT_ENABLED: z.string().default('true'),

  // Phase 5 (PR 5.4) — minimum number of evidence images required at
  // QC submission. 0 = off (legacy behaviour); 2 = at least two photos
  // per inspection. Phase 0 (Gap audit) bumped the default to 2 so a
  // QC decision can never be submitted with zero photos — that was a
  // dispute-liability black hole. Set via env to override per
  // environment (e.g. 0 in dev seeds, 2 in staging/prod).
  RETURN_QC_MIN_EVIDENCE: z.coerce.number().int().min(0).default(2),
  // Reverse-logistics (delivery) charge billed to a SELLER on a seller-fault
  // return — the round-trip shipping cost their fault caused. Added to the
  // SellerDebit ON TOP of any product-value recovery, and applies EVEN when
  // the product value is ₹0 (within-window / "seller never made the sale"),
  // because the platform still paid the courier for the round trip. Flat
  // per-return paise; set to 0 to disable. Only ever charged on SELLER-liable
  // returns (logistics/platform-fault returns never bill the seller). ₹100 default.
  RETURN_SELLER_DELIVERY_CHARGE_PAISE: z.coerce.number().int().min(0).default(10000),
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

  // Phase 6 (PR 6.2) — SLA breach detector cron. Default flipped to
  // 'true' 2026-05-16 — example policies have been seeded and the
  // cron is a read-only scan + alert path with no money side effects.
  SLA_BREACH_DETECTOR_ENABLED: z.string().default('true'),

  // Phase 3.6 (2026-05-16) — Commission processor gate.
  // Default ON. Set to 'false' to pause the setInterval loop without
  // a code change (commission-rule migration window, runaway
  // investigation, etc.). Interval also tunable.
  COMMISSION_PROCESSOR_ENABLED: z.string().default('true'),
  COMMISSION_PROCESSOR_INTERVAL_MS: z.coerce.number().default(15_000),
  // Phase 159d — affiliate return-window confirm cron. Emergency-pause flag +
  // tunable interval, parity with the seller commission processor above.
  AFFILIATE_RETURN_WINDOW_CRON_ENABLED: z.string().default('true'),
  AFFILIATE_RETURN_WINDOW_CRON_INTERVAL_MS: z.coerce.number().default(60_000),
  // Phase 135 — max sub-orders processed per tick. Caps the scan + the
  // per-tick work so a large backlog drains across ticks instead of loading
  // everything (+ nested includes) into one query.
  COMMISSION_PROCESSOR_BATCH_SIZE: z.coerce.number().int().min(1).default(200),
  // Phase 135 — bounded concurrency for the per-tick sub-order loop. Each
  // sub-order is an independent atomic-claimed transaction; the cap bounds
  // DB-connection pressure.
  COMMISSION_PROCESSOR_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  // Phase 174 — COD cash-in-hand gate. When ON, a DELIVERED COD sub-order's
  // commission is deferred until its SubOrder.paymentStatus = PAID (cash
  // collected). Default OFF preserves pay-on-delivery; flip after finance
  // sign-off. ONLINE/prepaid sub-orders are unaffected.
  COMMISSION_REQUIRE_COD_PAID: z.string().default('false'),

  // Phase 3.8 (2026-05-16) — Double-entry invariant validator.
  // Daily cron at 04:00 IST sums the day's wallet + payout + refund
  // + commission + tax movements and asserts they balance to ±1 paise.
  // Read-only; emits accounts.imbalance_detected on breach.
  DOUBLE_ENTRY_VALIDATOR_ENABLED: z.string().default('true'),

  // Phase 4.4 (2026-05-16) — Stock reservation expiry sweep.
  // Runs every minute on the leader replica; flips reservations past
  // their 15-min TTL from RESERVED → EXPIRED and decrements the
  // mapping's reservedQty atomically. Without this, abandoned
  // checkouts permanently block stock from being resold.
  RESERVATION_EXPIRY_SWEEP_ENABLED: z.string().default('true'),
  RESERVATION_EXPIRY_BATCH_SIZE: z.coerce.number().default(500),

  // Phase 61 (2026-05-22) — cart abandonment sweep (audit Gap #12).
  // Daily 03:00 UTC, leader-elected. Deletes Cart rows whose
  // updatedAt is older than CART_ABANDONMENT_CUTOFF_DAYS. The
  // cart_items FK is ON DELETE CASCADE so child rows go with the
  // parent.
  CART_ABANDONMENT_SWEEP_ENABLED: z.string().default('true'),
  CART_ABANDONMENT_CUTOFF_DAYS: z.coerce.number().default(90),

  // Phase 62 (2026-05-22) — coupon application hardening.
  //   AFFILIATE_COMMISSION_CAP_PER_ORDER (in paise) is the upper
  //     bound on a single AffiliateCommission row (audit Gap #14).
  //     Default 100,000 paise = ₹1000 per order so a colluding
  //     fraud pair can't bank arbitrary commissions on a fake
  //     order. 0 disables the cap.
  //   COUPON_ATTEMPT_IP_HASH_SALT — salt applied to IP addresses
  //     before SHA-256 digesting (audit Gap #21). Rotated quarterly
  //     by ops; old digests stay queryable for the 30-day cleanup
  //     window. Must be at least 16 chars.
  AFFILIATE_COMMISSION_CAP_PER_ORDER: z.coerce.number().default(100_000),
  COUPON_ATTEMPT_IP_HASH_SALT: z.string().min(16).default(
    'sportsmart-coupon-attempt-salt-2026-05-rotate-quarterly',
  ),

  // Phase 64 (2026-05-22) — serviceability hardening.
  //   ROUTING_MAX_DISTANCE_KM is the upper bound on the customer-
  //   to-seller Haversine distance for an eligibility match (audit
  //   Gap #8). Pre-Phase-64 a Chennai customer could be routed to
  //   a 2500km Punjab seller with one unit of stock; the allocator
  //   now filters out candidates beyond this cap. Default 1500 km
  //   covers the longest realistic single-leg domestic shipment
  //   without enabling cross-country mis-routes. 0 disables the
  //   cap for back-compat.
  ROUTING_MAX_DISTANCE_KM: z.coerce.number().default(1500),

  // Tiered-allocation cascade (2026-06-16) — Retail sellers are LOCAL fulfilment
  // only: a retail seller is eligible for an order only when the customer is
  // within this straight-line (Haversine) radius of their pickup pincode.
  // Beyond it, the retail seller is not eligible at all (no nationwide retail
  // fallback) and the order cascades to Franchise → D2C, which ship nationwide
  // (no distance cap). 0 disables the radius (retail becomes nationwide too).
  RETAIL_LOCAL_RADIUS_KM: z.coerce.number().default(50),

  // Phase 66 (2026-05-22) — payment intent hardening.
  //   PAYMENT_EXPIRY_SWEEP_ENABLED (audit Gap #18) gates the cron
  //     that flips PENDING_PAYMENT orders past their
  //     paymentExpiresAt to CANCELLED + paymentStatus=EXPIRED.
  //   ALLOW_ONLINE_PAYMENTS (audit Gap #12) lets ops disable
  //     online payments cleanly without removing the Razorpay
  //     config. /checkout/summary returns the flag so the UI can
  //     hide the ONLINE option without guessing.
  PAYMENT_EXPIRY_SWEEP_ENABLED: z.string().default('true'),
  ALLOW_ONLINE_PAYMENTS: z.string().default('true'),
  // Option B — deferred order creation. OFF by default: the legacy
  // create-then-pay flow stays in control until this is flipped. When ON, an
  // ONLINE checkout creates a CheckoutSession (not an order) and the real
  // MasterOrder is created only on gateway capture. COD / wallet-fully-covered
  // checkouts ignore this flag (no pending-gateway gap).
  CHECKOUT_DEFERRED_ORDER_CREATION: z.string().default('false'),

  // Phase 69 (2026-05-22) — Phase 67 audit Gaps #1 + #5. The
  // OrderFinalizationRecoveryCron retries tax-snapshot creation
  // for orders whose post-tx work never finished (finalizedAt IS
  // NULL). All three tunables are env-driven so ops can pause
  // recovery temporarily or shorten the alert threshold in
  // incident response.
  ORDER_FINALIZATION_RECOVERY_ENABLED: z.string().default('true'),
  ORDER_FINALIZATION_GRACE_MINUTES: z.coerce.number().int().min(1).default(10),
  ORDER_FINALIZATION_ALERT_MINUTES: z.coerce.number().int().min(1).default(60),
  ORDER_FINALIZATION_BATCH_LIMIT: z.coerce.number().int().min(1).max(5000).default(500),

  // Phase 70 (2026-05-22) — Phase 66 audit Gap #8. Wallet refund
  // saga retry cron tunables.
  WALLET_REFUND_SAGA_ENABLED: z.string().default('true'),
  WALLET_REFUND_SAGA_BATCH_LIMIT: z.coerce.number().int().min(1).max(1000).default(100),
  WALLET_REFUND_SAGA_COOLDOWN_MINUTES: z.coerce.number().int().min(1).default(5),
  // Phase 173 (Recon audit #1) — stale-run reaper knobs.
  RECON_STALE_RUN_REAPER_ENABLED: z.string().default('true'),
  RECON_STALE_RUN_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  // Phase 172 (#9) — goodwill-expiry sweep cron knobs.
  WALLET_GOODWILL_EXPIRY_ENABLED: z.string().default('true'),
  WALLET_GOODWILL_EXPIRY_BATCH_LIMIT: z.coerce.number().int().min(1).max(10000).default(1000),

  // Phase 70 (2026-05-22) — Phase 66 audit Gap #19 (wallet flow).
  // Env-tunable single-topup cap (paise). Default ₹1,00,000 mirrors
  // the legacy hard-coded value.
  WALLET_MAX_TOPUP_PAISE: z.coerce.number().int().min(100).default(10_000_000),

  // Phase 68 (2026-05-22) — verification queue claim TTL (audit Gap
  // #16). The number of minutes a claim is held before the next
  // claim-next call can re-claim the order. Default 15 matches the
  // legacy hardcoded value; teams in different shift patterns can
  // tune without redeploying code.
  VERIFICATION_CLAIM_TTL_MINUTES: z.coerce.number().int().min(1).default(15),

  // Phase 73 (2026-05-22) — claim-flow audit Gap #4 + #7.
  //   VERIFICATION_MAX_CLAIMS_PER_VERIFIER  default 10 — cap on
  //     live claims per admin (prevents mass-claim queue DoS).
  //   VERIFICATION_CLAIM_EXPIRY_ENABLED      default true — gates
  //     the auto-release cron; ops can pause during incident
  //     response.
  //   VERIFICATION_CLAIM_EXPIRY_BATCH_LIMIT  default 500 — per-
  //     tick row cap so a stuck-state backlog can't blow up one
  //     cron run.
  VERIFICATION_MAX_CLAIMS_PER_VERIFIER: z.coerce.number().int().min(1).default(10),

  // Phase 76 (2026-05-22) — bulk-approve-green ceiling. Default 25
  // mirrors legacy behaviour; service-side absolute ceiling of 50
  // caps any env typo.
  VERIFICATION_BULK_APPROVE_MAX: z.coerce.number().int().min(1).max(50).default(25),
  VERIFICATION_CLAIM_EXPIRY_ENABLED: z.string().default('true'),
  VERIFICATION_CLAIM_EXPIRY_BATCH_LIMIT: z.coerce.number().int().min(1).max(5000).default(500),

  // Phase 68 (audit Gap #13) — verification SLA window. New orders
  // get verification_deadline_at = NOW() + this many minutes at
  // place-order time. Default 60 (= 1h) matches the pre-Phase-68
  // queue-stats proxy threshold.
  VERIFICATION_SLA_MINUTES: z.coerce.number().int().min(1).default(60),

  // Phase 10 (2026-05-16) — stuck-job detector cron. Sweeps known
  // transient cohorts (tax_documents in PDF_PENDING, einvoice PENDING,
  // settlement cycles in PREVIEWED) past their tolerance window and
  // emits ops.stuck_job_detected. OpsAlertHandler turns the events
  // into emails. Tolerances tunable per cohort.
  STUCK_JOB_DETECTOR_ENABLED: z.string().default('true'),
  STUCK_TAX_PDF_HOURS: z.coerce.number().default(2),
  STUCK_EINVOICE_HOURS: z.coerce.number().default(2),
  STUCK_SETTLEMENT_CYCLE_HOURS: z.coerce.number().default(24),

  // Phase 10 (2026-05-16) — webhook DLQ sweeper. Watches
  // webhook_deliveries.status = FAILED_DEAD rows that landed in the
  // last sweep window and emits webhook.dlq_growing per endpoint
  // when its FAILED_DEAD count exceeds the threshold.
  WEBHOOK_DLQ_SWEEPER_ENABLED: z.string().default('true'),
  WEBHOOK_DLQ_SWEEP_WINDOW_HOURS: z.coerce.number().default(2),
  WEBHOOK_DLQ_ALERT_THRESHOLD: z.coerce.number().default(5),

  // Phase 11 (2026-05-16) — external-dependency health probes.
  // `HEALTH_EXTERNAL_PROBES_DEFAULT=true` makes /health include
  // Razorpay / R2 checks by default (still overridable
  // per-request via ?external=0). The dedicated /health/deps route
  // always runs them. Per-probe timeout shared across both.
  HEALTH_EXTERNAL_PROBES_DEFAULT: z.string().default('false'),
  HEALTH_PROBE_TIMEOUT_MS: z.coerce.number().default(3_000),

  // Phase 11 (2026-05-16) — OpenTelemetry bootstrap (lazy-required;
  // see src/bootstrap/tracing/tracing.ts). Off by default; flip to
  // true after `pnpm add @opentelemetry/sdk-node @opentelemetry/
  // auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http
  // @opentelemetry/resources @opentelemetry/semantic-conventions
  // @opentelemetry/api` lands. Sampler ratio 0.1 keeps the trace
  // backend volume reasonable while still surfacing every error
  // (parent-based sampler honours upstream sampled-true).
  OTEL_ENABLED: z.string().default('false'),
  OTEL_SERVICE_NAME: z.string().default('sportsmart-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .default('http://localhost:4318/v1/traces'),
  OTEL_TRACES_SAMPLER_RATIO: z.coerce.number().min(0).max(1).default(0.1),

  // Phase 14 (2026-05-16) — media orphan sweep cron. Daily cron that
  // deletes orphaned media assets (R2) whose owning Product was
  // soft-deleted more than MEDIA_ORPHAN_RETENTION_DAYS ago.
  // 30 days gives ops a recovery window before the asset is gone.
  MEDIA_ORPHAN_SWEEPER_ENABLED: z.string().default('true'),
  MEDIA_ORPHAN_RETENTION_DAYS: z.coerce.number().default(30),
  MEDIA_ORPHAN_BATCH_SIZE: z.coerce.number().default(200),
  // Phase 174 — after this many failed media deletes a row is flagged
  // delete_failed=true and dropped from the scan instead of churning daily.
  MEDIA_ORPHAN_DELETE_RETRY_CAP: z.coerce.number().int().min(1).default(5),

  // Portal SSE realtime streams — per-actor connection caps (DoS guard).
  // Opening more than the cap evicts the actor's oldest connection.
  PORTAL_SSE_MAX_CONN_PER_ACTOR: z.coerce.number().int().min(1).default(5),
  PORTAL_SSE_MAX_CONN_PER_ADMIN: z.coerce.number().int().min(1).default(3),
  // Max connection lifetime (minutes). Past this the server force-closes
  // the stream; the browser EventSource auto-reconnects, which re-runs the
  // auth guard (DB session + account-active check) — bounding how long a
  // revoked/suspended actor can keep streaming to at most this window.
  PORTAL_SSE_MAX_CONN_AGE_MIN: z.coerce.number().int().min(1).default(15),

  // Phase 7 (2026-05-16) — Procurement approval SLA. When a franchise
  // submits a procurement request, the admin gets `PROCUREMENT_APPROVAL_SLA_HOURS`
  // to approve/reject before the breach cron fires `procurement.sla_breached`
  // for ops escalation. Set the cron flag false to silence breach
  // notifications during planned maintenance windows.
  PROCUREMENT_APPROVAL_SLA_HOURS: z.coerce.number().default(48),
  PROCUREMENT_SLA_BREACH_CRON_ENABLED: z.string().default('true'),

  // Phase 4.8 (2026-05-16) — Coupon attempts cleanup. Daily purge of
  // coupon_attempts older than the retention horizon. Without this
  // the table grows unbounded and the windowed fraud-check query
  // (which scans recent attempts per customer) gradually slows.
  COUPON_ATTEMPTS_CLEANUP_ENABLED: z.string().default('true'),
  COUPON_ATTEMPTS_RETENTION_DAYS: z.coerce.number().default(30),

  // Phase 5.3 (2026-05-16) — Escalation email for return + support
  // stale-state alerts. Previously hardcoded to admin@sportsmart.com
  // in 2 places. Pointing this at an ops distribution list / PagerDuty
  // inbox means alerts survive admin departures without code changes.
  ADMIN_ESCALATION_EMAIL: z.string().optional(),

  // Phase 5.5 (2026-05-16) — Support SLA business-hours mode.
  // When 'true', SLA timers pause outside 09:00-19:00 IST on weekdays
  // and pause entirely on Saturday + Sunday. Default 'false' preserves
  // the legacy wall-clock behaviour.
  SUPPORT_SLA_BUSINESS_HOURS_ENABLED: z.string().default('false'),
  SUPPORT_SLA_BUSINESS_HOUR_START: z.coerce.number().min(0).max(23).default(9),
  SUPPORT_SLA_BUSINESS_HOUR_END: z.coerce.number().min(1).max(24).default(19),
  // Phase 120 — SLA-breach sweep. Set false to pause auto-escalation of
  // tickets that blew their slaTargetAt.
  SUPPORT_SLA_SWEEP_ENABLED: z.string().default('true'),
  // Phase 122 — a non-admin reply reopens a RESOLVED ticket; past this many
  // days since resolution, force a new ticket instead. 0 disables the window.
  SUPPORT_REOPEN_WINDOW_DAYS: z.coerce.number().int().min(0).default(30),
  // Phase 124 — forward-mirror reliability sweep (ticket reply → dispute).
  SUPPORT_MIRROR_SWEEP_ENABLED: z.string().default('true'),
  SUPPORT_MIRROR_SWEEP_LOOKBACK_MINUTES: z.coerce
    .number()
    .int()
    .min(10)
    .default(120),

  // Phase 5.5 (2026-05-16) — Auto-assignment for new support tickets.
  // Round-robin across on-shift agents (admins with permission
  // `support.reply`). Default 'false' to preserve manual triage flow.
  SUPPORT_AUTO_ASSIGN_ENABLED: z.string().default('false'),

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
  // Phase 174 — per-tick batch for the stuck-saga sweep.
  REFUND_SAGA_SWEEP_BATCH_SIZE: z.coerce.number().int().min(1).default(50),
  // Phase 116 — stuck PENDING_APPROVAL sweep. Set false to pause the
  // escalation cron during an ops incident.
  REFUND_PENDING_APPROVAL_SWEEP_ENABLED: z.string().default('true'),
  // RefundInstruction rows left in PENDING_APPROVAL longer than this many
  // hours raise an AdminTask so finance is paged. Default 48h.
  REFUND_PENDING_APPROVAL_STUCK_HOURS: z.coerce.number().int().min(1).default(48),

  // Phase 1 (PR 1.8) — Franchise reservation cleanup cron. ON by
  // default so a crash-mid-checkout doesn't strand franchise stock
  // forever. Set false to pause during ops incidents where the
  // franchise inventory ledger is being manually reconciled.
  FRANCHISE_RESERVATION_SWEEP_ENABLED: z.string().default('true'),
  // Phase 174 — caps the expired ORDER_RESERVE ledger scan per tick.
  FRANCHISE_RESERVATION_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).default(500),

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
  // request-then-post). When false (default), even small TIME_BARRED
  // rows sit in PENDING_APPROVAL — finance reviews every single one.
  // Default flipped to false on 2026-05-14 so audits see a named
  // approver on every wallet row. Set to 'true' to opt back into
  // the old behaviour for low-trust ops.
  WALLET_ADJUSTMENT_AUTO_APPROVE_BELOW_THRESHOLD:
    z.string().default('false'),

  // Phase 15 GST — E-way bill provider selector. 'stub' produces
  // placeholder EWB numbers + logs the would-be NIC payload to
  // `e_way_bills.raw_request_json`; 'nic' wires the real CBIC
  // e-Waybill API (lands in a later phase tied to e-invoicing). Keep
  // 'stub' in dev/test so engineers can exercise the ship-block + retry
  // UI without NIC credentials.
  EWAY_BILL_PROVIDER: z.enum(['stub', 'nic']).default('stub'),
  // Phase 89 (2026-05-23) — NIC e-Waybill API credentials. All
  // optional at the env layer (dev uses stub), but the NIC adapter's
  // constructor throws if any are missing when EWAY_BILL_PROVIDER=nic
  // — so a misconfigured prod deploy crashes at boot rather than
  // silently falling back to the stub.
  NIC_API_BASE_URL: z.string().optional(),
  NIC_GSP_USERNAME: z.string().optional(),
  NIC_GSP_PASSWORD: z.string().optional(),
  NIC_GSP_CLIENT_ID: z.string().optional(),
  NIC_GSP_CLIENT_SECRET: z.string().optional(),
  NIC_TAXPAYER_GSTIN: z.string().optional(),

  // Phase 19 GST — tax-document PDF storage provider. 'stub' writes
  // rendered HTML to `apps/api/storage/tax-pdfs/...` so dev can open
  // the file directly; 'r2' wires real cloud storage (Cloudflare R2)
  // via the tax-PDF storage provider. Switching is single-line at boot
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
  // Phase 90 (2026-05-23) — NIC IRP credentials. All optional at
  // env layer (dev uses stub). The NIC adapter's constructor throws
  // if any are missing when EINVOICE_PROVIDER=nic, so a misconfigured
  // prod deploy crashes at boot rather than silently falling back.
  NIC_IRP_BASE_URL: z.string().optional(),
  NIC_IRP_GSP_USERNAME: z.string().optional(),
  NIC_IRP_GSP_PASSWORD: z.string().optional(),
  NIC_IRP_GSP_CLIENT_ID: z.string().optional(),
  NIC_IRP_GSP_CLIENT_SECRET: z.string().optional(),
  NIC_IRP_TAXPAYER_GSTIN: z.string().optional(),
  // Phase 35 GST — GSTN portal verification provider. `stub` derives
  // the result from the local Mod-36 checksum so dev / staging can
  // exercise the verification UI without GSTN credentials. `sandbox`
  // is reserved for the real GSTN sandbox API (crashes loudly at
  // boot until wired — see TaxModule factory).
  GSTN_PROVIDER: z.enum(['stub', 'sandbox']).default('stub'),
  // Phase 161 (Seller GSTIN Verification audit #13) — re-verify cooldown.
  // 0 (default) = no cooldown; >0 = skip the provider call (return the cached
  // row) when the GSTIN was checked within this many hours, unless force=true.
  GSTN_REVERIFY_COOLDOWN_HOURS: z.coerce.number().int().min(0).default(0),
  // Phase 200 (#14) — weekly GSTN re-verification cron. Default OFF so it
  // doesn't burn provider quota against the stub; flip on once a live GSTN
  // adapter is wired. STALE_DAYS = re-check profiles verified longer ago.
  GSTN_REVERIFY_CRON_ENABLED: z.string().default('false'),
  GSTN_REVERIFY_STALE_DAYS: z.coerce.number().int().min(1).default(90),
  // Phase 197 (#20) — legacy single-seller place-order path (POST /customer/
  // orders). Default OFF: the live flow is POST /customer/checkout/place-order.
  LEGACY_PLACE_ORDER_ENABLED: z.string().default('false'),
  // Phase 199 (#9) — orphaned return-evidence cleanup sweep.
  // Default OFF: requires the R2 object-listing seam to be wired.
  RETURN_EVIDENCE_ORPHAN_CLEANUP_ENABLED: z.string().default('false'),
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

  // Phase 163 (Tax Audit Readiness Dashboard audit) — readiness scan knobs.
  //   #19 — "active seller" window for the missing-GSTIN / legal-name-mismatch
  //         scans (was a hardcoded 30 days; 90 covers quarterly-only sellers).
  //   #2  — a DRAFT tax document older than this is "stuck", not in-flight.
  //   #5  — server-side cache TTL for the (expensive, 14-scan) readiness build.
  //   #16 — the 6-hourly readiness-snapshot (trend table) cron toggle.
  TAX_AUDIT_READINESS_ACTIVE_SELLER_WINDOW_DAYS:
    z.coerce.number().int().min(1).default(90),
  TAX_AUDIT_READINESS_DRAFT_STALE_HOURS:
    z.coerce.number().int().min(0).default(24),
  TAX_READINESS_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(30),
  TAX_READINESS_SNAPSHOT_CRON_ENABLED: z.string().default('true'),

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
  // Phase 10 (2026-05-16) — promoted from default-off. The anchor cron
  // is listed in requiredOnInProd; flipping the default to 'true'
  // means staging runs the anchor on its own cadence and a missed
  // anchor surfaces in cron metrics before the prod cutover.
  AUDIT_CHAIN_ANCHOR_ENABLED: z.string().default('true'),

  // Phase 203 (#9) / 204 (#7) — autonomous chain-break detector cron. Walks
  // forward from the latest anchor every 30 min, persists a verification run,
  // and emits `audit.chain.break_detected` on any tamper. Read-only over the
  // audit log + one run row per tick, so default-on.
  AUDIT_CHAIN_VERIFY_ENABLED: z.string().default('true'),
  // Rows the cron walks per tick (anchor cadence keeps this small in steady
  // state; the cap bounds a first-run backlog).
  AUDIT_CHAIN_VERIFY_LIMIT: z.coerce.number().int().positive().default(20_000),

  // Phase 206 (#4) — CSV export guard-rails. The export REQUIRES a date range;
  // these bound it so one click can't dump the whole table.
  AUDIT_EXPORT_MAX_RANGE_DAYS: z.coerce.number().int().positive().default(90),
  AUDIT_EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(100_000),

  // Phase 203 (#15) — audit-log retention. HONEST-CALL: compliance (CERT-In /
  // DPDP / financial) typically mandates a 5–7 YEAR floor, so the sweeper is
  // OFF by default and the window defaults to ~7 years; turning it on is a
  // deliberate, signed-off decision (and a cold-archive export should run
  // first — surfaced, not built). See AuditLogRetentionCron.
  AUDIT_LOG_RETENTION_ENABLED: z.string().default('false'),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(2557),

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

  // ─── Logistics partner registration (LogisticsPartnerModule) ──────
  // Feature flag for the partner-agnostic pickup-location registration
  // surface (apps/api → logistics-facade → Delhivery / future
  // carriers). Default `'true'` so prod environments get the feature
  // by default; set to literal `'false'` to roll back: the
  // `LogisticsPartnerModule.forRoot({ enabled: false })` path returns
  // an empty module so `/admin/logistics-partner/*` returns 404.
  //
  // Note: the facade URL + key vars below are only consumed when the
  // flag is true; setting the flag false lets apps/api boot in
  // environments where the facade is not deployed yet.
  LOGISTICS_PARTNER_REGISTRATION_ENABLED: z.string().default('true'),
  /** Base URL of the apps/logistics-facade service. */
  LOGISTICS_FACADE_URL: z.string().optional(),
  /** Shared secret rotated by ops — sent as `Authorization: ApiKey <key>`. */
  LOGISTICS_FACADE_API_KEY: z.string().optional(),
  /** Per-request timeout in milliseconds (default 30_000). */
  LOGISTICS_FACADE_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
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
    if (!m || m[1] === undefined || m[2] === undefined) return null;
    const n = parseInt(m[1], 10);
    if (n <= 0) return null;
    const unitToSec: Record<string, number> = {
      s: 1, m: 60, h: 3600, d: 86400,
    };
    const unit = unitToSec[m[2]];
    return unit === undefined ? null : n * unit;
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
      if (!a || !b) continue;
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

  // Phase 9 (2026-05-16) — APP_URL prod guard. The default in this
  // schema is `http://localhost:8000` for developer ergonomics, but
  // shipping that default in production is a CORS / OAuth-redirect /
  // email-link disaster — every absolute URL the API embeds in an
  // outbound email or webhook payload would point at localhost. Fail
  // the boot when the value either is empty, points at localhost /
  // 127.0.0.1, or uses http:// in prod.
  const appUrlRaw = env.APP_URL;
  if (typeof appUrlRaw === 'string') {
    let parsed: URL | null = null;
    try {
      parsed = new URL(appUrlRaw);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_URL'],
        message: `APP_URL must be a valid URL in production (got '${appUrlRaw}').`,
      });
    }
    if (parsed) {
      if (parsed.protocol !== 'https:') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['APP_URL'],
          message: `APP_URL must use https:// in production (got '${parsed.protocol}').`,
        });
      }
      const host = parsed.hostname;
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host.endsWith('.local')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['APP_URL'],
          message: `APP_URL points at a local host ('${host}') in production — set the real public URL via env before boot.`,
        });
      }
    }
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
    // Cloudflare R2 object storage (replaces S3). Endpoint is derived from
    // R2_ACCOUNT_ID when R2_ENDPOINT isn't set, so only one of them is
    // strictly required — R2_ACCOUNT_ID is the canonical one to require.
    'R2_ACCOUNT_ID',
    'R2_BUCKET',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    // PR 10.8 — Phase 10's MFA flow (PR 10.6 login challenge,
    // PR 10.7 anti-replay) reads ADMIN_MFA_ENCRYPTION_KEY on every
    // verify-challenge request to decrypt the admin's stored TOTP
    // secret. Without the key, an enrolled admin literally cannot
    // complete login — better to fail at boot than to surface that
    // as a 500 on the first MFA-required login attempt in prod.
    'ADMIN_MFA_ENCRYPTION_KEY',
  ];
  // NOTE: `SELLER_BANK_ENCRYPTION_KEY` (Phase 19, 2026-05-20) is
  // documented in .env.example as required for prod, but is NOT
  // listed above. `SellerBankDetailsService` refuses writes at
  // request time with `BANK_DETAILS_UNAVAILABLE` when the key is
  // unset — that is a sufficient runtime gate without forcing a
  // boot-time failure that would cascade through the prod-env test
  // matrix.
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

  // Phase 185 (#1/#4) — SMS credentials are only mandatory in prod when a
  // real provider is selected. Default `stub` keeps non-SMS deployments
  // (the current state) booting unchanged; choosing msg91/twilio without
  // creds would silently no-op every SMS, so fail fast instead.
  if (env.NODE_ENV === 'production' && env.SMS_PROVIDER && env.SMS_PROVIDER !== 'stub') {
    const needed: Array<keyof typeof env> = ['SMS_AUTH_KEY', 'SMS_SENDER_ID'];
    if (env.SMS_PROVIDER === 'twilio') needed.push('SMS_API_SECRET');
    for (const key of needed) {
      const value = env[key];
      if (value === undefined || value === null || String(value).trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when SMS_PROVIDER=${env.SMS_PROVIDER} in production`,
        });
      }
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
    {
      key: 'PERMISSIONS_GUARD_STRICT',
      reason:
        'Phase 0 (Gap audit) — PermissionsGuard.STRICT forces the guard to throw (fail-closed) when a controller route is decorated with @Permissions(...) but the resolver cannot evaluate the admin\'s effective permission set (DB unreachable, role row missing, cache cold). Off / non-strict, the guard degrades-open: a transient permission-resolver failure lets the request through, masking config drift and turning a permission misconfiguration into a silent missing-check. Schema default is already \'true\'; this gate makes the production boot refuse if it gets flipped off.',
    },
    {
      key: 'RBAC_ORPHAN_SWEEP_ENABLED',
      reason:
        'Phase 24 (RBAC audit) — RbacOrphanSweepCron is the only daily detector that catches drift between code-side ALL_PERMISSION_KEYS and DB-side admin_custom_role_permissions.permissionKey. When a permission key is renamed in code, the cron emits rbac.orphan_permission_detected so ops can rename the DB rows or restore the code key. Off in prod, custom roles silently grant permissions that no controller checks — the role looks correct but PermissionsGuard never matches the orphan key. The sweep is read-only with no money-moving side effects, so the boot-gate has no operational cost.',
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
