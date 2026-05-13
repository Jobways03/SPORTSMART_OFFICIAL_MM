import { envSchema } from '../../src/bootstrap/env/env.schema';

/**
 * Phase 2 (PR 2.5) — env-level safety interlocks for the outbox.
 *
 * Misconfigured combinations that would silently drop events MUST
 * fail at boot, not at runtime. These tests pin the boot-time
 * refusal behaviour so a future env-schema refactor can't regress it.
 */
describe('outbox env safety interlocks', () => {
  // Minimal viable env so other validators don't fire and obscure
  // the interlock errors we're testing.
  const baseEnv = (): Record<string, string> => ({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    // Phase 3 (PR 3.5) — distinct per actor scope; the schema now
    // enforces pairwise uniqueness.
    JWT_CUSTOMER_SECRET: 'c'.repeat(40),
    JWT_SELLER_SECRET: 's'.repeat(40),
    JWT_FRANCHISE_SECRET: 'f'.repeat(40),
    JWT_ADMIN_SECRET: 'a'.repeat(40),
    JWT_AFFILIATE_SECRET: 'p'.repeat(40),
    AFFILIATE_ENCRYPTION_KEY: 'k'.repeat(40),
    JWT_REFRESH_SECRET: 'r'.repeat(40),
  });

  it('AUTHORITATIVE=true alone fails fast (no publisher to drain)', () => {
    expect(() =>
      envSchema.parse({
        ...baseEnv(),
        OUTBOX_AUTHORITATIVE: 'true',
        OUTBOX_ENABLED: 'false',
        OUTBOX_DUAL_WRITE: 'false',
      }),
    ).toThrow(/OUTBOX_AUTHORITATIVE=true requires OUTBOX_ENABLED=true/);
  });

  it('AUTHORITATIVE=true with ENABLED=true but DUAL_WRITE=false fails fast (no writer)', () => {
    expect(() =>
      envSchema.parse({
        ...baseEnv(),
        OUTBOX_AUTHORITATIVE: 'true',
        OUTBOX_ENABLED: 'true',
        OUTBOX_DUAL_WRITE: 'false',
      }),
    ).toThrow(/OUTBOX_AUTHORITATIVE=true requires OUTBOX_DUAL_WRITE=true/);
  });

  it('AUTHORITATIVE=true with both ENABLED + DUAL_WRITE accepted', () => {
    expect(() =>
      envSchema.parse({
        ...baseEnv(),
        OUTBOX_AUTHORITATIVE: 'true',
        OUTBOX_ENABLED: 'true',
        OUTBOX_DUAL_WRITE: 'true',
      }),
    ).not.toThrow();
  });

  it('legacy state — all flags off — still boots', () => {
    expect(() => envSchema.parse(baseEnv())).not.toThrow();
  });

  it('dual-write soak (DUAL_WRITE=true, AUTHORITATIVE=false) accepted', () => {
    expect(() =>
      envSchema.parse({
        ...baseEnv(),
        OUTBOX_ENABLED: 'true',
        OUTBOX_DUAL_WRITE: 'true',
        OUTBOX_AUTHORITATIVE: 'false',
      }),
    ).not.toThrow();
  });
});
