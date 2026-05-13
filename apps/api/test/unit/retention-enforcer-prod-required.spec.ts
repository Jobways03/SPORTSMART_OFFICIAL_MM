import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.12) — `RETENTION_ENFORCER_ENABLED` must be true in prod.
 *
 * The companion to PR 6.6 (`ERASURE_PROCESSOR_ENABLED`):
 *
 *   - PR 6.6 handles the **reactive** side: a specific customer
 *     exercises their right to erasure, and the queue gets drained
 *     within the statutory window.
 *   - PR 6.12 handles the **proactive** side: data whose retention
 *     purpose has expired must be deleted / archived / redacted even
 *     when no specific erasure request exists. DPDPA Section 8(7)
 *     and GDPR Article 5(1)(e) ("storage limitation") are blanket
 *     obligations independent of any one customer's request.
 *
 * `RetentionEnforcerCron` (instrumented in PR 5.3) runs daily at
 * 03:00, walks every enabled `RetentionPolicy`, finds files older
 * than `retainDays` for the policy's `(resourceType, purpose)`, and
 * applies the action (DELETE / ARCHIVE / REDACT) — but only after
 * `LegalHoldService.check` clears the file so files locked by
 * ongoing litigation / audit / dispute aren't touched.
 *
 * `RETENTION_ENFORCER_DRY_RUN` defaults to true so the first
 * production soak is observe-only — operators flip it off after
 * reviewing the `RetentionExecution` rows. This PR only forces
 * `RETENTION_ENFORCER_ENABLED` so the cron is running and writing
 * dry-run telemetry; the DRY_RUN flag stays an operator-controlled
 * roll-out lever.
 *
 * Off in prod, every retention policy an admin sets up via the admin
 * console is decorative: KYC docs, support photos, return-evidence
 * pictures, expired-listing assets accumulate past their statutory
 * windows, and the runbook query for "what we tried but skipped"
 * returns empty (no `RetentionExecution` rows exist at all).
 *
 * Stays off in dev/test/staging because the daily cadence is
 * irrelevant for ephemeral fixtures, and writing `RetentionExecution`
 * rows from CI noises up dashboards.
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
  // Sibling required-on flags (PR 6.1 – 6.11, 6.13 – 6.15).
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
  ABAC_ENABLED: 'true',
  REFUND_SAGA_ENABLED: 'true',
  COD_REFUND_PENDING_ENABLED: 'true',
  MONEY_DUAL_WRITE_ENABLED: 'true',
};

describe('RETENTION_ENFORCER_ENABLED prod policy (PR 6.12)', () => {
  describe('dev / staging — flag stays default-off', () => {
    it('dev parses cleanly with the flag absent', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.RETENTION_ENFORCER_ENABLED).toBe('false');
    });

    it('staging accepts the flag off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        RETENTION_ENFORCER_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('rejects a prod env where RETENTION_ENFORCER_ENABLED is missing', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/RETENTION_ENFORCER_ENABLED.*production/i);
      }
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        RETENTION_ENFORCER_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true (DRY_RUN remains operator-controlled)', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        RETENTION_ENFORCER_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('the prod gate does NOT force RETENTION_ENFORCER_DRY_RUN off — that stays a manual rollout lever', () => {
      // Explicit test for separation: enabling the cron is required;
      // flipping off the dry-run is not. Operators bring up the cron
      // in observe-only mode, review the RetentionExecution rows,
      // then turn DRY_RUN off when comfortable. Boot must accept all
      // four combinations of (ENABLED=true, DRY_RUN=true/false/absent).
      for (const dryRun of ['true', 'false', undefined]) {
        const env: Record<string, string> = {
          ...baseProdEnv,
          RETENTION_ENFORCER_ENABLED: 'true',
        };
        if (dryRun !== undefined) env.RETENTION_ENFORCER_DRY_RUN = dryRun;
        const result = envSchema.safeParse(env);
        expect(result.success).toBe(true);
      }
    });

    it('error payload mentions the DPDPA / GDPR / retention / storage-limitation framing so the boot trace points ops at the legal exposure', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/DPDPA|GDPR|retention|storage|lifecycle/i);
      }
    });

    it('sibling required-on flags still fire independently when only retention is set', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        RETENTION_ENFORCER_ENABLED: 'true',
        ERASURE_PROCESSOR_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('ERASURE_PROCESSOR_ENABLED');
      }
    });
  });
});
