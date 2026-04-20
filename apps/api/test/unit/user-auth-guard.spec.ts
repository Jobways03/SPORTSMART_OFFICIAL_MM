import * as jwt from 'jsonwebtoken';
import { UserAuthGuard } from '../../src/core/guards/user-auth.guard';
import { UnauthorizedAppException } from '../../src/core/exceptions';

/**
 * Tests for UserAuthGuard — Sprint 1 closed two CRITICAL gaps:
 *   1. The guard now checks Session.revokedAt — stolen JWTs are killed at logout.
 *   2. The guard now checks User.status — deactivated accounts can't use old tokens.
 *
 * This spec pins both behaviours so a future change can't silently regress them.
 */

const SECRET = 'unit-test-customer-secret-min16-chars';

const fakeEnv = {
  getString: (key: string) => {
    if (key === 'JWT_CUSTOMER_SECRET') return SECRET;
    return '';
  },
} as any;

const buildContext = (token: string | null) => {
  const request: any = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
};

const buildPrisma = (overrides: {
  session?: any;
  user?: any;
}): any => ({
  session: {
    findUnique: jest.fn().mockResolvedValue(overrides.session ?? null),
  },
  user: {
    findUnique: jest.fn().mockResolvedValue(overrides.user ?? null),
  },
});

const validSession = {
  id: 'sess1',
  userId: 'user1',
  revokedAt: null,
  expiresAt: new Date('2099-01-01'),
};

const activeUser = {
  id: 'user1',
  email: 'a@b.c',
  status: 'ACTIVE',
};

const buildToken = (
  overrides: Partial<{ sub: string; sessionId: string; roles: string[] }> = {},
) =>
  jwt.sign(
    {
      sub: overrides.sub ?? 'user1',
      email: 'a@b.c',
      roles: overrides.roles ?? ['CUSTOMER'],
      sessionId: overrides.sessionId ?? 'sess1',
    },
    SECRET,
    { expiresIn: '1h' },
  );

describe('UserAuthGuard', () => {
  it('rejects requests with no Authorization header', async () => {
    const guard = new UserAuthGuard(fakeEnv, buildPrisma({}));
    await expect(guard.canActivate(buildContext(null))).rejects.toThrow(
      'Authentication required',
    );
  });

  it('rejects requests with a malformed Bearer token', async () => {
    const guard = new UserAuthGuard(fakeEnv, buildPrisma({}));
    await expect(
      guard.canActivate(buildContext('not-a-jwt')),
    ).rejects.toThrow('Invalid or expired token');
  });

  it('rejects a token signed with the wrong secret (cross-actor forgery)', async () => {
    const forged = jwt.sign(
      { sub: 'user1', email: 'a@b.c', roles: ['CUSTOMER'], sessionId: 'sess1' },
      'attacker-secret-min16-chars',
      { expiresIn: '1h' },
    );
    const guard = new UserAuthGuard(fakeEnv, buildPrisma({}));
    await expect(guard.canActivate(buildContext(forged))).rejects.toThrow(
      'Invalid or expired token',
    );
  });

  it('rejects a token without CUSTOMER role', async () => {
    const sellerToken = buildToken({ roles: ['SELLER'] });
    const guard = new UserAuthGuard(fakeEnv, buildPrisma({}));
    await expect(
      guard.canActivate(buildContext(sellerToken)),
    ).rejects.toThrow('Invalid customer token');
  });

  it('rejects when the session has been revoked (stolen-JWT defence)', async () => {
    const token = buildToken();
    const guard = new UserAuthGuard(
      fakeEnv,
      buildPrisma({
        session: { ...validSession, revokedAt: new Date() },
        user: activeUser,
      }),
    );
    await expect(guard.canActivate(buildContext(token))).rejects.toThrow(
      'Session has been revoked',
    );
  });

  it('rejects when the session has expired', async () => {
    const token = buildToken();
    const guard = new UserAuthGuard(
      fakeEnv,
      buildPrisma({
        session: { ...validSession, expiresAt: new Date('2020-01-01') },
        user: activeUser,
      }),
    );
    await expect(guard.canActivate(buildContext(token))).rejects.toThrow(
      'Session has expired',
    );
  });

  it('rejects when the session belongs to a different user (token tampering)', async () => {
    const token = buildToken({ sub: 'user1' });
    const guard = new UserAuthGuard(
      fakeEnv,
      buildPrisma({
        session: { ...validSession, userId: 'someone-else' },
        user: activeUser,
      }),
    );
    await expect(guard.canActivate(buildContext(token))).rejects.toThrow(
      'Session not found',
    );
  });

  it('rejects when the user account has been suspended (DB-state check)', async () => {
    const token = buildToken();
    const guard = new UserAuthGuard(
      fakeEnv,
      buildPrisma({
        session: validSession,
        user: { ...activeUser, status: 'SUSPENDED' },
      }),
    );
    await expect(guard.canActivate(buildContext(token))).rejects.toThrow(
      'Account is not active',
    );
  });

  it('accepts a valid token and populates request fields', async () => {
    const token = buildToken();
    const request: any = { headers: { authorization: `Bearer ${token}` } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;

    const guard = new UserAuthGuard(
      fakeEnv,
      buildPrisma({ session: validSession, user: activeUser }),
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.userId).toBe('user1');
    expect(request.userEmail).toBe('a@b.c');
    expect(request.sessionId).toBe('sess1');
  });

  it('rejects a token without sessionId claim', async () => {
    // Hand-crafted token bypassing the helper (no sessionId field).
    const token = jwt.sign(
      { sub: 'user1', email: 'a@b.c', roles: ['CUSTOMER'] },
      SECRET,
      { expiresIn: '1h' },
    );
    const guard = new UserAuthGuard(fakeEnv, buildPrisma({}));
    await expect(guard.canActivate(buildContext(token))).rejects.toThrow(
      'missing session',
    );
  });

  it('rejects when the session does not exist in the database', async () => {
    const token = buildToken();
    const guard = new UserAuthGuard(fakeEnv, buildPrisma({ user: activeUser }));
    await expect(guard.canActivate(buildContext(token))).rejects.toThrow(
      'Session not found',
    );
  });
});
