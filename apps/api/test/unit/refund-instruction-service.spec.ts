import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { RefundInstructionService } from '../../src/modules/refund-instructions/application/services/refund-instruction.service';

/**
 * Phase 3 (PR 3.4) — RefundInstructionService.
 *
 * Behaviour to pin:
 *   - Flag-OFF (REFUND_INSTRUCTION_REQUIRED=false): createForDispute
 *     returns null. Caller falls back to legacy direct-credit.
 *   - Flag-ON: creates a RefundInstruction in PROCESSING, runs the saga,
 *     reconciles the row to SUCCESS / FAILED.
 *   - Idempotency: same idempotencyKey returns the existing row instead
 *     of creating a duplicate.
 *   - Race: P2002 on insert → fetch & return the winner.
 *   - WALLET method runs the wallet-credit step. Other methods land in
 *     MANUAL_REQUIRED for ops follow-up.
 */
describe('RefundInstructionService', () => {
  function buildService(opts: {
    enabled?: boolean;
    sagaResult?: { status: 'COMPLETED' | 'FAILED'; failureReason?: string; finalContext?: Record<string, unknown> };
    existingByKey?: Record<string, unknown> | null;
    raceOnCreate?: boolean;
  }) {
    const created: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];
    const prisma = {
      refundInstruction: {
        findUnique: jest
          .fn()
          .mockResolvedValue(opts.existingByKey ?? null),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          if (opts.raceOnCreate) {
            throw new Prisma.PrismaClientKnownRequestError(
              'unique idempotency_key',
              { code: 'P2002', clientVersion: 'test' } as never,
            );
          }
          const row = {
            id: `ri-${created.length + 1}`,
            ...args.data,
            failureReason: null,
          };
          created.push(row);
          return row;
        }),
        update: jest.fn(async (args: { data: Record<string, unknown> }) => {
          updated.push(args.data);
          return { id: 'ri-1', ...args.data };
        }),
      },
    };
    const env = {
      getBoolean: jest
        .fn()
        .mockReturnValue(opts.enabled ?? false),
    };
    const wallet = {
      creditFromRefund: jest.fn().mockResolvedValue({
        wallet: { id: 'w-1', balanceInPaise: 5000 },
        transaction: { id: 'wt-1' },
      }),
    };
    const saga = {
      run: jest.fn().mockImplementation(async () => {
        const result = opts.sagaResult ?? {
          status: 'COMPLETED',
          finalContext: { walletTransactionId: 'wt-1' },
        };
        return {
          sagaId: 'saga-1',
          ...result,
        };
      }),
    };

    const service = new RefundInstructionService(
      prisma as never,
      env as never,
      wallet as never,
      saga as never,
    );
    return { service, prisma, env, wallet, saga, updated };
  }

  const baseArgs = () => ({
    disputeId: 'd-1',
    disputeNumber: 'DSP-2026-000001',
    customerId: 'u-1',
    masterOrderId: 'mo-1',
    amountInPaise: 5000,
  });

  // ─── Flag-OFF ─────────────────────────────────────────────────────

  it('returns null when REFUND_INSTRUCTION_REQUIRED is false', async () => {
    const { service, prisma } = buildService({});
    const result = await service.createForDispute(baseArgs());
    expect(result).toBeNull();
    expect(prisma.refundInstruction.create).not.toHaveBeenCalled();
  });

  // ─── Happy path ───────────────────────────────────────────────────

  it('creates an instruction + runs saga + flips to SUCCESS', async () => {
    const { service, prisma, saga, updated } = buildService({
      enabled: true,
    });
    const result = await service.createForDispute(baseArgs());
    expect(prisma.refundInstruction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceType: 'DISPUTE',
        sourceId: 'd-1',
        amountInPaise: 5000n,
        refundMethod: 'WALLET',
        status: 'PROCESSING',
        idempotencyKey: 'dispute:d-1',
      }),
    });
    expect(saga.run).toHaveBeenCalledTimes(1);
    expect(updated[0]).toEqual(
      expect.objectContaining({
        status: 'SUCCESS',
        walletTransactionId: 'wt-1',
        processedAt: expect.any(Date),
      }),
    );
    expect(result?.status).toBe('SUCCESS');
  });

  // ─── Saga failure ─────────────────────────────────────────────────

  it('flips to FAILED when the saga fails', async () => {
    const { service, updated } = buildService({
      enabled: true,
      sagaResult: { status: 'FAILED', failureReason: 'wallet locked' },
    });
    const result = await service.createForDispute(baseArgs());
    expect(updated[0]).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        failureReason: 'wallet locked',
      }),
    );
    expect(result?.status).toBe('FAILED');
  });

  // ─── Idempotency ──────────────────────────────────────────────────

  it('reuses an existing instruction with the same idempotencyKey', async () => {
    const existing = {
      id: 'ri-existing',
      sourceType: 'DISPUTE',
      sourceId: 'd-1',
      idempotencyKey: 'dispute:d-1',
      status: 'SUCCESS',
    };
    const { service, prisma, saga } = buildService({
      enabled: true,
      existingByKey: existing,
    });
    const result = await service.createForDispute(baseArgs());
    expect(result).toBe(existing);
    expect(prisma.refundInstruction.create).not.toHaveBeenCalled();
    expect(saga.run).not.toHaveBeenCalled();
  });

  it('recovers from P2002 race by returning the winning row', async () => {
    const winner = {
      id: 'ri-winner',
      sourceType: 'DISPUTE',
      idempotencyKey: 'dispute:d-1',
      status: 'PROCESSING',
    };
    const { service, prisma } = buildService({
      enabled: true,
      raceOnCreate: true,
    });
    // First findUnique returned null (built into mock); the recovery
    // findUnique returns the winner.
    prisma.refundInstruction.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    const result = await service.createForDispute(baseArgs());
    expect(result).toBe(winner);
  });
});
