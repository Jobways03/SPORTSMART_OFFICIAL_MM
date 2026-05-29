import 'reflect-metadata';
import { AdminTaxReportsController } from '../../src/modules/tax/presentation/controllers/admin-tax-reports.controller';
import { HttpStatus } from '@nestjs/common';

// Phase 25 GST — Admin tax reports controller tests.
//
// Focus on validation + handler dispatch. The underlying services
// (Gstr1ReportService, etc.) are themselves covered in their own specs.

function makeController(): {
  controller: AdminTaxReportsController;
  readiness: any;
  mode: any;
  gstr1: any;
  gstr3b: any;
  gstr8: any;
  tcs: any;
  platformGstProfile: any;
  audit: any;
} {
  const readiness = { build: jest.fn() };
  const mode = {
    getMode: jest.fn(),
    // Phase 159w added getModeInfo (audit #14) — required by the controller.
    getModeInfo: jest
      .fn()
      .mockResolvedValue({ mode: 'AUDIT', source: 'db' }),
    setMode: jest.fn(),
  };
  const gstr1 = {
    generateB2bCsv: jest.fn().mockResolvedValue('header\nrow'),
    generateB2cLargeCsv: jest.fn().mockResolvedValue('b2cl'),
    generateB2cSmallCsv: jest.fn().mockResolvedValue('b2cs'),
    generateCreditNoteCsv: jest.fn().mockResolvedValue('cn'),
    generateHsnSummaryCsv: jest.fn().mockResolvedValue('hsn'),
    generateDocumentsIssuedCsv: jest.fn().mockResolvedValue('docs'),
  };
  const gstr3b = { generateCsv: jest.fn().mockResolvedValue('gstr3b') };
  const gstr8 = {
    generateCsv: jest.fn().mockResolvedValue('gstr8'),
    generateJsonPayload: jest.fn(),
    summarise: jest.fn(),
  };
  const tcs = {
    markFiled: jest.fn(),
    markPaidToGovt: jest.fn(),
    reverse: jest.fn(),
  };
  // Phase 159z (audit B3) — controller now takes PlatformGstProfileService.
  const platformGstProfile = {
    requireDefault: jest.fn().mockResolvedValue({
      gstin: '27AAACR4849R1ZL',
      gstStateCode: '27',
      isDefault: true,
      isActive: true,
    }),
    getDefault: jest.fn(),
  };
  const tds = { listForPeriod: jest.fn(), markDeposited: jest.fn(), markCertificateIssued: jest.fn() };
  const form26q = { generateCsv: jest.fn(), summarise: jest.fn(), renderForm16AHtml: jest.fn() };
  const marketplaceCommissionGstr = { generateCsv: jest.fn() };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const controller = new AdminTaxReportsController(
    readiness as any,
    mode as any,
    gstr1 as any,
    gstr3b as any,
    gstr8 as any,
    tcs as any,
    tds as any,
    form26q as any,
    marketplaceCommissionGstr as any,
    platformGstProfile as any,
    audit as any,
  );
  return {
    controller,
    readiness,
    mode,
    gstr1,
    gstr3b,
    gstr8,
    tcs,
    platformGstProfile,
    audit,
  };
}

function makeRes() {
  const res: any = {
    setHeader: jest.fn(),
    send: jest.fn(),
  };
  return res;
}

describe('AdminTaxReportsController.getMode', () => {
  it('returns the current mode + source', async () => {
    const { controller, mode } = makeController();
    mode.getModeInfo.mockResolvedValue({ mode: 'AUDIT', source: 'db' });
    const r = await controller.getMode();
    expect(r.data.mode).toBe('AUDIT');
    expect(r.data.source).toBe('db');
  });
});

describe('AdminTaxReportsController.auditReadiness', () => {
  it('serialises BigInt values in the report', async () => {
    const { controller, readiness } = makeController();
    readiness.build.mockResolvedValue({
      currentMode: 'AUDIT',
      ready: false,
      generatedAt: new Date(),
      blockers: [],
      totalBlockers: 0,
      totalTcs: 123n,
    });
    const r = await controller.auditReadiness();
    expect(r.success).toBe(true);
    // BigInt serialised to string via the controller's helper.
    expect(typeof (r.data as any).totalTcs).toBe('string');
  });
});

// Phase 36 added @Req() req as the leading parameter on every CSV
// endpoint; Phase 159z (GSTR-8 audit) added schemaVersion / pagination
// / ARN. The req object only needs to carry an adminId for these tests.
const req = { adminId: 'a-1' } as any;

describe('AdminTaxReportsController.gstr1B2bCsv', () => {
  it('requires sellerId + filingPeriod', async () => {
    const { controller } = makeController();
    const res = makeRes();
    await expect(controller.gstr1B2bCsv(req, res)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    await expect(
      controller.gstr1B2bCsv(req, res, 'sel-1'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('rejects malformed filingPeriod', async () => {
    const { controller } = makeController();
    const res = makeRes();
    await expect(
      controller.gstr1B2bCsv(req, res, 'sel-1', '202604'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('sets Content-Disposition with a safe filename', async () => {
    const { controller, gstr1 } = makeController();
    const res = makeRes();
    await controller.gstr1B2bCsv(req, res, 'sel-1', '2026-04');
    expect(gstr1.generateB2bCsv).toHaveBeenCalledWith({
      sellerId: 'sel-1',
      filingPeriod: '2026-04',
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(/gstr1-b2b-sel-1-2026-04\.csv/),
    );
    expect(res.send).toHaveBeenCalledWith('header\nrow');
  });
});

describe('AdminTaxReportsController.gstr1SectionCsv', () => {
  it('routes section names to the right service method', async () => {
    const { controller, gstr1 } = makeController();
    const res = makeRes();
    await controller.gstr1SectionCsv(req, res, 'b2c-large', 'sel-1', '2026-04');
    expect(gstr1.generateB2cLargeCsv).toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('b2cl');

    await controller.gstr1SectionCsv(req, res, 'section7', 'sel-1', '2026-04');
    expect(gstr1.generateB2cSmallCsv).toHaveBeenCalled();

    await controller.gstr1SectionCsv(req, res, 'credit-notes', 'sel-1', '2026-04');
    expect(gstr1.generateCreditNoteCsv).toHaveBeenCalled();

    await controller.gstr1SectionCsv(req, res, 'hsn', 'sel-1', '2026-04');
    expect(gstr1.generateHsnSummaryCsv).toHaveBeenCalled();

    await controller.gstr1SectionCsv(req, res, 'section13', 'sel-1', '2026-04');
    expect(gstr1.generateDocumentsIssuedCsv).toHaveBeenCalled();
  });

  it('rejects unknown section names', async () => {
    const { controller } = makeController();
    const res = makeRes();
    await expect(
      controller.gstr1SectionCsv(req, res, 'garbage', 'sel-1', '2026-04'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });
});

describe('AdminTaxReportsController.gstr3bCsv', () => {
  it('produces 3B CSV per (seller, period)', async () => {
    const { controller, gstr3b } = makeController();
    const res = makeRes();
    await controller.gstr3bCsv(req, res, 'sel-1', '2026-04');
    expect(gstr3b.generateCsv).toHaveBeenCalledWith({
      sellerId: 'sel-1',
      filingPeriod: '2026-04',
    });
  });
});

describe('AdminTaxReportsController.gstr8Csv', () => {
  it('streams CSV without requiring sellerId (platform-side report)', async () => {
    const { controller, gstr8 } = makeController();
    gstr8.streamCsv = jest
      .fn()
      .mockResolvedValue({ rowsEmitted: 0, bytesWritten: 0 });
    const res = makeRes();
    await controller.gstr8Csv(req, res, '2026-04');
    expect(gstr8.streamCsv).toHaveBeenCalledWith(
      res,
      '2026-04',
      expect.objectContaining({ schemaVersion: '2024-Q3' }),
    );
  });

  it('requires filingPeriod', async () => {
    const { controller } = makeController();
    const res = makeRes();
    await expect(controller.gstr8Csv(req, res)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  // Phase 159z (audit #12) — future periods are rejected up-front.
  it('rejects future filing periods', async () => {
    const { controller } = makeController();
    const res = makeRes();
    await expect(
      controller.gstr8Csv(req, res, '2099-12'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  // Phase 159z (audit #7) — unknown schemaVersion is rejected.
  it('rejects unknown schemaVersion', async () => {
    const { controller } = makeController();
    const res = makeRes();
    await expect(
      controller.gstr8Csv(req, res, '2026-04', 'not-real'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });
});

describe('AdminTaxReportsController.gstr8Json', () => {
  // Phase 159z (audit B3) — operatorGstin no longer accepted as a
  // query param; the controller resolves it from PlatformGstProfile.
  it('resolves operator GSTIN from PlatformGstProfile (server-side)', async () => {
    const { controller, gstr8 } = makeController();
    gstr8.generateJsonPayload.mockResolvedValue({
      gstin: '27AAACR4849R1ZL',
      ret_period: '042026',
      schema_version: '2024-Q3',
      details: [],
    });
    const r = await controller.gstr8Json(req, '2026-04');
    expect(r.success).toBe(true);
    expect(gstr8.generateJsonPayload).toHaveBeenCalledWith(
      '2026-04',
      '27AAACR4849R1ZL',
      expect.objectContaining({ schemaVersion: '2024-Q3' }),
    );
  });

  it('refuses to export when the Platform GST profile is missing', async () => {
    const { controller, platformGstProfile } = makeController();
    platformGstProfile.requireDefault.mockRejectedValue(
      new Error('No default Platform GST profile configured'),
    );
    await expect(
      controller.gstr8Json(req, '2026-04'),
    ).rejects.toThrow(/Platform GST profile/);
  });
});

describe('AdminTaxReportsController.gstr8Summary', () => {
  it('serialises BigInt to string + forwards pagination', async () => {
    const { controller, gstr8 } = makeController();
    gstr8.summarise.mockResolvedValue({
      filingPeriod: '2026-04',
      sellerCount: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      totalTcsInPaise: 25_000_00n,
    });
    const r = await controller.gstr8Summary(req, '2026-04', '1', '50');
    expect((r.data as any).totalTcsInPaise).toBe('2500000');
    expect(gstr8.summarise).toHaveBeenCalledWith({
      filingPeriod: '2026-04',
      page: 1,
      pageSize: 50,
    });
  });
});

describe('AdminTaxReportsController.markFiled', () => {
  it('forwards ledgerIds + ARN to the service + audits the flipped rows', async () => {
    const { controller, tcs, audit } = makeController();
    tcs.markFiled.mockResolvedValue({
      flippedCount: 2,
      flippedIds: ['l-1', 'l-2'],
    });
    const r = await controller.markFiled(req, {
      ledgerIds: ['l-1', 'l-2'],
      nicArn: 'AA1234567890123',
    });
    expect(tcs.markFiled).toHaveBeenCalledWith({
      ledgerIds: ['l-1', 'l-2'],
      filedBy: 'a-1',
      nicArn: 'AA1234567890123',
    });
    expect(r.data.flipped).toBe(2);
    expect(r.data.requested).toBe(2);
    // Phase 159z (lifecycle audits) — one audit row per flipped ledger.
    expect(audit.writeAuditLog).toHaveBeenCalledTimes(2);
  });
});

describe('AdminTaxReportsController.markPaid', () => {
  it('passes paymentReference through + audits per row', async () => {
    const { controller, tcs, audit } = makeController();
    tcs.markPaidToGovt.mockResolvedValue({
      flippedCount: 1,
      flippedIds: ['l-1'],
    });
    const r = await controller.markPaid(req, {
      ledgerIds: ['l-1'],
      paymentReference: 'UTR-12345',
    });
    expect(tcs.markPaidToGovt).toHaveBeenCalledWith({
      ledgerIds: ['l-1'],
      paidBy: 'a-1',
      paymentReference: 'UTR-12345',
    });
    expect(r.data.flipped).toBe(1);
    expect(audit.writeAuditLog).toHaveBeenCalledTimes(1);
  });
});

describe('AdminTaxReportsController.reverseTcs', () => {
  it('writes audit row with previousStatus + new status', async () => {
    const { controller, tcs, audit } = makeController();
    tcs.reverse.mockResolvedValue({
      ledger: { id: 'l-1', status: 'REVERSED' },
      previousStatus: 'FILED',
      wasAlreadyReversed: false,
    });
    const r = await controller.reverseTcs(
      req,
      '00112233-aabb-ccdd-eeff-001122334455',
      { reason: 'duplicate row' },
    );
    expect(r.success).toBe(true);
    expect(tcs.reverse).toHaveBeenCalledWith({
      ledgerId: '00112233-aabb-ccdd-eeff-001122334455',
      reversedBy: 'a-1',
      reason: 'duplicate row',
    });
    expect(audit.writeAuditLog).toHaveBeenCalledTimes(1);
    const call = audit.writeAuditLog.mock.calls[0][0];
    expect(call.action).toBe('tax.tcs.reversed');
    expect(call.oldValue).toEqual({ status: 'FILED' });
  });

  it('rejects malformed ledgerId path param', async () => {
    const { controller } = makeController();
    await expect(
      controller.reverseTcs(req, 'short', { reason: 'oops oops' }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });
});
