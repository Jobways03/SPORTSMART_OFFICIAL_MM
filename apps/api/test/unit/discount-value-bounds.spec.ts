import 'reflect-metadata';
import { DiscountsService } from '../../src/modules/discounts/application/services/discounts.service';

/**
 * Regression test for discount value bounds.
 *
 * Before: the discount service accepted any numeric `value` and
 * `getDiscountValue` without bounds. An admin (any admin — no role gate
 * either, addressed separately) could create a PERCENTAGE discount with
 * value=150 and customers would be refunded more than they paid. A
 * negative value would add to the order total. Date validation was also
 * missing: endsAt ≤ startsAt silently created an unusable record.
 *
 * After: PERCENTAGE values must be in [0, 100], FIXED values must be
 * non-negative and finite, and endsAt must be strictly after startsAt.
 */

describe('DiscountsService — numeric value bounds', () => {
  const buildSvc = () => {
    const discountRepo: any = {
      findByCode: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'd1' }),
      update: jest.fn().mockResolvedValue({ id: 'd1' }),
      delete: jest.fn(),
      createProductLinks: jest.fn(),
      createCollectionLinks: jest.fn(),
      deleteProductLinks: jest.fn(),
      deleteCollectionLinks: jest.fn(),
    };
    return { svc: new DiscountsService(discountRepo), discountRepo };
  };

  const baseCreateInput = {
    code: 'TEST',
    type: 'ORDER',
    method: 'CODE',
    valueType: 'PERCENTAGE',
    value: 10,
  };

  it('rejects PERCENTAGE > 100', async () => {
    const { svc } = buildSvc();
    await expect(
      svc.create({ ...baseCreateInput, value: 150 }),
    ).rejects.toThrow(/PERCENTAGE.*between 0 and 100/i);
  });

  it('rejects negative value', async () => {
    const { svc } = buildSvc();
    await expect(
      svc.create({ ...baseCreateInput, value: -5 }),
    ).rejects.toThrow(/cannot be negative/i);
  });

  it('rejects non-finite value', async () => {
    const { svc } = buildSvc();
    await expect(
      svc.create({ ...baseCreateInput, value: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow(/must be a number/i);
  });

  it('accepts a FIXED 500 value (no percentage ceiling)', async () => {
    const { svc, discountRepo } = buildSvc();
    await svc.create({
      ...baseCreateInput,
      valueType: 'FIXED',
      value: 500,
    });
    expect(discountRepo.create).toHaveBeenCalled();
  });

  it('rejects endsAt <= startsAt', async () => {
    const { svc } = buildSvc();
    await expect(
      svc.create({
        ...baseCreateInput,
        startsAt: '2026-05-01T00:00:00Z',
        endsAt: '2026-05-01T00:00:00Z',
      }),
    ).rejects.toThrow(/must be after startsAt/i);
  });

  it('update rejects PERCENTAGE > 100 when only value changes', async () => {
    const { svc, discountRepo } = buildSvc();
    discountRepo.findById.mockResolvedValue({
      id: 'd1',
      valueType: 'PERCENTAGE',
      value: 10,
    });
    await expect(svc.update('d1', { value: 150 })).rejects.toThrow(
      /PERCENTAGE.*between 0 and 100/i,
    );
  });

  it('update accepts valueType switch to FIXED with large value', async () => {
    const { svc, discountRepo } = buildSvc();
    discountRepo.findById.mockResolvedValue({
      id: 'd1',
      valueType: 'PERCENTAGE',
      value: 10,
    });
    await svc.update('d1', { valueType: 'FIXED', value: 5000 });
    expect(discountRepo.update).toHaveBeenCalled();
  });
});
