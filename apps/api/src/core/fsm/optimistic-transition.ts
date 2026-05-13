import type { Prisma } from '@prisma/client';
import {
  ConflictAppException,
  NotFoundAppException,
} from '../exceptions';
import { assertTransition, type StatusKind } from './status-transitions';

/**
 * Phase 5 (PR 5.1) — combine FSM transition check with optimistic-lock
 * compare-and-set on a Prisma `update` call.
 *
 * Without this helper, a service method that mutates `status` typically
 * does:
 *
 *   const cur = await prisma.return.findUnique(...);
 *   assertTransition('ReturnStatus', cur.status, 'APPROVED');
 *   await prisma.return.update({ where: { id }, data: { status: 'APPROVED' } });
 *
 * Two requests racing on the same return both pass the transition check
 * (both see status=REQUESTED) and both write APPROVED. That's mostly
 * harmless for a single field, but if one wanted REJECTED instead the
 * APPROVED writer wins by happening last — a clear last-write-wins bug.
 *
 * `applyOptimisticTransition` instead writes:
 *
 *   UPDATE returns
 *      SET status = 'APPROVED', version = version + 1
 *    WHERE id = $1 AND version = $expected;
 *
 * via Prisma's `where: { id, version }`. A 0-row update means another
 * writer beat us; we throw ConflictAppException so the caller gets a 409.
 *
 * Caller pattern:
 *
 *   await applyOptimisticTransition({
 *     kind: 'ReturnStatus',
 *     toStatus: 'APPROVED',
 *     current: returnRow,
 *     update: (whereWithVersion, statusPatch) =>
 *       prisma.return.update({
 *         where: whereWithVersion,
 *         data: { ...statusPatch, approvedAt: new Date(), approvedBy: adminId },
 *       }),
 *   });
 *
 * The helper passes the `where` clause that includes the version match
 * and the `{ status, version: increment }` patch. Caller layers extra
 * fields on top.
 */

interface ApplyTransitionInput<K extends StatusKind, R> {
  kind: K;
  toStatus: string;
  current: { id: string; status: string; version: number };
  /**
   * Performs the actual update. Receives a `where` clause containing
   * both `{ id }` and `{ version }` (so Prisma's CAS works) and a status
   * patch the caller must merge into its own `data` field. Should return
   * the updated row.
   *
   * Phase 0 (PR 0.9) — `version` patch is `{ increment: 0 | 1 }`. The
   * 0 case fires on idempotent same-state transitions so the row's
   * `version` column does NOT inflate every time a webhook replays the
   * same status. Callers' auxiliary fields (assignedAdminId, notes,
   * etc.) still apply on the no-op path, matching their existing
   * intent.
   */
  update: (
    where: { id: string; version: number },
    statusPatch: { status: string; version: { increment: 0 | 1 } },
  ) => Promise<R>;
}

/**
 * Throws BadRequestAppException for an illegal transition,
 * ConflictAppException for a stale-version race, NotFoundAppException
 * if the row vanished mid-update.
 */
export async function applyOptimisticTransition<K extends StatusKind, R>(
  input: ApplyTransitionInput<K, R>,
): Promise<R> {
  // Phase 0 (PR 0.9) — idempotent same-state transitions DO NOT bump
  // version. The previous code's `increment: 1` here inflated version
  // on every retry, defeating the very idempotency the docstring
  // promises ("a retried 'approve' call doesn't silently bump
  // version"). Webhook handlers replaying the same status now leave
  // the CAS column untouched, so a subsequent legitimate writer with
  // the same observed version still succeeds.
  if (input.current.status === input.toStatus) {
    return input.update(
      { id: input.current.id, version: input.current.version },
      { status: input.toStatus, version: { increment: 0 } },
    );
  }

  assertTransition(input.kind, input.current.status, input.toStatus);

  try {
    return await input.update(
      { id: input.current.id, version: input.current.version },
      { status: input.toStatus, version: { increment: 1 } },
    );
  } catch (err) {
    // Prisma raises P2025 ("record not found") when the WHERE clause —
    // including the version match — finds zero rows. We can't tell
    // "vanished" from "stale version" without a second query, but the
    // empirically-likelier explanation in production is the version race.
    const code = (err as { code?: string }).code;
    if (code === 'P2025') {
      throw new ConflictAppException(
        `Stale state detected on ${input.kind} ${input.current.id}: another writer updated it concurrently`,
      );
    }
    // Re-throw anything else (foreign-key violations, validation, etc.)
    throw err;
  }
}

/**
 * Convenience for the simpler case: caller just wants the FSM check +
 * the CAS where-clause but is happy to write Prisma directly.
 */
export function buildVersionedWhere<T extends { id: string; version: number }>(
  current: T,
): { id: string; version: number } {
  return { id: current.id, version: current.version };
}

// Re-export for ergonomic use sites (so callers can import everything
// they need from one path).
export { assertTransition, NotFoundAppException, ConflictAppException };
export type { Prisma };
