/**
 * Phase 51 (2026-05-21) — locks the seller-mapping DTO contract.
 * Pre-Phase-51 the controller accepted inline TS interfaces which
 * NestJS could not validate; these tests guard against regression of
 * the new class-validator rules.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BulkStockUpdateDto,
  MapProductDto,
  UpdateMappingDto,
} from './seller-mapping.dto';

async function messages<T extends object>(
  cls: new () => T,
  input: unknown,
): Promise<string[]> {
  const dto = plainToInstance(cls, input);
  const errs = await validate(dto as object);
  return errs.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...(e.children?.flatMap((c) =>
      Object.values(c.constraints ?? {}).concat(
        c.children?.flatMap((gc) => Object.values(gc.constraints ?? {})) ?? [],
      ),
    ) ?? []),
  ]);
}

const uuid = '00000000-0000-4000-8000-000000000001';

describe('MapProductDto (Phase 51)', () => {
  it('accepts a minimal valid payload', async () => {
    const msgs = await messages(MapProductDto, { productId: uuid, stockQty: 5 });
    expect(msgs).toEqual([]);
  });

  it('rejects a non-UUID productId', async () => {
    const msgs = await messages(MapProductDto, { productId: 'not-a-uuid', stockQty: 5 });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects stockQty < 0', async () => {
    const msgs = await messages(MapProductDto, { productId: uuid, stockQty: -1 });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects non-integer stockQty', async () => {
    const msgs = await messages(MapProductDto, { productId: uuid, stockQty: 5.5 });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects an invalid pickupPincode format', async () => {
    const msgs = await messages(MapProductDto, {
      productId: uuid,
      stockQty: 5,
      pickupPincode: '12345abc',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('pincode'))).toBe(true);
  });

  it('accepts a valid 6-digit pickupPincode', async () => {
    const msgs = await messages(MapProductDto, {
      productId: uuid,
      stockQty: 5,
      pickupPincode: '400001',
    });
    expect(msgs).toEqual([]);
  });

  it('rejects an out-of-bounds latitude', async () => {
    const msgs = await messages(MapProductDto, {
      productId: uuid,
      stockQty: 5,
      latitude: 999,
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects sellerInternalSku longer than 64 chars', async () => {
    const msgs = await messages(MapProductDto, {
      productId: uuid,
      stockQty: 5,
      sellerInternalSku: 'a'.repeat(65),
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects dispatchSla > 30', async () => {
    const msgs = await messages(MapProductDto, {
      productId: uuid,
      stockQty: 5,
      dispatchSla: 31,
    });
    expect(msgs.some((m) => m.toLowerCase().includes('30'))).toBe(true);
  });

  it('accepts lowStockThreshold inline (Phase 51 — Gap #7)', async () => {
    const msgs = await messages(MapProductDto, {
      productId: uuid,
      stockQty: 5,
      lowStockThreshold: 3,
    });
    expect(msgs).toEqual([]);
  });

  it('rejects lowStockThreshold < 0', async () => {
    const msgs = await messages(MapProductDto, {
      productId: uuid,
      stockQty: 5,
      lowStockThreshold: -1,
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects negative price', async () => {
    const msgs = await messages(MapProductDto, {
      productId: uuid,
      stockQty: 5,
      settlementPrice: -5,
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects an oversized pickupAddress', async () => {
    const msgs = await messages(MapProductDto, {
      productId: uuid,
      stockQty: 5,
      pickupAddress: 'a'.repeat(501),
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});

describe('UpdateMappingDto (Phase 51 + Phase 58)', () => {
  it('accepts an empty payload', async () => {
    const msgs = await messages(UpdateMappingDto, {});
    expect(msgs).toEqual([]);
  });

  it('rejects an invalid pickupPincode on update', async () => {
    const msgs = await messages(UpdateMappingDto, { pickupPincode: 'abc' });
    expect(msgs.length).toBeGreaterThan(0);
  });

  // Phase 58 (2026-05-22) — isActive removed from UpdateMappingDto
  // (audit Gaps #3 + #9). The DTO no longer validates the field; the
  // controller's updateData loop also doesn't copy it. Sellers must
  // use POST /mapping/:id/pause for an explicit STOPPED transition.
  it('does not validate isActive — silently dropped by ValidationPipe whitelist (Phase 58)', async () => {
    // A non-boolean isActive used to surface as a class-validator
    // error; now there are zero decorators on the field, so even
    // garbage values pass validation. The runtime defense is the
    // controller's allowlist loop, NOT the DTO.
    const msgs = await messages(UpdateMappingDto, { isActive: 'yes' as any });
    expect(msgs).toEqual([]);
  });
});

describe('BulkStockUpdateDto (Phase 51)', () => {
  it('accepts a valid 1-row batch', async () => {
    const msgs = await messages(BulkStockUpdateDto, {
      updates: [{ mappingId: uuid, stockQty: 5 }],
    });
    expect(msgs).toEqual([]);
  });

  it('rejects an empty updates array', async () => {
    const msgs = await messages(BulkStockUpdateDto, { updates: [] });
    expect(msgs.some((m) => m.toLowerCase().includes('empty'))).toBe(true);
  });

  it('rejects > 100 updates', async () => {
    const updates = Array.from({ length: 101 }, () => ({ mappingId: uuid, stockQty: 1 }));
    const msgs = await messages(BulkStockUpdateDto, { updates });
    expect(msgs.some((m) => m.toLowerCase().includes('100'))).toBe(true);
  });

  it('accepts lowStockThreshold per row (Phase 51 — Gap #4)', async () => {
    const msgs = await messages(BulkStockUpdateDto, {
      updates: [{ mappingId: uuid, stockQty: 5, lowStockThreshold: 2 }],
    });
    expect(msgs).toEqual([]);
  });

  it('rejects a non-UUID mappingId inside a row', async () => {
    const msgs = await messages(BulkStockUpdateDto, {
      updates: [{ mappingId: 'not-a-uuid', stockQty: 5 }],
    });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects a row with negative stockQty', async () => {
    const msgs = await messages(BulkStockUpdateDto, {
      updates: [{ mappingId: uuid, stockQty: -1 }],
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});
