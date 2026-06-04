import { DataValidationController } from './data-validation.controller';

describe('DataValidationController', () => {
  it('returns the service result and access-logs the run', async () => {
    const report = { ok: true, checks: [] };
    const service = { runDataValidation: jest.fn().mockResolvedValue(report) } as any;
    const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
    const ctrl = new DataValidationController(service, audit);

    const res = await ctrl.runDataValidation({ adminId: 'admin-1' } as any);

    expect(res).toBe(report);
    expect(service.runDataValidation).toHaveBeenCalledTimes(1);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'audit.data_validation.viewed',
        resource: 'data_validation',
        actorId: 'admin-1',
      }),
    );
  });

  it('still returns the report when no audit facade is wired', async () => {
    const report = { ok: true };
    const service = { runDataValidation: jest.fn().mockResolvedValue(report) } as any;
    const ctrl = new DataValidationController(service);
    await expect(
      ctrl.runDataValidation({ adminId: 'admin-1' } as any),
    ).resolves.toBe(report);
  });
});
