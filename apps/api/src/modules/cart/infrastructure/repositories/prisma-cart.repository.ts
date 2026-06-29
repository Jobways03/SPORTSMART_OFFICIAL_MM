import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  CartRepository,
  CartWithItems,
  CartItemForTaxPreview,
} from '../../domain/repositories/cart.repository.interface';

@Injectable()
export class PrismaCartRepository implements CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Franchise availability (cart/checkout stock gate) ───────────────
  // The cart's available-stock is computed from seller_product_mappings only,
  // so a franchise-tier product (stock in franchise_stock) reads as 0 and
  // can't be added ("Insufficient stock. Available: 0"). These helpers sum
  // franchise_stock.available_qty for ACTIVE franchises with an APPROVED +
  // is_active + is_listed_for_online_fulfillment catalog mapping — the same
  // gate the storefront catalog uses — so it's ADDED on top of the seller
  // total. (D2C + retail sellers are unaffected; they keep flowing through the
  // seller_product_mappings aggregate.) Order fulfillment routing to the right
  // source already happens in the franchise-aware allocation cascade.
  //
  // variantId === null sums across all of the product's franchise stock,
  // matching the seller aggregate's product-level behaviour.

  private async franchiseAvailable(
    productId: string,
    variantId: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const db = (tx ?? this.prisma) as Prisma.TransactionClient;
    const rows = await db.$queryRaw<{ available: number }[]>(Prisma.sql`
      SELECT COALESCE(SUM(fs.available_qty), 0)::int AS available
      FROM franchise_catalog_mappings fcm
      JOIN franchise_stock fs ON fs.franchise_id = fcm.franchise_id
        AND fs.product_id = fcm.product_id
        AND fs.variant_id IS NOT DISTINCT FROM fcm.variant_id
      JOIN franchise_partners fp ON fp.id = fcm.franchise_id
      WHERE fcm.product_id = ${productId}
        ${variantId ? Prisma.sql`AND fcm.variant_id = ${variantId}` : Prisma.empty}
        AND fcm.is_active = true
        AND fcm.is_listed_for_online_fulfillment = true
        AND fcm.approval_status = 'APPROVED'
        AND fp.status = 'ACTIVE'
    `);
    return Number(rows[0]?.available ?? 0);
  }

  /** Batched franchise availability → Map keyed `${productId}:${variantId ?? 'null'}`. */
  private async franchiseAvailableBatch(
    variantIds: string[],
    baseProductIds: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (variantIds.length > 0) {
      const rows = await this.prisma.$queryRaw<
        { productId: string; variantId: string; available: number }[]
      >(Prisma.sql`
        SELECT fcm.product_id AS "productId", fcm.variant_id AS "variantId",
          COALESCE(SUM(fs.available_qty), 0)::int AS available
        FROM franchise_catalog_mappings fcm
        JOIN franchise_stock fs ON fs.franchise_id = fcm.franchise_id
          AND fs.product_id = fcm.product_id
          AND fs.variant_id IS NOT DISTINCT FROM fcm.variant_id
        JOIN franchise_partners fp ON fp.id = fcm.franchise_id
        WHERE fcm.variant_id IN (${Prisma.join(variantIds)})
          AND fcm.is_active = true AND fcm.is_listed_for_online_fulfillment = true
          AND fcm.approval_status = 'APPROVED' AND fp.status = 'ACTIVE'
        GROUP BY fcm.product_id, fcm.variant_id
      `);
      for (const r of rows) map.set(`${r.productId}:${r.variantId}`, Number(r.available));
    }
    if (baseProductIds.length > 0) {
      const rows = await this.prisma.$queryRaw<
        { productId: string; available: number }[]
      >(Prisma.sql`
        SELECT fcm.product_id AS "productId",
          COALESCE(SUM(fs.available_qty), 0)::int AS available
        FROM franchise_catalog_mappings fcm
        JOIN franchise_stock fs ON fs.franchise_id = fcm.franchise_id
          AND fs.product_id = fcm.product_id
          AND fs.variant_id IS NOT DISTINCT FROM fcm.variant_id
        JOIN franchise_partners fp ON fp.id = fcm.franchise_id
        WHERE fcm.product_id IN (${Prisma.join(baseProductIds)})
          AND fcm.is_active = true AND fcm.is_listed_for_online_fulfillment = true
          AND fcm.approval_status = 'APPROVED' AND fp.status = 'ACTIVE'
        GROUP BY fcm.product_id
      `);
      for (const r of rows) map.set(`${r.productId}:null`, Number(r.available));
    }
    return map;
  }

  async findByCustomerId(customerId: string): Promise<CartWithItems | null> {
    // Phase 61 (2026-05-22) — enriched projection (audit Gaps #2 +
    // #9 + #22).
    //   - product.seller threaded through so the storefront cart
    //     can group line items by seller (Gap #2).
    //   - product.isDeleted / variant.isDeleted exposed so the
    //     cart service can flag archived/deleted lines instead of
    //     silently re-pricing them (Gap #9).
    //   - unitPriceAtAddInPaise included via the default scalar
    //     select — picked up automatically since we don't pin
    //     specific cart-item columns.
    return this.prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                slug: true,
                basePrice: true,
                baseStock: true,
                baseSku: true,
                hasVariants: true,
                status: true,
                isDeleted: true,
                images: {
                  where: { isPrimary: true },
                  select: { url: true },
                  take: 1,
                },
                seller: {
                  select: {
                    id: true,
                    sellerName: true,
                    sellerShopName: true,
                  },
                },
              },
            },
            variant: {
              select: {
                id: true,
                title: true,
                price: true,
                stock: true,
                sku: true,
                status: true,
                isDeleted: true,
                images: {
                  select: { url: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    }) as unknown as Promise<CartWithItems | null>;
  }

  async findItemsForTaxPreview(
    customerId: string,
  ): Promise<CartItemForTaxPreview[]> {
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          where: { savedForLater: false },
          include: {
            product: {
              select: { id: true, sellerId: true, basePrice: true },
            },
            variant: { select: { id: true, price: true } },
          },
        },
      },
    });
    if (!cart) return [];
    return cart.items.map((it) => {
      const listPrice = it.variant?.price ?? it.product.basePrice;
      const unitPriceInPaise = BigInt(Math.round(Number(listPrice ?? 0) * 100));
      return {
        productId: it.productId,
        variantId: it.variantId,
        quantity: it.quantity,
        unitPriceInPaise,
        sellerId: it.product.sellerId,
      };
    });
  }

  async upsertCart(customerId: string): Promise<{ id: string }> {
    // Phase 196 (#11) — stamp activity on add.
    return this.prisma.cart.upsert({
      where: { customerId },
      create: { customerId },
      update: { lastActivityAt: new Date() },
    });
  }

  /**
   * Phase 196 (#11) — refresh the cart's activity timestamp. Called by the
   * service after non-add mutations (update / remove / clear / park) so the
   * abandonment sweep sees an accurate last-touched time. Best-effort: a
   * missing cart row is a no-op (updateMany, not update).
   */
  async touchLastActivity(cartId: string): Promise<void> {
    await this.prisma.cart.updateMany({
      where: { id: cartId },
      data: { lastActivityAt: new Date() },
    });
  }

  async findCartItem(
    cartId: string,
    productId: string,
    variantId: string | null,
  ): Promise<{ id: string; quantity: number } | null> {
    return this.prisma.cartItem.findFirst({
      where: { cartId, productId, variantId },
    });
  }

  // Phase 61 (2026-05-22) — `addCartItem` removed (audit Gap #16).
  // The atomic primitive `incrementOrCreateCartItem` is the only
  // public write path; the legacy method was dead code that
  // bypassed the FOR UPDATE lock.

  /**
   * Phase 196 (#16) — quantity set under the same FOR UPDATE cart-row lock
   * incrementOrCreateCartItem uses, with the stock floor re-read INSIDE the
   * lock. Pre-196 this was a bare update after a non-transactional stock
   * read in the service (read-then-write TOCTOU). PATCH carries an absolute
   * target quantity (not a delta), so the lock primarily guarantees the
   * stock check and the write see a consistent snapshot.
   */
  async updateCartItemQuantity(
    itemId: string,
    cartId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM carts WHERE id = ${cartId} FOR UPDATE
      `;
      if (!locked || locked.length === 0) {
        throw new Error(`Cart ${cartId} not found while acquiring row lock`);
      }
      const where: any = { productId, isActive: true, approvalStatus: 'APPROVED' };
      if (variantId) where.variantId = variantId;
      const agg = await tx.sellerProductMapping.aggregate({
        where,
        _sum: { stockQty: true, reservedQty: true },
      });
      const sellerAvailable = Math.max(0, (agg._sum.stockQty ?? 0) - (agg._sum.reservedQty ?? 0));
      const available =
        sellerAvailable + (await this.franchiseAvailable(productId, variantId, tx));
      if (available < quantity) {
        throw Object.assign(
          new Error(`Insufficient stock. Available: ${available}, Requested: ${quantity}`),
          { code: 'INSUFFICIENT_STOCK', availableStock: available },
        );
      }
      await tx.cartItem.update({ where: { id: itemId }, data: { quantity } });
    });
  }

  async deleteCartItem(itemId: string): Promise<void> {
    await this.prisma.cartItem.delete({ where: { id: itemId } });
  }

  async clearCart(cartId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { cartId } });
  }

  async findCartByCustomerId(customerId: string): Promise<{ id: string } | null> {
    return this.prisma.cart.findUnique({ where: { customerId } });
  }

  async findCartItemById(
    itemId: string,
    cartId: string,
  ): Promise<{ id: string; productId: string; variantId: string | null; quantity: number } | null> {
    return this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
    });
  }

  async getAggregatedStock(productId: string, variantId?: string | null): Promise<number> {
    const where: any = { productId, isActive: true, approvalStatus: 'APPROVED' };
    if (variantId) where.variantId = variantId;

    const result = await this.prisma.sellerProductMapping.aggregate({
      where,
      _sum: { stockQty: true, reservedQty: true },
    });

    const totalStock = result._sum.stockQty ?? 0;
    const totalReserved = result._sum.reservedQty ?? 0;
    const sellerAvailable = Math.max(0, totalStock - totalReserved);
    // Franchise stock counts too — otherwise a franchise-only product reads 0.
    const franchiseAvailable = await this.franchiseAvailable(productId, variantId ?? null);
    return sellerAvailable + franchiseAvailable;
  }

  /**
   * Phase 196 (#10) — batched stock aggregate. getCart used to call
   * getAggregatedStock once per line (N round-trips via Promise.all);
   * this collapses it to at most two grouped queries (one keyed by
   * variant for variant lines, one keyed by product for base lines),
   * preserving the exact per-line semantics of getAggregatedStock.
   * Returns a map keyed `${productId}:${variantId ?? 'null'}`.
   */
  async getAggregatedStockBatch(
    keys: Array<{ productId: string; variantId: string | null }>,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (keys.length === 0) return map;

    const variantIds = [...new Set(keys.filter((k) => k.variantId).map((k) => k.variantId as string))];
    const baseProductIds = [...new Set(keys.filter((k) => !k.variantId).map((k) => k.productId))];

    if (variantIds.length > 0) {
      const rows = await this.prisma.sellerProductMapping.groupBy({
        by: ['productId', 'variantId'],
        where: { isActive: true, approvalStatus: 'APPROVED', variantId: { in: variantIds } },
        _sum: { stockQty: true, reservedQty: true },
      });
      for (const r of rows) {
        const avail = Math.max(0, (r._sum.stockQty ?? 0) - (r._sum.reservedQty ?? 0));
        map.set(`${r.productId}:${r.variantId}`, avail);
      }
    }
    if (baseProductIds.length > 0) {
      const rows = await this.prisma.sellerProductMapping.groupBy({
        by: ['productId'],
        where: { isActive: true, approvalStatus: 'APPROVED', productId: { in: baseProductIds } },
        _sum: { stockQty: true, reservedQty: true },
      });
      for (const r of rows) {
        const avail = Math.max(0, (r._sum.stockQty ?? 0) - (r._sum.reservedQty ?? 0));
        map.set(`${r.productId}:null`, avail);
      }
    }
    // Add franchise stock on top of the seller totals (same keys), so
    // franchise-only lines aren't shown as out of stock in the cart.
    const franchiseMap = await this.franchiseAvailableBatch(variantIds, baseProductIds);
    for (const [key, franchiseAvail] of franchiseMap) {
      map.set(key, (map.get(key) ?? 0) + franchiseAvail);
    }
    return map;
  }

  async validateProduct(productId: string): Promise<boolean> {
    // Phase 196 (#3) — a PENDING / REJECTED / NEEDS_REVISION product must
    // not be addable to a cart even if its UUID leaks (draft URL, stale
    // tab, prior search-suggest exposure). Mirrors the visibility predicate
    // the storefront listing / search paths enforce (#192/#194/#195).
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: 'ACTIVE', isDeleted: false, moderationStatus: 'APPROVED' },
    });
    return !!product;
  }

  async validateVariant(variantId: string, productId: string): Promise<boolean> {
    // Phase 41 (2026-05-21) — Gap #12 fix. Only ACTIVE / OUT_OF_STOCK
    // variants are addable to a cart. DISABLED, ARCHIVED, DRAFT remain
    // hidden from purchase paths even when their stock > 0. Without
    // this filter an admin could disable a variant and customers with
    // a stale PDP tab would still be able to checkout.
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: variantId,
        productId,
        isDeleted: false,
        status: { in: ['ACTIVE', 'OUT_OF_STOCK'] },
      },
    });
    return !!variant;
  }

  async countActiveItemsForVariant(variantId: string): Promise<number> {
    // Phase 196 (#17) — "active in a cart" means a live line, not a parked
    // save-for-later one. Without this filter the catalog soft-delete guard
    // treated a saved-for-later variant as in-use and refused the delete.
    return this.prisma.cartItem.count({
      where: { variantId, savedForLater: false },
    });
  }

  async countActiveItemsForProduct(productId: string): Promise<number> {
    // Only count base-product line items (where variantId is null) — variant
    // line items are tracked separately by countActiveItemsForVariant.
    // Phase 196 (#17) — exclude parked (saved-for-later) lines.
    return this.prisma.cartItem.count({
      where: { productId, variantId: null, savedForLater: false },
    });
  }

  /**
   * Phase 1 (PR 1.9) — atomic find-or-increment-or-create.
   *
   * The transaction holds a `SELECT ... FOR UPDATE` lock on the cart
   * row. A second concurrent call for the same customerId waits on
   * that lock; when it gets the row, the first call's cart_items row
   * is already visible inside the second call's transaction, so the
   * second branch goes through `update` (quantity increment) instead
   * of `create` (duplicate row).
   *
   * Why lock the Cart row and not the CartItem row:
   *   - On the create branch, no CartItem row exists yet — there's
   *     nothing to lock.
   *   - Cart.customerId is `@unique`, so the cart row is the natural
   *     per-customer serialisation point.
   *   - The lock is held only across two short queries; contention is
   *     bounded to N requests per customer, not N requests cluster-
   *     wide.
   *
   * Why `$queryRaw` over `findUnique`: Prisma doesn't expose
   * `FOR UPDATE` on `findUnique`. The raw query is parameterised to
   * stay safe from injection (tagged-template binding).
   */
  async incrementOrCreateCartItem(
    cartId: string,
    productId: string,
    variantId: string | null,
    quantityDelta: number,
    args: {
      availableStock: number;
      unitPriceInPaiseSnapshot: bigint;
      cartLineCap: number;
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Row lock on the cart — serialises addItem for this customer.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM carts WHERE id = ${cartId} FOR UPDATE
      `;
      if (!locked || locked.length === 0) {
        throw new Error(`Cart ${cartId} not found while acquiring row lock`);
      }

      const existing = await tx.cartItem.findFirst({
        where: { cartId, productId, variantId },
      });

      // Phase 61 (2026-05-22) — stock floor check INSIDE the lock
      // (audit Gap #7). Pre-Phase-61 the service computed
      // `existingQty + availableStock` before entering the
      // transaction; two parallel adds for stock=10 each requesting
      // qty=8 could both pass that check before either incremented
      // the row, over-committing the seller's inventory. With the
      // check inside the FOR UPDATE the second add sees the first's
      // increment and rejects cleanly.
      const existingQty = existing?.quantity ?? 0;
      if (args.availableStock < existingQty + quantityDelta) {
        throw Object.assign(
          new Error(
            `Insufficient stock. Available: ${args.availableStock}, In cart: ${existingQty}, Requested: ${quantityDelta}`,
          ),
          { code: 'INSUFFICIENT_STOCK', availableStock: args.availableStock, existingQty },
        );
      }

      if (existing) {
        // Sprint 3 Story 2.3 — snap-back: if the existing row was
        // saved-for-later, re-adding flips it back into the active
        // cart with the new quantity added. Matches typical e-commerce
        // UX (user re-finds an item and adds it; they expect it to
        // appear in the active cart, not stay parked).
        //
        // Phase 61 — the price snapshot is NOT touched on this branch:
        // drift-detection semantics are strictly "first add wins"
        // (only the create branch below writes unitPriceAtAddInPaise),
        // so increments and saved-for-later snap-backs keep comparing
        // against the original add-time price.
        await tx.cartItem.update({
          where: { id: existing.id },
          data: {
            quantity: existing.quantity + quantityDelta,
            savedForLater: false,
          },
        });
      } else {
        // Phase 61 — cart-line cap (audit Gap #23). Enforced inside
        // the lock so two parallel adds that would both create a
        // new line serialise here. Existing-row increments don't
        // hit the cap.
        const lineCount = await tx.cartItem.count({ where: { cartId } });
        if (lineCount >= args.cartLineCap) {
          throw Object.assign(
            new Error(
              `Cart has reached the ${args.cartLineCap}-line limit. Remove an item to add a new one.`,
            ),
            { code: 'CART_LINE_CAP', lineCount, cartLineCap: args.cartLineCap },
          );
        }
        await tx.cartItem.create({
          data: {
            cartId,
            productId,
            variantId,
            quantity: quantityDelta,
            savedForLater: false,
            // Phase 61 — add-time price snapshot in paise (audit Gap #22).
            unitPriceAtAddInPaise: args.unitPriceInPaiseSnapshot,
          },
        });
      }
    });
  }

  async countCartItemsForCustomer(customerId: string): Promise<number> {
    // Phase 61 (2026-05-22) — backs the per-cart line cap (audit
    // Gap #23). Cheap count via the cartId index.
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
      select: { id: true },
    });
    if (!cart) return 0;
    return this.prisma.cartItem.count({ where: { cartId: cart.id } });
  }

  async deleteAbandonedCartsOlderThan(cutoff: Date): Promise<number> {
    // Phase 61 (2026-05-22) — abandonment cleanup (audit Gap #12).
    // Deletes carts whose activity is older than the cutoff. The FK on
    // cart_items is ON DELETE CASCADE, so child rows go with the parent.
    // Phase 196 (#11) — switched the predicate from updatedAt (which only
    // bumped on add, via upsertCart) to lastActivityAt (bumped on every
    // mutation) so a cart actively edited via remove/update isn't wrongly
    // swept. Two-pass: read ids first for an accurate count.
    const stale = await this.prisma.cart.findMany({
      where: { lastActivityAt: { lt: cutoff } },
      select: { id: true },
    });
    if (stale.length === 0) return 0;
    const result = await this.prisma.cart.deleteMany({
      where: { id: { in: stale.map((c) => c.id) } },
    });
    return result.count;
  }

  /**
   * Sprint 3 Story 2.3 — flip the saved-for-later flag on a cart item.
   * The service layer is responsible for ownership checks; this just
   * does the write. Idempotent (setting to the same value is a no-op).
   */
  async setSavedForLater(itemId: string, value: boolean): Promise<void> {
    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { savedForLater: value },
    });
  }

  /**
   * Live list unit price in paise — variant.price when a variant is
   * given, product.basePrice otherwise. Used by the cart service for
   * the add-time price snapshot (audit Gap #22).
   */
  async getListUnitPriceInPaise(
    productId: string,
    variantId: string | null,
  ): Promise<bigint> {
    if (variantId) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { price: true },
      });
      return BigInt(Math.round(Number(variant?.price ?? 0) * 100));
    }
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { basePrice: true },
    });
    return BigInt(Math.round(Number(product?.basePrice ?? 0) * 100));
  }

  /**
   * Phase 4.1 (2026-05-16) — atomic move-to-cart with stock check.
   * The aggregated-stock read and the savedForLater flip run inside
   * a single transaction so a concurrent reservation can't claim
   * inventory between the two operations.
   *
   * Returns `{ moved: true }` when the flip went through, or
   * `{ moved: false, availableStock }` when stock was insufficient
   * (caller surfaces a clean 400 to the customer).
   */
  async moveToCartIfStockAvailable(
    itemId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
  ): Promise<{ moved: boolean; availableStock: number }> {
    return this.prisma.$transaction(async (tx) => {
      const where: any = {
        productId,
        isActive: true,
        approvalStatus: 'APPROVED',
      };
      if (variantId) where.variantId = variantId;
      const agg = await tx.sellerProductMapping.aggregate({
        where,
        _sum: { stockQty: true, reservedQty: true },
      });
      const totalStock = agg._sum.stockQty ?? 0;
      const totalReserved = agg._sum.reservedQty ?? 0;
      const availableStock =
        Math.max(0, totalStock - totalReserved) +
        (await this.franchiseAvailable(productId, variantId, tx));

      if (availableStock < quantity) {
        return { moved: false, availableStock };
      }
      await tx.cartItem.update({
        where: { id: itemId },
        data: { savedForLater: false },
      });
      return { moved: true, availableStock };
    });
  }
}
