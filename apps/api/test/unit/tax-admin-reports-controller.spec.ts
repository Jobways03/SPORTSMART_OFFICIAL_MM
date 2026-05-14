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
} {
  const readiness = { build: jest.fn() };
  const mode = { getMode: jest.fn() };
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
  const tcs = { markFiled: jest.fn(), markPaidToGovt: jest.fn() };
  const controller = new AdminTaxReportsController(
    readiness as any,
    mode as any,
    gstr1 as any,
    gstr3b as any,
    gstr8 as any,
    tcs as any,
  );
  return { controller, readiness, mode, gstr1, gstr3b, gstr8, tcs };
}

function makeRes() {
  const res: any = {
    setHeader: jest.fn(),
    send: jest.fn(),
  };
  return res;
}

describe('AdminTaxReportsController.getMode', () => {
  it('returns the current mode', async () => {
    const { controller, mode } = makeController();
    mode.getMode.mockResolvedValue('AUDIT');
    const r = await controller.getMode();
    expect(r.data.mode).toBe('AUDIT');
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

describe('AdminTaxReportsController.gstr1B2bCsv', () => {
  it('requires sellerId + filingPeriod', async () => {
    const { controller } = makeController();
    const res = makeRes();
    await expect(controller.gstr1B2bCsv(res)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    await expect(
      controller.gstr1B2bCsv(res, 'sel-1'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('rejects malformed filingPeriod', async () => {
    const { controller } = makeController();
    const res = makeRes();
    await expect(
      controller.gstr1B2bCsv(res, 'sel-1', '202604'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('sets Content-Disposition with a safe filename', async () => {
    const { controller, gstr1 } = makeController();
    const res = makeRes();
    await controller.gstr1B2bCsv(res, 'sel-1', '2026-04');
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
    await controller.gstr1SectionCsv(res, 'b2c-large', 'sel-1', '2026-04');
    expect(gstr1.generateB2cLargeCsv).toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('b2cl');

    await controller.gstr1SectionCsv(res, 'section7', 'sel-1', '2026-04');
    expect(gstr1.generateB2cSmallCsv).toHaveBeenCalled();

    await controller.gstr1SectionCsv(res, 'credit-notes', 'sel-1', '2026-04');
    expect(gstr1.generateCreditNoteCsv).toHaveBeenCalled();

    await controller.gstr1SectionCsv(res, 'hsn', 'sel-1', '2026-04');
    expect(gstr1.generateHsnSummaryCsv).toHaveBeenCalled();

    await controller.gstr1SectionCsv(res, 'section13', 'sel-1', '2026-04');
    expect(gstr1.generateDocumentsIssuedCsv).toHaveBeenCalled();
  });

  it('rejects unknown section names', async () => {
    const { controller } = makeController();
    const res = makeRes();
    await expect(
      controller.gstr1SectionCsv(res, 'garbage', 'sel-1', '2026-04'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });
});

describe('AdminTaxReportsController.gstr3bCsv', () => {
  it('produces 3B CSV per (seller, period)', async () => {
    const { controller, gstr3b } = makeController();
    const res = makeRes();
    await controller.gstr3bCsv(res, 'sel-1', '2026-04');
    expect(gstr3b.generateCsv).toHaveBeenCalledWith({
      sellerId: 'sel-1',
      filingPeriod: '2026-04',
    });
  });
});

describe('AdminTaxReportsController.gstr8Csv', () => {
  it('does NOT require sellerId (platform-side report)', async () => {
    const { controller, gstr8 } = makeController();
    const res = makeRes();
    await controller.gstr8Csv(res, '2026-04');
    expect(gstr8.generateCsv).toHaveBeenCalledWith('2026-04');
  });

  it('requires filingPeriod', async () => {
    const { controller } = makeController();
    const res = makeRes();
    await expect(controller.gstr8Csv(res)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });
});

describe('AdminTaxReportsController.gstr8Json', () => {
  it('requires operatorGstin', async () => {
    const { controller } = makeController();
    await expect(
      controller.gstr8Json('2026-04'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('returns the JSON payload + operator GSTIN', async () => {
    const { controller, gstr8 } = makeController();
    gstr8.generateJsonPayload.mockResolvedValue({
      gstin: '29ABCDE1234F1Z5',
      ret_period: '042026',
      details: [],
    });
    const r = await controller.gstr8Json('2026-04', '29ABCDE1234F1Z5');
    expect(r.success).toBe(true);
    expect(gstr8.generateJsonPayload).toHaveBeenCalledWith(
      '2026-04',
      '29ABCDE1234F1Z5',
    );
  });
});

describe('AdminTaxReportsController.gstr8Summary', () => {
  it('serialises BigInt to string', async () => {
    const { controller, gstr8 } = makeController();
    gstr8.summarise.mockResolvedValue({
      filingPeriod: '2026-04',
      sellerCount: 2,
      totalTcsInPaise: 25_000_00n,
    });
    const r = await controller.gstr8Summary('2026-04');
    expect((r.data as any).totalTcsInPaise).toBe('2500000');
  });
});

describe('AdminTaxReportsController.markFiled', () => {
  it('rejects non-array ledgerIds', async () => {
    const { controller } = makeController();
    await expect(
      controller.markFiled({ adminId: 'a-1' }, { ledgerIds: 'not-array' as any }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('passes adminId from req as filedBy', async () => {
    const { controller, tcs } = makeController();
    tcs.markFiled.mockResolvedValue(2);
    const r = await controller.markFiled(
      { adminId: 'a-1' },
      { ledgerIds: ['l-1', 'l-2'] },
    );
    expect(tcs.markFiled).toHaveBeenCalledWith({
      ledgerIds: ['l-1', 'l-2'],
      filedBy: 'a-1',
    });
    expect(r.data.flipped).toBe(2);
    expect(r.data.requested).toBe(2);
  });
});

describe('AdminTaxReportsController.markPaid', () => {
  it('rejects missing paymentReference', async () => {
    const { controller } = makeController();
    await expect(
      controller.markPaid(
        { adminId: 'a-1' },
        { ledgerIds: ['l-1'], paymentReference: '' },
      ),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('passes paymentReference through to the service', async () => {
    const { controller, tcs } = makeController();
    tcs.markPaidToGovt.mockResolvedValue(1);
    const r = await controller.markPaid(
      { adminId: 'a-1' },
      { ledgerIds: ['l-1'], paymentReference: 'UTR-12345' },
    );
    expect(tcs.markPaidToGovt).toHaveBeenCalledWith({
      ledgerIds: ['l-1'],
      paidBy: 'a-1',
      paymentReference: 'UTR-12345',
    });
    expect(r.data.flipped).toBe(1);
  });
});
