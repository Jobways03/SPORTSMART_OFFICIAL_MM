import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.5) — `INTEGRITY_VERIFIER_ENABLED` must be true in prod.
 *
 * The `IntegrityVerifierCron` (instrumented in PR 5.3) is the only
 * mechanism in the codebase that catches silent file tampering. Every
 * hour it walks `fileMetadata` rows in `READY` status, re-downloads
 * each object from its provider (media / S3), recomputes the
 * SHA-256, and compares it with `contentSha256`. Mismatch ⇒
 * `file.integrity.violation` event ⇒ ops alert.
 *
 * The covered surface is broad and high-stakes:
 *   - KYC docs (PAN cards, GST certificates) — tampering here lets a
 *     malicious actor swap an approved seller's documents post-hoc.
 *   - Invoices and tax filings — silent edits change tax liability.
 *   - Return-evidence photos — swap-out lets a fraudulent claim
 *     survive review.
 *   - Product catalog assets — image swap to NSFW / counterfeit.
 *
 * Off in prod, none of those land an alert. The cron also performs
 * the lazy backfill of SHA hashes for files predating the hashing
 * infra; off ⇒ the backfill never completes ⇒ a growing fraction of
 * files have no integrity baseline at all.
 *
 * Stays off in dev/test/staging because the recompute does a per-byte
 * download of every READY file in the fixture set, which is expensive
 * and meaningless against pristine seed data.
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
  R2_ACCOUNT_ID: 'x',
  R2_BUCKET: 'media',
  R2_ACCESS_KEY_ID: 'x',
  R2_SECRET_ACCESS_KEY: 'x',
  ADMIN_MFA_ENCRYPTION_KEY: 'k'.repeat(32),
  APP_URL: 'https://api.example.com',
  CORS_ORIGINS: 'https://app.example.com',
  // Sibling required-on flags (PR 6.1 – 6.4, 6.6 – 6.15).
  CRON_HEARTBEAT_ENABLED: 'true',
  SLA_BREACH_DETECTOR_ENABLED: 'true',
  AUDIT_CHAIN_ANCHOR_ENABLED: 'true',
  IDEMPOTENCY_ENABLED: 'true',
  ERASURE_PROCESSOR_ENABLED: 'true',
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

describe('INTEGRITY_VERIFIER_ENABLED prod policy (PR 6.5)', () => {
  describe('dev / staging — flag stays default-off', () => {
    it('dev parses cleanly with the flag absent', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.INTEGRITY_VERIFIER_ENABLED).toBe('false');
    });

    it('staging accepts the flag off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        INTEGRITY_VERIFIER_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('rejects a prod env where INTEGRITY_VERIFIER_ENABLED is missing', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/INTEGRITY_VERIFIER_ENABLED.*production/i);
      }
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        INTEGRITY_VERIFIER_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        INTEGRITY_VERIFIER_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error payload mentions the tamper-detection / hash-mismatch concern so the boot log is self-documenting', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/tamper|hash|integrity|SHA/i);
      }
    });

    it('sibling required-on flags still fire independently when only the integrity flag is set', () => {
      // Defensive: the new entry must not mask the prior ones.
      const result = envSchema.safeParse({
        ...baseProdEnv,
        INTEGRITY_VERIFIER_ENABLED: 'true',
        IDEMPOTENCY_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('IDEMPOTENCY_ENABLED');
      }
    });
  });
});
