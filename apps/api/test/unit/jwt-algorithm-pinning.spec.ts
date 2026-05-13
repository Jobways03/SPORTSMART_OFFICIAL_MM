import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 3 (PR 3.1) — JWT algorithm-pinning regression guard.
 *
 * Every `jwt.verify` call site in this codebase MUST pass
 * `JWT_VERIFY_OPTIONS` (or an inline `{ algorithms: [...] }`) so the
 * library is told which algorithm to accept. Without it, jsonwebtoken
 * accepts whatever algorithm the token header declares, which is the
 * "alg=none" / HS-vs-RS confusion attack surface.
 *
 * Every `jwt.sign` call site should also be explicit about the
 * algorithm (defense in depth — the library default is HS256 today,
 * but stating it kills a class of "the library changed defaults"
 * bugs).
 *
 * This test scans the source files. A future PR that copy-pastes a
 * `jwt.verify(token, secret)` without options would fail before
 * landing.
 */

const VERIFY_FILES = [
  'src/core/guards/user-auth.guard.ts',
  'src/core/guards/affiliate-auth.guard.ts',
  'src/core/guards/admin-auth.guard.ts',
  'src/core/guards/any-auth.guard.ts',
  'src/core/guards/seller-auth.guard.ts',
  'src/core/guards/franchise-auth.guard.ts',
];

const SIGN_FILES = [
  'src/modules/seller/application/use-cases/login-seller.use-case.ts',
  'src/modules/identity/application/use-cases/login-user.use-case.ts',
  'src/modules/identity/application/use-cases/refresh-session.use-case.ts',
  'src/modules/admin/application/use-cases/admin-login.use-case.ts',
  'src/modules/admin/application/use-cases/admin-impersonate-seller.use-case.ts',
  'src/modules/franchise/application/use-cases/login-franchise.use-case.ts',
  'src/modules/franchise/application/use-cases/admin-impersonate-franchise.use-case.ts',
  'src/modules/affiliate/application/services/affiliate-auth.service.ts',
];

function read(rel: string): string {
  return readFileSync(join(__dirname, '..', '..', rel), 'utf8');
}

/**
 * Returns true if the file's `jwt.verify(...)` invocations all carry
 * an `algorithms` option (either inline or via `JWT_VERIFY_OPTIONS`).
 *
 * The check is intentionally loose on formatting — TS prettier may
 * reflow the call across lines — but strict on the semantic:
 * "algorithm pinning is somewhere in or near the verify call".
 */
function verifyCallsArePinned(source: string): { ok: boolean; reason?: string } {
  // Capture each `jwt.verify(...)` call body. Greedy enough to span
  // multi-line argument lists. Stops at the closing paren of the
  // outermost call.
  const calls = [...source.matchAll(/jwt\.verify\s*\(([\s\S]*?)\)\s*as\s+[\w<>[\]\s,|.]+/g)];
  if (calls.length === 0) {
    // Some files may use a different pattern (no `as` cast). Fall
    // back to a looser match and re-scan.
    const looser = [...source.matchAll(/jwt\.verify\s*\(([\s\S]*?)\);/g)];
    if (looser.length === 0) {
      return { ok: false, reason: 'no jwt.verify call found in file' };
    }
    for (const m of looser) {
      const args = m[1];
      if (!/JWT_VERIFY_OPTIONS|algorithms\s*:\s*\[/.test(args)) {
        return { ok: false, reason: `unpinned verify: ${args.slice(0, 80)}` };
      }
    }
    return { ok: true };
  }
  for (const m of calls) {
    const args = m[1];
    if (!/JWT_VERIFY_OPTIONS|algorithms\s*:\s*\[/.test(args)) {
      return { ok: false, reason: `unpinned verify: ${args.slice(0, 80)}` };
    }
  }
  return { ok: true };
}

function signCallsArePinned(source: string): { ok: boolean; reason?: string } {
  const calls = [...source.matchAll(/jwt\.sign\s*\(([\s\S]*?)\);/g)];
  if (calls.length === 0) {
    return { ok: false, reason: 'no jwt.sign call found' };
  }
  // Accept either:
  //   - inline `algorithm: 'HS256'`
  //   - the shared `JWT_ALGORITHM` constant (preferred)
  //   - spreading `JWT_SIGN_OPTIONS`
  const pinned = /JWT_SIGN_OPTIONS|algorithm\s*:\s*(?:['"]HS256['"]|JWT_ALGORITHM)/;
  for (const m of calls) {
    const args = m[1];
    if (!pinned.test(args)) {
      return { ok: false, reason: `unpinned sign: ${args.slice(0, 80)}` };
    }
  }
  return { ok: true };
}

describe('JWT algorithm pinning (PR 3.1)', () => {
  describe('jwt.verify call sites', () => {
    it.each(VERIFY_FILES)('%s pins the algorithm', (rel) => {
      const source = read(rel);
      const result = verifyCallsArePinned(source);
      expect(result.ok).toBe(true);
    });
  });

  describe('jwt.sign call sites', () => {
    it.each(SIGN_FILES)('%s pins the algorithm', (rel) => {
      const source = read(rel);
      const result = signCallsArePinned(source);
      expect(result.ok).toBe(true);
    });
  });

  it('the shared constants file exports HS256 as the chosen algorithm', () => {
    const source = read('src/core/auth/jwt-constants.ts');
    expect(source).toMatch(/JWT_ALGORITHM\s*=\s*'HS256'/);
    expect(source).toMatch(/algorithms:\s*\[JWT_ALGORITHM\]/);
    expect(source).toMatch(/algorithm:\s*JWT_ALGORITHM/);
  });
});
