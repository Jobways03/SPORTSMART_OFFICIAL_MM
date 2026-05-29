import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PosRecordSaleDto } from '../../src/modules/franchise/presentation/dtos/pos-record-sale.dto';

/**
 * Phase 159q — POS record-sale DTO guards.
 *   #7  paymentMethod is required (no silent CASH default)
 *   #12 quantity / unitPrice bounded
 *   #16 line-item array capped
 */
const validItem = { productId: '123e4567-e89b-42d3-a456-426614174000', quantity: 1, unitPrice: 100 };

describe('PosRecordSaleDto validation', () => {
  it('#7 — rejects a missing paymentMethod', async () => {
    const errors = await validate(plainToInstance(PosRecordSaleDto, { items: [validItem] }));
    expect(errors.some((e) => e.property === 'paymentMethod')).toBe(true);
  });

  it('#12 — rejects quantity over the 10,000 cap', async () => {
    const errors = await validate(
      plainToInstance(PosRecordSaleDto, {
        paymentMethod: 'CASH',
        items: [{ ...validItem, quantity: 1_000_000 }],
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('#12 — rejects unitPrice over the 1,000,000 cap', async () => {
    const errors = await validate(
      plainToInstance(PosRecordSaleDto, {
        paymentMethod: 'CASH',
        items: [{ ...validItem, unitPrice: 99_999_999 }],
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('#16 — rejects more than 200 line items', async () => {
    const many = Array.from({ length: 201 }, () => ({ ...validItem }));
    const errors = await validate(plainToInstance(PosRecordSaleDto, { paymentMethod: 'CASH', items: many }));
    expect(errors.some((e) => e.property === 'items')).toBe(true);
  });

  it('accepts a valid sale', async () => {
    const errors = await validate(
      plainToInstance(PosRecordSaleDto, { paymentMethod: 'CASH', items: [validItem] }),
    );
    expect(errors.length).toBe(0);
  });
});
