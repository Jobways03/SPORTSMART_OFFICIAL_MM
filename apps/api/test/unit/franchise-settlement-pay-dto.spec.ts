import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FranchiseSettlementPayDto } from '../../src/modules/franchise/presentation/dtos/franchise-settlement-pay.dto';

/**
 * Phase 159v (audit #10/#17) — paymentReference (bank UTR) bounds + charset.
 */
describe('FranchiseSettlementPayDto.paymentReference', () => {
  const refErr = (errs: any[]) => errs.some((e) => e.property === 'paymentReference');
  const make = (paymentReference: any) =>
    validate(plainToInstance(FranchiseSettlementPayDto, { paymentReference }));

  it('accepts a normal NEFT UTR', async () => {
    expect(refErr(await make('SBIN0123456789012'))).toBe(false);
  });

  it('accepts an IMPS-style mixed-case reference', async () => {
    expect(refErr(await make('imps-2026/0001'))).toBe(false);
  });

  it('rejects a whitespace-only reference (trimmed → empty)', async () => {
    expect(refErr(await make('     '))).toBe(true);
  });

  it('rejects a too-short reference', async () => {
    expect(refErr(await make('AB12'))).toBe(true);
  });

  it('rejects a reference over 64 characters', async () => {
    expect(refErr(await make('A'.repeat(65)))).toBe(true);
  });

  it('rejects injection / control characters', async () => {
    expect(refErr(await make('UTR123<script>'))).toBe(true);
    expect(refErr(await make('=cmd|/c calc'))).toBe(true);
  });
});
