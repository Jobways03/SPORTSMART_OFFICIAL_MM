/**
 * Phase 53 (2026-05-21) — DTO contract for the seller + admin
 * adjust endpoints.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StockMovementKind } from '@prisma/client';
import {
  AdjustStockDto,
  AdminAdjustStockDto,
  StockImportDto,
} from './inventory-adjust.dto';

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

describe('AdjustStockDto (Phase 53)', () => {
  it('accepts a valid payload', async () => {
    const msgs = await messages(AdjustStockDto, {
      adjustment: 5,
      reason: 'Physical count reconciliation',
    });
    expect(msgs).toEqual([]);
  });

  it('rejects adjustment=0', async () => {
    const msgs = await messages(AdjustStockDto, {
      adjustment: 0,
      reason: 'something',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('non-zero'))).toBe(true);
  });

  it('rejects non-integer adjustment', async () => {
    const msgs = await messages(AdjustStockDto, {
      adjustment: 5.5,
      reason: 'something',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('integer'))).toBe(true);
  });

  it('rejects missing reason', async () => {
    const msgs = await messages(AdjustStockDto, { adjustment: 5 });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects reason shorter than 3 chars', async () => {
    const msgs = await messages(AdjustStockDto, { adjustment: 5, reason: 'ab' });
    expect(msgs.some((m) => m.includes('3'))).toBe(true);
  });

  it('rejects reason longer than 500 chars', async () => {
    const msgs = await messages(AdjustStockDto, {
      adjustment: 5,
      reason: 'a'.repeat(501),
    });
    expect(msgs.some((m) => m.includes('500'))).toBe(true);
  });

  it('accepts a negative adjustment with valid reason', async () => {
    const msgs = await messages(AdjustStockDto, {
      adjustment: -3,
      reason: 'Damage write-off',
    });
    expect(msgs).toEqual([]);
  });
});

describe('StockImportDto (Phase 53)', () => {
  it('accepts a valid 1-row payload', async () => {
    const msgs = await messages(StockImportDto, {
      items: [{ masterSku: 'PRD-001-BLU-8', stockQty: 50 }],
      reason: 'Monthly count reconciliation',
    });
    expect(msgs).toEqual([]);
  });

  it('rejects empty items array', async () => {
    const msgs = await messages(StockImportDto, {
      items: [],
      reason: 'something',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('empty'))).toBe(true);
  });

  it('rejects > 500 items', async () => {
    const items = Array.from({ length: 501 }, () => ({
      masterSku: 'A',
      stockQty: 1,
    }));
    const msgs = await messages(StockImportDto, {
      items,
      reason: 'something',
    });
    expect(msgs.some((m) => m.includes('500'))).toBe(true);
  });

  it('rejects when reason is missing', async () => {
    const msgs = await messages(StockImportDto, {
      items: [{ masterSku: 'X', stockQty: 1 }],
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects negative stockQty inside a row', async () => {
    const msgs = await messages(StockImportDto, {
      items: [{ masterSku: 'X', stockQty: -1 }],
      reason: 'something',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});

describe('AdminAdjustStockDto (Phase 53)', () => {
  it('accepts a valid payload with default kind (MANUAL_ADJUST)', async () => {
    const msgs = await messages(AdminAdjustStockDto, {
      mappingId: uuid,
      adjustment: 10,
      reason: 'Admin reconciliation',
    });
    expect(msgs).toEqual([]);
  });

  it('rejects a non-UUID mappingId', async () => {
    const msgs = await messages(AdminAdjustStockDto, {
      mappingId: 'not-a-uuid',
      adjustment: 5,
      reason: 'r' + 'a'.repeat(3),
    });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('accepts WRITE_OFF kind (permission gate enforced in controller)', async () => {
    const msgs = await messages(AdminAdjustStockDto, {
      mappingId: uuid,
      adjustment: -3,
      reason: 'Storeroom flood damage',
      kind: StockMovementKind.WRITE_OFF,
    });
    expect(msgs).toEqual([]);
  });

  it('rejects an invalid kind value', async () => {
    const msgs = await messages(AdminAdjustStockDto, {
      mappingId: uuid,
      adjustment: -3,
      reason: 'something',
      kind: 'NONSENSE' as any,
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});
