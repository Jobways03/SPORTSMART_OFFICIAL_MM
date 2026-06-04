/**
 * Phase 197 (My-Orders audit #5/#7) — ListCustomerOrdersDto contract.
 *
 * Pre-Phase-197 the customer order listing hand-parsed `page`/`limit`
 * with parseInt (no bounds, no rejection of junk) and had NO status
 * filter at all. This DTO is the typed replacement; the cases below
 * pin the validation + bucket enum.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ListCustomerOrdersDto,
  CustomerOrderStatusBucket,
} from './list-customer-orders.dto';

function flattenErrors(errs: any[]): string[] {
  const out: string[] = [];
  for (const e of errs) {
    if (e.constraints) out.push(...Object.values<string>(e.constraints));
    if (e.children?.length) out.push(...flattenErrors(e.children));
  }
  return out;
}
async function messages(input: unknown): Promise<string[]> {
  return flattenErrors(
    await validate(plainToInstance(ListCustomerOrdersDto, input) as object),
  );
}

describe('ListCustomerOrdersDto (Phase 197 — My-Orders #5/#7)', () => {
  it('accepts an empty query (all optional)', async () => {
    expect(await messages({})).toEqual([]);
  });

  it('coerces numeric strings for page/limit (global transform)', () => {
    const dto = plainToInstance(ListCustomerOrdersDto, { page: '2', limit: '10' });
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
  });

  it('rejects page < 1', async () => {
    const msgs = await messages({ page: 0 });
    expect(msgs.some((m) => m.includes('page must be >= 1'))).toBe(true);
  });

  it('rejects limit > 50', async () => {
    const msgs = await messages({ limit: 51 });
    expect(msgs.some((m) => m.includes('must not exceed 50'))).toBe(true);
  });

  it('rejects a fractional limit', async () => {
    const msgs = await messages({ limit: 1.5 });
    expect(msgs.some((m) => m.includes('limit must be an integer'))).toBe(true);
  });

  it('rejects an unknown status bucket', async () => {
    const msgs = await messages({ status: 'shipped' });
    expect(msgs.some((m) => m.includes('status must be one of'))).toBe(true);
  });

  it('accepts every valid bucket', async () => {
    for (const s of Object.values(CustomerOrderStatusBucket)) {
      expect(await messages({ status: s })).toEqual([]);
    }
  });

  it('accepts a fully valid query', async () => {
    expect(
      await messages({ page: 1, limit: 20, status: 'active' }),
    ).toEqual([]);
  });
});
