import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 3 (PR 3.2) — refresh-token hashing source-scan regression guard.
 *
 * Every repository that writes a `refreshToken` column MUST call
 * `hashRefreshToken` before passing the value to Prisma. A future
 * copy-paste that goes `data: { refreshToken: rawToken }` would
 * silently re-introduce the plaintext-at-rest bug.
 *
 * Strategy: open the four session repos, grep for `refreshToken:`
 * inside write operations (create / update), assert the value
 * passed to Prisma is `hashRefreshToken(...)` rather than a raw
 * identifier.
 *
 * The migration SQL is also pinned — `digest(..., 'sha256')` and the
 * idempotency guard `length(...) <> 64`.
 */

const SESSION_REPO_FILES = [
  'src/modules/identity/infrastructure/repositories/prisma-session.prisma-repository.ts',
  'src/modules/admin/infrastructure/repositories/prisma-admin.repository.ts',
  'src/modules/seller/infrastructure/repositories/prisma-seller.repository.ts',
  'src/modules/franchise/infrastructure/repositories/prisma-franchise.repository.ts',
];

function read(rel: string): string {
  return readFileSync(join(__dirname, '..', '..', rel), 'utf8');
}

describe('Refresh-token hashing — source-scan invariants (PR 3.2)', () => {
  describe('each session repo imports the hash helper and uses it in writes', () => {
    it.each(SESSION_REPO_FILES)('%s imports hashRefreshToken', (rel) => {
      const source = read(rel);
      expect(source).toMatch(
        /import\s+\{[^}]*hashRefreshToken[^}]*\}\s+from\s+['"][^'"]*core\/auth\/refresh-token['"]/,
      );
    });

    it.each(SESSION_REPO_FILES)('%s wraps every refreshToken write through hashRefreshToken', (rel) => {
      const source = read(rel);

      // Find every appearance of `refreshToken:` that looks like a
      // value assignment (followed by a value, not a TS type). Two
      // shapes appear in the codebase:
      //
      //   refreshToken: hashRefreshToken(data.refreshToken)   ← own-line
      //   data: { ...data, refreshToken: hashRefreshToken(...) }   ← spread
      //
      // We capture each substring `refreshToken: <until-comma-or-close>`
      // and reject any that does NOT immediately call hashRefreshToken,
      // ignoring the TS type-declaration lines (value is a primitive).
      const writes = [...source.matchAll(/refreshToken\s*:\s*([^,}\n;]+)/g)]
        .map((m) => m[1].trim())
        .filter(
          (value) =>
            // Exclude type-declaration RHS values like `string`, `Date`,
            // `number`. Also exclude Prisma `select: { refreshToken: true }`
            // projection markers — those are reads, not writes.
            !/^(?:string|Date|number|boolean|true|false)\b/.test(value),
        );

      expect(writes.length).toBeGreaterThan(0);

      for (const value of writes) {
        const ok = /^hashRefreshToken\s*\(/.test(value);
        expect({ rel, value, ok }).toEqual(
          expect.objectContaining({ ok: true }),
        );
      }
    });
  });

  describe('identity repo uses the helper on lookup too (refresh-rotation path)', () => {
    it('findByRefreshToken hashes the incoming token before querying', () => {
      const source = read(SESSION_REPO_FILES[0]);
      // The lookup must call hashRefreshToken(refreshToken) — not pass
      // the raw token into the where clause.
      expect(source).toMatch(
        /where:\s*\{\s*refreshToken:\s*hashRefreshToken\s*\(\s*refreshToken\s*\)\s*\}/,
      );
    });
  });

  describe('Migration SQL', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'prisma',
        'schema',
        'migrations',
        '20260512170000_hash_refresh_tokens_at_rest',
        'migration.sql',
      ),
      'utf8',
    );

    it('enables pgcrypto idempotently', () => {
      expect(sql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pgcrypto/i);
    });

    it('hashes via SHA-256 + hex encoding (not base64, not raw)', () => {
      const hashCalls = [...sql.matchAll(/digest\s*\(\s*"refresh_token"\s*,\s*'sha256'\s*\)/gi)];
      expect(hashCalls.length).toBe(4);
      const encodeCalls = [...sql.matchAll(/encode\s*\(\s*digest\s*\([^)]+\)\s*,\s*'hex'\s*\)/gi)];
      expect(encodeCalls.length).toBe(4);
    });

    it('is idempotent — re-runs skip already-hashed (length 64) rows', () => {
      // Without the WHERE clause, replaying the migration would
      // double-hash every row and break every session.
      const skipClauses = [
        ...sql.matchAll(/WHERE\s+length\s*\(\s*"refresh_token"\s*\)\s*<>\s*64/gi),
      ];
      expect(skipClauses.length).toBe(4);
    });

    it('targets all four session tables', () => {
      // Match any `UPDATE "<table>"` where the table name ends in
      // `sessions`. Captures the bare `sessions` table too, not just
      // the `*_sessions` variants.
      const tables = [...sql.matchAll(/UPDATE\s+"([a-z_]*sessions)"/g)].map(
        (m) => m[1],
      );
      expect(new Set(tables)).toEqual(
        new Set(['sessions', 'admin_sessions', 'seller_sessions', 'franchise_sessions']),
      );
    });
  });
});
