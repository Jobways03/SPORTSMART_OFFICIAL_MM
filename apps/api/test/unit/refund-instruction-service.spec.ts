import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { RefundInstructionService } from '../../src/modules/refund-instructions/application/services/refund-instruction.service';

/**
 * Phase 3 (PR 3.4) + Phase 12 (ADR-017) — RefundInstructionService.
 *
 * PR 12.4 — Test contract updated for ADR-016 + ADR-017:
 *   - ADR-016 deleted the `REFUND_INSTRUCTION_REQUIRED` gate for
 *     disputes; createForDispute always mints an instruction now. The
 *     flag still applies to return-driven refunds, but those have
 *     their own tests.
 *   - ADR-017 added the finance-approval gate: amounts over the
 *     threshold (default ₹10,000 = 1_000_000 paise) queue as
 *     PENDING_APPROVAL and skip the saga. Amounts under threshold
 *     auto-execute via the saga (current behaviour).
 *
 * Behaviour pinned by this spec:
 *   - Under-threshold dispute → creates a PROCESSING row, runs saga,
 *     reconciles to SUCCESS / FAILED.
 *   - Over-threshold dispute → creates a PENDING_APPROVAL row,
 *     skips saga, returns the row for finance review.
 *   - Idempotency: same idempotencyKey returns the existing row
 *     instead of creating a duplicate.
 *   - Race: P2002 on insert → fetch & return the winner.
 *   - WALLET method runs the wallet-credit step. Other methods land
 *     in MANUAL_REQUIRED for ops follow-up.
 */
describe('RefundInstructionService', () => {
  function buildService(opts: {
    enabled?: boolean;
    sagaResult?: { status: 'COMPLETED' | 'FAILED'; failureReason?: string; finalContext?: Record<string, unknown> };
    existingByKey?: Record<string, unknown> | null;
    raceOnCreate?: boolean;
    /** Override the auto-approve threshold (paise). Default 1_000_000 (₹10k). */
    thresholdPaise?: number;
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
      // PR 12.4 — REFUND_AUTO_APPROVE_THRESHOLD_PAISE default matches
      // the source (1_000_000 paise = ₹10,000). baseArgs uses 5000
      // paise which stays under threshold and auto-routes through the
      // saga. Over-threshold cases supply an explicit `thresholdPaise`
      // opt override. env.getOptional returns undefined (no per-method
      // override), env.getNumber returns the threshold.
      getOptional: jest.fn().mockReturnValue(undefined),
      getNumber: jest
        .fn()
        .mockReturnValue(opts.thresholdPaise ?? 1_000_000),
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

  // ─── ADR-017 finance-approval gate ────────────────────────────────

  it('queues PENDING_APPROVAL when amount exceeds the auto-approve threshold', async () => {
    // 50_000 paise (₹500) under a ₹100 (10_000 paise) threshold →
    // over-threshold → PENDING_APPROVAL, no saga.
    const { service, prisma, saga, updated } = buildService({
      thresholdPaise: 10_000,
    });
    const result = await service.createForDispute({
      ...baseArgs(),
      amountInPaise: 50_000,
    });
    expect(prisma.refundInstruction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceType: 'DISPUTE',
        sourceId: 'd-1',
        amountInPaise: 50_000n,
        refundMethod: 'WALLET',
        status: 'PENDING_APPROVAL',
        idempotencyKey: 'dispute:d-1',
      }),
    });
    // Skipped saga + skipped status reconciliation update; row is
    // handed back as-is for finance to approve later.
    expect(saga.run).not.toHaveBeenCalled();
    expect(updated).toHaveLength(0);
    expect(result?.status).toBe('PENDING_APPROVAL');
  });

  // ─── Happy path (under-threshold auto-route) ──────────────────────

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
