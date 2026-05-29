/**
 * Phase 55 (2026-05-21) — locks the procurement-receipt DTO
 * contract. Pre-Phase-55 nothing enforced damagedQty <= receivedQty;
 * a frontend bug could push goodQty = received - damaged into
 * negative territory and corrupt stock.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ProcurementReceiptDto,
  ReceiptItemDto,
} from './procurement-receipt.dto';

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
  const dto = plainToInstance(cls, input);
  const errs = await validate(dto as object);
  return flattenErrors(errs);
}

const uuid = '00000000-0000-4000-8000-000000000001';

describe('ReceiptItemDto (Phase 55)', () => {
  it('accepts a valid row', async () => {
    const msgs = await messages(ReceiptItemDto, {
      itemId: uuid,
      receivedQty: 5,
      damagedQty: 1,
    });
    expect(msgs).toEqual([]);
  });

  it('rejects damagedQty > receivedQty (Phase 55 cross-field check)', async () => {
    const msgs = await messages(ReceiptItemDto, {
      itemId: uuid,
      receivedQty: 5,
      damagedQty: 10,
    });
    expect(msgs.some((m) => m.toLowerCase().includes('damagedqty'))).toBe(true);
  });

  it('accepts damagedQty equal to receivedQty (full damage)', async () => {
    const msgs = await messages(ReceiptItemDto, {
      itemId: uuid,
      receivedQty: 5,
      damagedQty: 5,
    });
    expect(msgs).toEqual([]);
  });

  it('rejects non-UUID itemId', async () => {
    const msgs = await messages(ReceiptItemDto, {
      itemId: 'not-a-uuid',
      receivedQty: 5,
    });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects negative receivedQty', async () => {
    const msgs = await messages(ReceiptItemDto, {
      itemId: uuid,
      receivedQty: -1,
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects fractional receivedQty', async () => {
    const msgs = await messages(ReceiptItemDto, {
      itemId: uuid,
      receivedQty: 5.5,
    });
    expect(msgs.some((m) => m.toLowerCase().includes('whole'))).toBe(true);
  });

  it('rejects unreasonably large receivedQty', async () => {
    const msgs = await messages(ReceiptItemDto, {
      itemId: uuid,
      receivedQty: 10_000_001,
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});

describe('ProcurementReceiptDto (Phase 55)', () => {
  it('accepts a valid batch', async () => {
    const msgs = await messages(ProcurementReceiptDto, {
      items: [
        { itemId: uuid, receivedQty: 5, damagedQty: 0 },
        { itemId: uuid, receivedQty: 10 },
      ],
    });
    expect(msgs).toEqual([]);
  });

  it('propagates per-row errors through nested validation', async () => {
    const msgs = await messages(ProcurementReceiptDto, {
      items: [{ itemId: uuid, receivedQty: 5, damagedQty: 10 }],
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});
