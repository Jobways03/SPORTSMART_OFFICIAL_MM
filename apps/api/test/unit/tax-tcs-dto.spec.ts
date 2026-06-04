import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MarkTcsPaidDto } from '../../src/modules/tax/presentation/dtos/mark-tcs-paid.dto';
import { MarkTcsCertificatesIssuedDto } from '../../src/modules/tax/presentation/dtos/mark-tcs-certificates-issued.dto';

// Phase 160 (§52 TCS lifecycle audit #15) — paymentReference must look
// like a real government remittance reference (CIN / UTR / challan):
// digits present, plausible length, restricted charset. Free-text slop
// like "garbage" must be rejected.

function errorsFor(obj: unknown) {
  return validateSync(plainToInstance(MarkTcsPaidDto, obj as any), {
    whitelist: true,
  });
}

describe('MarkTcsPaidDto.paymentReference validation', () => {
  it('rejects free-text slop with no digits ("garbage")', () => {
    const errs = errorsFor({ ledgerIds: ['l-1'], paymentReference: 'garbage' });
    expect(errs.length).toBeGreaterThan(0);
    const refErr = errs.find((e) => e.property === 'paymentReference');
    expect(refErr).toBeDefined();
  });

  it('rejects a too-short reference', () => {
    const errs = errorsFor({ ledgerIds: ['l-1'], paymentReference: 'AB12' });
    expect(errs.find((e) => e.property === 'paymentReference')).toBeDefined();
  });

  it('accepts a 17-digit CIN', () => {
    const errs = errorsFor({
      ledgerIds: ['l-1'],
      paymentReference: '12345678901234567',
    });
    expect(errs.find((e) => e.property === 'paymentReference')).toBeUndefined();
  });

  it('accepts an alphanumeric UTR with hyphens', () => {
    const errs = errorsFor({
      ledgerIds: ['l-1'],
      paymentReference: 'SBIN0R52026040100123',
    });
    expect(errs.find((e) => e.property === 'paymentReference')).toBeUndefined();
  });

  it('accepts an optional paymentProofFileId', () => {
    const errs = errorsFor({
      ledgerIds: ['l-1'],
      paymentReference: '12345678901234567',
      paymentProofFileId: 'file-abc',
    });
    expect(errs.length).toBe(0);
  });
});

describe('MarkTcsCertificatesIssuedDto validation', () => {
  it('accepts ids without a prefix', () => {
    const errs = validateSync(
      plainToInstance(MarkTcsCertificatesIssuedDto, { ledgerIds: ['l-1'] }),
    );
    expect(errs.length).toBe(0);
  });

  it('rejects a non-alphanumeric prefix', () => {
    const errs = validateSync(
      plainToInstance(MarkTcsCertificatesIssuedDto, {
        ledgerIds: ['l-1'],
        certificateNumberPrefix: 'TCS/2026',
      }),
    );
    expect(
      errs.find((e) => e.property === 'certificateNumberPrefix'),
    ).toBeDefined();
  });

  it('rejects an empty ledgerIds array', () => {
    const errs = validateSync(
      plainToInstance(MarkTcsCertificatesIssuedDto, { ledgerIds: [] }),
    );
    expect(errs.find((e) => e.property === 'ledgerIds')).toBeDefined();
  });
});
