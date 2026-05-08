import 'reflect-metadata';
import { matchesConditions } from '../../src/core/authorization/policy-condition.matcher';

/**
 * Phase 4 (PR 4.3) — ResourcePolicy condition matcher.
 *
 * The matcher is the trust boundary for ABAC: a buggy operator here
 * could let a Tier-1 admin run a ₹1Cr refund. Pin each operator and
 * each fail-closed branch.
 */
describe('matchesConditions', () => {
  it('null/empty conditions match everything', () => {
    expect(matchesConditions(null, {})).toBe(true);
    expect(matchesConditions(undefined, { a: 1 })).toBe(true);
    expect(matchesConditions({}, { a: 1 })).toBe(true);
  });

  it('scalar value uses strict equality', () => {
    expect(matchesConditions({ method: 'WALLET' }, { method: 'WALLET' })).toBe(true);
    expect(matchesConditions({ method: 'WALLET' }, { method: 'UPI' })).toBe(false);
    expect(matchesConditions({ count: 0 }, { count: 0 })).toBe(true);
    expect(matchesConditions({ count: 0 }, { count: '0' as any })).toBe(false);
  });

  it('$lte caps numeric amounts (the ₹10k example)', () => {
    const cap = { amountInPaise: { $lte: 1_000_000 } };
    expect(matchesConditions(cap, { amountInPaise: 999_999 })).toBe(true);
    expect(matchesConditions(cap, { amountInPaise: 1_000_000 })).toBe(true);
    expect(matchesConditions(cap, { amountInPaise: 1_000_001 })).toBe(false);
  });

  it('non-numeric actual on numeric operator fails closed', () => {
    expect(
      matchesConditions(
        { amountInPaise: { $lte: 1_000_000 } },
        { amountInPaise: 'lots' as any },
      ),
    ).toBe(false);
    expect(
      matchesConditions(
        { amountInPaise: { $lte: 1_000_000 } },
        { amountInPaise: undefined },
      ),
    ).toBe(false);
  });

  it('$gt / $gte / $lt obey strict inequality', () => {
    expect(matchesConditions({ x: { $gt: 10 } }, { x: 11 })).toBe(true);
    expect(matchesConditions({ x: { $gt: 10 } }, { x: 10 })).toBe(false);
    expect(matchesConditions({ x: { $gte: 10 } }, { x: 10 })).toBe(true);
    expect(matchesConditions({ x: { $lt: 10 } }, { x: 9 })).toBe(true);
    expect(matchesConditions({ x: { $lt: 10 } }, { x: 10 })).toBe(false);
  });

  it('$in / $nin check membership', () => {
    expect(
      matchesConditions(
        { method: { $in: ['WALLET', 'UPI'] } },
        { method: 'UPI' },
      ),
    ).toBe(true);
    expect(
      matchesConditions(
        { method: { $in: ['WALLET', 'UPI'] } },
        { method: 'CARD' },
      ),
    ).toBe(false);
    expect(
      matchesConditions(
        { method: { $nin: ['MANUAL'] } },
        { method: 'UPI' },
      ),
    ).toBe(true);
    expect(
      matchesConditions(
        { method: { $nin: ['MANUAL'] } },
        { method: 'MANUAL' },
      ),
    ).toBe(false);
  });

  it('$ne checks inequality', () => {
    expect(matchesConditions({ x: { $ne: 'A' } }, { x: 'B' })).toBe(true);
    expect(matchesConditions({ x: { $ne: 'A' } }, { x: 'A' })).toBe(false);
  });

  it('$exists honours both true and false', () => {
    expect(matchesConditions({ x: { $exists: true } }, { x: 1 })).toBe(true);
    expect(matchesConditions({ x: { $exists: true } }, {})).toBe(false);
    expect(matchesConditions({ x: { $exists: false } }, {})).toBe(true);
    expect(matchesConditions({ x: { $exists: false } }, { x: 1 })).toBe(false);
  });

  it('multiple keys are AND-combined', () => {
    const cond = {
      amountInPaise: { $lte: 1_000_000 },
      method: { $in: ['WALLET', 'UPI'] },
    };
    expect(
      matchesConditions(cond, { amountInPaise: 500_000, method: 'WALLET' }),
    ).toBe(true);
    expect(
      matchesConditions(cond, { amountInPaise: 500_000, method: 'CARD' }),
    ).toBe(false);
    expect(
      matchesConditions(cond, { amountInPaise: 2_000_000, method: 'WALLET' }),
    ).toBe(false);
  });

  it('unknown operator on a key fails closed', () => {
    expect(
      matchesConditions(
        { x: { $regex: 'foo' } as any } as any,
        { x: 'foo' },
      ),
    ).toBe(false);
  });
});
