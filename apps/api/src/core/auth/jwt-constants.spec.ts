import 'reflect-metadata';
import * as jwt from 'jsonwebtoken';
import { JWT_ALGORITHM, JWT_VERIFY_OPTIONS, JWT_SIGN_OPTIONS } from './jwt-constants';

/**
 * Phase 3 (PR 3.1) — runtime behaviour of the pinned algorithm constants.
 *
 * The meta-test in `test/unit/jwt-algorithm-pinning.spec.ts` ensures
 * every call site references `JWT_VERIFY_OPTIONS` / `JWT_ALGORITHM`.
 * This file exercises the actual behaviour: a token signed with a
 * different algorithm (or `alg: 'none'`) must be rejected when verified
 * with the pinned options.
 *
 * Without `algorithms: ['HS256']`, jsonwebtoken would honour whatever
 * `alg` header the token declares — the well-known "alg=none" attack
 * and the HS-vs-RS algorithm-confusion vulnerability. Pinning closes
 * both classes at once.
 */

const TEST_SECRET = 'pr-3-1-test-secret-min-32-chars-long-enough';

describe('JWT pinning runtime behaviour (PR 3.1)', () => {
  it('a token signed with HS256 verifies cleanly under JWT_VERIFY_OPTIONS', () => {
    const token = jwt.sign({ sub: 'u-1' }, TEST_SECRET, JWT_SIGN_OPTIONS);
    const payload = jwt.verify(token, TEST_SECRET, JWT_VERIFY_OPTIONS) as any;
    expect(payload.sub).toBe('u-1');
  });

  it('an alg=none token is REJECTED even though the secret happens to be the empty string', () => {
    // The classic "alg=none" forgery: header { alg: 'none' }, no signature.
    // jsonwebtoken v9+ refuses to sign `none`, so build the token manually.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url');
    const forged = `${header}.${payload}.`;

    expect(() => jwt.verify(forged, TEST_SECRET, JWT_VERIFY_OPTIONS)).toThrow();
  });

  it('a token signed with HS384 is REJECTED under HS256-only pinning', () => {
    // HS-family algorithm-confusion: same shared secret, different MAC.
    // Without pinning, jsonwebtoken would happily accept any HS variant
    // — meaning an attacker who can convince the signer to use a weaker
    // algorithm could craft tokens the verifier still accepts.
    const token = jwt.sign({ sub: 'attacker' }, TEST_SECRET, { algorithm: 'HS384' });
    expect(() => jwt.verify(token, TEST_SECRET, JWT_VERIFY_OPTIONS)).toThrow();
  });

  it('JWT_ALGORITHM resolves to the documented HS256 constant', () => {
    // Sanity check that no future refactor silently flips the algorithm
    // (e.g. to a slower RS variant) without a corresponding key-management
    // change. Phase 3.1 picked HS256 deliberately; a change here must
    // ripple through the docs.
    expect(JWT_ALGORITHM).toBe('HS256');
    expect(JWT_VERIFY_OPTIONS.algorithms).toEqual(['HS256']);
    expect(JWT_SIGN_OPTIONS.algorithm).toBe('HS256');
  });
});
