import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { AdminTaxReportsController } from '../../src/modules/tax/presentation/controllers/admin-tax-reports.controller';

/**
 * Phase 159w (GST Mode Toggle audit #10) — the controller must refuse to enter
 * STRICT while the AUDIT-readiness report still shows blockers, unless the
 * admin explicitly forces it (which is then audited + flagged).
 */
function build(totalBlockers: number) {
  const readiness: any = {
    build: jest.fn().mockResolvedValue({
      totalBlockers,
      blockers: totalBlockers ? [{ code: 'product.missing_hsn', count: totalBlockers, sampleIds: [], message: 'x' }] : [],
    }),
  };
  const mode: any = {
    setMode: jest.fn().mockResolvedValue({ from: 'AUDIT', to: 'STRICT' }),
    getModeInfo: jest.fn().mockResolvedValue({ mode: 'OFF', source: 'db' }),
  };
  // Only readiness (arg0) + mode (arg1) are exercised by setMode; the rest are
  // unused here.
  const ctrl = new AdminTaxReportsController(
    readiness, mode, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  return { ctrl, readiness, mode };
}

const req = { adminId: 'admin-1' } as any;

describe('AdminTaxReportsController.setMode — readiness gate (#10)', () => {
  it('blocks STRICT when blockers exist and force is not set', async () => {
    const { ctrl, mode } = build(5);
    await expect(ctrl.setMode(req, { mode: 'STRICT' } as any)).rejects.toBeInstanceOf(HttpException);
    expect(mode.setMode).not.toHaveBeenCalled();
  });

  it('allows STRICT with force=true and flags the override as forced', async () => {
    const { ctrl, mode } = build(5);
    await ctrl.setMode(req, { mode: 'STRICT', force: true } as any);
    expect(mode.setMode).toHaveBeenCalledWith(
      'STRICT',
      'admin-1',
      expect.objectContaining({ forced: true, blockerCount: 5 }),
    );
  });

  it('allows STRICT when there are zero blockers (not forced)', async () => {
    const { ctrl, mode } = build(0);
    await ctrl.setMode(req, { mode: 'STRICT' } as any);
    expect(mode.setMode).toHaveBeenCalledWith(
      'STRICT',
      'admin-1',
      expect.objectContaining({ forced: false, blockerCount: 0 }),
    );
  });

  it('does not run the readiness gate for AUDIT / OFF', async () => {
    const { ctrl, mode, readiness } = build(99);
    await ctrl.setMode(req, { mode: 'AUDIT' } as any);
    expect(readiness.build).not.toHaveBeenCalled();
    expect(mode.setMode).toHaveBeenCalledWith('AUDIT', 'admin-1', expect.objectContaining({ blockerCount: 0 }));
  });
});
