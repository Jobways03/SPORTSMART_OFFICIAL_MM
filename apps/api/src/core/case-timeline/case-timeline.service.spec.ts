import { CaseTimelineService } from './case-timeline.service';

/**
 * Security focus: the non-admin redaction allowlist. Before the fix the
 * redactor stripped only `gatewayRefundId`, so internal status-change
 * notes, gateway failure reasons, and the admin's decision rationale all
 * leaked to the customer timeline. These tests pin the denylist.
 */
function prismaFor(parts: Record<string, any>) {
  return {
    return: { findUnique: jest.fn().mockResolvedValue(parts.return ?? null) },
    returnStatusHistory: {
      findMany: jest.fn().mockResolvedValue(parts.history ?? []),
    },
    refundTransaction: {
      findMany: jest.fn().mockResolvedValue(parts.refunds ?? []),
    },
    dispute: { findUnique: jest.fn().mockResolvedValue(parts.dispute ?? null) },
    disputeMessage: {
      findMany: jest.fn().mockResolvedValue(parts.disputeMessages ?? []),
    },
  } as any;
}

describe('CaseTimelineService — non-admin redaction (data-leak guard)', () => {
  const RETURN = {
    id: 'r1',
    customerId: 'cust-1',
    returnNumber: 'RET-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  const HISTORY = [
    {
      id: 'h1',
      returnId: 'r1',
      fromStatus: 'REQUESTED',
      toStatus: 'APPROVED',
      changedBy: 'admin-9',
      notes: 'fraud-flag cleared by ops — internal',
      createdAt: new Date('2026-01-02T00:00:00Z'),
    },
  ];
  const REFUNDS = [
    {
      id: 'rt1',
      returnId: 'r1',
      status: 'FAILED',
      attemptNumber: 2,
      gatewayRefundId: 'rfnd_secrettoken',
      failureReason: 'GATEWAY_DECLINED: insufficient_balance',
      createdAt: new Date('2026-01-03T00:00:00Z'),
    },
  ];

  it('strips notes / failureReason / gatewayRefundId for a CUSTOMER viewer', async () => {
    const svc = new CaseTimelineService(
      prismaFor({ return: RETURN, history: HISTORY, refunds: REFUNDS }),
    );
    const events = await svc.getTimeline({
      caseKind: 'return',
      caseId: 'r1',
      viewerKind: 'CUSTOMER',
      viewerId: 'cust-1',
    });

    const status = events.find((e) => e.kind === 'returns.timeline.approved');
    expect(status?.payload).toBeDefined();
    expect(status?.payload).not.toHaveProperty('notes');
    // public status fields survive
    expect(status?.payload).toMatchObject({ toStatus: 'APPROVED' });

    const refund = events.find((e) => e.kind.startsWith('returns.timeline.refund_'));
    expect(refund?.payload).not.toHaveProperty('gatewayRefundId');
    expect(refund?.payload).not.toHaveProperty('failureReason');
    // non-sensitive field survives
    expect(refund?.payload).toMatchObject({ attemptNumber: 2 });
  });

  it('ADMIN viewer keeps every field', async () => {
    const svc = new CaseTimelineService(
      prismaFor({ return: RETURN, history: HISTORY, refunds: REFUNDS }),
    );
    const events = await svc.getTimeline({
      caseKind: 'return',
      caseId: 'r1',
      viewerKind: 'ADMIN',
      viewerId: 'admin-1',
    });
    const status = events.find((e) => e.kind === 'returns.timeline.approved');
    expect(status?.payload).toHaveProperty('notes', 'fraud-flag cleared by ops — internal');
    const refund = events.find((e) => e.kind.startsWith('returns.timeline.refund_'));
    expect(refund?.payload).toHaveProperty('gatewayRefundId', 'rfnd_secrettoken');
    expect(refund?.payload).toHaveProperty('failureReason');
  });

  it('strips the decision rationale from a customer-filed dispute timeline', async () => {
    const svc = new CaseTimelineService(
      prismaFor({
        dispute: {
          id: 'd1',
          filedById: 'cust-1',
          filedByType: 'CUSTOMER',
          disputeNumber: 'DSP-1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          decisionAt: new Date('2026-01-05T00:00:00Z'),
          status: 'RESOLVED_BUYER',
          decisionRationale: 'approved as goodwill; seller at fault per chat log',
        },
        disputeMessages: [],
      }),
    );
    const events = await svc.getTimeline({
      caseKind: 'dispute',
      caseId: 'd1',
      viewerKind: 'CUSTOMER',
      viewerId: 'cust-1',
    });
    const decision = events.find((e) => e.kind.startsWith('disputes.timeline.resolved'));
    expect(decision).toBeDefined();
    expect(decision?.payload ?? {}).not.toHaveProperty('rationale');
  });

  it('denies a customer who does not own the return', async () => {
    const svc = new CaseTimelineService(prismaFor({ return: RETURN }));
    await expect(
      svc.getTimeline({
        caseKind: 'return',
        caseId: 'r1',
        viewerKind: 'CUSTOMER',
        viewerId: 'someone-else',
      }),
    ).rejects.toThrow();
  });
});
