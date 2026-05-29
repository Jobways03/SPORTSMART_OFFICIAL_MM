// Phase 159g — Form 26Q quarterly export.
//   - affiliate Form 26Q CSV (full PAN, BSR, CBDT columns, NIL return,
//     filingPeriod validation, formula-injection-safe);
//   - the shared escaper fix for the LIVE seller Form 26Q export.

import { AffiliatePayoutService } from '../../src/modules/affiliate/application/services/affiliate-payout.service';
import { Form26QReportService } from '../../src/modules/tax/application/services/form-26q-report.service';
import { BadRequestException } from '@nestjs/common';
import { BadRequestAppException } from '../../src/core/exceptions';

function buildAffiliateSvc(over: { ledgerRows?: any[]; kyc?: any[]; pan?: string } = {}) {
  const prisma = {
    affiliateTds194OLedger: { findMany: jest.fn().mockResolvedValue(over.ledgerRows ?? []) },
    affiliateKyc: { findMany: jest.fn().mockResolvedValue(over.kyc ?? []) },
  } as any;
  const encryption = { decrypt: jest.fn().mockReturnValue(over.pan ?? 'ABCDE1234F') } as any;
  const svc = new AffiliatePayoutService(prisma, encryption, {} as any, {} as any, {} as any);
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return svc;
}

const LEDGER_ROW = {
  affiliateId: 'a1',
  filingPeriod: '2026-Q1',
  grossInPaise: 100000n,
  tdsInPaise: 1000n,
  tdsRateBps: 100,
  challanReference: 'CHL-9',
  bsrCode: '0123456',
  depositedAt: new Date('2026-07-01T00:00:00Z'),
  challanDate: new Date('2026-06-30T00:00:00Z'),
  certificateNumber: 'CERT-1',
  status: 'CERTIFICATE_ISSUED',
  affiliate: { id: 'a1', firstName: 'Riya', lastName: 'K' },
};

describe('AffiliatePayoutService.generateAffiliateForm26QCsv (Phase 159g)', () => {
  it('rejects a malformed filing period', async () => {
    const svc = buildAffiliateSvc();
    await expect(svc.generateAffiliateForm26QCsv('2026')).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('NIL quarter → header-only CSV with the CBDT columns', async () => {
    const svc = buildAffiliateSvc({ ledgerRows: [] });
    const csv = await svc.generateAffiliateForm26QCsv('2026-Q1');
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Deductee Type');
    expect(lines[0]).toContain('BSR Code');
    expect(lines[0]).toContain('Challan Date');
  });

  it('emits full PAN (decrypted), BSR, type, rate + amounts for a row', async () => {
    const svc = buildAffiliateSvc({
      ledgerRows: [LEDGER_ROW],
      kyc: [{ affiliateId: 'a1', panNumberEnc: 'enc', panNumberIv: 'iv' }],
      pan: 'ABCDE1234F',
    });
    const csv = await svc.generateAffiliateForm26QCsv('2026-Q1');
    const row = csv.split('\n')[1];
    expect(row).toContain('ABCDE1234F'); // full PAN from KYC decrypt
    expect(row).toContain('AFFILIATE');
    expect(row).toContain('194O');
    expect(row).toContain('0123456'); // BSR code
    expect(row).toContain('1000.00'); // TDS amount (paise→rupees)
    expect(row).toContain('1.00'); // rate %
    expect(row).toContain('30/06/2026'); // challan date IST
  });

  it('neutralises a formula-injection affiliate name', async () => {
    const svc = buildAffiliateSvc({
      ledgerRows: [{ ...LEDGER_ROW, affiliate: { id: 'a1', firstName: '=DANGER', lastName: '' } }],
      kyc: [{ affiliateId: 'a1', panNumberEnc: 'enc', panNumberIv: 'iv' }],
    });
    const csv = await svc.generateAffiliateForm26QCsv('2026-Q1');
    expect(csv).toContain("'=DANGER"); // prefixed with apostrophe → inert in Excel
    expect(csv).not.toMatch(/,=DANGER(,|$)/m); // never a bare =DANGER cell
  });
});

// ── Seller Form 26Q injection fix (live) ────────────────────────
describe('Form26QReportService.generateCsv — injection fix (Phase 159g)', () => {
  function buildSellerSvc(rows: any[]) {
    const tds = { listForPeriod: jest.fn().mockResolvedValue(rows) } as any;
    return new Form26QReportService(tds, {} as any);
  }

  it('rejects a malformed filing period', async () => {
    const svc = buildSellerSvc([]);
    await expect(svc.generateCsv('Q1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('neutralises a malicious sellerLegalName', async () => {
    const svc = buildSellerSvc([
      {
        sellerPanNumber: 'AAAAA0000A',
        sellerLegalName: '=cmd|calc',
        filingPeriod: '2026-Q1',
        netSaleInPaise: 100000n,
        tdsRateBps: 100,
        tdsInPaise: 1000n,
        challanReference: 'CHL',
        depositedAt: new Date('2026-07-01T00:00:00Z'),
        certificateNumber: 'C1',
        status: 'DEPOSITED',
      },
    ]);
    const csv = await svc.generateCsv('2026-Q1');
    expect(csv).toContain("'=cmd|calc"); // neutralised
  });
});
