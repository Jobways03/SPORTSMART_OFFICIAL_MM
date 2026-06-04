import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { AdminTaxReportsController } from '../../src/modules/tax/presentation/controllers/admin-tax-reports.controller';

// Phase 163 — Tax Audit Readiness Dashboard audit remediation coverage.
//   #10 audit-readiness read is audit-logged
//   #6  scope filter threaded + invalid filingPeriod rejected
//   #5  TTL cache short-circuits a second build within the window
//   #3  STRICT-mode export readiness gate (409 / 403 / acknowledged-override)
//       + OFF/AUDIT exports unrestricted

function buildController(opts: {
  mode?: 'OFF' | 'AUDIT' | 'STRICT';
  totalBlockers?: number;
  permissions?: string[];
} = {}) {
  const report = {
    currentMode: opts.mode ?? 'OFF',
    ready: (opts.totalBlockers ?? 0) === 0,
    generatedAt: new Date(),
    blockers: [
      { code: 'tcs.unfiled', severity: 'CRITICAL', resourceType: 'tcsLedger', count: opts.totalBlockers ?? 0, sampleIds: [], message: 'x' },
    ],
    totalBlockers: opts.totalBlockers ?? 0,
    criticalBlockers: opts.totalBlockers ?? 0,
    filter: { sellerId: null, filingPeriod: null, gstProfileId: null },
  };
  const readiness = {
    build: jest.fn().mockResolvedValue(report),
    history: jest.fn().mockResolvedValue([]),
  };
  const mode = { getMode: jest.fn().mockResolvedValue(opts.mode ?? 'OFF') };
  const gstr3b = { generateCsv: jest.fn().mockResolvedValue('csv,data') };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const env = { getNumber: (_k: string, fb: number) => fb, getBoolean: (_k: string, fb: boolean) => fb };
  const ctrl = new AdminTaxReportsController(
    readiness as any, mode as any,
    {} as any, gstr3b as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    audit as any, env as any,
  );
  return { ctrl, readiness, mode, gstr3b, audit, report };
}

const reqWith = (permissions: string[] = []) => ({
  adminId: 'admin-1',
  user: { permissions },
  headers: {},
  ip: '127.0.0.1',
});
const resMock = () => ({ setHeader: jest.fn(), send: jest.fn() }) as any;

describe('auditReadiness endpoint (#10 / #6 / #5)', () => {
  it('#10 — audit-logs the read and returns the report directly', async () => {
    const { ctrl, audit } = buildController({ totalBlockers: 3 });
    const res = await ctrl.auditReadiness(reqWith(), undefined, undefined, undefined, undefined);
    expect(res.data.totalBlockers).toBe(3);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tax.readiness.viewed' }),
    );
  });

  it('#6 — rejects a malformed filingPeriod', async () => {
    const { ctrl } = buildController();
    await expect(
      ctrl.auditReadiness(reqWith(), undefined, 'not-a-period', undefined, undefined),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('#6 — threads the scope filter into build()', async () => {
    const { ctrl, readiness } = buildController();
    await ctrl.auditReadiness(reqWith(), 'seller-7', '2026-04', 'pgp-1', undefined);
    expect(readiness.build).toHaveBeenCalledWith({
      sellerId: 'seller-7',
      filingPeriod: '2026-04',
      gstProfileId: 'pgp-1',
    });
  });

  it('#5 — caches within the TTL window (second call does not rebuild)', async () => {
    const { ctrl, readiness } = buildController({ totalBlockers: 1 });
    await ctrl.auditReadiness(reqWith(), undefined, undefined, undefined, undefined);
    await ctrl.auditReadiness(reqWith(), undefined, undefined, undefined, undefined);
    expect(readiness.build).toHaveBeenCalledTimes(1);
  });

  it('#5 — refresh=true bypasses the cache', async () => {
    const { ctrl, readiness } = buildController({ totalBlockers: 1 });
    await ctrl.auditReadiness(reqWith(), undefined, undefined, undefined, undefined);
    await ctrl.auditReadiness(reqWith(), undefined, undefined, undefined, 'true');
    expect(readiness.build).toHaveBeenCalledTimes(2);
  });
});

describe('STRICT-mode export readiness gate (#3)', () => {
  const sellerId = 'seller-1';
  const period = '2026-04';

  it('OFF mode: export is unrestricted even with blockers', async () => {
    const { ctrl, gstr3b } = buildController({ mode: 'OFF', totalBlockers: 99 });
    const res = resMock();
    await ctrl.gstr3bCsv(reqWith(), res, sellerId, period, undefined);
    expect(gstr3b.generateCsv).toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('csv,data');
  });

  it('STRICT + blockers + no acknowledgement → 409 BLOCKERS_PRESENT', async () => {
    const { ctrl, gstr3b } = buildController({ mode: 'STRICT', totalBlockers: 5 });
    const res = resMock();
    await expect(
      ctrl.gstr3bCsv(reqWith(), res, sellerId, period, undefined),
    ).rejects.toMatchObject({ response: { code: 'BLOCKERS_PRESENT' } });
    expect(gstr3b.generateCsv).not.toHaveBeenCalled();
  });

  it('STRICT + blockers + acknowledge but NO permission → 403', async () => {
    const { ctrl } = buildController({ mode: 'STRICT', totalBlockers: 5 });
    const res = resMock();
    await expect(
      ctrl.gstr3bCsv(reqWith([]), res, sellerId, period, 'true'),
    ).rejects.toMatchObject({ response: { code: 'OVERRIDE_NOT_PERMITTED' } });
  });

  it('STRICT + blockers + acknowledge + permission → proceeds + audit-logged', async () => {
    const { ctrl, gstr3b, audit } = buildController({ mode: 'STRICT', totalBlockers: 5 });
    const res = resMock();
    await ctrl.gstr3bCsv(reqWith(['tax.reports.overrideBlockers']), res, sellerId, period, 'true');
    expect(gstr3b.generateCsv).toHaveBeenCalled();
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tax.report.exported_with_blockers' }),
    );
  });

  it('STRICT + zero blockers → proceeds without acknowledgement', async () => {
    const { ctrl, gstr3b } = buildController({ mode: 'STRICT', totalBlockers: 0 });
    const res = resMock();
    await ctrl.gstr3bCsv(reqWith(), res, sellerId, period, undefined);
    expect(gstr3b.generateCsv).toHaveBeenCalled();
  });
});
