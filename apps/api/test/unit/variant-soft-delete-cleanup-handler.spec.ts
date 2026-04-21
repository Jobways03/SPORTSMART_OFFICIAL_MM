import 'reflect-metadata';
import { VariantSoftDeleteCleanupHandler } from '../../src/modules/franchise/application/event-handlers/variant-soft-delete-cleanup.handler';

/**
 * Regression test for the franchise mapping auto-stop on variant
 * soft-delete.
 *
 * Before: when a catalog variant was soft-deleted (by seller or
 * admin), the FranchiseCatalogMapping rows pointing at it were left
 * as APPROVED+isActive=true in the DB. They were hidden from reads
 * by the repo filter (fixed in the previous pass), but the rows
 * themselves kept their prior state. If the variant ever came back
 * (isDeleted flipped to false), those mappings would silently
 * re-emerge as APPROVED without the franchise re-confirming them.
 *
 * After: the handler fires on `catalog.variant.soft_deleted` and
 * moves every matching mapping to STOPPED+isActive=false, making
 * the lifecycle explicit and auditable. Idempotent by design —
 * already-STOPPED rows are filtered out so replays are no-ops.
 */

describe('VariantSoftDeleteCleanupHandler', () => {
  const buildHandler = () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma: any = { franchiseCatalogMapping: { updateMany } };
    return {
      handler: new VariantSoftDeleteCleanupHandler(prisma),
      updateMany,
    };
  };

  const buildEvent = (variantId: string) => ({
    eventName: 'catalog.variant.soft_deleted',
    aggregate: 'ProductVariant',
    aggregateId: variantId,
    occurredAt: new Date(),
    payload: { variantId, productId: 'prod-1', deletedBy: 'admin-1' },
  });

  it('stops all live mappings for the soft-deleted variant', async () => {
    const { handler, updateMany } = buildHandler();
    await handler.handleVariantSoftDeleted(buildEvent('var-1'));

    expect(updateMany).toHaveBeenCalledTimes(1);
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toEqual({
      variantId: 'var-1',
      approvalStatus: { not: 'STOPPED' },
    });
    expect(args.data).toEqual({
      approvalStatus: 'STOPPED',
      isActive: false,
    });
  });

  it('is idempotent — the where clause filters out already-STOPPED rows', async () => {
    // Replays of the same event must not ping already-stopped mappings
    // (otherwise updatedAt churns on every retry). The where clause is
    // the guard; verify it here so a refactor can't silently remove it.
    const { handler, updateMany } = buildHandler();
    await handler.handleVariantSoftDeleted(buildEvent('var-1'));
    await handler.handleVariantSoftDeleted(buildEvent('var-1'));

    for (const call of updateMany.mock.calls) {
      expect(call[0].where.approvalStatus).toEqual({ not: 'STOPPED' });
    }
  });

  it('returns silently and does not throw when the payload has no variantId', async () => {
    const { handler, updateMany } = buildHandler();
    const bogus: any = {
      eventName: 'catalog.variant.soft_deleted',
      aggregate: 'ProductVariant',
      aggregateId: '',
      occurredAt: new Date(),
      payload: { variantId: '', productId: 'prod-1' },
    };
    await expect(handler.handleVariantSoftDeleted(bogus)).resolves.toBeUndefined();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('swallows DB errors so a listener failure does not crash the emitter', async () => {
    // The handler runs under emitAsync — if it throws, the event bus
    // logs and moves on (per event-bus-async-handler-errors.spec), but
    // every listener should still try to be resilient on its own. The
    // catalog filter already hides the orphan mapping from business
    // logic, so a failed STOP is not a correctness bug, just stale
    // state.
    const updateMany = jest.fn().mockRejectedValue(new Error('db down'));
    const prisma: any = { franchiseCatalogMapping: { updateMany } };
    const handler = new VariantSoftDeleteCleanupHandler(prisma);

    await expect(handler.handleVariantSoftDeleted(buildEvent('var-1'))).resolves.toBeUndefined();
  });
});
