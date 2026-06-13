import { ExecutionContext } from '@nestjs/common';
import {
  AdminOrderSellerScopeGuard,
  AdminReturnSellerScopeGuard,
  AdminProductSellerScopeGuard,
  AdminMappingSellerScopeGuard,
} from './entity-seller-scope.guard';
import { NotFoundAppException } from '../exceptions/not-found.exception';

function makeCtx(req: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AdminReturnSellerScopeGuard', () => {
  const guardWith = (ret: any) => {
    const prisma = { return: { findUnique: jest.fn(async () => ret) } } as any;
    return { guard: new AdminReturnSellerScopeGuard(prisma), prisma };
  };

  it('allows an unrestricted admin without hitting the DB', async () => {
    const { guard, prisma } = guardWith({ subOrder: { seller: { sellerType: 'RETAIL' } } });
    const ok = await guard.canActivate(
      makeCtx({ user: { permissions: ['returns.read'] }, params: { returnId: 'r1' } }),
    );
    expect(ok).toBe(true);
    expect(prisma.return.findUnique).not.toHaveBeenCalled();
  });

  it('allows a D2C-scoped admin on a D2C return', async () => {
    const { guard } = guardWith({ subOrder: { seller: { sellerType: 'D2C' } } });
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['sellers.scope.d2c'] }, params: { returnId: 'r1' } })),
    ).resolves.toBe(true);
  });

  it('404s a D2C-scoped admin on a RETAIL return', async () => {
    const { guard } = guardWith({ subOrder: { seller: { sellerType: 'RETAIL' } } });
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['sellers.scope.d2c'] }, params: { returnId: 'r1' } })),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('404s when the return is missing', async () => {
    const { guard } = guardWith(null);
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['sellers.scope.retail'] }, params: { returnId: 'missing' } })),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('no-ops on the list route (no returnId)', async () => {
    const { guard, prisma } = guardWith(null);
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['sellers.scope.d2c'] }, params: {} })),
    ).resolves.toBe(true);
    expect(prisma.return.findUnique).not.toHaveBeenCalled();
  });
});

describe('AdminProductSellerScopeGuard', () => {
  const guardWith = (prod: any) => {
    const prisma = { product: { findUnique: jest.fn(async () => prod) } } as any;
    return { guard: new AdminProductSellerScopeGuard(prisma), prisma };
  };

  it('allows a RETAIL-scoped admin on a RETAIL-owned product', async () => {
    const { guard } = guardWith({ seller: { sellerType: 'RETAIL' } });
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['sellers.scope.retail'] }, params: { productId: 'p1' } })),
    ).resolves.toBe(true);
  });

  it('404s a RETAIL-scoped admin on a D2C-owned product', async () => {
    const { guard } = guardWith({ seller: { sellerType: 'D2C' } });
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['sellers.scope.retail'] }, params: { productId: 'p1' } })),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('404s a scoped admin on a platform-owned product (no owner seller)', async () => {
    const { guard } = guardWith({ seller: null });
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['sellers.scope.d2c'] }, params: { productId: 'p1' } })),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('allows an unrestricted admin on a platform-owned product', async () => {
    const { guard } = guardWith({ seller: null });
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['catalog.read'] }, params: { productId: 'p1' } })),
    ).resolves.toBe(true);
  });
});

describe('AdminMappingSellerScopeGuard', () => {
  const guardWith = (mapping: any) => {
    const prisma = {
      sellerProductMapping: { findUnique: jest.fn(async () => mapping) },
    } as any;
    return { guard: new AdminMappingSellerScopeGuard(prisma), prisma };
  };

  it('allows a RETAIL-scoped admin on a RETAIL seller mapping', async () => {
    const { guard } = guardWith({ seller: { sellerType: 'RETAIL' } });
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['sellers.scope.retail'] }, params: { mappingId: 'm1' } })),
    ).resolves.toBe(true);
  });

  it('404s a D2C-scoped admin on a RETAIL seller mapping (the H6 boundary)', async () => {
    const { guard } = guardWith({ seller: { sellerType: 'RETAIL' } });
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['sellers.scope.d2c'] }, params: { mappingId: 'm1' } })),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('404s when the mapping is missing', async () => {
    const { guard } = guardWith(null);
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['sellers.scope.d2c'] }, params: { mappingId: 'gone' } })),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('no-ops (allows) on routes without a mappingId param so it composes with the product guard', async () => {
    const { guard, prisma } = guardWith(null);
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['sellers.scope.d2c'] }, params: { productId: 'p1' } })),
    ).resolves.toBe(true);
    expect(prisma.sellerProductMapping.findUnique).not.toHaveBeenCalled();
  });

  it('allows an unrestricted admin without a DB hit', async () => {
    const { guard, prisma } = guardWith({ seller: { sellerType: 'RETAIL' } });
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['catalog.approve'] }, params: { mappingId: 'm1' } })),
    ).resolves.toBe(true);
    expect(prisma.sellerProductMapping.findUnique).not.toHaveBeenCalled();
  });
});

describe('AdminOrderSellerScopeGuard', () => {
  it('allows an order with ≥1 in-scope sub-order (mixed cart)', async () => {
    const prisma = {
      masterOrder: {
        findUnique: jest.fn(async () => ({
          subOrders: [{ seller: { sellerType: 'RETAIL' } }, { seller: { sellerType: 'D2C' } }],
        })),
      },
    } as any;
    const guard = new AdminOrderSellerScopeGuard(prisma);
    await expect(
      guard.canActivate(
        makeCtx({ user: { permissions: ['sellers.scope.d2c'] }, params: { id: 'o1' }, route: { path: '/admin/orders/:id' } }),
      ),
    ).resolves.toBe(true);
  });

  it('404s an order with no in-scope sub-order', async () => {
    const prisma = {
      masterOrder: {
        findUnique: jest.fn(async () => ({ subOrders: [{ seller: { sellerType: 'RETAIL' } }] })),
      },
    } as any;
    const guard = new AdminOrderSellerScopeGuard(prisma);
    await expect(
      guard.canActivate(
        makeCtx({ user: { permissions: ['sellers.scope.d2c'] }, params: { id: 'o1' }, route: { path: '/admin/orders/:id' } }),
      ),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('resolves a sub-order route via subOrder.seller (path-detected, :id)', async () => {
    const prisma = {
      subOrder: { findUnique: jest.fn(async () => ({ seller: { sellerType: 'D2C' } })) },
      masterOrder: { findUnique: jest.fn() },
    } as any;
    const guard = new AdminOrderSellerScopeGuard(prisma);
    const ok = await guard.canActivate(
      makeCtx({
        user: { permissions: ['sellers.scope.d2c'] },
        params: { id: 'so1' },
        originalUrl: '/api/admin/orders/sub-orders/so1/accept',
      }),
    );
    expect(ok).toBe(true);
    expect(prisma.subOrder.findUnique).toHaveBeenCalled();
    expect(prisma.masterOrder.findUnique).not.toHaveBeenCalled();
  });

  it('404s a RETAIL sub-order for a D2C admin (via :subOrderId)', async () => {
    const prisma = {
      subOrder: { findUnique: jest.fn(async () => ({ seller: { sellerType: 'RETAIL' } })) },
    } as any;
    const guard = new AdminOrderSellerScopeGuard(prisma);
    await expect(
      guard.canActivate(
        makeCtx({
          user: { permissions: ['sellers.scope.d2c'] },
          params: { subOrderId: 'so1' },
          originalUrl: '/api/admin/orders/sub-orders/so1/mark-paid',
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });

  it('no-ops on the order list route', async () => {
    const prisma = { masterOrder: { findUnique: jest.fn() } } as any;
    const guard = new AdminOrderSellerScopeGuard(prisma);
    await expect(
      guard.canActivate(makeCtx({ user: { permissions: ['sellers.scope.d2c'] }, params: {}, route: { path: '/admin/orders' } })),
    ).resolves.toBe(true);
    expect(prisma.masterOrder.findUnique).not.toHaveBeenCalled();
  });
});
