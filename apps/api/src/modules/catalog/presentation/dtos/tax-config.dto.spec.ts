/**
 * Phase 46 (2026-05-21) — locks the BulkUpdateTaxConfigDto cap +
 * cessRateBps support contract.
 *
 * The DTO is the first line of defence before the request hits the
 * controller. These tests guard against a future relaxation slipping
 * past code review.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BulkUpdateTaxConfigDto, BULK_TAX_CONFIG_MAX_PRODUCTS } from './tax-config.dto';

async function validateDto(input: unknown): Promise<string[]> {
  const dto = plainToInstance(BulkUpdateTaxConfigDto, input);
  const errors = await validate(dto as object);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('BulkUpdateTaxConfigDto (Phase 46)', () => {
  it('cap is 500', () => {
    expect(BULK_TAX_CONFIG_MAX_PRODUCTS).toBe(500);
  });

  it('accepts a small valid payload', async () => {
    const errors = await validateDto({
      productIds: [uuid(1), uuid(2)],
      hsnCode: '12345678',
      gstRateBps: 1800,
    });
    expect(errors).toEqual([]);
  });

  it('rejects productIds array larger than 500', async () => {
    const big = Array.from({ length: 501 }, (_, i) => uuid(i + 1));
    const errors = await validateDto({ productIds: big, gstRateBps: 1800 });
    expect(errors.some((m) => m.includes('500'))).toBe(true);
  });

  it('accepts an array of exactly 500', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => uuid(i + 1));
    const errors = await validateDto({ productIds: ids, gstRateBps: 1800 });
    expect(errors).toEqual([]);
  });

  it('rejects non-UUID entries in productIds', async () => {
    const errors = await validateDto({ productIds: ['not-a-uuid'], gstRateBps: 1800 });
    expect(errors.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects malformed HSN', async () => {
    const errors = await validateDto({ productIds: [uuid(1)], hsnCode: 'abc' });
    expect(errors.some((m) => m.includes('HSN'))).toBe(true);
  });

  it('accepts cessRateBps', async () => {
    const errors = await validateDto({ productIds: [uuid(1)], cessRateBps: 1500 });
    expect(errors).toEqual([]);
  });

  it('rejects cessRateBps > 10000', async () => {
    const errors = await validateDto({ productIds: [uuid(1)], cessRateBps: 99999 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects bogus supplyTaxability', async () => {
    const errors = await validateDto({
      productIds: [uuid(1)],
      supplyTaxability: 'WHATEVER',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects lowercase UQC', async () => {
    const errors = await validateDto({
      productIds: [uuid(1)],
      defaultUqcCode: 'nos',
    });
    expect(errors.some((m) => m.toLowerCase().includes('uqc'))).toBe(true);
  });
});
