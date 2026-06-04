// Phase 214 (#7) — StaleReturnProcessorService cron-migration coverage.
//
// The legacy service ran on a raw setInterval + unfenced redis lock with no
// instrumentation. The migration:
//   • per-row status flip + status_history breadcrumb now commit in ONE tx,
//   • a best-effort SYSTEM summary audit row is written per tick (counts),
//     OUTSIDE the per-row transactions,
//   • the four batch sizes are env-tunable,
//   • the run() entrypoint is gated on RETURN_STALE_DAYS via enabled().

import { StaleReturnProcessorService } from './stale-return-processor.service';

function buildDeps(overrides: any = {}) {
  const env = {
    getNumber: jest.fn((key: string, def: number) => {
      if (key === 'RETURN_STALE_DAYS') return 30;
      return def;
    }),
  };
  return {
    prisma: {
      return: { findMany: jest.fn().mockResolvedValue([]) },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    },
    env,
    eventBus: { publish: jest.fn().mockResolvedValue(undefined) },
    leader: { run: jest.fn(async (_n: string, _t: number, body: any) => body()) },
    instrumentation: { wrap: jest.fn(async (_n: string, fn: any) => fn()) },
    audit: { writeAuditLog: jest.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
}

function build(deps: any) {
  return new StaleReturnProcessorService(
    deps.prisma,
    deps.env,
    deps.eventBus,
    deps.leader,
    deps.instrumentation,
    deps.audit,
  );
}

describe('StaleReturnProcessorService (Phase 214 cron migration)', () => {
  it('wraps the auto-cancel flip + status_history write in ONE transaction and counts only claimed rows', async () => {
    const tx: any = {
      return: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const deps = buildDeps({
      prisma: {
        // first findMany = auto-cancel candidates; the rest return [].
        return: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              { id: 'r1', returnNumber: 'RET-1', status: 'REQUESTED' },
            ])
            .mockResolvedValue([]),
        },
        returnStatusHistory: { create: jest.fn() },
        $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
      },
    });
    const service = build(deps);

    const counts = await service.tick();

    // The updateMany + history.create both ran on the SAME tx client.
    expect(deps.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.return.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1', status: 'REQUESTED' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    expect(tx.returnStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(counts.cancelled).toBe(1);
  });

  it('does NOT write the history breadcrumb when the CAS claim loses (count=0)', async () => {
    const tx: any = {
      return: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      returnStatusHistory: { create: jest.fn() },
    };
    const deps = buildDeps({
      prisma: {
        return: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              { id: 'r1', returnNumber: 'RET-1', status: 'REQUESTED' },
            ])
            .mockResolvedValue([]),
        },
        returnStatusHistory: { create: jest.fn() },
        $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
      },
    });
    const service = build(deps);

    const counts = await service.tick();

    expect(tx.returnStatusHistory.create).not.toHaveBeenCalled();
    expect(counts.cancelled).toBe(0);
  });

  it('writes ONE best-effort SYSTEM summary audit row per tick with the four counts', async () => {
    const tx: any = {
      return: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const deps = buildDeps({
      prisma: {
        return: {
          // auto-cancel: 1 row; auto-close: 0; escalate: 1 row; exhausted: 0.
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              { id: 'r1', returnNumber: 'RET-1', status: 'REQUESTED' },
            ])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
              {
                id: 'r2',
                returnNumber: 'RET-2',
                status: 'IN_TRANSIT',
                masterOrderId: 'm2',
                customerId: 'c2',
              },
            ])
            .mockResolvedValueOnce([]),
        },
        returnStatusHistory: { create: jest.fn() },
        $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
      },
    });
    const service = build(deps);

    const counts = await service.tick();

    expect(counts).toEqual({
      cancelled: 1,
      closed: 0,
      escalated: 1,
      exhausted: 0,
    });
    expect(deps.audit.writeAuditLog).toHaveBeenCalledTimes(1);
    const entry = deps.audit.writeAuditLog.mock.calls[0][0];
    expect(entry.action).toBe('RETURN_STALE_PROCESSED');
    expect(entry.actorType).toBe('SYSTEM');
    expect(entry.metadata).toEqual(
      expect.objectContaining({ cancelled: 1, closed: 0, escalated: 1, exhausted: 0 }),
    );
  });

  it('does NOT write an audit summary when nothing moved', async () => {
    const deps = buildDeps(); // all findMany default to []
    const service = build(deps);
    const counts = await service.tick();
    expect(counts).toEqual({ cancelled: 0, closed: 0, escalated: 0, exhausted: 0 });
    expect(deps.audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('a summary-audit failure does not throw (best-effort) — the sweep still returns counts', async () => {
    const tx: any = {
      return: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      returnStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const deps = buildDeps({
      prisma: {
        return: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              { id: 'r1', returnNumber: 'RET-1', status: 'REQUESTED' },
            ])
            .mockResolvedValue([]),
        },
        returnStatusHistory: { create: jest.fn() },
        $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
      },
      audit: { writeAuditLog: jest.fn().mockRejectedValue(new Error('audit down')) },
    });
    const service = build(deps);
    await expect(service.tick()).resolves.toEqual(
      expect.objectContaining({ cancelled: 1 }),
    );
  });

  it('uses the env-tunable batch sizes (RETURN_STALE_BATCH_SIZE / _EXHAUSTED_BATCH_SIZE)', async () => {
    const env = {
      getNumber: jest.fn((key: string, def: number) => {
        if (key === 'RETURN_STALE_DAYS') return 30;
        if (key === 'RETURN_STALE_BATCH_SIZE') return 7;
        if (key === 'RETURN_STALE_EXHAUSTED_BATCH_SIZE') return 3;
        return def;
      }),
    };
    const findMany = jest.fn().mockResolvedValue([]);
    const deps = buildDeps({
      env,
      prisma: {
        return: { findMany },
        returnStatusHistory: { create: jest.fn() },
        $transaction: jest.fn(),
      },
    });
    const service = build(deps);
    await service.tick();

    const takes = findMany.mock.calls.map((c) => c[0].take);
    // 3 status-batches at 7, then the exhausted batch at 3.
    expect(takes).toEqual([7, 7, 7, 3]);
  });

  it('run() skips entirely when disabled (RETURN_STALE_DAYS <= 0)', async () => {
    const env = {
      getNumber: jest.fn((key: string, def: number) =>
        key === 'RETURN_STALE_DAYS' ? 0 : def,
      ),
    };
    const deps = buildDeps({ env });
    const service = build(deps);
    expect(service.enabled()).toBe(false);

    await service.run();
    expect(deps.leader.run).not.toHaveBeenCalled();
    expect(deps.instrumentation.wrap).not.toHaveBeenCalled();
  });

  it('run() drives the tick through leader-election + instrumentation when enabled', async () => {
    const deps = buildDeps();
    const service = build(deps);
    expect(service.enabled()).toBe(true);

    await service.run();
    expect(deps.leader.run).toHaveBeenCalledWith(
      'return-stale-processor',
      expect.any(Number),
      expect.any(Function),
    );
    expect(deps.instrumentation.wrap).toHaveBeenCalledWith(
      'returns.stale_processor',
      expect.any(Function),
    );
  });
});
