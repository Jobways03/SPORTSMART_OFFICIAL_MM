import 'reflect-metadata';
import { RefundSagaService } from '../../src/modules/payments-saga/application/services/refund-saga.service';
import type { SagaStep } from '../../src/modules/payments-saga/domain/saga-step.types';

/**
 * Phase 3 (PR 3.3) — RefundSaga executor.
 *
 * Behaviour to pin:
 *   - Flag-OFF: runs steps directly, returns COMPLETED on success,
 *     compensates on failure (without persisting saga rows).
 *   - Flag-ON: persists STARTED → IN_PROGRESS step records → COMPLETED.
 *   - Forward step failure → compensations run in reverse order on
 *     previously-SUCCEEDED steps only.
 *   - Compensation failure does NOT abort remaining compensations.
 *   - Context update from step N is visible to step N+1.
 */
describe('RefundSagaService', () => {
  function buildService(opts: { enabled?: boolean } = {}) {
    const created: { id: string }[] = [];
    const updates: Record<string, unknown>[] = [];
    const prisma = {
      refundSaga: {
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          const id = `saga-${created.length + 1}`;
          created.push({ id, ...args.data });
          return { id, ...args.data };
        }),
        update: jest.fn(async (args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return args.data;
        }),
      },
    };
    const env = {
      getBoolean: jest
        .fn()
        .mockReturnValue(opts.enabled ?? false),
    };
    const service = new RefundSagaService(prisma as never, env as never);
    return { service, prisma, env, updates };
  }

  type Ctx = { steps: string[] };

  function step(opts: {
    name: string;
    fail?: boolean;
    compFail?: boolean;
    addContext?: Partial<Ctx>;
  }): SagaStep<Ctx> & { compensateCalls: number } {
    const s = {
      name: opts.name,
      compensateCalls: 0,
      async execute(ctx: Ctx) {
        ctx.steps.push(`exec:${opts.name}`);
        if (opts.fail) throw new Error(`${opts.name} failed`);
        return {
          result: { who: opts.name },
          contextUpdate: opts.addContext,
        };
      },
      async compensate(ctx: Ctx, _result: unknown) {
        ctx.steps.push(`comp:${opts.name}`);
        s.compensateCalls += 1;
        if (opts.compFail) throw new Error(`${opts.name}.comp failed`);
      },
    };
    return s;
  }

  // ─── Flag-OFF behaviour ───────────────────────────────────────────

  describe('flag OFF', () => {
    it('runs the steps directly and returns COMPLETED on full success', async () => {
      const { service, prisma } = buildService({});
      const a = step({ name: 'A' });
      const b = step({ name: 'B' });
      const ctx: Ctx = { steps: [] };
      const r = await service.run({
        refundType: 'RETURN',
        sourceId: 'r-1',
        customerId: 'u-1',
        amountInPaise: 1000,
        context: ctx,
        steps: [a, b],
      });
      expect(r.status).toBe('COMPLETED');
      expect(r.finalContext.steps).toEqual(['exec:A', 'exec:B']);
      // No saga persistence at flag-OFF.
      expect(prisma.refundSaga.create).not.toHaveBeenCalled();
    });

    it('compensates on failure, in reverse order', async () => {
      const { service } = buildService({});
      const a = step({ name: 'A' });
      const b = step({ name: 'B' });
      const c = step({ name: 'C', fail: true });
      const ctx: Ctx = { steps: [] };
      const r = await service.run({
        refundType: 'RETURN',
        sourceId: 'r-1',
        customerId: 'u-1',
        amountInPaise: 1000,
        context: ctx,
        steps: [a, b, c],
      });
      expect(r.status).toBe('FAILED');
      expect(r.failureReason).toContain('C failed');
      expect(r.finalContext.steps).toEqual([
        'exec:A',
        'exec:B',
        'exec:C',
        'comp:B',
        'comp:A',
      ]);
    });
  });

  // ─── Flag-ON behaviour ────────────────────────────────────────────

  describe('flag ON', () => {
    it('persists the saga row + step records on success', async () => {
      const { service, prisma } = buildService({ enabled: true });
      const a = step({ name: 'A' });
      const b = step({ name: 'B' });
      const ctx: Ctx = { steps: [] };
      const r = await service.run({
        refundType: 'DISPUTE',
        sourceId: 'd-1',
        customerId: 'u-1',
        amountInPaise: 5000,
        context: ctx,
        steps: [a, b],
      });
      expect(r.status).toBe('COMPLETED');
      expect(r.sagaId).toBe('saga-1');
      expect(prisma.refundSaga.create).toHaveBeenCalledTimes(1);
      // 2 steps × 2 status updates each (IN_PROGRESS at start, IN_PROGRESS
      // again on persist after exec) + 1 final COMPLETED = 5 updates.
      // Exact count is brittle; just verify the final state was set.
      const finalUpdate =
        prisma.refundSaga.update.mock.calls[
          prisma.refundSaga.update.mock.calls.length - 1
        ][0];
      expect(finalUpdate.data.status).toBe('COMPLETED');
    });

    it('persists FAILED + compensations on forward failure', async () => {
      const { service, prisma } = buildService({ enabled: true });
      const a = step({ name: 'A' });
      const b = step({ name: 'B', fail: true });
      const ctx: Ctx = { steps: [] };
      const r = await service.run({
        refundType: 'DISPUTE',
        sourceId: 'd-1',
        customerId: 'u-1',
        amountInPaise: 5000,
        context: ctx,
        steps: [a, b],
      });
      expect(r.status).toBe('FAILED');
      // Final update is the FAILED + compensations write.
      const finalUpdate =
        prisma.refundSaga.update.mock.calls[
          prisma.refundSaga.update.mock.calls.length - 1
        ][0];
      expect(finalUpdate.data.status).toBe('FAILED');
      expect(finalUpdate.data.compensations).toBeDefined();
      expect(a.compensateCalls).toBe(1);
    });

    it('compensation failure does NOT abort remaining compensations', async () => {
      const { service } = buildService({ enabled: true });
      const a = step({ name: 'A' });
      const b = step({ name: 'B', compFail: true });
      const c = step({ name: 'C', fail: true });
      const ctx: Ctx = { steps: [] };
      const r = await service.run({
        refundType: 'RETURN',
        sourceId: 'r-1',
        customerId: 'u-1',
        amountInPaise: 1000,
        context: ctx,
        steps: [a, b, c],
      });
      expect(r.status).toBe('FAILED');
      // Both A.comp and B.comp ran (B failed but didn't abort A).
      expect(a.compensateCalls).toBe(1);
      expect(b.compensateCalls).toBe(1);
    });

    it('threads context updates from step N to step N+1', async () => {
      const { service } = buildService({ enabled: true });
      const a = step({ name: 'A', addContext: { steps: ['from-A'] } });
      let seenInB: Ctx | undefined;
      const b: SagaStep<Ctx> = {
        name: 'B',
        async execute(ctx) {
          seenInB = ctx;
          return { result: null };
        },
      };
      await service.run({
        refundType: 'RETURN',
        sourceId: 'r-1',
        customerId: 'u-1',
        amountInPaise: 1000,
        context: { steps: [] },
        steps: [a, b],
      });
      // contextUpdate from A overwrites the steps array — B sees the
      // overwritten value.
      expect(seenInB?.steps).toEqual(['from-A']);
    });
  });
});
