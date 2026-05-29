/**
 * Phase 66 (2026-05-22) — PlaceOrderDto + VerifyPaymentDto +
 * RetryPaymentDto contracts (audit Gaps #6 + #13).
 *
 * Pre-Phase-66 the body was an inline TS interface so any value of
 * paymentMethod that wasn't 'ONLINE' silently became COD. Walking
 * the validator through the same cases catches the regression.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  PlaceOrderDto,
  PlaceOrderPaymentMethod,
  RetryPaymentDto,
  VerifyPaymentDto,
} from './place-order.dto';

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

describe('PlaceOrderDto (Phase 66 — Gaps #6 + #13)', () => {
  it('accepts an empty body (all optional)', async () => {
    const msgs = await messages(PlaceOrderDto, {});
    expect(msgs).toEqual([]);
  });

  it('rejects paymentMethod="UPI" — pre-Phase-66 silently became COD', async () => {
    const msgs = await messages(PlaceOrderDto, { paymentMethod: 'UPI' });
    expect(msgs.some((m) => m.includes('COD or ONLINE'))).toBe(true);
  });

  it('rejects paymentMethod="cod" — strict enum match (after upper-case transform it becomes COD which is valid)', async () => {
    // Note: the @Transform upper() runs first, so 'cod' → 'COD'.
    // This is the desired UX (case-insensitive input); the spec
    // documents the canonicalization.
    const dto = plainToInstance(PlaceOrderDto, { paymentMethod: 'cod' });
    expect((dto as any).paymentMethod).toBe('COD');
  });

  it('accepts COD', async () => {
    const msgs = await messages(PlaceOrderDto, {
      paymentMethod: PlaceOrderPaymentMethod.COD,
    });
    expect(msgs).toEqual([]);
  });

  it('accepts ONLINE', async () => {
    const msgs = await messages(PlaceOrderDto, {
      paymentMethod: PlaceOrderPaymentMethod.ONLINE,
    });
    expect(msgs).toEqual([]);
  });

  it('rejects walletApplyAmountInPaise < 0', async () => {
    const msgs = await messages(PlaceOrderDto, { walletApplyAmountInPaise: -1 });
    expect(msgs.some((m) => m.includes('non-negative'))).toBe(true);
  });

  it('rejects fractional walletApplyAmountInPaise', async () => {
    const msgs = await messages(PlaceOrderDto, { walletApplyAmountInPaise: 1.5 });
    expect(msgs.some((m) => m.includes('integer'))).toBe(true);
  });

  it('rejects couponCode > 64 chars', async () => {
    const msgs = await messages(PlaceOrderDto, { couponCode: 'X'.repeat(65) });
    expect(msgs.some((m) => m.includes('64'))).toBe(true);
  });

  it('canonicalises couponCode to upper-case', () => {
    const dto = plainToInstance(PlaceOrderDto, { couponCode: 'summer10' });
    expect((dto as any).couponCode).toBe('SUMMER10');
  });

  it('rejects non-UUID shippingOptionId', async () => {
    const msgs = await messages(PlaceOrderDto, { shippingOptionId: 'bad' });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects non-UUID taxProfileId', async () => {
    const msgs = await messages(PlaceOrderDto, { taxProfileId: 'bad' });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('accepts a fully populated valid payload', async () => {
    const msgs = await messages(PlaceOrderDto, {
      paymentMethod: PlaceOrderPaymentMethod.ONLINE,
      couponCode: 'SUMMER10',
      referralCode: 'refABC',
      walletApplyAmountInPaise: 5000,
      shippingOptionId: UUID,
      taxProfileId: UUID,
    });
    expect(msgs).toEqual([]);
  });
});

describe('VerifyPaymentDto (Phase 66)', () => {
  it('rejects empty razorpayOrderId', async () => {
    const msgs = await messages(VerifyPaymentDto, {
      razorpayPaymentId: 'pay_1',
      razorpaySignature: 'sig',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects oversized razorpaySignature', async () => {
    const msgs = await messages(VerifyPaymentDto, {
      razorpayOrderId: 'order_1',
      razorpayPaymentId: 'pay_1',
      razorpaySignature: 'X'.repeat(300),
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts a valid payload', async () => {
    const msgs = await messages(VerifyPaymentDto, {
      razorpayOrderId: 'order_ABC123',
      razorpayPaymentId: 'pay_DEF456',
      razorpaySignature: 'ab'.repeat(32),
    });
    expect(msgs).toEqual([]);
  });
});

describe('RetryPaymentDto (Phase 66)', () => {
  it('rejects empty orderNumber', async () => {
    const msgs = await messages(RetryPaymentDto, {});
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts a valid orderNumber', async () => {
    const msgs = await messages(RetryPaymentDto, { orderNumber: 'SM-0001' });
    expect(msgs).toEqual([]);
  });
});
