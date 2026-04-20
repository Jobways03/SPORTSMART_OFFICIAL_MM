import 'reflect-metadata';
import { guardNotProd } from '../../prisma/scripts/guard-not-prod';

/**
 * Regression test for the destructive-DB-script prod guard.
 *
 * Before: `pnpm db:reset` invoked `prisma migrate reset --force`
 * directly, which drops the whole database without a second prompt.
 * If a dev terminal still had the prod DATABASE_URL in scope (e.g. a
 * leaked `.env`, an ops session that forgot to switch contexts) the
 * script would gladly nuke production. Near-miss waiting to happen.
 *
 * After: every destructive db:* script short-circuits through
 * guardNotProd first and aborts when NODE_ENV=production. It's a
 * last-line check, not a replacement for not giving dev machines prod
 * credentials in the first place.
 */

describe('guardNotProd — destructive DB script gate', () => {
  it('throws a clear error when NODE_ENV=production', () => {
    expect(() => guardNotProd('production')).toThrow(
      /Refusing to run destructive DB script/i,
    );
  });

  it('returns silently for development', () => {
    expect(() => guardNotProd('development')).not.toThrow();
  });

  it('returns silently for test / staging', () => {
    expect(() => guardNotProd('test')).not.toThrow();
    expect(() => guardNotProd('staging')).not.toThrow();
  });

  it('returns silently when NODE_ENV is unset', () => {
    // Unset is the default on a fresh dev shell; must not block.
    expect(() => guardNotProd(undefined)).not.toThrow();
  });

  it('is case-sensitive — "Production" does not trigger the guard', () => {
    // NODE_ENV is convention-lowercase everywhere in the repo. We
    // deliberately don't normalise here because a mixed-case value
    // signals a misconfigured env and should surface elsewhere, not
    // be silently treated as prod.
    expect(() => guardNotProd('Production')).not.toThrow();
  });
});
