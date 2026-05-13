import 'reflect-metadata';
import { createHash } from 'crypto';
import { PrismaSessionRepository } from './prisma-session.prisma-repository';

/**
 * Phase 3 (PR 3.6) — repo plumbing for refresh-token reuse detection.
 *
 * Two new contracts on the session repo:
 *
 *   1. `rotateRefreshToken` MUST move the current `refreshToken` hash
 *      into the `previousRefreshTokenHash` slot before overwriting
 *      with the new hash. Otherwise the burned-token detection has
 *      no historical signal to fire on.
 *
 *   2. `findByPreviousRefreshToken(raw)` hashes the input and queries
 *      the previous-hash column. The use-case calls this only when
 *      the primary lookup misses, so the secondary read is a
 *      bounded extra cost on the (rare) reuse path.
 */

const sha256hex = (s: string) =>
  createHash('sha256').update(s, 'utf8').digest('hex');

function buildPrismaMock() {
  return {
    session: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      // We need both the current state AND the update result; capture
      // the actual call args so the test can inspect the data shape.
      update: jest.fn().mockResolvedValue({ id: 's-1' }),
      updateMany: jest.fn(),
    },
  } as any;
}

describe('PrismaSessionRepository — reuse detection plumbing (PR 3.6)', () => {
  describe('rotateRefreshToken — moves current hash into previous slot', () => {
    it('reads the current `refreshToken` hash from the row, then writes new + stashes previous in a single update', async () => {
      const prisma = buildPrismaMock();
      // The repo needs to know the current hash to stash it. The
      // simplest implementation is `findUnique` first, then `update`.
      // The mocked findUnique returns the existing session row with
      // its current hash.
      prisma.session.findUnique = jest.fn().mockResolvedValue({
        id: 's-1',
        refreshToken: 'CURRENT_HASH',
        previousRefreshTokenHash: 'older-hash-or-null',
      });
      const repo = new PrismaSessionRepository(prisma);

      const newRaw = 'new-token-aaa-bbb';
      const newExpiresAt = new Date('2027-01-01T00:00:00Z');
      await repo.rotateRefreshToken('s-1', newRaw, newExpiresAt);

      expect(prisma.session.update).toHaveBeenCalledTimes(1);
      const updateArgs = prisma.session.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 's-1' });
      // Stashed: the current hash becomes the previous hash.
      expect(updateArgs.data.previousRefreshTokenHash).toBe('CURRENT_HASH');
      // New: the freshly-rotated token's hash overwrites the current slot.
      expect(updateArgs.data.refreshToken).toBe(sha256hex(newRaw));
      expect(updateArgs.data.expiresAt).toEqual(newExpiresAt);
    });

    it('on first rotation (no prior previous-hash) stashes the current hash anyway', async () => {
      const prisma = buildPrismaMock();
      prisma.session.findUnique = jest.fn().mockResolvedValue({
        id: 's-1',
        refreshToken: 'FIRST_CURRENT_HASH',
        previousRefreshTokenHash: null,
      });
      const repo = new PrismaSessionRepository(prisma);

      await repo.rotateRefreshToken('s-1', 'second-token', new Date('2027-01-01'));

      const updateArgs = prisma.session.update.mock.calls[0][0];
      expect(updateArgs.data.previousRefreshTokenHash).toBe('FIRST_CURRENT_HASH');
    });
  });

  describe('findByPreviousRefreshToken — secondary lookup on the burned-hash slot', () => {
    it('hashes the incoming raw token and queries the previous-hash column', async () => {
      const prisma = buildPrismaMock();
      prisma.session.findFirst = jest.fn().mockResolvedValue({ id: 's-1' });
      const repo = new PrismaSessionRepository(prisma);

      const raw = 'burned-token-raw';
      await repo.findByPreviousRefreshToken(raw);

      expect(prisma.session.findFirst).toHaveBeenCalledTimes(1);
      const where = prisma.session.findFirst.mock.calls[0][0].where;
      expect(where.previousRefreshTokenHash).toBe(sha256hex(raw));
      // Must NOT also match on the current-hash column — that would
      // double-count and break the use-case's "primary missed,
      // secondary hit ⇒ reuse" distinguisher.
      expect(where.refreshToken).toBeUndefined();
    });

    it('returns null when the burned-hash slot doesn\'t match either', async () => {
      const prisma = buildPrismaMock();
      prisma.session.findFirst = jest.fn().mockResolvedValue(null);
      const repo = new PrismaSessionRepository(prisma);

      const result = await repo.findByPreviousRefreshToken('not-in-db');
      expect(result).toBeNull();
    });
  });
});
