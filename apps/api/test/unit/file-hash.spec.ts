import 'reflect-metadata';
import {
  hashBuffer,
  hashesEqual,
  HASH_ALGORITHM,
} from '../../src/core/file-integrity/file-hash.util';

/**
 * Phase 7 (PR 7.1) — file integrity hash util.
 *
 * The util is the single source of truth for "what we hash with" —
 * a future shift to BLAKE3 or SHA-3 changes one constant in one file.
 * Pin the algorithm + the comparison branches so a refactor can't
 * silently change it.
 */
describe('file-hash util', () => {
  it('SHA-256 of empty buffer matches well-known constant', () => {
    expect(hashBuffer(Buffer.alloc(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('different buffers produce different hashes', () => {
    expect(hashBuffer(Buffer.from('foo'))).not.toBe(
      hashBuffer(Buffer.from('bar')),
    );
  });

  it('same bytes produce the same hash (idempotent)', () => {
    const a = hashBuffer(Buffer.from('hello world'));
    const b = hashBuffer(Buffer.from('hello world'));
    expect(a).toBe(b);
  });

  it('hashesEqual is case-insensitive on hex', () => {
    expect(hashesEqual('AbCdEf', 'abcdef')).toBe(true);
    expect(hashesEqual('AbCdEf', 'abcdee')).toBe(false);
  });

  it('hashesEqual returns false on null / undefined / empty', () => {
    expect(hashesEqual(null, 'abcd')).toBe(false);
    expect(hashesEqual('abcd', undefined)).toBe(false);
    expect(hashesEqual('abcd', '')).toBe(false);
    expect(hashesEqual(null, null)).toBe(false);
  });

  it('hashesEqual returns false on length mismatch', () => {
    expect(hashesEqual('abcd', 'abcde')).toBe(false);
  });

  it('exposes the algorithm name for the metadata column', () => {
    expect(HASH_ALGORITHM).toBe('sha256');
  });
});
