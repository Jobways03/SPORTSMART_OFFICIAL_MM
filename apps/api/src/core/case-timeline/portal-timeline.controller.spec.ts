import { PortalTimelineController } from './portal-timeline.controller';

function make() {
  const service = { getTimeline: jest.fn().mockResolvedValue([]) } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const ctrl = new PortalTimelineController(service, audit);
  return { ctrl, service, audit };
}

describe('PortalTimelineController', () => {
  it('customer route reads req.userId (set by UserAuthGuard) as the viewer', async () => {
    const { ctrl, service } = make();
    const req = { userId: 'cust-1' } as any;
    await ctrl.customerTimeline(req, 'return', 'r1');
    expect(service.getTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ viewerKind: 'CUSTOMER', viewerId: 'cust-1', caseId: 'r1' }),
    );
  });

  it('throws when no user scope is present (defensive; guard normally guarantees it)', async () => {
    const { ctrl, service } = make();
    await expect(ctrl.customerTimeline({} as any, 'dispute', 'd1')).rejects.toThrow();
    expect(service.getTimeline).not.toHaveBeenCalled();
  });

  it('rejects an unknown caseKind', async () => {
    const { ctrl } = make();
    const req = { userId: 'cust-1' } as any;
    await expect(ctrl.customerTimeline(req, 'invoice', 'x')).rejects.toThrow();
  });

  it('admin route resolves ADMIN viewer and access-logs per caseKind', async () => {
    const { ctrl, service, audit } = make();
    const req = { adminId: 'admin-1' } as any;
    await ctrl.adminTimeline(req, 'dispute', 'd1');
    expect(service.getTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ viewerKind: 'ADMIN', viewerId: 'admin-1' }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'disputes.timeline.viewed',
        module: 'disputes',
        resource: 'case_timeline',
        resourceId: 'dispute:d1',
      }),
    );
  });

  it('admin route works even when the optional audit facade is absent', async () => {
    const service = { getTimeline: jest.fn().mockResolvedValue([]) } as any;
    const ctrl = new PortalTimelineController(service);
    const req = { adminId: 'admin-1' } as any;
    await expect(ctrl.adminTimeline(req, 'ticket', 't1')).resolves.toBeTruthy();
  });
});
