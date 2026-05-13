import 'reflect-metadata';
import { createHash } from 'crypto';
import { PrismaSessionRepository } from './prisma-session.prisma-repository';

/**
 * Phase 3 (PR 3.2) — repo hashes refresh tokens at every storage boundary.
 *
 * The repo is the only conversion point: callers continue to pass
 * raw tokens, the DB only ever sees the SHA-256 hash. These tests
 * mock Prisma and assert the hash actually reaches the query.
 *
 * Coverage:
 *   - createSession: stored value is hash(raw), not raw.
 *   - findByRefreshToken: lookup queries hash(input), not input.
 *   - rotateRefreshToken: new token is hashed before write.
 *
 * If a future refactor accidentally drops one of these hash calls,
 * the corresponding test catches it before the raw token leaks into
 * a Prisma write or a query predicate.
 */

const sha256hex = (s: string) =>
  createHash('sha256').update(s, 'utf8').digest('hex');

function buildPrismaMock() {
  return {
    session: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 's-1' }),
      update: jest.fn().mockResolvedValue({ id: 's-1' }),
      updateMany: jest.fn(),
    },
  } as any;
}

describe('PrismaSessionRepository — refresh-token hashing (PR 3.2)', () => {
  it('createSession stores the SHA-256 of the raw token, never the raw value', async () => {
    const prisma = buildPrismaMock();
    const repo = new PrismaSessionRepository(prisma);

    const rawToken = 'a1b2c3d4-aaaa-bbbb-cccc-deadbeefdead';
    await repo.createSession({
      userId: 'u-1',
      refreshToken: rawToken,
      userAgent: 'spec',
      ipAddress: '127.0.0.1',
      expiresAt: new Date('2026-12-31T00:00:00Z'),
    });

    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    const written = prisma.session.create.mock.calls[0][0].data;
    expect(written.refreshToken).toBe(sha256hex(rawToken));
    expect(written.refreshToken).not.toBe(rawToken);
  });

  it('findByRefreshToken queries the DB with hash(input), never the raw input', async () => {
    const prisma = buildPrismaMock();
    const repo = new PrismaSessionRepository(prisma);

    const incoming = 'fffffff-1111-2222-3333-444444444444';
    await repo.findByRefreshToken(incoming);

    expect(prisma.session.findFirst).toHaveBeenCalledTimes(1);
    const where = prisma.session.findFirst.mock.calls[0][0].where;
    expect(where.refreshToken).toBe(sha256hex(incoming));
    expect(where.refreshToken).not.toBe(incoming);
  });

  it('rotateRefreshToken hashes the new token before persisting', async () => {
    const prisma = buildPrismaMock();
    const repo = new PrismaSessionRepository(prisma);

    const newRaw = '11111111-2222-3333-4444-555555555555';
    await repo.rotateRefreshToken('sess-1', newRaw, new Date('2026-12-31T00:00:00Z'));

    expect(prisma.session.update).toHaveBeenCalledTimes(1);
    const data = prisma.session.update.mock.calls[0][0].data;
    expect(data.refreshToken).toBe(sha256hex(newRaw));
    expect(data.refreshToken).not.toBe(newRaw);
  });

  it('end-to-end: a raw token that was hashed on createSession is findable by passing the same raw token', async () => {
    // Simulates the production round-trip:
    //   1. Login mints a raw token, stores hash(raw).
    //   2. Client sends the raw token on refresh.
    //   3. Repo hashes the incoming raw token; lookup matches the
    //      stored hash. The session is found.
    //
    // The Prisma mock here checks that `create.data.refreshToken ===
    // findFirst.where.refreshToken` — i.e. the round-trip hashes match.
    const prisma = buildPrismaMock();
    const repo = new PrismaSessionRepository(prisma);

    const raw = '99999999-eeee-dddd-cccc-bbbbbbbbbbbb';
    await repo.createSession({
      userId: 'u-1',
      refreshToken: raw,
      userAgent: null,
      ipAddress: null,
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    await repo.findByRefreshToken(raw);

    const stored = prisma.session.create.mock.calls[0][0].data.refreshToken;
    const queried = prisma.session.findFirst.mock.calls[0][0].where.refreshToken;
    expect(stored).toBe(queried);
  });
});
