import { StockRestoreService } from './stock-restore.service';

/**
 * Phase 0 (PR 0.7) — stock-ledger symmetry.
 *
 * `SellerAllocationService.confirmReservation` decrements BOTH
 * `mapping.stockQty` AND `productVariant.stock` (or `product.baseStock`)
 * on payment success. The reverse paths in OrdersService historically
 * restored only one of the two — silently drifting the ledgers apart.
 *
 * These tests pin the helper's contract: every reservation in the
 * appropriate prior state restores exactly what was decremented; nothing
 * more, nothing less; terminal-state reservations are no-ops.
 */

interface FakeReservation {
  id: string;
  mappingId: string;
  quantity: number;
  status: 'RESERVED' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED';
  orderId: string;
}

interface FakeMapping {
  id: string;
  sellerId: string;
  productId: string;
  variantId: string | null;
  stockQty: number;
  reservedQty: number;
}

function buildTx(opts: {
  reservations: FakeReservation[];
  mappings: FakeMapping[];
  variantStock?: Record<string, number>;
  productBaseStock?: Record<string, number>;
}) {
  const reservations = new Map(opts.reservations.map((r) => [r.id, { ...r }]));
  const mappings = new Map(opts.mappings.map((m) => [m.id, { ...m }]));
  const variantStock = new Map(Object.entries(opts.variantStock ?? {}));
  const productBaseStock = new Map(Object.entries(opts.productBaseStock ?? {}));

  const reservationFindManyMock = jest.fn();

  // Real Prisma returns SNAPSHOTS, not live row refs. Cloning on the
  // way out of findUnique / update prevents the helper from seeing
  // post-update state when it later inspects the original `reservation`.
  const tx = {
    stockReservation: {
      findUnique: jest.fn(async ({ where }: any) => {
        const r = reservations.get(where.id);
        return r ? { ...r } : null;
      }),
      findMany: reservationFindManyMock.mockImplementation(async ({ where }: any) => {
        const filtered = Array.from(reservations.values()).filter((r) => {
          if (r.orderId !== where.orderId) return false;
          if (where.status?.in && !where.status.in.includes(r.status)) return false;
          if (where.mapping?.sellerId) {
            const m = mappings.get(r.mappingId);
            if (m?.sellerId !== where.mapping.sellerId) return false;
          }
          return true;
        });
        return filtered.map((r) => ({ id: r.id }));
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = reservations.get(where.id);
        if (!r) throw new Error('reservation not found');
        if (data.status) r.status = data.status;
        return { ...r };
      }),
    },
    sellerProductMapping: {
      update: jest.fn(async ({ where, data }: any) => {
        const m = mappings.get(where.id);
        if (!m) throw new Error('mapping not found');
        if (data.stockQty?.increment !== undefined) m.stockQty += data.stockQty.increment;
        if (data.stockQty?.decrement !== undefined) m.stockQty -= data.stockQty.decrement;
        if (data.reservedQty?.increment !== undefined) m.reservedQty += data.reservedQty.increment;
        if (data.reservedQty?.decrement !== undefined) m.reservedQty -= data.reservedQty.decrement;
        return { ...m };
      }),
    },
    productVariant: {
      update: jest.fn(async ({ where, data }: any) => {
        const cur = variantStock.get(where.id) ?? 0;
        const nxt =
          cur +
          (data.stock?.increment ?? 0) -
          (data.stock?.decrement ?? 0);
        variantStock.set(where.id, nxt);
        return { id: where.id, stock: nxt };
      }),
    },
    product: {
      update: jest.fn(async ({ where, data }: any) => {
        const cur = productBaseStock.get(where.id) ?? 0;
        const nxt =
          cur +
          (data.baseStock?.increment ?? 0) -
          (data.baseStock?.decrement ?? 0);
        productBaseStock.set(where.id, nxt);
        return { id: where.id, baseStock: nxt };
      }),
    },
  } as any;

  return {
    tx,
    state: { reservations, mappings, variantStock, productBaseStock },
  };
}

describe('StockRestoreService', () => {
  let svc: StockRestoreService;
  beforeEach(() => {
    svc = new StockRestoreService();
  });

  // ── single-reservation contract ────────────────────────────────────

  it('CONFIRMED reservation: restores BOTH stockQty AND variant.stock (the headline bug)', async () => {
    const { tx, state } = buildTx({
      reservations: [
        { id: 'r-1', mappingId: 'm-1', quantity: 3, status: 'CONFIRMED', orderId: 'o-1' },
      ],
      mappings: [
        { id: 'm-1', sellerId: 's-1', productId: 'p-1', variantId: 'v-1', stockQty: 7, reservedQty: 0 },
      ],
      variantStock: { 'v-1': 12 },
    });

    const result = await svc.restoreForReservation(tx, 'r-1');

    expect(result).toBe(true);
    expect(state.reservations.get('r-1')!.status).toBe('RELEASED');
    expect(state.mappings.get('m-1')!.stockQty).toBe(10); // 7 + 3
    expect(state.variantStock.get('v-1')).toBe(15);       // 12 + 3 — the previously-missing increment
    expect(state.mappings.get('m-1')!.reservedQty).toBe(0); // unchanged (already 0 at confirm time)
  });

  it('CONFIRMED reservation against a base product (no variant): restores baseStock', async () => {
    const { tx, state } = buildTx({
      reservations: [
        { id: 'r-2', mappingId: 'm-2', quantity: 2, status: 'CONFIRMED', orderId: 'o-2' },
      ],
      mappings: [
        { id: 'm-2', sellerId: 's-1', productId: 'p-2', variantId: null, stockQty: 5, reservedQty: 0 },
      ],
      productBaseStock: { 'p-2': 8 },
    });

    await svc.restoreForReservation(tx, 'r-2');

    expect(state.mappings.get('m-2')!.stockQty).toBe(7);  // 5 + 2
    expect(state.productBaseStock.get('p-2')).toBe(10);   // 8 + 2
  });

  it('RESERVED reservation: only undoes the reservedQty bump, never touches variant', async () => {
    const { tx, state } = buildTx({
      reservations: [
        { id: 'r-3', mappingId: 'm-3', quantity: 4, status: 'RESERVED', orderId: 'o-3' },
      ],
      mappings: [
        { id: 'm-3', sellerId: 's-1', productId: 'p-3', variantId: 'v-3', stockQty: 10, reservedQty: 4 },
      ],
      variantStock: { 'v-3': 20 },
    });

    await svc.restoreForReservation(tx, 'r-3');

    expect(state.mappings.get('m-3')!.stockQty).toBe(10);    // unchanged
    expect(state.mappings.get('m-3')!.reservedQty).toBe(0);  // 4 - 4
    expect(state.variantStock.get('v-3')).toBe(20);          // unchanged — never decremented for RESERVED
  });

  it('RELEASED reservation is an idempotent no-op', async () => {
    const { tx, state } = buildTx({
      reservations: [
        { id: 'r-4', mappingId: 'm-4', quantity: 5, status: 'RELEASED', orderId: 'o-4' },
      ],
      mappings: [
        { id: 'm-4', sellerId: 's-1', productId: 'p-4', variantId: 'v-4', stockQty: 10, reservedQty: 0 },
      ],
      variantStock: { 'v-4': 20 },
    });

    const result = await svc.restoreForReservation(tx, 'r-4');

    expect(result).toBe(false);
    expect(state.mappings.get('m-4')!.stockQty).toBe(10);
    expect(state.variantStock.get('v-4')).toBe(20);
    expect(tx.sellerProductMapping.update).not.toHaveBeenCalled();
    expect(tx.productVariant.update).not.toHaveBeenCalled();
  });

  it('EXPIRED reservation is an idempotent no-op', async () => {
    const { tx } = buildTx({
      reservations: [
        { id: 'r-5', mappingId: 'm-5', quantity: 1, status: 'EXPIRED', orderId: 'o-5' },
      ],
      mappings: [
        { id: 'm-5', sellerId: 's-1', productId: 'p-5', variantId: 'v-5', stockQty: 1, reservedQty: 0 },
      ],
      variantStock: { 'v-5': 1 },
    });
    expect(await svc.restoreForReservation(tx, 'r-5')).toBe(false);
  });

  it('Missing reservation id returns false and does not throw', async () => {
    const { tx } = buildTx({ reservations: [], mappings: [] });
    expect(await svc.restoreForReservation(tx, 'r-ghost')).toBe(false);
  });

  it('Calling twice on the same reservation only restores once', async () => {
    const { tx, state } = buildTx({
      reservations: [
        { id: 'r-6', mappingId: 'm-6', quantity: 2, status: 'CONFIRMED', orderId: 'o-6' },
      ],
      mappings: [
        { id: 'm-6', sellerId: 's-1', productId: 'p-6', variantId: 'v-6', stockQty: 0, reservedQty: 0 },
      ],
      variantStock: { 'v-6': 0 },
    });

    expect(await svc.restoreForReservation(tx, 'r-6')).toBe(true);
    expect(state.mappings.get('m-6')!.stockQty).toBe(2);
    expect(state.variantStock.get('v-6')).toBe(2);

    expect(await svc.restoreForReservation(tx, 'r-6')).toBe(false);
    expect(state.mappings.get('m-6')!.stockQty).toBe(2); // unchanged on second call
    expect(state.variantStock.get('v-6')).toBe(2);
  });

  // ── restoreForOrder ────────────────────────────────────────────────

  it('restoreForOrder walks all non-terminal reservations for one order', async () => {
    const { tx, state } = buildTx({
      reservations: [
        { id: 'r-A', mappingId: 'm-A', quantity: 1, status: 'CONFIRMED', orderId: 'o-multi' },
        { id: 'r-B', mappingId: 'm-B', quantity: 2, status: 'RESERVED',  orderId: 'o-multi' },
        { id: 'r-C', mappingId: 'm-C', quantity: 3, status: 'RELEASED',  orderId: 'o-multi' }, // skip
        { id: 'r-D', mappingId: 'm-D', quantity: 4, status: 'CONFIRMED', orderId: 'o-other' }, // skip — wrong order
      ],
      mappings: [
        { id: 'm-A', sellerId: 's-1', productId: 'p-A', variantId: 'v-A', stockQty: 0, reservedQty: 0 },
        { id: 'm-B', sellerId: 's-1', productId: 'p-B', variantId: 'v-B', stockQty: 0, reservedQty: 2 },
        { id: 'm-C', sellerId: 's-1', productId: 'p-C', variantId: 'v-C', stockQty: 0, reservedQty: 0 },
        { id: 'm-D', sellerId: 's-2', productId: 'p-D', variantId: 'v-D', stockQty: 0, reservedQty: 0 },
      ],
      variantStock: { 'v-A': 0, 'v-B': 0, 'v-C': 0, 'v-D': 0 },
    });

    const result = await svc.restoreForOrder(tx, 'o-multi');

    expect(result.releasedCount).toBe(2); // A (CONFIRMED) + B (RESERVED)
    expect(state.mappings.get('m-A')!.stockQty).toBe(1);       // CONFIRMED restored
    expect(state.variantStock.get('v-A')).toBe(1);
    expect(state.mappings.get('m-B')!.reservedQty).toBe(0);    // RESERVED undone
    expect(state.variantStock.get('v-B')).toBe(0);             // not touched
    expect(state.mappings.get('m-C')!.stockQty).toBe(0);       // RELEASED skipped
    expect(state.mappings.get('m-D')!.stockQty).toBe(0);       // wrong order skipped
  });

  it('restoreForOrder with sellerId filter only restores that seller', async () => {
    const { tx, state } = buildTx({
      reservations: [
        { id: 'r-X', mappingId: 'm-X', quantity: 1, status: 'CONFIRMED', orderId: 'o-mixed' },
        { id: 'r-Y', mappingId: 'm-Y', quantity: 1, status: 'CONFIRMED', orderId: 'o-mixed' },
      ],
      mappings: [
        { id: 'm-X', sellerId: 's-target', productId: 'p-X', variantId: 'v-X', stockQty: 0, reservedQty: 0 },
        { id: 'm-Y', sellerId: 's-other',  productId: 'p-Y', variantId: 'v-Y', stockQty: 0, reservedQty: 0 },
      ],
      variantStock: { 'v-X': 0, 'v-Y': 0 },
    });

    const result = await svc.restoreForOrder(tx, 'o-mixed', 's-target');

    expect(result.releasedCount).toBe(1);
    expect(state.mappings.get('m-X')!.stockQty).toBe(1);
    expect(state.variantStock.get('v-X')).toBe(1);
    expect(state.mappings.get('m-Y')!.stockQty).toBe(0); // other seller untouched
    expect(state.variantStock.get('v-Y')).toBe(0);
  });

  // ── property-like invariant: ledger symmetry under random sequences ──

  it('property: random confirm-and-restore sequences preserve (mapping.stockQty change === variant.stock change)', async () => {
    // Seed: 10 reservations of varying quantities, all CONFIRMED, all
    // pointing at the same mapping/variant. Restore them all and
    // assert the cumulative deltas match.
    const reservations: FakeReservation[] = Array.from({ length: 10 }, (_, i) => ({
      id: `r-prop-${i}`,
      mappingId: 'm-prop',
      quantity: ((i * 7) % 13) + 1, // varied 1..13
      status: 'CONFIRMED' as const,
      orderId: 'o-prop',
    }));
    const totalRestored = reservations.reduce((a, r) => a + r.quantity, 0);

    const { tx, state } = buildTx({
      reservations,
      mappings: [
        { id: 'm-prop', sellerId: 's-1', productId: 'p-prop', variantId: 'v-prop', stockQty: 0, reservedQty: 0 },
      ],
      variantStock: { 'v-prop': 0 },
    });

    await svc.restoreForOrder(tx, 'o-prop');

    expect(state.mappings.get('m-prop')!.stockQty).toBe(totalRestored);
    expect(state.variantStock.get('v-prop')).toBe(totalRestored);
    // The invariant: every CONFIRMED restore bumps both ledgers by
    // the same amount, so they stay equal under any sequence.
    expect(state.mappings.get('m-prop')!.stockQty).toBe(state.variantStock.get('v-prop'));
  });
});
