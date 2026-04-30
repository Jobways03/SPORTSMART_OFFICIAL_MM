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
}).superRefine((env, ctx) => {
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
