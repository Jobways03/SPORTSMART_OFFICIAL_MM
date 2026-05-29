import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { D2cOnlyGuard, RetailOnlyGuard } from './seller-type.guard';

/**
 * Phase 38 — D2cOnlyGuard / RetailOnlyGuard.
 *
 * Two resolution paths the guard supports:
 *   1. seller-authenticated request  (request.sellerId set)
 *      → trust the DB row, ignore the header
 *   2. admin-authenticated request   (no request.sellerId)
 *      → trust the X-Seller-Type header
 *
 * These tests pin both paths plus the failure modes a forged header
 * or a legacy un-backfilled row could create.
 */
describe('SellerType guards', () => {
  // Minimal mock PrismaService — only the call shape the guard uses.
  function makePrisma(rows: Record<string, { sellerType: 'D2C' | 'RETAIL' | null }>) {
    return {
      seller: {
        findUnique: jest.fn(async ({ where }: any) => {
          const row = rows[where.id];
          return row ? { sellerType: row.sellerType } : null;
        }),
      },
    } as any;
  }

  function makeCtx(req: Record<string, unknown>) {
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as any;
  }

  // ── Path 1: seller-authenticated requests ────────────────────────

  describe('seller-authenticated requests (request.sellerId set)', () => {
    it('D2cOnlyGuard allows a D2C seller', async () => {
      const prisma = makePrisma({ 's-1': { sellerType: 'D2C' } });
      const guard = new D2cOnlyGuard(prisma);
      const ctx = makeCtx({ sellerId: 's-1', headers: {} });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(prisma.seller.findUnique).toHaveBeenCalledWith({
        where: { id: 's-1' },
        select: { sellerType: true },
      });
    });

    it('D2cOnlyGuard rejects a RETAIL seller', async () => {
      const prisma = makePrisma({ 's-1': { sellerType: 'RETAIL' } });
      const guard = new D2cOnlyGuard(prisma);
      const ctx = makeCtx({ sellerId: 's-1', headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('RetailOnlyGuard allows a RETAIL seller', async () => {
      const prisma = makePrisma({ 's-1': { sellerType: 'RETAIL' } });
      const guard = new RetailOnlyGuard(prisma);
      const ctx = makeCtx({ sellerId: 's-1', headers: {} });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('RetailOnlyGuard rejects a D2C seller', async () => {
      const prisma = makePrisma({ 's-1': { sellerType: 'D2C' } });
      const guard = new RetailOnlyGuard(prisma);
      const ctx = makeCtx({ sellerId: 's-1', headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('DB row wins over a forged header (D2C row, forged RETAIL header → guard uses D2C)', async () => {
      const prisma = makePrisma({ 's-1': { sellerType: 'D2C' } });
      const guard = new D2cOnlyGuard(prisma);
      const ctx = makeCtx({
        sellerId: 's-1',
        headers: { 'x-seller-type': 'RETAIL' }, // forged
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      // RetailOnlyGuard on the same forged header must reject because
      // the real seller type is D2C.
      const retailGuard = new RetailOnlyGuard(prisma);
      await expect(retailGuard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the seller row has no sellerType (legacy un-backfilled row)', async () => {
      const prisma = makePrisma({ 's-1': { sellerType: null } });
      const guard = new D2cOnlyGuard(prisma);
      const ctx = makeCtx({ sellerId: 's-1', headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the seller row is missing entirely', async () => {
      const prisma = makePrisma({});
      const guard = new D2cOnlyGuard(prisma);
      const ctx = makeCtx({ sellerId: 's-missing', headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── Path 2: admin-authenticated requests ─────────────────────────

  describe('admin-authenticated requests (no request.sellerId)', () => {
    it('D2cOnlyGuard allows when X-Seller-Type header is D2C', async () => {
      const prisma = makePrisma({});
      const guard = new D2cOnlyGuard(prisma);
      const ctx = makeCtx({ headers: { 'x-seller-type': 'D2C' } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      // No DB hit needed when seller-id is absent.
      expect(prisma.seller.findUnique).not.toHaveBeenCalled();
    });

    it('D2cOnlyGuard rejects when X-Seller-Type header is RETAIL', async () => {
      const prisma = makePrisma({});
      const guard = new D2cOnlyGuard(prisma);
      const ctx = makeCtx({ headers: { 'x-seller-type': 'RETAIL' } });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('RetailOnlyGuard allows when X-Seller-Type header is RETAIL', async () => {
      const prisma = makePrisma({});
      const guard = new RetailOnlyGuard(prisma);
      const ctx = makeCtx({ headers: { 'x-seller-type': 'RETAIL' } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('rejects when the header is missing', async () => {
      const prisma = makePrisma({});
      const guard = new D2cOnlyGuard(prisma);
      const ctx = makeCtx({ headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the header value is unrecognised', async () => {
      const prisma = makePrisma({});
      const guard = new D2cOnlyGuard(prisma);
      const ctx = makeCtx({ headers: { 'x-seller-type': 'B2B' } });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('handles a header arriving as a string[] (Node multi-value form)', async () => {
      const prisma = makePrisma({});
      const guard = new D2cOnlyGuard(prisma);
      const ctx = makeCtx({ headers: { 'x-seller-type': ['D2C', 'X'] } });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  // ── Error-message shape ──────────────────────────────────────────

  it('error message names the required scope and the observed scope', async () => {
    const prisma = makePrisma({ 's-1': { sellerType: 'RETAIL' } });
    const guard = new D2cOnlyGuard(prisma);
    const ctx = makeCtx({ sellerId: 's-1', headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toThrow(/D2C/);
    await expect(guard.canActivate(ctx)).rejects.toThrow(/RETAIL/);
  });

  it('error message says "unknown" when neither sellerId nor header is present', async () => {
    const prisma = makePrisma({});
    const guard = new D2cOnlyGuard(prisma);
    const ctx = makeCtx({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toThrow(/unknown/);
  });
});
