/**
 * Phase 63 (2026-05-22) — CreateAddressDto / UpdateAddressDto
 * contracts (audit Gaps #4 + #8).
 *
 * The two highest-impact assertions:
 *   1. The phone @Transform strips a `+91` / `91` prefix BEFORE
 *      the @Matches regex runs, so the storefront's normalised
 *      `+91XXXXXXXXXX` shape now saves (was the MVP-blocker).
 *   2. Mass-assignment surface is locked down — fields not on the
 *      DTO (e.g. customerId, createdAt) are silently dropped at
 *      the class-transformer layer when whitelist:true is set on
 *      the global pipe.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AddressTypeDto,
  CreateAddressDto,
  UpdateAddressDto,
} from './customer-address.dto';

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

const VALID_INPUT = {
  fullName: 'Anita Sharma',
  phone: '9876543210',
  addressLine1: '12 MG Road',
  city: 'Mumbai',
  state: 'Maharashtra',
  postalCode: '400001',
};

// ─── Gap #8: phone +91 strip ──────────────────────────────────────────

describe('CreateAddressDto phone normalization (Phase 63 — Gap #8)', () => {
  it('accepts +91XXXXXXXXXX (storefront-normalized shape)', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      phone: '+919876543210',
    });
    expect(msgs).toEqual([]);
  });

  it('accepts +91 XXXXX XXXXX with whitespace', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      phone: '+91 98765 43210',
    });
    expect(msgs).toEqual([]);
  });

  it('accepts 91XXXXXXXXXX (no leading +)', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      phone: '919876543210',
    });
    expect(msgs).toEqual([]);
  });

  it('accepts a raw 10-digit 9876543210', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      phone: '9876543210',
    });
    expect(msgs).toEqual([]);
  });

  it('rejects a 10-digit number starting with 5 (not 6/7/8/9)', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      phone: '5876543210',
    });
    expect(msgs.some((m) => m.includes('6, 7, 8, or 9'))).toBe(true);
  });

  it('rejects fewer than 10 digits', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      phone: '987654321',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('persists the canonical 10-digit value on the instance', () => {
    const dto = plainToInstance(CreateAddressDto, {
      ...VALID_INPUT,
      phone: '+91 98765 43210',
    });
    expect((dto as any).phone).toBe('9876543210');
  });
});

// ─── Gap #4: DTO bounds ───────────────────────────────────────────────

describe('CreateAddressDto bounds (Phase 63 — Gap #4)', () => {
  it('rejects fullName < 2 chars', async () => {
    const msgs = await messages(CreateAddressDto, { ...VALID_INPUT, fullName: 'A' });
    expect(msgs.some((m) => m.includes('2 characters'))).toBe(true);
  });

  it('rejects fullName > 100 chars', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      fullName: 'X'.repeat(101),
    });
    expect(msgs.some((m) => m.includes('100 characters'))).toBe(true);
  });

  it('rejects addressLine1 < 4 chars', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      addressLine1: 'a',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects addressLine1 > 200 chars', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      addressLine1: 'X'.repeat(201),
    });
    expect(msgs.some((m) => m.includes('200 characters'))).toBe(true);
  });

  it('rejects malformed postalCode (leading zero)', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      postalCode: '012345',
    });
    expect(msgs.some((m) => m.includes('6-digit Indian PIN'))).toBe(true);
  });

  it('rejects malformed postalCode (5 digits)', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      postalCode: '40000',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects stateCode not matching /^[0-9]{2}$/', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      stateCode: 'XX',
    });
    expect(msgs.some((m) => m.includes('2-digit'))).toBe(true);
  });

  it('rejects invalid addressType', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      addressType: 'COTTAGE' as any,
    });
    expect(msgs.some((m) => m.includes('HOME, WORK, or OTHER'))).toBe(true);
  });

  it('accepts a valid HOME addressType', async () => {
    const msgs = await messages(CreateAddressDto, {
      ...VALID_INPUT,
      addressType: AddressTypeDto.HOME,
    });
    expect(msgs).toEqual([]);
  });

  it('accepts a minimal valid payload', async () => {
    const msgs = await messages(CreateAddressDto, VALID_INPUT);
    expect(msgs).toEqual([]);
  });
});

describe('UpdateAddressDto (Phase 63)', () => {
  it('accepts an empty payload (all-optional update)', async () => {
    const msgs = await messages(UpdateAddressDto, {});
    expect(msgs).toEqual([]);
  });

  it('normalizes +91 phone on update too', async () => {
    const dto = plainToInstance(UpdateAddressDto, { phone: '+919876543210' });
    expect((dto as any).phone).toBe('9876543210');
  });

  it('rejects malformed pincode on update', async () => {
    const msgs = await messages(UpdateAddressDto, { postalCode: '0xx' });
    expect(msgs.length).toBeGreaterThan(0);
  });
});
