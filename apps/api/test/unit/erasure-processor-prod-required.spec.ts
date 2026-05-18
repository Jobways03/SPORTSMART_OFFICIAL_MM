import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.6) — `ERASURE_PROCESSOR_ENABLED` must be true in prod.
 *
 * The `ErasureProcessorCron` (instrumented in PR 5.3) walks
 * `DataErasureRequest` rows whose `notBefore` has elapsed and runs
 * them through `ErasureService.processOne`. That service is what
 * actually scrubs the PII fan-out across customer, address, support
 * ticket, dispute, and audit-log rows — the request row itself is
 * just a queue ticket.
 *
 * Off in prod, requests sit indefinitely in PENDING. India's DPDPA
 * (Section 12) imposes a statutory window for "right to erasure"
 * requests; the EU GDPR Article 17 sets a 30-day default. Missing
 * those windows is a regulatory violation with monetary penalties,
 * not just a customer-trust issue. The intake surface (customer
 * portal "delete my account" and the support-side erasure button)
 * happily accepts requests whether the cron runs or not — the queue
 * just doesn't drain.
 *
 * Stays off in dev/test/staging because the processor scrubs real
 * rows; running it against fixture data destroys golden seeds.
 */

const SECRETS = {
  JWT_CUSTOMER_SECRET: 'c'.repeat(32),
  JWT_SELLER_SECRET: 's'.repeat(32),
  JWT_FRANCHISE_SECRET: 'f'.repeat(32),
  JWT_ADMIN_SECRET: 'a'.repeat(32),
  JWT_AFFILIATE_SECRET: 'p'.repeat(32),
  JWT_REFRESH_SECRET: 'r'.repeat(32),
  AFFILIATE_ENCRYPTION_KEY: 'k'.repeat(32),
};

const baseDevEnv = {
  NODE_ENV: 'development' as const,
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost:6379',
  ...SECRETS,
};

const baseProdEnv = {
  ...baseDevEnv,
  NODE_ENV: 'production' as const,
  RAZORPAY_KEY_ID: 'x',
  RAZORPAY_KEY_SECRET: 'x',
  RAZORPAY_WEBHOOK_SECRET: 'x',
  S3_BUCKET: 'x',
  S3_REGION: 'ap-south-1',
  S3_ACCESS_KEY: 'x',
  S3_SECRET_KEY: 'x',
  ADMIN_MFA_ENCRYPTION_KEY: 'k'.repeat(32),
  APP_URL: 'https://api.example.com',
  CORS_ORIGINS: 'https://app.example.com',
  // Sibling required-on flags (PR 6.1 – 6.5, 6.7 – 6.15).
  CRON_HEARTBEAT_ENABLED: 'true',
  SLA_BREACH_DETECTOR_ENABLED: 'true',
  AUDIT_CHAIN_ANCHOR_ENABLED: 'true',
  IDEMPOTENCY_ENABLED: 'true',
  INTEGRITY_VERIFIER_ENABLED: 'true',
  WALLET_LEDGER_RECON_ENABLED: 'true',
  EVENT_DEDUP_ENABLED: 'true',
  OUTBOX_ENABLED: 'true',
  OUTBOX_DUAL_WRITE: 'true',
  REFUND_GATEWAY_RECON_ENABLED: 'true',
  RETENTION_ENFORCER_ENABLED: 'true',
  ABAC_ENABLED: 'true',
  REFUND_SAGA_ENABLED: 'true',
  COD_REFUND_PENDING_ENABLED: 'true',
  MONEY_DUAL_WRITE_ENABLED: 'true',
};

describe('ERASURE_PROCESSOR_ENABLED prod policy (PR 6.6)', () => {
  describe('dev / staging — flag stays default-off', () => {
    it('dev parses cleanly with the flag absent', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.ERASURE_PROCESSOR_ENABLED).toBe('false');
    });

    it('staging accepts the flag off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        ERASURE_PROCESSOR_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('rejects a prod env where ERASURE_PROCESSOR_ENABLED is missing', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/ERASURE_PROCESSOR_ENABLED.*production/i);
      }
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        ERASURE_PROCESSOR_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        ERASURE_PROCESSOR_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error payload mentions the DPDPA / GDPR / statutory framing so the boot trace points ops at the legal exposure', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/DPDPA|GDPR|statutory|erasure/i);
      }
    });

    it('sibling required-on flags still fire independently when only erasure is set', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        ERASURE_PROCESSOR_ENABLED: 'true',
        INTEGRITY_VERIFIER_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('INTEGRITY_VERIFIER_ENABLED');
      }
    });
  });
});
