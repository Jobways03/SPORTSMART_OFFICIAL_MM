/**
 * Phase 64 (2026-05-22) — DTO contracts for the /storefront/
 * allocate/* endpoints (audit Gap #21).
 *
 * Pre-Phase-64 every body type was a TS interface, so a hostile
 * caller could POST { items: Array(10000), customerPincode: 'abc' }
 * and the allocator burned CPU on every line before the PostOffice
 * cache miss surfaced as "999km".
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AllocateAndReserveDto,
  AllocateItemDto,
  AllocateRequestDto,
  CheckCartServiceabilityDto,
  CheckServiceabilityQueryDto,
  ReserveRequestDto,
} from './storefront-allocation.dto';

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

describe('AllocateRequestDto (Phase 64 — Gap #21)', () => {
  it('rejects empty items array', async () => {
    const msgs = await messages(AllocateRequestDto, {
      items: [],
      customerPincode: '400001',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('empty'))).toBe(true);
  });

  it('rejects items array > 50 entries', async () => {
    const items = Array.from({ length: 51 }, () => ({
      productId: UUID,
      quantity: 1,
    }));
    const msgs = await messages(AllocateRequestDto, {
      items,
      customerPincode: '400001',
    });
    expect(msgs.some((m) => m.includes('50'))).toBe(true);
  });

  it('rejects malformed pincode (leading zero)', async () => {
    const msgs = await messages(AllocateRequestDto, {
      items: [{ productId: UUID, quantity: 1 }],
      customerPincode: '012345',
    });
    expect(msgs.some((m) => m.includes('6-digit'))).toBe(true);
  });

  it('rejects pincode with letters', async () => {
    const msgs = await messages(AllocateRequestDto, {
      items: [{ productId: UUID, quantity: 1 }],
      customerPincode: 'abc123',
    });
    expect(msgs.some((m) => m.includes('6-digit'))).toBe(true);
  });

  it('rejects non-UUID productId inside items', async () => {
    const msgs = await messages(AllocateRequestDto, {
      items: [{ productId: 'not-a-uuid', quantity: 1 }],
      customerPincode: '400001',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects quantity > 99 per line', async () => {
    const msgs = await messages(AllocateRequestDto, {
      items: [{ productId: UUID, quantity: 1000 }],
      customerPincode: '400001',
    });
    expect(msgs.some((m) => m.includes('99'))).toBe(true);
  });

  it('accepts a minimal valid payload', async () => {
    const msgs = await messages(AllocateRequestDto, {
      items: [{ productId: UUID, quantity: 1 }],
      customerPincode: '400001',
    });
    expect(msgs).toEqual([]);
  });
});

describe('ReserveRequestDto + AllocateAndReserveDto (Phase 64)', () => {
  it('rejects non-UUID mappingId on reserve', async () => {
    const msgs = await messages(ReserveRequestDto, {
      mappingId: 'not-a-uuid',
      quantity: 1,
    });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects expiresInMinutes > 120', async () => {
    const msgs = await messages(ReserveRequestDto, {
      mappingId: UUID,
      quantity: 1,
      expiresInMinutes: 200,
    });
    expect(msgs.some((m) => m.includes('120'))).toBe(true);
  });

  it('AllocateAndReserveDto rejects pincode with letters', async () => {
    const msgs = await messages(AllocateAndReserveDto, {
      productId: UUID,
      customerPincode: 'abc999',
      quantity: 1,
    });
    expect(msgs.some((m) => m.includes('6-digit'))).toBe(true);
  });
});

describe('CheckServiceabilityQueryDto (Phase 64 — Gap #2)', () => {
  it('rejects malformed pincode', async () => {
    const msgs = await messages(CheckServiceabilityQueryDto, {
      productId: UUID,
      pincode: '12abc',
    });
    expect(msgs.some((m) => m.includes('6-digit'))).toBe(true);
  });

  it('rejects non-UUID productId', async () => {
    const msgs = await messages(CheckServiceabilityQueryDto, {
      productId: 'bad',
      pincode: '400001',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('accepts a valid query', async () => {
    const msgs = await messages(CheckServiceabilityQueryDto, {
      productId: UUID,
      pincode: '400001',
    });
    expect(msgs).toEqual([]);
  });
});

describe('CheckCartServiceabilityDto (Phase 64 — Gap #3)', () => {
  it('rejects malformed pincode', async () => {
    const msgs = await messages(CheckCartServiceabilityDto, {
      pincode: 'abc',
    });
    expect(msgs.some((m) => m.includes('6-digit'))).toBe(true);
  });

  it('accepts a valid pincode', async () => {
    const msgs = await messages(CheckCartServiceabilityDto, {
      pincode: '400001',
    });
    expect(msgs).toEqual([]);
  });
});

describe('AllocateItemDto direct (Phase 64)', () => {
  it('rejects negative quantity', async () => {
    const msgs = await messages(AllocateItemDto, {
      productId: UUID,
      quantity: -1,
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects fractional quantity', async () => {
    const msgs = await messages(AllocateItemDto, {
      productId: UUID,
      quantity: 1.5,
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});
