// Phase 199 (2026-06-02) — Returns Flow audit #7 / #14 DTO coverage.
//
// #7  — CreateReturnDto.evidenceFileUrls must reject non-media /
//        non-https URLs at the DTO boundary (defence-in-depth on top of
//        the service's validateEvidenceUrls allowlist).
// #14 — CustomerMarkHandedOverDto.trackingNumber must reject values
//        outside the courier-AWB charset / length.

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateReturnDto } from './create-return.dto';
import { CustomerMarkHandedOverDto } from './customer-mark-handed-over.dto';

async function constraintsFor<T extends object>(
  cls: new () => T,
  input: unknown,
): Promise<string[]> {
  const dto = plainToInstance(cls, input);
  const errs = await validate(dto as object);
  // Flatten nested (each: true) constraint messages too.
  const collect = (e: any): string[] => [
    ...(Object.values(e.constraints ?? {}) as string[]),
    ...((e.children ?? []) as any[]).flatMap(collect),
  ];
  return errs.flatMap(collect) as string[];
}

const baseReturn = {
  subOrderId: '00000000-0000-4000-8000-000000000001',
  items: [
    {
      orderItemId: '00000000-0000-4000-8000-000000000002',
      quantity: 1,
      reasonCategory: 'DEFECTIVE',
    },
  ],
  forfeitConsent: true,
};

describe('CreateReturnDto.evidenceFileUrls (Phase 199 #7)', () => {
  it('accepts a media https URL', async () => {
    const msgs = await constraintsFor(CreateReturnDto, {
      ...baseReturn,
      evidenceFileUrls: ['https://placehold.co/demo/a.jpg'],
    });
    expect(msgs).toHaveLength(0);
  });

  it('accepts any well-formed https URL at the DTO layer (host allowlist is enforced service-side against the R2 host)', async () => {
    // The DTO does https/tld format validation only; the authoritative
    // host allowlist (derived from R2_PUBLIC_BASE_URL) lives in
    // ReturnService.validateEvidenceUrls, which can't be expressed in a
    // static decorator.
    const msgs = await constraintsFor(CreateReturnDto, {
      ...baseReturn,
      evidenceFileUrls: ['https://evil.example.com/a.jpg'],
    });
    expect(msgs).toHaveLength(0);
  });

  it('rejects an http:// (non-TLS) media URL', async () => {
    const msgs = await constraintsFor(CreateReturnDto, {
      ...baseReturn,
      evidenceFileUrls: ['http://placehold.co/demo/a.jpg'],
    });
    expect(msgs.join(' ')).toMatch(/URL/i);
  });

  it('rejects a non-URL string', async () => {
    const msgs = await constraintsFor(CreateReturnDto, {
      ...baseReturn,
      evidenceFileUrls: ['not-a-url'],
    });
    expect(msgs.join(' ')).toMatch(/URL/i);
  });
});

describe('CustomerMarkHandedOverDto.trackingNumber (Phase 199 #14)', () => {
  it('accepts a normal alphanumeric AWB', async () => {
    const msgs = await constraintsFor(CustomerMarkHandedOverDto, {
      trackingNumber: 'AWB-12345678',
    });
    expect(msgs).toHaveLength(0);
  });

  it('accepts an omitted tracking number (optional)', async () => {
    const msgs = await constraintsFor(CustomerMarkHandedOverDto, {});
    expect(msgs).toHaveLength(0);
  });

  it('rejects a value with markup / control characters', async () => {
    const msgs = await constraintsFor(CustomerMarkHandedOverDto, {
      trackingNumber: '<script>alert(1)</script>',
    });
    expect(msgs.join(' ')).toMatch(/Tracking number/i);
  });

  it('rejects a too-short value', async () => {
    const msgs = await constraintsFor(CustomerMarkHandedOverDto, {
      trackingNumber: 'AB1',
    });
    expect(msgs.join(' ')).toMatch(/Tracking number/i);
  });
});
