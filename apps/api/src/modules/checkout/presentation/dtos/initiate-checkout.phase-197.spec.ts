/**
 * Phase 197 (Checkout audit #4) — InitiateCheckoutDto contract.
 *
 * Pre-Phase-197 POST /customer/checkout/initiate took an untyped
 * `@Body() body: { addressId: string }` — a missing or non-UUID
 * addressId sailed past the controller. The DTO closes that.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InitiateCheckoutDto } from './place-order.dto';

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
    await validate(plainToInstance(InitiateCheckoutDto, input) as object),
  );
}

const UUID = '00000000-0000-4000-8000-000000000001';

describe('InitiateCheckoutDto (Phase 197 — Checkout #4)', () => {
  it('rejects a missing addressId', async () => {
    const msgs = await messages({});
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects a non-UUID addressId', async () => {
    const msgs = await messages({ addressId: 'not-a-uuid' });
    expect(msgs.some((m) => m.includes('addressId must be a UUID'))).toBe(true);
  });

  it('accepts a valid UUID addressId', async () => {
    expect(await messages({ addressId: UUID })).toEqual([]);
  });
});
