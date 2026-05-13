import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.13) — `ABAC_ENABLED` must be true in prod.
 *
 * The policy evaluator runs in two modes today:
 *
 *   Soak (`ABAC_ENABLED=false` — current default):
 *     - DENY policies still throw (sharp tools always armed).
 *     - No matching ALLOW → request goes through with an audit log
 *       line carrying `wouldHaveBlocked=true`. Operators read those
 *       lines to discover missing-coverage routes BEFORE flipping
 *       strict mode.
 *
 *   Strict (`ABAC_ENABLED=true`):
 *     - DENY policies throw.
 *     - No matching ALLOW + the route has @Policy → DENY.
 *     - Routes without @Policy are unaffected.
 *
 * The soak phase is the rollout tool. Once it's done — i.e. every
 * @Policy-decorated route has a confirmed ALLOW rule that covers its
 * legitimate callers — `ABAC_ENABLED=false` in prod is the worse
 * configuration: a misconfigured policy or a new route added without
 * the right @Policy rules silently allows traffic, and the
 * fail-closed semantics that ABAC was built for are voided.
 *
 * This gate forces "prod runs fail-closed" as the durable invariant.
 * The presumption is that the soak's `wouldHaveBlocked=true` audit
 * lines have already driven policy coverage to completeness;
 * shipping a prod that hasn't completed soak is the operator's
 * problem to catch in pre-deployment review.
 *
 * Stays off in dev / test / staging because:
 *   - Local development surfaces partial @Policy rule coverage as
 *     normal during feature work — denying every uncovered request
 *     would just be friction.
 *   - The audit-readiness controller (`admin-authz-readiness`)
 *     EXISTS specifically to consume `wouldHaveBlocked=true` log
 *     lines from staging; flipping strict there would mask the
 *     signal the controller depends on.
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
  // Sibling required-on flags (PR 6.1 – 6.12, 6.14, 6.15).
  CRON_HEARTBEAT_ENABLED: 'true',
  SLA_BREACH_DETECTOR_ENABLED: 'true',
  AUDIT_CHAIN_ANCHOR_ENABLED: 'true',
  IDEMPOTENCY_ENABLED: 'true',
  INTEGRITY_VERIFIER_ENABLED: 'true',
  ERASURE_PROCESSOR_ENABLED: 'true',
  WALLET_LEDGER_RECON_ENABLED: 'true',
  EVENT_DEDUP_ENABLED: 'true',
  OUTBOX_ENABLED: 'true',
  OUTBOX_DUAL_WRITE: 'true',
  REFUND_GATEWAY_RECON_ENABLED: 'true',
  RETENTION_ENFORCER_ENABLED: 'true',
  REFUND_SAGA_ENABLED: 'true',
  COD_REFUND_PENDING_ENABLED: 'true',
  MONEY_DUAL_WRITE_ENABLED: 'true',
};

describe('ABAC_ENABLED prod policy (PR 6.13)', () => {
  describe('dev / test / staging — flag stays default-off so the soak signal stays observable', () => {
    it('dev parses cleanly with the flag absent', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.ABAC_ENABLED).toBe('false');
    });

    it('staging accepts the flag off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        ABAC_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });

    it('dev also accepts the flag on for local strict-mode testing', () => {
      // Explicit acceptance: a developer running locally MIGHT want
      // to mirror prod and verify their @Policy coverage. The gate
      // is "prod requires on", not "non-prod requires off".
      const result = envSchema.safeParse({
        ...baseDevEnv,
        ABAC_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true (fail-closed)', () => {
    it('rejects a prod env where ABAC_ENABLED is missing', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/ABAC_ENABLED.*production/i);
      }
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        ABAC_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        ABAC_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error payload mentions the fail-closed / soak / strict framing so the boot trace explains the rollout prerequisite', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/fail-closed|soak|strict|policy|@Policy/i);
      }
    });

    it('sibling required-on flags still fire independently when only ABAC is set', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        ABAC_ENABLED: 'true',
        RETENTION_ENFORCER_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('RETENTION_ENFORCER_ENABLED');
      }
    });
  });
});
