import { ShippingPublicFacade } from './shipping-public.facade';

/**
 * Phase 0 (PR 0.8) — pin the new contract of
 * `updateShipmentFromTrackingEvent`:
 *
 *   1. Unknown fulfillment-status strings are rejected (was: cast `as any`
 *      and written directly into the Prisma enum).
 *   2. The FSM matrix is consulted; illegal transitions are skip-and-log.
 *   3. A status-conditional `updateMany` defends against concurrent
 *      writers (e.g. admin cancel landing between the read and the write).
 *
 * The facade is constructed directly with a lightweight mock prisma
 * because the real PrismaService transitively touches modules with
 * pre-existing Prisma client gaps (out of scope for PR 0.8).
 */

function buildFacade(opts: {
  initialStatus?: string;
  subOrderExists?: boolean;
  concurrentWriteWins?: boolean;
}) {
  const findUnique = jest.fn(async () =>
    opts.subOrderExists === false
      ? null
      : { fulfillmentStatus: opts.initialStatus ?? 'SHIPPED' },
  );
  const updateMany = jest.fn(async () => ({
    count: opts.concurrentWriteWins ? 0 : 1,
  }));

  const prisma = {
    subOrder: { findUnique, updateMany, update: jest.fn(), findMany: jest.fn() },
  } as any;
  const eventBus = { publish: jest.fn() } as any;

  const facade = new ShippingPublicFacade(prisma, eventBus);
  return { facade, prisma, findUnique, updateMany };
}

describe('ShippingPublicFacade.updateShipmentFromTrackingEvent — PR 0.8', () => {
  it('writes DELIVERED on a SHIPPED sub-order (happy path)', async () => {
    const { facade, updateMany } = buildFacade({ initialStatus: 'SHIPPED' });

    await facade.updateShipmentFromTrackingEvent('so-1', { status: 'DELIVERED' });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'so-1', fulfillmentStatus: 'SHIPPED' },
      data: { fulfillmentStatus: 'DELIVERED' },
    });
  });

  it('REJECTS an unknown fulfillment-status string (was: silent `as any` corruption)', async () => {
    const { facade, updateMany } = buildFacade({ initialStatus: 'SHIPPED' });

    await facade.updateShipmentFromTrackingEvent('so-2', { status: 'OUT_FOR_DELIVERY' });

    // OUT_FOR_DELIVERY isn't in the Prisma enum — must not write
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('skips an illegal FSM transition (DELIVERED → SHIPPED late tracking event)', async () => {
    const { facade, updateMany } = buildFacade({ initialStatus: 'DELIVERED' });

    await facade.updateShipmentFromTrackingEvent('so-3', { status: 'SHIPPED' });

    // FSM matrix has no DELIVERED → SHIPPED edge.
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('skips when the sub-order has vanished (race condition)', async () => {
    const { facade, updateMany } = buildFacade({ subOrderExists: false });

    await facade.updateShipmentFromTrackingEvent('so-ghost', { status: 'DELIVERED' });

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('skips when a concurrent writer claimed the row (status-CAS lost)', async () => {
    const { facade, updateMany } = buildFacade({
      initialStatus: 'SHIPPED',
      concurrentWriteWins: true, // updateMany returns count=0
    });

    await facade.updateShipmentFromTrackingEvent('so-4', { status: 'DELIVERED' });

    // updateMany was attempted but matched 0 rows — the helper returns
    // without throwing, log line emitted.
    expect(updateMany).toHaveBeenCalled();
  });

  it('SHIPPED → FULFILLED is legal and writes', async () => {
    const { facade, updateMany } = buildFacade({ initialStatus: 'SHIPPED' });
    await facade.updateShipmentFromTrackingEvent('so-5', { status: 'FULFILLED' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fulfillmentStatus: 'FULFILLED' } }),
    );
  });

  it('CANCELLED → DELIVERED is rejected (terminal state)', async () => {
    const { facade, updateMany } = buildFacade({ initialStatus: 'CANCELLED' });
    await facade.updateShipmentFromTrackingEvent('so-6', { status: 'DELIVERED' });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
