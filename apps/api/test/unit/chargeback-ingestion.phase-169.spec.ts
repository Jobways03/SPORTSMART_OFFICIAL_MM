import 'reflect-metadata';
import { ChargebackService } from '../../src/modules/payments-ops/application/services/chargeback.service';

// Phase 169 (Payment Ops audit #1/#2/#18) — Razorpay dispute (chargeback)
// ingestion lifecycle: open → won/lost, idempotency, evidence-task enqueue.

function build(opts: { existing?: any } = {}) {
  const store: any = { row: opts.existing ?? null };
  const prisma: any = {
    chargeback: {
      findUnique: jest.fn(async () => store.row),
      create: jest.fn(async ({ data }: any) => {
        store.row = { id: 'cb-1', ...data };
        return store.row;
      }),
      update: jest.fn(async ({ data }: any) => {
        store.row = { ...store.row, ...data };
        return store.row;
      }),
    },
  };
  const events = { publish: jest.fn().mockResolvedValue(undefined) };
  const ledger = { enqueueAdminTask: jest.fn().mockResolvedValue({ id: 'task-1' }) };
  const svc = new ChargebackService(prisma, events as any, ledger as any);
  return { svc, prisma, events, ledger, store };
}

const baseArgs = {
  providerDisputeId: 'disp_1',
  providerPaymentId: 'pay_1',
  masterOrderId: 'mo-1',
  orderNumber: 'ORD-1',
  amountInPaise: 500000n,
  dueDate: new Date(Date.now() + 7 * 24 * 3_600_000),
};

describe('ChargebackService.ingestDisputeEvent (Phase 169)', () => {
  it('opens a chargeback on payment.dispute.created + enqueues an evidence task + emits opened', async () => {
    const { svc, events, ledger, store } = build();
    const res = await svc.ingestDisputeEvent({ eventType: 'payment.dispute.created', ...baseArgs });
    expect(res.opened).toBe(true);
    expect(store.row.status).toBe('OPEN');
    expect(store.row.financialImpact).toBe('HELD');
    expect(store.row.evidenceStatus).toBe('PENDING');
    expect(ledger.enqueueAdminTask).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CHARGEBACK_EVIDENCE_DUE', sourceId: 'cb-1' }),
    );
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'payment.dispute.opened' }),
    );
  });

  it('transitions to WON (RECOVERED, terminal) on payment.dispute.won', async () => {
    const existing = { id: 'cb-1', status: 'OPEN', evidenceStatus: 'SUBMITTED', financialImpact: 'HELD' };
    const { svc, store, ledger } = build({ existing });
    const res = await svc.ingestDisputeEvent({ eventType: 'payment.dispute.won', ...baseArgs });
    expect(res.transitioned).toBe(true);
    expect(store.row.status).toBe('WON');
    expect(store.row.financialImpact).toBe('RECOVERED');
    expect(store.row.resolvedAt).toBeInstanceOf(Date);
    // terminal — no new evidence task
    expect(ledger.enqueueAdminTask).not.toHaveBeenCalled();
  });

  it('transitions to LOST (terminal) on payment.dispute.lost', async () => {
    const existing = { id: 'cb-1', status: 'UNDER_REVIEW', evidenceStatus: 'SUBMITTED', financialImpact: 'HELD' };
    const { svc, store } = build({ existing });
    await svc.ingestDisputeEvent({ eventType: 'payment.dispute.lost', ...baseArgs });
    expect(store.row.status).toBe('LOST');
    expect(store.row.financialImpact).toBe('LOST');
  });

  it('does NOT regress a terminal dispute on a late duplicate', async () => {
    const existing = { id: 'cb-1', status: 'WON', evidenceStatus: 'NOT_REQUIRED', financialImpact: 'RECOVERED' };
    const { svc, events } = build({ existing });
    const res = await svc.ingestDisputeEvent({ eventType: 'payment.dispute.created', ...baseArgs });
    expect(res.transitioned).toBe(false);
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('is idempotent — re-delivering the same created event does not double-open', async () => {
    const { svc } = build();
    await svc.ingestDisputeEvent({ eventType: 'payment.dispute.created', ...baseArgs });
    const second = await svc.ingestDisputeEvent({ eventType: 'payment.dispute.created', ...baseArgs });
    // already OPEN → no status change → not a transition
    expect(second.opened).toBe(false);
    expect(second.transitioned).toBe(false);
  });

  // Phase 169 review (L1#4) — closed-without-resolution preserves the prior
  // financial impact instead of clobbering HELD → NONE.
  it('closed-without-resolution preserves the prior HELD financial impact', async () => {
    const existing = { id: 'cb-1', status: 'UNDER_REVIEW', evidenceStatus: 'SUBMITTED', financialImpact: 'HELD' };
    const { svc, store } = build({ existing });
    await svc.ingestDisputeEvent({ eventType: 'payment.dispute.closed', ...baseArgs }); // no entityStatus
    expect(store.row.status).toBe('CLOSED');
    expect(store.row.financialImpact).toBe('HELD'); // preserved, not NONE
  });
});

describe('ChargebackService.markEvidenceSubmitted (Phase 169)', () => {
  it('CAS-guards on OPEN/UNDER_REVIEW + PENDING evidence', async () => {
    const prisma: any = {
      chargeback: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'cb-1', evidenceStatus: 'SUBMITTED' }),
      },
    };
    const svc = new ChargebackService(prisma, { publish: jest.fn() } as any, undefined);
    const res = await svc.markEvidenceSubmitted({ id: 'cb-1', adminId: 'a1' });
    expect(res.updated).toBe(true);
    expect(prisma.chargeback.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'cb-1',
          status: { in: ['OPEN', 'UNDER_REVIEW'] },
          evidenceStatus: 'PENDING',
        }),
      }),
    );
  });

  it('reports updated=false when nothing matched (already submitted / terminal)', async () => {
    const prisma: any = {
      chargeback: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'cb-1', evidenceStatus: 'SUBMITTED' }),
      },
    };
    const svc = new ChargebackService(prisma, { publish: jest.fn() } as any, undefined);
    const res = await svc.markEvidenceSubmitted({ id: 'cb-1', adminId: 'a1' });
    expect(res.updated).toBe(false);
  });
});
