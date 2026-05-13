import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.3) — `AUDIT_CHAIN_ANCHOR_ENABLED` must be true in prod.
 *
 * The `AuditChainAnchorCron` (instrumented in PR 5.2) runs hourly,
 * computes the Merkle head of new audit_logs rows since the last
 * anchor, and pins it into `audit_chain_anchors`. The anchor table
 * is the load-bearing structure for tamper-evidence: the audit-chain
 * verifier walks forward from the latest anchor, recomputing the
 * Merkle root, and asserts it matches the pinned value.
 *
 * Without `AUDIT_CHAIN_ANCHOR_ENABLED=true`, no anchors are pinned.
 * Verifier-time chain walks become unbounded — a verifier started
 * after 30 days of audit traffic at peak rate must hash every row
 * since boot, which is both slow and (more importantly) gives an
 * attacker a 30-day window where retroactive log tampering goes
 * undetected.
 *
 * Stays off in dev/test/staging because the cron writes
 * `audit_chain_anchors` rows that bloat fixture databases; tests
 * that focus on the chain verifier opt in explicitly.
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
  CORS_ORIGINS: 'https://app.example.com',
  // Sibling required-on flags (PR 6.1, 6.2, 6.4 – 6.15).
  CRON_HEARTBEAT_ENABLED: 'true',
  SLA_BREACH_DETECTOR_ENABLED: 'true',
  IDEMPOTENCY_ENABLED: 'true',
  INTEGRITY_VERIFIER_ENABLED: 'true',
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

describe('AUDIT_CHAIN_ANCHOR_ENABLED prod policy (PR 6.3)', () => {
  describe('dev / staging — flag stays default-off', () => {
    it('dev parses cleanly with the flag absent', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.AUDIT_CHAIN_ANCHOR_ENABLED).toBe('false');
    });

    it('staging accepts the flag off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        AUDIT_CHAIN_ANCHOR_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('rejects a prod env where AUDIT_CHAIN_ANCHOR_ENABLED is missing', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/AUDIT_CHAIN_ANCHOR_ENABLED.*production/i);
      }
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        AUDIT_CHAIN_ANCHOR_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        AUDIT_CHAIN_ANCHOR_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error payload includes the policy reason so ops can read intent from boot logs', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        // The phrase from the policy reason text — keeps the error
        // message stable enough for ops runbook to grep on.
        expect(messages).toMatch(/Merkle anchor|tamper-evidence|chain/i);
      }
    });
  });
});
