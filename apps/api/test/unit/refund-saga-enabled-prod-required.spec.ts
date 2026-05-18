import 'reflect-metadata';
import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 6 (PR 6.14) — `REFUND_SAGA_ENABLED` must be true in prod.
 *
 * `RefundSagaService.execute` is the orchestration entry point for
 * every refund the API issues (ADR-009). Two execution paths:
 *
 *   Flag ON (saga path):
 *     - Opens a `refund_sagas` row in STARTED with each step PENDING.
 *     - Persists step transitions as they advance.
 *     - On step failure, runs compensations AND records the failure
 *       reason + last-step on the saga row.
 *     - A crash mid-flow leaves a resumable row: the saga sweeper
 *       (PR 5.x cron) picks it up and either retries or finishes the
 *       compensation walk.
 *
 *   Flag OFF (`runWithoutSaga` legacy path):
 *     - Runs steps + compensations directly, no persistence.
 *     - A crash between two steps leaves nothing on disk to recover.
 *       Whatever step has run lands its side-effects (refund instr
 *       created, gateway hit, wallet credited) without the
 *       counter-step ever firing. Manual intervention via finance
 *       tooling is the only mop-up.
 *
 * The flag was added precisely so the saga rewrite could ship in
 * parallel with the legacy code. Soak validates the saga path under
 * real traffic via dual-running, then flip. Off in prod after the
 * saga rewrite has shipped is the worse posture — every crash
 * during a refund leaves a customer with a half-done state.
 *
 * Stays off in dev/test/staging because:
 *   - Many refund tests stub `RefundSagaService` and assert on the
 *     `runWithoutSaga` path's return shape; turning the saga on
 *     forces them to also stub the `refund_sagas` table writes.
 *   - The saga emits events on every transition; CI noise.
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
  // Sibling required-on flags (PR 6.1 – 6.13, 6.15).
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
  ABAC_ENABLED: 'true',
  COD_REFUND_PENDING_ENABLED: 'true',
  MONEY_DUAL_WRITE_ENABLED: 'true',
};

describe('REFUND_SAGA_ENABLED prod policy (PR 6.14)', () => {
  describe('dev / staging — flag default-on (Phase 9 — promoted from off in 2026-05-16)', () => {
    it('dev parses cleanly with the flag absent and inherits the default-on', () => {
      const parsed = envSchema.parse(baseDevEnv);
      expect(parsed.REFUND_SAGA_ENABLED).toBe('true');
    });

    it('staging accepts the flag explicitly off', () => {
      const result = envSchema.safeParse({
        ...baseDevEnv,
        NODE_ENV: 'staging',
        REFUND_SAGA_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('production — flag must be true', () => {
    it('accepts a prod env where REFUND_SAGA_ENABLED is missing (inherits default-on)', () => {
      const result = envSchema.safeParse(baseProdEnv);
      expect(result.success).toBe(true);
    });

    it('rejects a prod env where the flag is explicitly false', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        REFUND_SAGA_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a prod env where the flag is true', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        REFUND_SAGA_ENABLED: 'true',
      });
      expect(result.success).toBe(true);
    });

    it('error payload mentions the saga / orchestration / resumable / ADR-009 framing so the boot trace explains the durability intent', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        REFUND_SAGA_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join('\n');
        expect(messages).toMatch(/saga|orchestra|resumable|compensat|ADR-009/i);
      }
    });

    it('sibling required-on flags still fire independently when only the saga flag is set', () => {
      const result = envSchema.safeParse({
        ...baseProdEnv,
        REFUND_SAGA_ENABLED: 'true',
        ABAC_ENABLED: 'false',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('ABAC_ENABLED');
      }
    });
  });
});
