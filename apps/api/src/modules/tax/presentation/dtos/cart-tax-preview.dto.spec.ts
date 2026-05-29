/**
 * Phase 65 (2026-05-22) — DTO contract for /customer/tax-preview/cart
 * (audit Gap #7). Pre-Phase-65 the body was inline TS interface so
 * a non-UUID addressId would still hit the addresses lookup before
 * .find() returned null.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CartTaxPreviewDto } from './cart-tax-preview.dto';

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

describe('CartTaxPreviewDto (Phase 65)', () => {
  it('accepts an empty body (all optional)', async () => {
    const msgs = await messages(CartTaxPreviewDto, {});
    expect(msgs).toEqual([]);
  });

  it('rejects a non-UUID addressId', async () => {
    const msgs = await messages(CartTaxPreviewDto, { addressId: 'not-a-uuid' });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects a non-UUID selectedTaxProfileId', async () => {
    const msgs = await messages(CartTaxPreviewDto, {
      selectedTaxProfileId: 'bad',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('accepts a valid combination', async () => {
    const msgs = await messages(CartTaxPreviewDto, {
      addressId: UUID,
      couponCode: 'SUMMER10',
      selectedTaxProfileId: UUID,
    });
    expect(msgs).toEqual([]);
  });

  it('canonicalises couponCode to uppercase at the pipe', () => {
    const dto = plainToInstance(CartTaxPreviewDto, {
      couponCode: 'summer10',
    });
    expect((dto as any).couponCode).toBe('SUMMER10');
  });

  it('rejects an oversized couponCode', async () => {
    const msgs = await messages(CartTaxPreviewDto, {
      couponCode: 'A'.repeat(65),
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});
