import { ExecutionContext } from '@nestjs/common';
import { AdminSellerScopeGuard } from './admin-seller-scope.guard';
import { NotFoundAppException } from '../exceptions/not-found.exception';

function makeCtx(req: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makePrisma(
  rows: Record<string, { sellerType: 'D2C' | 'RETAIL' } | null>,
) {
  return {
    seller: {
      findUnique: jest.fn(async ({ where }: any) => rows[where.id] ?? null),
    },
  } as any;
}

describe('AdminSellerScopeGuard', () => {
  it('allows an unrestricted admin (no scope perm) without touching the DB', async () => {
    const prisma = makePrisma({ 's-1': { sellerType: 'RETAIL' } });
    const guard = new AdminSellerScopeGuard(prisma);
    const ctx = makeCtx({
      user: { permissions: ['sellers.read'] },
      params: { sellerId: 's-1' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.seller.findUnique).not.toHaveBeenCalled();
  });

  it('allows a D2C-scoped admin acting on a D2C seller', async () => {
    const prisma = makePrisma({ 's-1': { sellerType: 'D2C' } });
    const guard = new AdminSellerScopeGuard(prisma);
    const ctx = makeCtx({
      user: { permissions: ['sellers.read', 'sellers.scope.d2c'] },
      params: { sellerId: 's-1' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('404s a D2C-scoped admin on a RETAIL seller (no existence leak)', async () => {
    const prisma = makePrisma({ 's-1': { sellerType: 'RETAIL' } });
    const guard = new AdminSellerScopeGuard(prisma);
    const ctx = makeCtx({
      user: { permissions: ['sellers.scope.d2c'] },
      params: { sellerId: 's-1' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });

  it('404s a scoped admin when the seller does not exist', async () => {
    const prisma = makePrisma({});
    const guard = new AdminSellerScopeGuard(prisma);
    const ctx = makeCtx({
      user: { permissions: ['sellers.scope.retail'] },
      params: { sellerId: 'missing' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });

  it('reads the :id param too (seller delivery-methods routes)', async () => {
    const prisma = makePrisma({ 's-9': { sellerType: 'RETAIL' } });
    const guard = new AdminSellerScopeGuard(prisma);
    const ctx = makeCtx({
      user: { permissions: ['sellers.scope.retail'] },
      params: { id: 's-9' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('is a no-op on routes with no seller id (list / impersonation-by-jti)', async () => {
    const prisma = makePrisma({});
    const guard = new AdminSellerScopeGuard(prisma);
    const ctx = makeCtx({
      user: { permissions: ['sellers.scope.d2c'] },
      params: { jti: 'abc-123' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.seller.findUnique).not.toHaveBeenCalled();
  });
});
