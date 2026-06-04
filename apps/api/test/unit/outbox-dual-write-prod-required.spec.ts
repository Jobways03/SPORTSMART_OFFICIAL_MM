import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.10) — `OUTBOX_DUAL_WRITE` must be true in prod.
 *
 * PR 6.9 ensures the publisher worker is running. This PR ensures the
 * events actually reach the outbox in the first place.
 *
 * `OUTBOX_DUAL_WRITE=true` makes `EventBusService` write the outbox
 * row transactionally AND emit on the in-process bus for backward
 * compatibility. Without it, the legacy direct-bus path runs alone:
 * a process crash between "handler started" and "handler finished"
 * drops the event entirely — exactly the failure ADR-008 was built
 * to close.
 *
 * The two prior PRs together (6.9 + 6.10) make every prod boot at
 * minimum in soak mode (DUAL_WRITE + ENABLED). `OUTBOX_AUTHORITATIVE`
 * stays optional in prod: the existing PR-2.5 interlock already
 * requires that AUTHORITATIVE implies DUAL_WRITE (and ENABLED), so
 * flipping AUTHORITATIVE on later is a clean cutover from soak to
 * outbox-only — the operator opts in when consumers are confirmed
 * reading from the publisher path.
 *
 * Stays off in dev/test/staging because:
 *   - The outbox write doubles per-event database load — pointless
 *     for ephemeral fixture data.
 *   - Many tests run in-process and stub the publisher; turning on
 *     dual-write surfaces unrelated outbox-row assertions that the
 *     tests don't care about.
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
  // Sibling required-on flags (PR 6.1 – 6.9, 6.11 – 6.15).
  CRON_HEARTBEAT_ENABLED: 'true',
  SLA_BREACH_DETECTOR_ENABLED: 'true',
  AUDIT_CHAIN_ANCHOR_ENABLED: 'true',
  IDEMPOTENCY_ENABLED: 'true',
  INTEGRITY_VERIFIER_ENABLED: 'true',
  ERASURE_PROCESSOR_ENABLED: 'true',
  WALLET_LEDGER_RECON_ENABLED: 'true',
  EVENT_DEDUP_ENABLED: 'true',
  OUTBOX_ENABLED: 'true',
  REFUND_GATEWAY_RECON_ENABLED: 'true',
  RETENTION_ENFORCER_ENABLED: 'true',
  ABAC_ENABLED: 'true',
  REFUND_SAGA_ENABLED: 'true',
  COD_REFUND_PENDING_ENABLED: 'true',
  MONEY_DUAL_WRITE_ENABLED: 'true',
};

describe('OUTBOX_DUAL_WRITE prod policy (PR 6.10)', () => {
  describe('dev / staging — flag stays default-off', () => {
    it('dev parses cleanly with the flag absent', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.OUTBOX_DUAL_WRITE).toBe('false');
    });

    it('staging accepts the flag off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        OUTBOX_DUAL_WRITE: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('rejects a prod env where OUTBOX_DUAL_WRITE is missing', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/OUTBOX_DUAL_WRITE.*production/i);
      }
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        OUTBOX_DUAL_WRITE: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true (soak mode)', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        OUTBOX_DUAL_WRITE: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a prod env where both DUAL_WRITE and AUTHORITATIVE are true (post-cutover)', () => {
      // The existing PR-2.5 interlock requires AUTHORITATIVE imply
      // DUAL_WRITE + ENABLED. The PR-6.9 + 6.10 prod gates require
      // DUAL_WRITE + ENABLED. Setting all three is the valid
      // post-cutover end-state.
      const result = envSchema.safeParse({
        ...baseProdEnv,
        OUTBOX_DUAL_WRITE: 'true',
        OUTBOX_AUTHORITATIVE: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error payload mentions the dual-write / crash-safety / in-process framing so the boot trace explains the rollout intent', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/dual-write|crash|in-process|outbox/i);
      }
    });

    it('the PR-6.9 OUTBOX_ENABLED gate still fires independently when only DUAL_WRITE is set', () => {
      // Defensive: PR 6.9 and PR 6.10 together form the soak-mode
      // contract. Setting DUAL_WRITE without ENABLED must still
      // reject for the ENABLED reason; the new gate doesn't mask
      // the prior one.
      const result = envSchema.safeParse({
        ...baseProdEnv,
        OUTBOX_DUAL_WRITE: 'true',
        OUTBOX_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('OUTBOX_ENABLED');
      }
    });
  });
});
