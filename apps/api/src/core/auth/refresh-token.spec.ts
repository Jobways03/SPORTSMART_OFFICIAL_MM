import 'reflect-metadata';
import { createHash, randomUUID } from 'crypto';
import { hashRefreshToken, mintRawRefreshToken } from './refresh-token';

/**
 * Phase 3 (PR 3.2) — refresh-token hashing primitive.
 *
 * Pins three properties of the hashing function:
 *
 *   1. Output is the canonical SHA-256 hex (64 chars). The Postgres
 *      backfill migration relies on this exact encoding; an
 *      accidental switch to base64 / raw bytes would break every
 *      existing session.
 *   2. Deterministic — same input always yields same output.
 *      Required because lookup is `WHERE refresh_token = hash(input)`.
 *      A salted KDF would defeat O(1) lookup.
 *   3. Different inputs map to different outputs (collision-resistant
 *      under SHA-256). The probability bound is the SHA-256 birthday
 *      bound (~2^128 expected collisions); we just assert that two
 *      adjacent UUIDs don't collide.
 *
 * The runtime tests also serve as living docs — anyone reading these
 * sees the contract without diving into the implementation.
 */

describe('refresh-token hashing (PR 3.2)', () => {
  it('produces a 64-char lowercase hex digest', () => {
    const out = hashRefreshToken('hello-world');
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same input → same output', () => {
    const token = randomUUID();
    const a = hashRefreshToken(token);
    const b = hashRefreshToken(token);
    expect(a).toBe(b);
  });

  it('matches the canonical SHA-256 encoding the migration relies on', () => {
    // Belt-and-braces: encode via Node's crypto directly and compare.
    // If the implementation ever switches to base64 / raw bytes /
    // truncated digest, this test catches it before the migration
    // would be silently incompatible.
    const token = 'fixed-input-for-comparison';
    const direct = createHash('sha256').update(token, 'utf8').digest('hex');
    expect(hashRefreshToken(token)).toBe(direct);
  });

  it('different inputs produce different digests', () => {
    const a = hashRefreshToken(randomUUID());
    const b = hashRefreshToken(randomUUID());
    expect(a).not.toBe(b);
  });

  it('mintRawRefreshToken returns a UUID v4 (36 chars with hyphens)', () => {
    const raw = mintRawRefreshToken();
    expect(raw).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('mint + hash flow is collision-free across N samples', () => {
    const samples = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const raw = mintRawRefreshToken();
      samples.add(hashRefreshToken(raw));
    }
    expect(samples.size).toBe(100);
  });
});
