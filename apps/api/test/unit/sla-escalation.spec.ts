import 'reflect-metadata';
import { SlaEscalationService } from '../../src/core/sla/services/sla-escalation.service';

/**
 * Phase 6 (PR 6.2) — SlaEscalationService.
 *
 * Three actions × three resource types = nine paths. Pin the
 * meaningful ones (e.g. BOOST_SEVERITY only on disputes, REASSIGN
 * on disputes/tickets, returns falls through to NOTIFY).
 */
describe('SlaEscalationService', () => {
  function setup() {
    const dispute = { update: jest.fn(async () => ({})) };
    const ticket = { update: jest.fn(async () => ({})) };
    const fakePrisma: any = { dispute, ticket };
    const eventBus: any = { publish: jest.fn(async () => undefined) };
    return {
      svc: new SlaEscalationService(fakePrisma, eventBus),
      dispute,
      ticket,
      eventBus,
    };
  }

  it('REASSIGN_SENIOR clears dispute.assignedAdminId', async () => {
    const { svc, dispute, eventBus } = setup();
    await svc.escalate({
      resourceType: 'dispute',
      resourceId: 'd1',
      action: 'REASSIGN_SENIOR',
      policyName: 'p',
    });
    expect(dispute.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { assignedAdminId: null },
    });
    expect(eventBus.publish).toHaveBeenCalled();
  });

  it('REASSIGN_SENIOR clears ticket.assignedAdminId', async () => {
    const { svc, ticket, eventBus } = setup();
    await svc.escalate({
      resourceType: 'ticket',
      resourceId: 't1',
      action: 'REASSIGN_SENIOR',
      policyName: 'p',
    });
    expect(ticket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { assignedAdminId: null },
    });
    expect(eventBus.publish).toHaveBeenCalled();
  });

  it('REASSIGN_SENIOR on a return falls through to NOTIFY_MANAGER (no assigned admin)', async () => {
    const { svc, dispute, ticket, eventBus } = setup();
    await svc.escalate({
      resourceType: 'return',
      resourceId: 'r1',
      action: 'REASSIGN_SENIOR',
      policyName: 'p',
    });
    expect(dispute.update).not.toHaveBeenCalled();
    expect(ticket.update).not.toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'sla.escalated',
        payload: expect.objectContaining({ action: 'NOTIFY_MANAGER' }),
      }),
    );
  });

  it('BOOST_SEVERITY bumps dispute.severity to 95', async () => {
    const { svc, dispute } = setup();
    await svc.escalate({
      resourceType: 'dispute',
      resourceId: 'd1',
      action: 'BOOST_SEVERITY',
      policyName: 'p',
    });
    expect(dispute.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { severity: 95 },
    });
  });

  it('BOOST_SEVERITY no-ops on non-dispute resources', async () => {
    const { svc, dispute, ticket } = setup();
    await svc.escalate({
      resourceType: 'ticket',
      resourceId: 't1',
      action: 'BOOST_SEVERITY',
      policyName: 'p',
    });
    expect(dispute.update).not.toHaveBeenCalled();
    expect(ticket.update).not.toHaveBeenCalled();
  });

  it('NOTIFY_MANAGER only emits an event', async () => {
    const { svc, dispute, ticket, eventBus } = setup();
    await svc.escalate({
      resourceType: 'dispute',
      resourceId: 'd1',
      action: 'NOTIFY_MANAGER',
      policyName: 'p',
    });
    expect(dispute.update).not.toHaveBeenCalled();
    expect(ticket.update).not.toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalled();
  });

  it('unknown action logs and skips (no DB writes, no event)', async () => {
    const { svc, dispute, ticket, eventBus } = setup();
    await svc.escalate({
      resourceType: 'dispute',
      resourceId: 'd1',
      action: 'WHATEVER_NEW_ACTION',
      policyName: 'p',
    });
    expect(dispute.update).not.toHaveBeenCalled();
    expect(ticket.update).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
