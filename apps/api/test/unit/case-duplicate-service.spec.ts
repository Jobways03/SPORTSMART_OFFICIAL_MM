import 'reflect-metadata';
import { CaseDuplicateService } from '../../src/core/case-duplicate/case-duplicate.service';
import { DuplicateCaseException } from '../../src/core/exceptions';

/**
 * Unit tests for CaseDuplicateService (Phase 1.5).
 *
 * Each rule is tested against:
 *   - Flag OFF → no-op (no DB read)
 *   - No active duplicate → resolves without throwing
 *   - Active duplicate found → throws DuplicateCaseException
 *     AND records a row in case_duplicates
 *
 * Prisma is mocked at the module-accessor level. We don't try to fake
 * the full PrismaClient; the rule logic is in the service, and the
 * accessor calls are simple findFirst+create pairs.
 */
describe('CaseDuplicateService', () => {
  let prismaMock: {
    returnItem: { findFirst: jest.Mock };
    dispute: { findFirst: jest.Mock };
    ticket: { findFirst: jest.Mock };
    caseDuplicate: { create: jest.Mock };
  };
  let envMock: { getBoolean: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; error: jest.Mock };
  let service: CaseDuplicateService;

  const customerActor = { type: 'CUSTOMER', id: 'user-1' };

  beforeEach(() => {
    prismaMock = {
      returnItem: { findFirst: jest.fn() },
      dispute: { findFirst: jest.fn() },
      ticket: { findFirst: jest.fn() },
      caseDuplicate: { create: jest.fn().mockResolvedValue({}) },
    };
    envMock = { getBoolean: jest.fn().mockReturnValue(true) };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };
    service = new CaseDuplicateService(
      prismaMock as never,
      envMock as never,
      logger as never,
    );
  });

  // ─── R1 — return per orderItem ────────────────────────────────────

  describe('assertNoActiveReturnForOrderItem', () => {
    it('no-ops when the flag is OFF', async () => {
      envMock.getBoolean.mockReturnValue(false);
      await service.assertNoActiveReturnForOrderItem({
        orderItemId: 'oi-1',
        actor: customerActor,
      });
      expect(prismaMock.returnItem.findFirst).not.toHaveBeenCalled();
    });

    it('resolves when no active return exists', async () => {
      prismaMock.returnItem.findFirst.mockResolvedValue(null);
      await expect(
        service.assertNoActiveReturnForOrderItem({
          orderItemId: 'oi-1',
          actor: customerActor,
        }),
      ).resolves.toBeUndefined();
      expect(prismaMock.caseDuplicate.create).not.toHaveBeenCalled();
    });

    it('throws DuplicateCaseException when an active return exists', async () => {
      prismaMock.returnItem.findFirst.mockResolvedValue({
        return: { id: 'ret-1', returnNumber: 'RET-2026-001234' },
      });
      await expect(
        service.assertNoActiveReturnForOrderItem({
          orderItemId: 'oi-1',
          actor: customerActor,
        }),
      ).rejects.toBeInstanceOf(DuplicateCaseException);
      expect(prismaMock.caseDuplicate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attemptedSourceType: 'RETURN',
            duplicateOfSourceType: 'RETURN',
            duplicateOfSourceId: 'ret-1',
            reason: 'ACTIVE_RETURN_EXISTS_FOR_ORDER_ITEM',
            actorType: 'CUSTOMER',
            actorId: 'user-1',
          }),
        }),
      );
    });

    it('exposes duplicateOfId + rule on the exception', async () => {
      prismaMock.returnItem.findFirst.mockResolvedValue({
        return: { id: 'ret-1', returnNumber: 'RET-2026-001234' },
      });
      await service
        .assertNoActiveReturnForOrderItem({
          orderItemId: 'oi-1',
          actor: customerActor,
        })
        .catch((err) => {
          expect(err).toBeInstanceOf(DuplicateCaseException);
          expect((err as DuplicateCaseException).duplicateOfId).toBe(
            'RET-2026-001234',
          );
          expect((err as DuplicateCaseException).rule).toBe(
            'ACTIVE_RETURN_EXISTS_FOR_ORDER_ITEM',
          );
        });
    });

    it('still rejects the user-visible 409 even if audit-write fails', async () => {
      prismaMock.returnItem.findFirst.mockResolvedValue({
        return: { id: 'ret-1', returnNumber: 'RET-2026-001234' },
      });
      prismaMock.caseDuplicate.create.mockRejectedValue(new Error('db down'));
      await expect(
        service.assertNoActiveReturnForOrderItem({
          orderItemId: 'oi-1',
          actor: customerActor,
        }),
      ).rejects.toBeInstanceOf(DuplicateCaseException);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ─── R2 — dispute per return ──────────────────────────────────────

  describe('assertNoActiveDisputeForReturn', () => {
    it('throws when an active dispute exists for the return', async () => {
      prismaMock.dispute.findFirst.mockResolvedValue({
        id: 'd-1',
        disputeNumber: 'DSP-2026-000045',
      });
      await expect(
        service.assertNoActiveDisputeForReturn({
          returnId: 'ret-1',
          actor: customerActor,
        }),
      ).rejects.toBeInstanceOf(DuplicateCaseException);
      expect(prismaMock.caseDuplicate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attemptedSourceType: 'DISPUTE',
            duplicateOfSourceType: 'DISPUTE',
            reason: 'ACTIVE_DISPUTE_EXISTS_FOR_RETURN',
          }),
        }),
      );
    });

    it('passes the inactive-status filter so resolved disputes do not block', async () => {
      // Verify the where-clause shape — "status notIn [...inactive]"
      // — by inspecting the mock call. We don't enforce equality on
      // the array contents, just that notIn is present.
      prismaMock.dispute.findFirst.mockResolvedValue(null);
      await service.assertNoActiveDisputeForReturn({
        returnId: 'ret-1',
        actor: customerActor,
      });
      const where = prismaMock.dispute.findFirst.mock.calls[0][0].where;
      expect(where.returnId).toBe('ret-1');
      expect(where.status.notIn).toEqual(
        expect.arrayContaining([
          'CLOSED',
          'RESOLVED_BUYER',
          'RESOLVED_SELLER',
          'RESOLVED_SPLIT',
        ]),
      );
    });
  });

  // ─── R3 — dispute per (order, kind) ──────────────────────────────

  describe('assertNoActiveDisputeForOrderAndKind', () => {
    it('throws on an active same-kind dispute on the same master order', async () => {
      prismaMock.dispute.findFirst.mockResolvedValue({
        id: 'd-9',
        disputeNumber: 'DSP-2026-000099',
      });
      await expect(
        service.assertNoActiveDisputeForOrderAndKind({
          masterOrderId: 'mo-1',
          kind: 'WRONG_ITEM_RECEIVED',
          actor: customerActor,
        }),
      ).rejects.toBeInstanceOf(DuplicateCaseException);
      const where = prismaMock.dispute.findFirst.mock.calls[0][0].where;
      expect(where.masterOrderId).toBe('mo-1');
      expect(where.kind).toBe('WRONG_ITEM_RECEIVED');
    });

    it('does not block a different-kind dispute on the same order', async () => {
      // R3 keys on (masterOrderId, kind) — two different kinds is fine.
      prismaMock.dispute.findFirst.mockResolvedValue(null);
      await expect(
        service.assertNoActiveDisputeForOrderAndKind({
          masterOrderId: 'mo-1',
          kind: 'DAMAGED_IN_TRANSIT',
          actor: customerActor,
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── R4 — ticket per (order, category) ──────────────────────────

  describe('assertNoActiveTicketForOrderAndCategory', () => {
    it('throws when an active ticket exists for the same order + category', async () => {
      prismaMock.ticket.findFirst.mockResolvedValue({
        id: 't-1',
        ticketNumber: 'TKT-2026-000007',
      });
      await expect(
        service.assertNoActiveTicketForOrderAndCategory({
          relatedOrderId: 'mo-1',
          categoryId: 'cat-shipping',
          actor: customerActor,
        }),
      ).rejects.toBeInstanceOf(DuplicateCaseException);
    });

    it('skips the rule when categoryId is missing (incomplete natural key)', async () => {
      await expect(
        service.assertNoActiveTicketForOrderAndCategory({
          relatedOrderId: 'mo-1',
          categoryId: null,
          actor: customerActor,
        }),
      ).resolves.toBeUndefined();
      expect(prismaMock.ticket.findFirst).not.toHaveBeenCalled();
    });

    it('admin override (allowDuplicate=true) bypasses the rule', async () => {
      prismaMock.ticket.findFirst.mockResolvedValue({
        id: 't-1',
        ticketNumber: 'TKT-2026-000007',
      });
      await expect(
        service.assertNoActiveTicketForOrderAndCategory({
          relatedOrderId: 'mo-1',
          categoryId: 'cat-shipping',
          actor: { type: 'ADMIN', id: 'admin-1' },
          allowDuplicate: true,
        }),
      ).resolves.toBeUndefined();
      // Admin override should NOT even hit the DB — short-circuit
      // before findFirst.
      expect(prismaMock.ticket.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.caseDuplicate.create).not.toHaveBeenCalled();
    });
  });
});
