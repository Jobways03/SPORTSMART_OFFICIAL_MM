/**
 * Phase 45 (2026-05-21) — locks the attestation contract.
 *
 * Covers:
 *   - re-validation runs on every attest (Gap #12 fix)
 *   - optimistic-lock refuses drifted version (Gap #8 fix)
 *   - audit row written for every transition (Gap #6 fix)
 *   - reset / edited recording from update paths
 */

import { ProductTaxAttestationService } from './product-tax-attestation.service';
import { BadRequestAppException, ConflictAppException, NotFoundAppException } from '../../../../core/exceptions';

interface FakeProduct {
  id: string;
  hsnCode: string | null;
  gstRateBps: number | null;
  supplyTaxability: string;
  defaultUqcCode: string | null;
  cessRateBps: number;
  taxConfigVerified: boolean;
  taxConfigVerifiedAt: Date | null;
  taxConfigVerifiedBy: string | null;
  taxConfigVersion: number;
}

function makeService(initial: FakeProduct) {
  const product = { ...initial };
  const logs: any[] = [];

  const txClient = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    product: {
      findUnique: jest.fn(async () => ({ ...product })),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(product, data);
        return product;
      }),
    },
    taxAttestationLog: {
      create: jest.fn(async ({ data }: any) => {
        logs.push(data);
      }),
      findMany: jest.fn(async () => logs),
    },
    // Phase 161 (HSN Master audit B1/B4) — attestation now requires the
    // product's HSN to be an active master row. Default mock returns a row;
    // tests override to null to assert the refusal.
    hsnMaster: {
      findFirst: jest.fn(async () => ({ id: 'hsn-row-1' })),
    },
    // Phase 161 (UQC Master audit B1/B4) — a declared UQC must be an active
    // master row. Default returns a row; tests override to null.
    uqcMaster: {
      findFirst: jest.fn(async () => ({ id: 'uqc-row-1' })),
    },
  };
  const prisma: any = {
    $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => fn(txClient)),
    product: txClient.product,
    taxAttestationLog: txClient.taxAttestationLog,
  };
  return {
    service: new ProductTaxAttestationService(prisma),
    product,
    logs,
    txClient,
  };
}

describe('ProductTaxAttestationService.attest', () => {
  const baseProduct: FakeProduct = {
    id: 'p1',
    hsnCode: '12345678',
    gstRateBps: 1800,
    supplyTaxability: 'TAXABLE',
    defaultUqcCode: 'NOS',
    cessRateBps: 0,
    taxConfigVerified: false,
    taxConfigVerifiedAt: null,
    taxConfigVerifiedBy: null,
    taxConfigVersion: 3,
  };

  it('attests a valid product and writes audit log', async () => {
    const { service, product, logs } = makeService(baseProduct);
    const result = await service.attest({
      productId: 'p1', actorId: 'admin-1', actorRole: 'ADMIN', expectedVersion: 3,
    });
    expect(result.taxConfigVerified).toBe(true);
    expect(result.taxConfigVerifiedBy).toBe('admin-1');
    expect(result.taxConfigVersion).toBe(4);
    expect(product.taxConfigVersion).toBe(4);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('ATTESTED');
    expect(logs[0].taxConfigVersion).toBe(4);
  });

  it('refuses attest when expectedVersion does not match (optimistic lock)', async () => {
    const { service } = makeService(baseProduct);
    await expect(
      service.attest({
        productId: 'p1', actorId: 'admin-1', actorRole: 'ADMIN', expectedVersion: 99,
      }),
    ).rejects.toThrow(ConflictAppException);
  });

  it('still attests when expectedVersion omitted', async () => {
    const { service } = makeService(baseProduct);
    const result = await service.attest({
      productId: 'p1', actorId: 'admin-1', actorRole: 'ADMIN',
    });
    expect(result.taxConfigVerified).toBe(true);
  });

  it('re-validates HSN — refuses when missing on TAXABLE', async () => {
    const { service } = makeService({ ...baseProduct, hsnCode: null });
    await expect(
      service.attest({ productId: 'p1', actorId: 'admin-1', actorRole: 'ADMIN' }),
    ).rejects.toThrow(BadRequestAppException);
  });

  it('re-validates HSN — refuses malformed value', async () => {
    const { service } = makeService({ ...baseProduct, hsnCode: 'abc123' });
    await expect(
      service.attest({ productId: 'p1', actorId: 'admin-1', actorRole: 'ADMIN' }),
    ).rejects.toThrow(/hsnCode/);
  });

  it('re-validates rate — refuses out of range', async () => {
    const { service } = makeService({ ...baseProduct, gstRateBps: 99999 });
    await expect(
      service.attest({ productId: 'p1', actorId: 'admin-1', actorRole: 'ADMIN' }),
    ).rejects.toThrow(/gstRateBps/);
  });

  it('refuses attest when HSN is not an active master row (B1/B4)', async () => {
    const { service, txClient } = makeService(baseProduct);
    txClient.hsnMaster.findFirst = jest.fn().mockResolvedValue(null);
    await expect(
      service.attest({ productId: 'p1', actorId: 'admin-1', actorRole: 'ADMIN' }),
    ).rejects.toThrow(/not an active code in the HSN master/);
  });

  it('refuses attest when the declared UQC is not an active master row (B1/B4)', async () => {
    const { service, txClient } = makeService(baseProduct);
    txClient.uqcMaster.findFirst = jest.fn().mockResolvedValue(null);
    await expect(
      service.attest({ productId: 'p1', actorId: 'admin-1', actorRole: 'ADMIN' }),
    ).rejects.toThrow(/not an active code in the UQC master/);
  });

  it('accepts EXEMPT product without HSN or rate', async () => {
    const { service } = makeService({
      ...baseProduct,
      supplyTaxability: 'EXEMPT',
      hsnCode: null,
      gstRateBps: 0,
    });
    await expect(
      service.attest({ productId: 'p1', actorId: 'admin-1', actorRole: 'ADMIN' }),
    ).resolves.toMatchObject({ taxConfigVerified: true });
  });

  it('idempotent when already verified — writes audit row but no state change', async () => {
    const { service, product, logs } = makeService({
      ...baseProduct,
      taxConfigVerified: true,
      taxConfigVerifiedAt: new Date('2026-05-01'),
      taxConfigVerifiedBy: 'admin-prior',
    });
    const result = await service.attest({
      productId: 'p1', actorId: 'admin-1', actorRole: 'ADMIN',
    });
    expect(result.taxConfigVerifiedBy).toBe('admin-prior');
    expect(product.taxConfigVersion).toBe(3);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('ATTESTED');
  });

  it('throws NotFound when product missing', async () => {
    const { service, txClient } = makeService(baseProduct);
    txClient.product.findUnique = jest.fn().mockResolvedValue(null);
    await expect(
      service.attest({ productId: 'missing', actorId: 'admin-1', actorRole: 'ADMIN' }),
    ).rejects.toThrow(NotFoundAppException);
  });
});

describe('ProductTaxAttestationService.recordReset', () => {
  it('writes a RESET audit row', async () => {
    const { service, logs } = makeService({
      id: 'p1',
      hsnCode: '12345678',
      gstRateBps: 1800,
      supplyTaxability: 'TAXABLE',
      defaultUqcCode: 'NOS',
      cessRateBps: 0,
      taxConfigVerified: false,
      taxConfigVerifiedAt: null,
      taxConfigVerifiedBy: null,
      taxConfigVersion: 5,
    });
    await service.recordReset({
      productId: 'p1', actorId: 'seller-1', actorRole: 'SELLER', reason: 'Seller edited HSN',
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('RESET');
    expect(logs[0].actorRole).toBe('SELLER');
    expect(logs[0].reviewerNote).toBe('Seller edited HSN');
  });
});
