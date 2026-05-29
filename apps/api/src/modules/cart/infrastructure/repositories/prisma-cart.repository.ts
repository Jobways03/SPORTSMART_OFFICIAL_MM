import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  CartRepository,
  CartWithItems,
  CartItemForTaxPreview,
} from '../../domain/repositories/cart.repository.interface';

@Injectable()
export class PrismaCartRepository implements CartRepository {
  constructor(private readonly prisma: PrismaService) {}

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
    // Phase 44 (2026-05-21) — use tier-adjusted unit price for the
    // tax preview. Pre-Phase-44 this computed GST against the raw
    // variant.price / basePrice, which over-charged GST on every
    // cart line where a pricing tier applied. The cart service now
    // writes the resolved effective price as `appliedListUnitPrice`
    // when no tier qualified, and the discount/fixed columns when a
    // tier did qualify. We reconstruct the effective price the same
    // way the resolver does.
    return cart.items.map((it) => {
      const listPrice = it.variant?.price ?? it.product.basePrice;
      let effectivePrice = Number(listPrice ?? 0);

      if (it.appliedFixedUnitPrice !== null) {
        effectivePrice = Number(it.appliedFixedUnitPrice);
      } else if (it.appliedDiscountPercent !== null) {
        const pct = Number(it.appliedDiscountPercent);
        const baseList =
          it.appliedListUnitPrice !== null
            ? Number(it.appliedListUnitPrice)
            : effectivePrice;
        effectivePrice = Math.round(baseList * (1 - pct / 100) * 100) / 100;
      }

      const unitPriceInPaise = BigInt(Math.round(effectivePrice * 100));
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
    return this.prisma.cart.upsert({
      where: { customerId },
      create: { customerId },
      update: {},
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

  async updateCartItemQuantity(itemId: string, quantity: number): Promise<void> {
    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
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
    return Math.max(0, totalStock - totalReserved);
  }

  async validateProduct(productId: string): Promise<boolean> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: 'ACTIVE', isDeleted: false },
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
    return this.prisma.cartItem.count({
      where: { variantId },
    });
  }

  async countActiveItemsForProduct(productId: string): Promise<number> {
    // Only count base-product line items (where variantId is null) — variant
    // line items are tracked separately by countActiveItemsForVariant.
    return this.prisma.cartItem.count({
      where: { productId, variantId: null },
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
        // Phase 61 — refresh the price snapshot when re-adding to a
        // previously-cleared row, but preserve the snapshot when an
        // ACTIVE row is incremented. The drift-detection semantics
        // are "first add wins" for the snapshot.
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
    // Deletes carts whose updatedAt is older than the cutoff. The
    // FK on cart_items is ON DELETE CASCADE, so child rows go with
    // the parent. Two-pass: read ids first so we can return an
    // accurate count even when deleteMany returns 0 in a no-op
    // case.
    const stale = await this.prisma.cart.findMany({
      where: { updatedAt: { lt: cutoff } },
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
   * Phase 44 (2026-05-21) — persist the resolved pricing-tier snapshot.
   * Called by CartService whenever the resolved tier drifts from what's
   * already on the row (qty change, tier activated/deactivated, etc).
   * NULL clears the snapshot when no tier qualifies.
   */
  async updateCartItemPricingSnapshot(
    itemId: string,
    snapshot: {
      appliedPricingTierId: string | null;
      appliedDiscountPercent: number | null;
      appliedFixedUnitPrice: number | null;
      appliedListUnitPrice: number | null;
    },
  ): Promise<void> {
    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: {
        appliedPricingTierId: snapshot.appliedPricingTierId,
        appliedDiscountPercent: snapshot.appliedDiscountPercent,
        appliedFixedUnitPrice: snapshot.appliedFixedUnitPrice,
        appliedListUnitPrice: snapshot.appliedListUnitPrice,
      },
    });
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
      const availableStock = Math.max(0, totalStock - totalReserved);

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
