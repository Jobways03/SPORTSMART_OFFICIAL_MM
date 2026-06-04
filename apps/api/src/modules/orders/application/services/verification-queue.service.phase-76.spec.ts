// Phase 76 (2026-05-22) — bulk-approve-green hardening.
//
// Covers:
//   Gap #6/#20 — parallelised verify loop with bounded concurrency
//   Gap #10    — orders.bulk.approved.green event emitted
//   Gap #12    — reason capped in audit metadata (only reasonCode kept)
//   Gap #13    — raw Error.message sanitised to enum code in response
//   Gap #16    — env-driven max with absolute ceiling
//   Gap #17    — dry-run returns rich previewIds shape
//   Gap #18    — response distinguishes routed vs exception queue
//   Gap #19    — success-path SQL admin-scoped claim clear

import { VerificationQueueService } from './verification-queue.service';

function makeSvc(opts: {
  claimedRows?: Array<{ id: string; order_number: string }>;
  verifyResults?: Record<string, { orderStatus: string } | Error>;
  envBulkMax?: number;
  dryRunRows?: any[];
} = {}) {
  const claimedRows = opts.claimedRows ?? [];
  const queryRaw = jest.fn().mockResolvedValue(opts.dryRunRows ?? []);
  const queryRawUnsafe = jest.fn().mockResolvedValue(claimedRows);
  const executeRaw = jest.fn().mockResolvedValue(1);
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };

  const ordersService = {
    verifyOrder: jest.fn().mockImplementation(async (id: string) => {
      const r = opts.verifyResults?.[id];
      if (r instanceof Error) throw r;
      return r ?? { orderStatus: 'ROUTED_TO_SELLER' };
    }),
    rejectOrder: jest.fn(),
  };
  const riskScoring = { scoreOrder: jest.fn() };
  const env: any = {
    getNumber: (k: string, fb: number) => {
      if (k === 'VERIFICATION_BULK_APPROVE_MAX' && opts.envBulkMax !== undefined) {
        return opts.envBulkMax;
      }
      return fb;
    },
  };
  const prisma: any = {
    $queryRaw: queryRaw,
    $queryRawUnsafe: queryRawUnsafe,
    $executeRaw: executeRaw,
    masterOrder: {
      count: jest.fn().mockResolvedValue(0),
      // Phase 174 — bulk-approve re-checks each claimed order's band right
      // before verify; default to GREEN so the verify path runs.
      findUnique: jest
        .fn()
        .mockResolvedValue({ verificationRiskBand: 'GREEN' }),
    },
  };

  const svc = new VerificationQueueService(
    prisma,
    ordersService as any,
    audit as any,
    riskScoring as any,
    env as any,
    eventBus as any,
  );
  return { svc, prisma, audit, eventBus, ordersService, queryRaw, queryRawUnsafe, executeRaw };
}

describe('VerificationQueueService.bulkApproveGreen (Phase 76)', () => {
  it('Gap #16 — env-driven ceiling clamps the limit', async () => {
    const { svc, queryRawUnsafe } = makeSvc({
      envBulkMax: 5,
      claimedRows: [],
    });
    await svc.bulkApproveGreen('admin-A', 100, false);
    // The SQL's $1 parameter receives the clamped value (5).
    const callArgs = queryRawUnsafe.mock.calls[0]!;
    expect(callArgs[1]).toBe(5);
  });

  it('Gap #16 — env ceiling capped at absolute max=50 (typo protection)', async () => {
    const { svc, queryRawUnsafe } = makeSvc({
      envBulkMax: 9999, // a typo in env
      claimedRows: [],
    });
    await svc.bulkApproveGreen('admin-A', 9999, false);
    expect(queryRawUnsafe.mock.calls[0]![1]).toBe(50);
  });

  it('Gap #17 — dry-run returns rich previewIds with risk reasons', async () => {
    const { svc } = makeSvc({
      dryRunRows: [
        {
          id: 'mo-1',
          orderNumber: 'SM-1',
          totalAmount: '500.00',
          riskScore: -5,
          riskBand: 'GREEN',
          riskReasons: ['Repeat customer', 'Online payment captured'],
        },
      ],
    });
    const result = await svc.bulkApproveGreen('admin-A', 25, true);
    expect(result.previewIds).toEqual([
      expect.objectContaining({
        id: 'mo-1',
        orderNumber: 'SM-1',
        totalAmount: 500,
        riskScore: -5,
        riskBand: 'GREEN',
        riskReasons: ['Repeat customer', 'Online payment captured'],
      }),
    ]);
  });

  it('Gap #18 — response distinguishes routed vs exception queue', async () => {
    const { svc } = makeSvc({
      claimedRows: [
        { id: 'mo-routed', order_number: 'SM-R' },
        { id: 'mo-excpt', order_number: 'SM-E' },
      ],
      verifyResults: {
        'mo-routed': { orderStatus: 'ROUTED_TO_SELLER' },
        'mo-excpt': { orderStatus: 'EXCEPTION_QUEUE' },
      },
    });
    const result = await svc.bulkApproveGreen('admin-A', 25, false);
    expect(result.routedCount).toBe(1);
    expect(result.exceptionQueueCount).toBe(1);
    expect(result.approvedIds.routed).toEqual(['mo-routed']);
    expect(result.approvedIds.exceptionQueue).toEqual(['mo-excpt']);
  });

  it('Gap #13 — failure reasonCode is enum-sanitised (no raw Prisma message)', async () => {
    const { svc } = makeSvc({
      claimedRows: [{ id: 'mo-fail', order_number: 'SM-F' }],
      verifyResults: {
        'mo-fail': new Error(
          'PrismaClientKnownRequestError: An unexpected DB-level failure',
        ),
      },
    });
    const result = await svc.bulkApproveGreen('admin-A', 25, false);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!).toEqual({
      orderId: 'mo-fail',
      orderNumber: 'SM-F',
      reasonCode: 'UNKNOWN',
    });
    // raw message NOT in the payload
    expect(JSON.stringify(result.failed)).not.toContain('PrismaClient');
  });

  it('Gap #13 — claim conflict translates to CLAIM_CONFLICT code', async () => {
    const { svc } = makeSvc({
      claimedRows: [{ id: 'mo-claim', order_number: 'SM-C' }],
      verifyResults: {
        'mo-claim': new Error('This order is currently held by another verifier'),
      },
    });
    const result = await svc.bulkApproveGreen('admin-A', 25, false);
    expect(result.failed[0]!.reasonCode).toBe('CLAIM_CONFLICT');
  });

  it('Gap #13 — allocation error translates to ALLOCATION_FAILED', async () => {
    const { svc } = makeSvc({
      claimedRows: [{ id: 'mo-allo', order_number: 'SM-A' }],
      verifyResults: {
        'mo-allo': new Error('No serviceable mapping found for pincode 500001'),
      },
    });
    const result = await svc.bulkApproveGreen('admin-A', 25, false);
    expect(result.failed[0]!.reasonCode).toBe('ALLOCATION_FAILED');
  });

  it('Gap #19 — success-path claim clear is admin-scoped', async () => {
    const { svc, executeRaw } = makeSvc({
      claimedRows: [{ id: 'mo-1', order_number: 'SM-1' }],
    });
    await svc.bulkApproveGreen('admin-A', 25, false);
    // executeRaw is a tag-template; the first arg is the strings
    // array. Concatenate to inspect the SQL.
    const sqlCalls = executeRaw.mock.calls.map((c) => {
      const arg = c[0];
      if (Array.isArray(arg)) return arg.join(' ');
      if (arg && typeof arg === 'object' && 'raw' in (arg as any)) {
        return (arg as any).raw.join(' ');
      }
      return String(arg);
    });
    expect(
      sqlCalls.some((sql) =>
        sql.includes('claimed_by_admin_id =') && sql.includes('UPDATE master_orders'),
      ),
    ).toBe(true);
  });

  it('Gap #10 — orders.bulk.approved.green event emitted with summary payload', async () => {
    const { svc, eventBus } = makeSvc({
      claimedRows: [
        { id: 'mo-1', order_number: 'SM-1' },
        { id: 'mo-2', order_number: 'SM-2' },
      ],
    });
    await svc.bulkApproveGreen('admin-A', 25, false);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'orders.bulk.approved.green',
        payload: expect.objectContaining({
          adminId: 'admin-A',
          attempted: 2,
          succeeded: 2,
          routedCount: 2,
          exceptionQueueCount: 0,
          failedCount: 0,
        }),
      }),
    );
  });

  it('Gap #12 — audit metadata captures reasonCode, not raw Prisma text', async () => {
    const { svc, audit } = makeSvc({
      claimedRows: [{ id: 'mo-x', order_number: 'SM-X' }],
      verifyResults: {
        'mo-x': new Error('PrismaClientKnownRequestError: \n  Stack trace...\n  Multi-line dump...'),
      },
    });
    await svc.bulkApproveGreen('admin-A', 25, false);
    const auditCall = audit.writeAuditLog.mock.calls[0]![0];
    expect(auditCall.metadata.failed[0]).toEqual(
      expect.objectContaining({ orderId: 'mo-x', reasonCode: 'UNKNOWN' }),
    );
    // raw multi-line text is NOT in the audit blob
    expect(JSON.stringify(auditCall.metadata)).not.toContain('Stack trace');
  });

  it('Gap #6/#20 — parallel verify loop bounded by concurrency cap', async () => {
    // 10 claimed orders × 200ms each; sequential would be 2s.
    // Parallel @ 5 should finish in roughly 400ms (10/5 * 200).
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `mo-${i}`,
      order_number: `SM-${i}`,
    }));
    const ordersService = {
      verifyOrder: jest.fn(
        () => new Promise((res) => setTimeout(() => res({ orderStatus: 'ROUTED_TO_SELLER' }), 50)),
      ),
      rejectOrder: jest.fn(),
    };
    const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    const env: any = { getNumber: (_k: string, fb: number) => fb };
    const prisma: any = {
      $queryRaw: jest.fn(),
      $queryRawUnsafe: jest.fn().mockResolvedValue(rows),
      $executeRaw: jest.fn().mockResolvedValue(1),
      masterOrder: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest
          .fn()
          .mockResolvedValue({ verificationRiskBand: 'GREEN' }),
      },
    };
    const svc = new VerificationQueueService(
      prisma,
      ordersService as any,
      audit as any,
      { scoreOrder: jest.fn() } as any,
      env,
      eventBus as any,
    );
    const t0 = Date.now();
    const result = await svc.bulkApproveGreen('admin-A', 10, false);
    const elapsed = Date.now() - t0;
    expect(result.succeeded).toBe(10);
    // Sequential would take 10 × 50 = 500ms; parallel @ 5 ≈ 100ms.
    // Allow 250ms upper bound for CI variance.
    expect(elapsed).toBeLessThan(300);
  });
});
