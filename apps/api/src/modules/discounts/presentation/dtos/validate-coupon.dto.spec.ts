/**
 * Phase 62 (2026-05-22) — ValidateCouponDto contract (audit Gap
 * #6). Pre-Phase-62 the validate endpoint accepted an inline TS
 * interface, so negative subtotal / 10kB code strings / 1000-row
 * items arrays sailed through to the service.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidateCouponDto } from './validate-coupon.dto';

function flattenErrors(errs: any[]): string[] {
  const out: string[] = [];
  for (const e of errs) {
    if (e.constraints) out.push(...Object.values<string>(e.constraints));
    if (e.children?.length) out.push(...flattenErrors(e.children));
  }
  return out;
}
async function messages<T extends object>(
  cls: new () => T,
  input: unknown,
): Promise<string[]> {
  return flattenErrors(await validate(plainToInstance(cls, input) as object));
}

const UUID = '00000000-0000-4000-8000-000000000001';

describe('ValidateCouponDto (Phase 62 — Gap #6)', () => {
  it('rejects negative subtotal', async () => {
    const msgs = await messages(ValidateCouponDto, {
      code: 'SUMMER10',
      subtotal: -1,
    });
    expect(msgs.some((m) => m.includes('non-negative'))).toBe(true);
  });

  it('rejects subtotal exceeding the upper bound', async () => {
    const msgs = await messages(ValidateCouponDto, {
      code: 'SUMMER10',
      subtotal: 2_000_000_000,
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects an empty code (after trim/upper)', async () => {
    const msgs = await messages(ValidateCouponDto, {
      code: '',
      subtotal: 100,
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects code longer than 64 chars', async () => {
    const msgs = await messages(ValidateCouponDto, {
      code: 'A'.repeat(65),
      subtotal: 100,
    });
    expect(msgs.some((m) => m.includes('64'))).toBe(true);
  });

  it('canonicalizes code to upper-case at the pipe (Gap #27 surface)', () => {
    const dto = plainToInstance(ValidateCouponDto, {
      code: 'summer10',
      subtotal: 100,
    });
    expect((dto as any).code).toBe('SUMMER10');
  });

  it('rejects items array > 200 entries', async () => {
    const items = Array.from({ length: 201 }, () => ({
      productId: UUID,
      quantity: 1,
      unitPrice: 10,
    }));
    const msgs = await messages(ValidateCouponDto, {
      code: 'SUMMER10',
      subtotal: 100,
      items,
    });
    expect(msgs.some((m) => m.includes('200'))).toBe(true);
  });

  it('rejects item quantity > 99', async () => {
    const msgs = await messages(ValidateCouponDto, {
      code: 'SUMMER10',
      subtotal: 100,
      items: [{ productId: UUID, quantity: 1000, unitPrice: 10 }],
    });
    expect(msgs.some((m) => m.includes('99'))).toBe(true);
  });

  it('rejects item unitPrice < 0', async () => {
    const msgs = await messages(ValidateCouponDto, {
      code: 'SUMMER10',
      subtotal: 100,
      items: [{ productId: UUID, quantity: 1, unitPrice: -5 }],
    });
    expect(msgs.some((m) => m.toLowerCase().includes('non-negative'))).toBe(true);
  });

  it('accepts a minimal valid payload', async () => {
    const msgs = await messages(ValidateCouponDto, {
      code: 'SUMMER10',
      subtotal: 100,
    });
    expect(msgs).toEqual([]);
  });
});
