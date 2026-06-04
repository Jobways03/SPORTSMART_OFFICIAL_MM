import 'reflect-metadata';
import { RefundGatewayReconCron } from '../../src/modules/reconciliation/application/jobs/refund-gateway-recon.cron';
import { RefundGatewayStuckHandler } from '../../src/modules/reconciliation/application/event-handlers/refund-gateway-stuck.handler';
import { RefundInstructionService } from '../../src/modules/refund-instructions/application/services/refund-instruction.service';

// Phase 167 — Refund Execution audit remediation coverage.
//   #1  recon cron now ACTUALLY calls the gateway + flips the instruction
//   #10 refund.gateway.stuck has a consumer that opens an alert
//   #7  markGatewayOutcome CAS (PROCESSING→SUCCESS/FAILED, SUCCESS→SETTLED)

function makeRecon(opts: {
  candidates: any[];
  paymentIdByOrder?: Record<string, string | null>;
  gatewayStatusByRefund?: Record<string, string>;
  gatewayThrows?: boolean;
}) {
  const prisma: any = {
    refundInstruction: {
      findMany: jest.fn().mockResolvedValue(opts.candidates),
      update: jest.fn().mockResolvedValue({}),
    },
    masterOrder: {
      findUnique: jest.fn(async ({ where }: any) => ({
        // honor an explicit null (unresolvable) vs absent (default) — `??` would
        // coerce a deliberate null back to the default.
        razorpayPaymentId:
          opts.paymentIdByOrder && where.id in opts.paymentIdByOrder
            ? opts.paymentIdByOrder[where.id]
            : 'pay_default',
      })),
    },
  };
  const env: any = { getNumber: (_k: string, fb: number) => fb, getBoolean: () => true };
  const events: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const razorpayAdapter: any = {
    getRefundStatus: jest.fn(async (_p: string, refundId: string) => {
      if (opts.gatewayThrows) throw new Error('gateway down');
      return { refundId, status: opts.gatewayStatusByRefund?.[refundId] ?? 'pending', amountInPaise: 0n };
    }),
  };
  const instructionService: any = {
    markGatewayOutcome: jest.fn().mockResolvedValue({ flipped: true }),
  };
  const paymentOps: any = { flagMismatch: jest.fn().mockResolvedValue(undefined) };
  const cron = new RefundGatewayReconCron(
    prisma, env, events, razorpayAdapter, instructionService, paymentOps, {} as any, {} as any,
  );
  return { cron, prisma, events, razorpayAdapter, instructionService, paymentOps };
}

const inst = (over: any = {}) => ({
  id: 'inst-1',
  customerId: 'cust-1',
  orderId: 'mo-1',
  gatewayRefundId: 'rfnd_1',
  // Phase 167 — stuck-detection uses createdAt (immutable), not updatedAt.
  createdAt: new Date(),
  ...over,
});

describe('RefundGatewayReconCron.tick (#1)', () => {
  it('flips a PROCESSING instruction to SUCCESS when the gateway says processed', async () => {
    const { cron, instructionService, prisma } = makeRecon({
      candidates: [inst()],
      gatewayStatusByRefund: { rfnd_1: 'processed' },
    });
    const res = await cron.tick();
    expect(res.settled).toBe(1);
    expect(instructionService.markGatewayOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ instructionId: 'inst-1', outcome: 'SUCCESS' }),
    );
    // Phase 167 review (L1#3) — a row we flipped terminal this tick is NO LONGER
    // a PROCESSING candidate; we must NOT re-stamp poll metadata onto it.
    expect(prisma.refundInstruction.update).not.toHaveBeenCalled();
  });

  it('flips to FAILED when the gateway says failed', async () => {
    const { cron, instructionService } = makeRecon({
      candidates: [inst()],
      gatewayStatusByRefund: { rfnd_1: 'failed' },
    });
    const res = await cron.tick();
    expect(res.failed).toBe(1);
    expect(instructionService.markGatewayOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'FAILED' }),
    );
  });

  it('emits refund.gateway.stuck only when still-pending past 24h (#10)', async () => {
    const old = new Date(Date.now() - 30 * 3_600_000); // 30h ago
    const { cron, events } = makeRecon({
      candidates: [inst({ createdAt: old })],
      gatewayStatusByRefund: { rfnd_1: 'pending' },
    });
    const res = await cron.tick();
    expect(res.stuck).toBe(1);
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'refund.gateway.stuck' }),
    );
  });

  it('does NOT emit stuck for a fresh still-pending instruction, but DOES stamp poll tracking', async () => {
    const { cron, events, prisma } = makeRecon({
      candidates: [inst({ createdAt: new Date() })],
      gatewayStatusByRefund: { rfnd_1: 'pending' },
    });
    const res = await cron.tick();
    expect(res.stuck).toBe(0);
    expect(events.publish).not.toHaveBeenCalled();
    // still-pending → poll tracking IS stamped (backoff + visibility).
    expect(prisma.refundInstruction.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastPolledAt: expect.any(Date) }) }),
    );
  });

  // Phase 167 review (L1#2) — an old instruction we could not even poll (no
  // resolvable payment id) is an orphan/data issue, NOT gateway-stuck. It must
  // not emit refund.gateway.stuck (which would fire a false sev-95 alert on
  // order-less dispute refunds).
  it('does NOT emit stuck for an old instruction with no resolvable paymentId', async () => {
    const old = new Date(Date.now() - 30 * 3_600_000); // 30h ago
    const { cron, events, prisma } = makeRecon({
      candidates: [inst({ createdAt: old })],
      paymentIdByOrder: { 'mo-1': null },
    });
    const res = await cron.tick();
    expect(res.stuck).toBe(0);
    expect(events.publish).not.toHaveBeenCalled();
    // the unresolvable row is still stamped with the poll error for visibility
    expect(prisma.refundInstruction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastPollError: expect.stringMatching(/no razorpay_payment_id/) }),
      }),
    );
  });

  it('opens an alert after consecutive gateway fetch failures (#16)', async () => {
    const { cron, paymentOps } = makeRecon({
      candidates: Array.from({ length: 5 }, (_, i) => inst({ id: `inst-${i}`, gatewayRefundId: `r-${i}` })),
      gatewayThrows: true,
    });
    await cron.tick();
    expect(paymentOps.flagMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ORPHAN_PAYMENT' }),
    );
  });
});

describe('RefundGatewayStuckHandler (#10)', () => {
  it('opens a PaymentMismatchAlert + audit on refund.gateway.stuck', async () => {
    const paymentOps: any = { flagMismatch: jest.fn().mockResolvedValue(undefined) };
    const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    const handler = new RefundGatewayStuckHandler(paymentOps, audit);
    await handler.handle({
      eventName: 'refund.gateway.stuck',
      aggregate: 'RefundInstruction',
      aggregateId: 'inst-9',
      occurredAt: new Date(),
      payload: { instructionId: 'inst-9', customerId: 'c-9', gatewayRefundId: 'rfnd_9', stuckSinceMs: 30 * 3_600_000 },
    } as any);
    expect(paymentOps.flagMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ORPHAN_PAYMENT', severity: 95 }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'refund.gateway.stuck' }),
    );
  });
});

describe('RefundInstructionService.markGatewayOutcome (#7 CAS)', () => {
  function svc(updateCount: number) {
    const prisma: any = {
      refundInstruction: { updateMany: jest.fn().mockResolvedValue({ count: updateCount }) },
    };
    const s = new RefundInstructionService(prisma, {} as any, {} as any, {} as any, {} as any);
    return { s, prisma };
  }

  it('flips PROCESSING→SUCCESS (CAS guarded)', async () => {
    const { s, prisma } = svc(1);
    const res = await s.markGatewayOutcome({ instructionId: 'i1', outcome: 'SUCCESS' });
    expect(res.flipped).toBe(true);
    expect(prisma.refundInstruction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'i1', status: { in: ['PROCESSING'] } }),
        data: expect.objectContaining({ status: 'SUCCESS' }),
      }),
    );
  });

  it('SETTLED is guarded on SUCCESS (not PROCESSING)', async () => {
    const { s, prisma } = svc(1);
    await s.markGatewayOutcome({ instructionId: 'i1', outcome: 'SETTLED' });
    expect(prisma.refundInstruction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['SUCCESS'] } }),
        data: expect.objectContaining({ status: 'SETTLED' }),
      }),
    );
  });

  it('reports flipped=false when the CAS matched nothing', async () => {
    const { s } = svc(0);
    const res = await s.markGatewayOutcome({ instructionId: 'i1', outcome: 'FAILED' });
    expect(res.flipped).toBe(false);
  });
});
