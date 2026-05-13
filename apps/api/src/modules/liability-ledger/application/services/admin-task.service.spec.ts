import { AdminTaskService } from './admin-task.service';

/**
 * Phase 0 (PR 0.14) — AdminTaskService.enqueue gains `slaHours`.
 * The breach-detector cron uses the resulting `slaBreachAt` to
 * escalate stuck refund-instruction failures.
 */

function buildService(opts: {
  createImpl?: (args: any) => Promise<any>;
}) {
  const create = jest.fn(opts.createImpl ?? (async (args: any) => ({ id: 'task-1', ...args.data })));
  const findUnique = jest.fn();
  const prisma = { adminTask: { create, findUnique } } as any;
  const service = new AdminTaskService(prisma);
  return { service, prisma, create, findUnique };
}

describe('AdminTaskService.enqueue — Phase 0 PR 0.14', () => {
  it('sets slaBreachAt = now + slaHours when slaHours is given', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { service, create } = buildService({});

    await service.enqueue({
      kind: 'REFUND_INSTRUCTION_FAILED',
      sourceType: 'DISPUTE',
      sourceId: 'd-1',
      reason: 'wallet credit failed',
      slaHours: 24,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'REFUND_INSTRUCTION_FAILED',
        sourceType: 'DISPUTE',
        sourceId: 'd-1',
        slaBreachAt: new Date('2026-01-02T00:00:00Z'), // +24h exactly
      }),
    });

    jest.useRealTimers();
  });

  it('legacy callers (no slaHours) get slaBreachAt: null', async () => {
    const { service, create } = buildService({});

    await service.enqueue({
      kind: 'LOGISTICS_CLAIM_REVIEW',
      sourceType: 'RETURN',
      sourceId: 'r-1',
      reason: 'manual review',
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slaBreachAt: null }),
    });
  });

  it('treats slaHours=0 or null as no SLA', async () => {
    const { service, create } = buildService({});
    await service.enqueue({
      kind: 'SELLER_DEBIT_DISPUTED',
      sourceType: 'MANUAL',
      sourceId: 's-1',
      reason: 'contest',
      slaHours: 0,
    });
    expect(create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ slaBreachAt: null }),
    });

    await service.enqueue({
      kind: 'SELLER_DEBIT_DISPUTED',
      sourceType: 'MANUAL',
      sourceId: 's-2',
      reason: 'contest',
      slaHours: null,
    });
    expect(create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ slaBreachAt: null }),
    });
  });

  it('on P2002 (idempotent recovery), returns the existing row without re-setting slaBreachAt', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'existing',
      kind: 'REFUND_INSTRUCTION_FAILED',
      sourceType: 'DISPUTE',
      sourceId: 'd-2',
      slaBreachAt: new Date('2026-01-01T12:00:00Z'),
    });
    const create = jest.fn().mockRejectedValue(
      Object.assign(Error('unique violation'), {
        code: 'P2002',
        clientVersion: 'test',
        constructor: { name: 'PrismaClientKnownRequestError' },
        // mimic Prisma's PrismaClientKnownRequestError shape
      }),
    );
    // Make it pass the `instanceof Prisma.PrismaClientKnownRequestError` check
    // by prototype-faking: use the real error class.
    const { Prisma } = require('@prisma/client');
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: 'test',
      } as any),
    );

    const prisma = { adminTask: { create, findUnique } } as any;
    const service = new AdminTaskService(prisma);

    const result = await service.enqueue({
      kind: 'REFUND_INSTRUCTION_FAILED',
      sourceType: 'DISPUTE',
      sourceId: 'd-2',
      reason: 'retry',
      slaHours: 48, // different from the existing 12h-from-now; must NOT extend
    });

    expect(result.id).toBe('existing');
    // The returned slaBreachAt is the ORIGINAL, not the retry's longer one.
    expect(result.slaBreachAt).toEqual(new Date('2026-01-01T12:00:00Z'));
  });
});
