import 'reflect-metadata';
import { applyOptimisticTransition } from '../../src/core/fsm/optimistic-transition';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../src/core/exceptions';

/**
 * Phase 5 (PR 5.1) — applyOptimisticTransition helper.
 *
 * The helper combines:
 *   - FSM transition check (illegal transition → BadRequestAppException)
 *   - Optimistic-lock CAS (stale version → ConflictAppException)
 *   - Same-state idempotency (toStatus == fromStatus → no FSM error)
 *
 * Tests pin all three branches plus the P2025 → 409 mapping.
 */
describe('applyOptimisticTransition', () => {
  it('runs the update for a valid transition and increments version', async () => {
    const update = jest.fn(async (_where, patch) => ({
      id: 'r1',
      status: patch.status,
      version: 1,
    }));

    const result = await applyOptimisticTransition({
      kind: 'ReturnStatus',
      toStatus: 'APPROVED',
      current: { id: 'r1', status: 'REQUESTED', version: 0 },
      update,
    });

    expect(result.status).toBe('APPROVED');
    expect(update).toHaveBeenCalledWith(
      { id: 'r1', version: 0 },
      { status: 'APPROVED', version: { increment: 1 } },
    );
  });

  it('throws BadRequestAppException for an illegal transition', async () => {
    const update = jest.fn();
    await expect(
      applyOptimisticTransition({
        kind: 'ReturnStatus',
        toStatus: 'COMPLETED',
        current: { id: 'r1', status: 'REQUESTED', version: 0 },
        update,
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(update).not.toHaveBeenCalled();
  });

  it('translates Prisma P2025 into ConflictAppException', async () => {
    const update = jest.fn(async () => {
      const e: any = new Error('record not found');
      e.code = 'P2025';
      throw e;
    });

    await expect(
      applyOptimisticTransition({
        kind: 'ReturnStatus',
        toStatus: 'APPROVED',
        current: { id: 'r1', status: 'REQUESTED', version: 0 },
        update,
      }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('re-throws non-P2025 errors untouched', async () => {
    const update = jest.fn(async () => {
      const e: any = new Error('FK violation');
      e.code = 'P2003';
      throw e;
    });

    await expect(
      applyOptimisticTransition({
        kind: 'ReturnStatus',
        toStatus: 'APPROVED',
        current: { id: 'r1', status: 'REQUESTED', version: 0 },
        update,
      }),
    ).rejects.toThrow('FK violation');
  });

  it('same-state transitions skip the FSM check (idempotent retries)', async () => {
    const update = jest.fn(async (_where, patch) => ({
      id: 'r1',
      status: patch.status,
      version: 5,
    }));

    // RECEIVED → RECEIVED would normally fail (RECEIVED has no
    // self-loop in the table), but the helper short-circuits on equality.
    const result = await applyOptimisticTransition({
      kind: 'ReturnStatus',
      toStatus: 'RECEIVED',
      current: { id: 'r1', status: 'RECEIVED', version: 4 },
      update,
    });

    expect(result.status).toBe('RECEIVED');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('PICKUP_SCHEDULED → RECEIVED shortcut is allowed (courier-skip case)', async () => {
    const update = jest.fn(async () => ({
      id: 'r1',
      status: 'RECEIVED',
      version: 1,
    }));

    await applyOptimisticTransition({
      kind: 'ReturnStatus',
      toStatus: 'RECEIVED',
      current: { id: 'r1', status: 'PICKUP_SCHEDULED', version: 0 },
      update,
    });

    expect(update).toHaveBeenCalled();
  });
});
