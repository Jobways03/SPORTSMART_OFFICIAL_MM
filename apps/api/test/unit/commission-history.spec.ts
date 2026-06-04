// Phase 139 — getCommissionHistory assembles a unified timeline at read time
// from five sources: the record (synthetic LOCKED), commission_reversal_records,
// commission_hold_history (admin HOLD/RESUME), audit_logs (system FREEZE/UNFREEZE),
// commission_adjustment_history (every manual adjust), and the settlement join
// (SETTLED when paid). It stamps generatedAt so operators know the snapshot age.

import { CommissionProcessorService } from '../../src/modules/commission/application/services/commission-processor.service';
import { NotFoundAppException } from '../../src/core/exceptions';

function build(opts: {
  record?: any;
  reversals?: any[];
  holdEvents?: any[];
  systemAudits?: any[];
  adjustments?: any[];
  settlement?: any;
}) {
  const record =
    opts.record === undefined
      ? {
          id: 'cr1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          adminEarning: '30.00',
          platformMargin: '30.00',
          refundedAdminEarning: '0.00',
          subOrderId: 'so1',
          settlementId: opts.settlement ? 'set1' : null,
          adjustedAt: null,
          adjustedBy: null,
          adjustmentReason: null,
          originalAdminEarning: null,
          status: 'PENDING',
          orderNumber: 'O1',
          sellerName: 'Seller',
          productTitle: 'Bat',
          variantTitle: null,
          quantity: 1,
          platformPrice: '100.00',
          settlementPrice: '70.00',
        }
      : opts.record;

  const prisma = {
    commissionRecord: { findUnique: jest.fn().mockResolvedValue(record) },
    commissionReversalRecord: {
      findMany: jest.fn().mockResolvedValue(opts.reversals ?? []),
    },
    commissionHoldHistory: {
      findMany: jest.fn().mockResolvedValue(opts.holdEvents ?? []),
    },
    auditLog: { findMany: jest.fn().mockResolvedValue(opts.systemAudits ?? []) },
    commissionAdjustmentHistory: {
      findMany: jest.fn().mockResolvedValue(opts.adjustments ?? []),
    },
    sellerSettlement: {
      findUnique: jest.fn().mockResolvedValue(opts.settlement ?? null),
    },
  };
  const svc = new CommissionProcessorService(
    {} as any,
    {} as any,
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { wrap: jest.fn((_n: string, fn: () => unknown) => fn()) } as any, // instr (Phase 174 @Cron migration)
  );
  return { svc, prisma };
}

describe('CommissionProcessorService.getCommissionHistory (Phase 139)', () => {
  it('always opens with a synthetic COMMISSION_LOCKED event + stamps generatedAt', async () => {
    const { svc } = build({});
    const res = await svc.getCommissionHistory('cr1');
    expect(res.timeline[0]!.type).toBe('COMMISSION_LOCKED');
    expect(typeof res.generatedAt).toBe('string');
  });

  it('surfaces a SETTLED event when the linked settlement has been paid', async () => {
    const { svc } = build({
      settlement: {
        id: 'set1',
        paidAt: new Date('2026-02-01T00:00:00Z'),
        utrReference: 'UTR-123',
        status: 'PAID',
      },
    });
    const res = await svc.getCommissionHistory('cr1');
    const settled = res.timeline.find((e: any) => e.type === 'SETTLED') as any;
    expect(settled).toBeDefined();
    expect(settled.settlementId).toBe('set1');
    expect(settled.utrReference).toBe('UTR-123');
    expect(settled.settlementStatus).toBe('PAID');
  });

  it('does NOT surface SETTLED when the record is attached to a cycle but not yet paid', async () => {
    const { svc } = build({
      settlement: { id: 'set1', paidAt: null, utrReference: null, status: 'PENDING' },
    });
    const res = await svc.getCommissionHistory('cr1');
    expect(res.timeline.some((e: any) => e.type === 'SETTLED')).toBe(false);
  });

  it('merges admin HOLD/RESUME, system FREEZE/UNFREEZE, and every adjustment', async () => {
    const { svc } = build({
      holdEvents: [
        {
          createdAt: new Date('2026-01-03T00:00:00Z'),
          action: 'HOLD',
          actorType: 'ADMIN',
          actorId: 'admin1',
          fromStatus: 'PENDING',
          toStatus: 'ON_HOLD',
          reason: 'fraud review',
        },
      ],
      systemAudits: [
        {
          createdAt: new Date('2026-01-02T00:00:00Z'),
          action: 'commission.frozen',
          newValue: { reason: 'return opened' },
        },
      ],
      adjustments: [
        {
          createdAt: new Date('2026-01-04T00:00:00Z'),
          adminId: 'admin1',
          fromAdminEarning: '30.00',
          toAdminEarning: '20.00',
          reason: 'first',
        },
        {
          createdAt: new Date('2026-01-05T00:00:00Z'),
          adminId: 'admin2',
          fromAdminEarning: '20.00',
          toAdminEarning: '25.00',
          reason: 'second',
        },
      ],
    });
    const res = await svc.getCommissionHistory('cr1');
    const types = res.timeline.map((e: any) => e.type);
    // 2 HOLD_EVENTs (1 admin HOLD + 1 system FREEZE) and 2 adjustments — both, not just the latest.
    expect(types.filter((t: string) => t === 'HOLD_EVENT')).toHaveLength(2);
    expect(types.filter((t: string) => t === 'MANUAL_ADJUSTMENT')).toHaveLength(2);
    const freeze = res.timeline.find(
      (e: any) => e.type === 'HOLD_EVENT' && e.action === 'SYSTEM_FREEZE',
    );
    expect(freeze).toBeDefined();
    // Timeline is sorted ascending by event time.
    const times = res.timeline.map((e: any) => new Date(e.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('404s on a missing record', async () => {
    const { svc } = build({ record: null });
    await expect(svc.getCommissionHistory('missing')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });
});
