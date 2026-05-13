import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 3 (PR 3.6) — `sessions.previous_refresh_token_hash` schema guard.
 *
 * The reuse-detection wiring depends on three artefacts moving in lockstep:
 *
 *   1. The Prisma model declares the column + its index.
 *   2. The migration SQL creates the column + index in Postgres.
 *   3. The repo's `findByPreviousRefreshToken` queries that exact column.
 *
 * Drift in any of these turns the secondary-lookup into a silent
 * always-null and the reuse detection becomes a no-op. The test
 * reads files via fs so the regression guard stays in the unit tier.
 */

const SCHEMA_BASE = join(__dirname, '..', '..', 'prisma', 'schema');

describe('sessions.previousRefreshTokenHash schema invariant (PR 3.6)', () => {
  it('Prisma model declares the previousRefreshTokenHash column', () => {
    const source = readFileSync(join(SCHEMA_BASE, 'identity.prisma'), 'utf8');
    expect(source).toMatch(
      /previousRefreshTokenHash\s+String\?\s+@map\("previous_refresh_token_hash"\)/,
    );
  });

  it('Prisma model declares an index on the new column', () => {
    const source = readFileSync(join(SCHEMA_BASE, 'identity.prisma'), 'utf8');
    expect(source).toMatch(/@@index\(\[previousRefreshTokenHash\]\)/);
  });

  it('migration SQL adds the column with TEXT type, nullable', () => {
    const sql = readFileSync(
      join(
        SCHEMA_BASE,
        'migrations',
        '20260512180000_session_previous_refresh_token_hash',
        'migration.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+"sessions"[\s\S]*ADD\s+COLUMN\s+"previous_refresh_token_hash"\s+TEXT\b/i,
    );
    // Nullable — no NOT NULL on the new column. Older sessions
    // backfill organically on their next rotation.
    expect(sql).not.toMatch(/"previous_refresh_token_hash"\s+TEXT\s+NOT\s+NULL/i);
  });

  it('migration SQL creates an index on the new column', () => {
    const sql = readFileSync(
      join(
        SCHEMA_BASE,
        'migrations',
        '20260512180000_session_previous_refresh_token_hash',
        'migration.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+"sessions_previous_refresh_token_hash_idx"\s+ON\s+"sessions"\s*\(\s*"previous_refresh_token_hash"\s*\)/i,
    );
  });

  it('the repo references the same Prisma field name', () => {
    const source = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'src',
        'modules',
        'identity',
        'infrastructure',
        'repositories',
        'prisma-session.prisma-repository.ts',
      ),
      'utf8',
    );
    // Both the where-clause for the secondary lookup AND the
    // data-clause stash on rotation must use the same camelCase field.
    expect(source).toMatch(/previousRefreshTokenHash:\s*hashRefreshToken/);
    expect(source).toMatch(/previousRefreshTokenHash:\s*current\?\.refreshToken/);
  });
});
