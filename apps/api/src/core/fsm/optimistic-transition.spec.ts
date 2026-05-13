import {
  applyOptimisticTransition,
  buildVersionedWhere,
} from './optimistic-transition';
import { BadRequestAppException, ConflictAppException } from '../exceptions';

/**
 * Phase 0 (PR 0.9) — `applyOptimisticTransition` same-state idempotency.
 *
 * Pins the contract:
 *   - Legal transition → version bumps by 1.
 *   - Same-state retry → version stays put (the bug fix).
 *   - Illegal transition → BadRequestAppException, no update issued.
 *   - Prisma P2025 (stale where-version) → ConflictAppException.
 */

describe('applyOptimisticTransition', () => {
  it('legal transition bumps version by 1', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'r-1', status: 'APPROVED', version: 1 });
    await applyOptimisticTransition({
      kind: 'ReturnStatus',
      toStatus: 'APPROVED',
      current: { id: 'r-1', status: 'REQUESTED', version: 0 },
      update,
    });
    expect(update).toHaveBeenCalledWith(
      { id: 'r-1', version: 0 },
      { status: 'APPROVED', version: { increment: 1 } },
    );
  });

  // ── The headline PR 0.9 contract ──────────────────────────────────

  it('same-state retry DOES NOT bump version (the bug fix)', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'r-1', status: 'APPROVED', version: 1 });
    await applyOptimisticTransition({
      kind: 'ReturnStatus',
      toStatus: 'APPROVED',
      current: { id: 'r-1', status: 'APPROVED', version: 1 },
      update,
    });
    // Critical assertion: increment is 0 on the same-state path. The
    // version column stays at 1 in the DB. A subsequent legitimate
    // writer who observed version=1 will succeed (no spurious CAS
    // conflict).
    expect(update).toHaveBeenCalledWith(
      { id: 'r-1', version: 1 },
      { status: 'APPROVED', version: { increment: 0 } },
    );
  });

  it('same-state still calls the caller update (so auxiliary fields apply)', async () => {
    // Real-world use case: dispute.assign passes targetStatus=current.status
    // when the dispute is already in a non-OPEN state, but still wants
    // to write `assignedAdminId`. Calling update is required for that.
    const update = jest.fn().mockResolvedValue({ id: 'd-1', status: 'UNDER_REVIEW', version: 3 });
    const result = await applyOptimisticTransition<'DisputeStatus', { id: string; status: string; version: number }>({
      kind: 'DisputeStatus',
      toStatus: 'UNDER_REVIEW',
      current: { id: 'd-1', status: 'UNDER_REVIEW', version: 3 },
      update,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('d-1');
  });

  it('same-state across multiple replays leaves version unbumped each time', async () => {
    let storedVersion = 5;
    const update = jest.fn(async (where: any, patch: any) => {
      storedVersion += patch.version.increment;
      return { id: where.id, status: 'APPROVED', version: storedVersion };
    });

    for (let i = 0; i < 10; i++) {
      await applyOptimisticTransition({
        kind: 'ReturnStatus',
        toStatus: 'APPROVED',
        current: { id: 'r-replay', status: 'APPROVED', version: 5 },
        update,
      });
    }
    // 10 same-state calls, version stays at 5.
    expect(storedVersion).toBe(5);
  });

  // ── Illegal transitions ───────────────────────────────────────────

  it('illegal transition throws BadRequestAppException without issuing the update', async () => {
    const update = jest.fn();
    await expect(
      applyOptimisticTransition({
        kind: 'ReturnStatus',
        toStatus: 'COMPLETED',
        current: { id: 'r-2', status: 'REQUESTED', version: 0 }, // REQUESTED → COMPLETED is illegal
        update,
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(update).not.toHaveBeenCalled();
  });

  // ── Stale-version race ────────────────────────────────────────────

  it('Prisma P2025 mid-update becomes ConflictAppException', async () => {
    const p2025 = Object.assign(new Error('Record not found'), { code: 'P2025' });
    const update = jest.fn().mockRejectedValue(p2025);
    await expect(
      applyOptimisticTransition({
        kind: 'ReturnStatus',
        toStatus: 'APPROVED',
        current: { id: 'r-3', status: 'REQUESTED', version: 0 },
        update,
      }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('other Prisma errors propagate unchanged', async () => {
    const fkError = Object.assign(new Error('FK violation'), { code: 'P2003' });
    const update = jest.fn().mockRejectedValue(fkError);
    await expect(
      applyOptimisticTransition({
        kind: 'ReturnStatus',
        toStatus: 'APPROVED',
        current: { id: 'r-4', status: 'REQUESTED', version: 0 },
        update,
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  // ── Helper ────────────────────────────────────────────────────────

  it('buildVersionedWhere returns id + version for direct Prisma use', () => {
    expect(buildVersionedWhere({ id: 'r-5', version: 7 })).toEqual({ id: 'r-5', version: 7 });
  });
});
