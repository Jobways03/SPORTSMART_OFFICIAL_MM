import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  CartRepository,
  CART_REPOSITORY,
} from '../../domain/repositories/cart.repository.interface';
import { CatalogPublicFacade } from '../../../catalog/application/facades/catalog-public.facade';

/**
 * Phase 61 (2026-05-22) — cart service hardening.
 *
 * The per-cart line cap matches the merge endpoint's max-batch
 * size so a hostile authed user can't sit on a 1000-line cart
 * and force the storefront client to render it. 50 is generous
 * for a real customer (Amazon's UX caps at 40) and keeps the
 * cap visible in error messages instead of failing on Postgres
 * write-amp.
 */
const CART_LINE_CAP = 50;

@Injectable()
export class CartService {
  constructor(
    @Inject(CART_REPOSITORY) private readonly cartRepo: CartRepository,
    // Phase 44 (2026-05-21) — pricing-tier resolution. The cart no
    // longer computes line price as raw variant.price / basePrice;
    // it goes through the catalog facade so every line reflects the
    // best-eligible ProductPricingTier (effective unit + snapshot).
    @Inject(forwardRef(() => CatalogPublicFacade))
    private readonly catalog: CatalogPublicFacade,
  ) {}

  async getCart(customerId: string) {
    const cart = await this.cartRepo.findByCustomerId(customerId);

    if (!cart) {
      return {
        items: [],
        savedItems: [],
        totalAmount: 0,
        itemCount: 0,
      };
    }

    // Phase 61 (2026-05-22) — drop lines whose product was archived
    // or soft-deleted between add-time and read-time (audit Gap #9).
    // Pre-Phase-61 the cart silently kept these lines and re-priced
    // them off the (still-readable) basePrice. Now the line is
    // flagged `unavailable: true` so the client can show "this item
    // is no longer available" instead of letting the customer
    // attempt to checkout something un-routable.
    const liveItems = cart.items;

    // Phase 44 (2026-05-21) — batch-resolve pricing tiers up-front in
    // one DB query so an N-item cart doesn't fire N separate tier
    // lookups. Lines whose qty doesn't qualify return baseResult and
    // pay the list price (current behaviour preserved for them).
    const resolveInputs = liveItems.map((item) => ({
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: item.quantity,
      listUnitPrice: item.variant
        ? Number(item.variant.price)
        : Number(item.product.basePrice ?? 0),
    }));
    const resolved = await this.catalog.resolveBatchUnitPrices(resolveInputs);

    let totalAmount = 0;
    const shaped = await Promise.all(
      liveItems.map(async (item, idx) => {
        const pricing = resolved[idx]!;
        const lineTotal = Math.round(pricing.effectiveUnitPrice * item.quantity * 100) / 100;

        // Phase 61 — status flags. `unavailable` short-circuits the
        // subtotal so an archived product doesn't keep counting
        // toward "Continue to checkout".
        const productUnavailable =
          item.product.isDeleted === true || item.product.status !== 'ACTIVE';
        const variantUnavailable = item.variant
          ? item.variant.isDeleted === true ||
            !['ACTIVE', 'OUT_OF_STOCK'].includes(item.variant.status)
          : false;
        const unavailable = productUnavailable || variantUnavailable;

        if (!item.savedForLater && !unavailable) totalAmount += lineTotal;

        const imageUrl =
          item.variant?.images?.[0]?.url ||
          item.product.images?.[0]?.url ||
          null;

        const availableStock = await this.cartRepo.getAggregatedStock(
          item.productId,
          item.variantId,
        );

        // Phase 44 — persist the tier snapshot on the row so checkout
        // + order placement can read it without recomputing (and so
        // refund/dispute review can prove the discount). Skip the
        // write when nothing changed to avoid pointless updates.
        const snapshotDrifted =
          (item.appliedPricingTierId ?? null) !== (pricing.appliedTierId ?? null)
          || Number(item.appliedListUnitPrice ?? -1) !== pricing.listUnitPrice;
        if (snapshotDrifted) {
          await this.cartRepo.updateCartItemPricingSnapshot(item.id, {
            appliedPricingTierId: pricing.appliedTierId,
            appliedDiscountPercent: pricing.appliedDiscountPercent,
            appliedFixedUnitPrice: pricing.appliedFixedUnitPrice,
            appliedListUnitPrice: pricing.listUnitPrice,
          });
        }

        // Phase 61 — price-drift detection (audit Gap #22). The
        // snapshot was taken in paise at add-time; compare against
        // the freshly-resolved effective price (also in paise) so
        // we surface a `priceChanged: true` flag the UI can show as
        // "Price updated since you added — review before checkout".
        const effectivePriceInPaise = BigInt(
          Math.round(pricing.effectiveUnitPrice * 100),
        );
        const snapshot = item.unitPriceAtAddInPaise;
        const priceChanged =
          snapshot !== null && snapshot !== undefined && snapshot !== effectivePriceInPaise;

        return {
          id: item.id,
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          savedForLater: item.savedForLater,
          productTitle: item.product.title,
          variantTitle: item.variant?.title || null,
          slug: item.product.slug,
          sku: item.variant?.sku || item.product.baseSku,
          imageUrl,
          // Phase 61 (audit Gap #2) — seller info threaded through so
          // the storefront cart groups by seller without a second
          // API call.
          sellerId: item.product.seller?.id ?? null,
          sellerName: item.product.seller?.sellerName ?? null,
          sellerShopName: item.product.seller?.sellerShopName ?? null,
          unitPrice: pricing.effectiveUnitPrice,
          listUnitPrice: pricing.listUnitPrice,
          appliedPricingTierId: pricing.appliedTierId,
          appliedDiscountPercent: pricing.appliedDiscountPercent,
          lineTotal,
          stock: availableStock,
          outOfStock: availableStock === 0,
          // Phase 61 — Gap #9 + #22 surfaces.
          unavailable,
          unavailableReason: unavailable
            ? productUnavailable
              ? 'product_unavailable'
              : 'variant_unavailable'
            : null,
          unitPriceAtAddInPaise:
            snapshot !== null && snapshot !== undefined ? Number(snapshot) : null,
          priceChanged,
        };
      }),
    );

    const items = shaped.filter((i) => !i.savedForLater);
    const savedItems = shaped.filter((i) => i.savedForLater);

    return {
      items,
      savedItems,
      totalAmount: Math.round(totalAmount * 100) / 100,
      itemCount: items
        .filter((i) => !i.unavailable)
        .reduce((sum, i) => sum + i.quantity, 0),
    };
  }

  /**
   * Sprint 3 Story 2.3 — park a cart item. Quantity is preserved
   * (snap-back behavior). Caller must own the cart.
   */
  async saveForLater(customerId: string, itemId: string) {
    const cart = await this.cartRepo.findCartByCustomerId(customerId);
    if (!cart) throw new NotFoundAppException('Cart not found');
    const item = await this.cartRepo.findCartItemById(itemId, cart.id);
    if (!item) throw new NotFoundAppException('Cart item not found');
    await this.cartRepo.setSavedForLater(itemId, true);
  }

  /**
   * Sprint 3 Story 2.3 — move a saved item back into the active cart.
   *
   * Re-validates stock atomically inside the transaction (Phase 4.1,
   * 2026-05-16) so a concurrent reservation can't snatch the inventory
   * between our check and the flag flip. The repo's
   * `moveToCartIfStockAvailable` does the check + flip in a single
   * SQL statement (UPDATE ... WHERE saved_for_later=true AND
   * available_stock >= quantity), returning the count of rows
   * affected. Zero rows = lost the race; we surface a clean 400 to
   * the caller.
   */
  async moveToCart(customerId: string, itemId: string) {
    const cart = await this.cartRepo.findCartByCustomerId(customerId);
    if (!cart) throw new NotFoundAppException('Cart not found');
    const item = await this.cartRepo.findCartItemById(itemId, cart.id);
    if (!item) throw new NotFoundAppException('Cart item not found');

    // The repo owns transaction boundaries — we ask it to atomically
    // re-check stock AND flip the savedForLater flag. If a concurrent
    // checkout snatches the inventory between our check and flip, the
    // repo returns moved=false and we surface a clean 400.
    const result = await this.cartRepo.moveToCartIfStockAvailable(
      itemId,
      item.productId,
      item.variantId,
      item.quantity,
    );
    if (!result.moved) {
      throw new BadRequestAppException(
        `Cannot move to cart — only ${result.availableStock} in stock, item has quantity ${item.quantity}`,
      );
    }
  }

  async addItem(
    customerId: string,
    productId: string,
    variantId: string | undefined,
    quantity: number,
  ) {
    if (!productId) {
      throw new BadRequestAppException('productId is required');
    }
    if (quantity < 1) {
      throw new BadRequestAppException('Quantity must be at least 1');
    }

    const productExists = await this.cartRepo.validateProduct(productId);
    if (!productExists) {
      throw new NotFoundAppException('Product not found or not available');
    }

    if (variantId) {
      const variantExists = await this.cartRepo.validateVariant(variantId, productId);
      if (!variantExists) {
        throw new NotFoundAppException('Variant not found or not available');
      }
    }

    // Phase 61 (2026-05-22) — read the live aggregated stock + the
    // resolver-derived unit price OUTSIDE the transaction (cheap
    // single-row reads). These flow into the atomic primitive,
    // which re-checks the stock floor against the row-locked
    // existingQty (Gap #7) and snapshots the price on a fresh
    // create branch (Gap #22).
    const availableStock = await this.cartRepo.getAggregatedStock(productId, variantId);

    // Resolve unit price once for the price snapshot. We use the
    // tier-resolved EFFECTIVE price (not raw list) so the snapshot
    // reflects what the customer was actually quoted at add-time.
    const resolved = await this.catalog.resolveBatchUnitPrices([
      {
        productId,
        variantId: variantId ?? null,
        quantity,
        listUnitPrice: 0, // resolver pulls live list price internally
      },
    ]);
    const unitPriceInPaiseSnapshot = BigInt(
      Math.round((resolved[0]?.effectiveUnitPrice ?? 0) * 100),
    );

    const cart = await this.cartRepo.upsertCart(customerId);

    try {
      await this.cartRepo.incrementOrCreateCartItem(
        cart.id,
        productId,
        variantId ?? null,
        quantity,
        {
          availableStock,
          unitPriceInPaiseSnapshot,
          cartLineCap: CART_LINE_CAP,
        },
      );
    } catch (err: any) {
      // Phase 61 — map repo-level typed errors to HTTP-friendly
      // exceptions. Pre-Phase-61 the service did this work itself
      // (and lost the race; see Gap #7). The repo now owns the
      // serialisation point.
      if (err?.code === 'INSUFFICIENT_STOCK') {
        throw new BadRequestAppException(err.message);
      }
      if (err?.code === 'CART_LINE_CAP') {
        throw new ConflictAppException(err.message);
      }
      throw err;
    }
  }

  async updateItem(customerId: string, itemId: string, quantity: number) {
    const cart = await this.cartRepo.findCartByCustomerId(customerId);
    if (!cart) throw new NotFoundAppException('Cart not found');

    const item = await this.cartRepo.findCartItemById(itemId, cart.id);
    if (!item) throw new NotFoundAppException('Cart item not found');

    // Phase 61 (2026-05-22) — reject 0/negative at the service edge
    // (audit Gap #6). The DTO is the primary guard; this is the
    // defence-in-depth path for any caller that bypasses the pipe
    // (facade, internal jobs).
    if (quantity <= 0) {
      throw new BadRequestAppException(
        'Quantity must be at least 1; use DELETE to remove an item',
      );
    }

    const availableStock = await this.cartRepo.getAggregatedStock(
      item.productId,
      item.variantId,
    );
    if (availableStock < quantity) {
      throw new BadRequestAppException(
        `Insufficient stock. Available: ${availableStock}, Requested: ${quantity}`,
      );
    }

    await this.cartRepo.updateCartItemQuantity(itemId, quantity);
  }

  async removeItem(customerId: string, itemId: string) {
    const cart = await this.cartRepo.findCartByCustomerId(customerId);
    if (!cart) throw new NotFoundAppException('Cart not found');

    const item = await this.cartRepo.findCartItemById(itemId, cart.id);
    if (!item) throw new NotFoundAppException('Cart item not found');

    await this.cartRepo.deleteCartItem(itemId);
  }

  async clearCart(customerId: string) {
    const cart = await this.cartRepo.findCartByCustomerId(customerId);
    if (cart) {
      await this.cartRepo.clearCart(cart.id);
    }
  }

  async countActiveItemsForVariant(variantId: string): Promise<number> {
    return this.cartRepo.countActiveItemsForVariant(variantId);
  }

  async countActiveItemsForProduct(productId: string): Promise<number> {
    return this.cartRepo.countActiveItemsForProduct(productId);
  }

  /**
   * Phase 37 — return the minimal item projection the tax module's
   * cart-side preview needs. Exposed via CartPublicFacade only.
   */
  async getItemsForTaxPreview(customerId: string) {
    return this.cartRepo.findItemsForTaxPreview(customerId);
  }

  /**
   * Phase 61 (2026-05-22) — abandonment-cleanup helper exposed to
   * the cron (audit Gap #12). 90-day cutoff is the default; the
   * cron passes the actual cutoff so tests can dial it down.
   */
  async sweepAbandonedCarts(cutoff: Date): Promise<number> {
    return this.cartRepo.deleteAbandonedCartsOlderThan(cutoff);
  }

  /**
   * Phase 64 (2026-05-22) — cart-level serviceability preview
   * (audit Gap #3).
   *
   * Pre-Phase-64 the cart had NO serviceability check — customers
   * learned at /checkout/initiate that an item couldn't be
   * delivered, by which point 9 of 10 items had already had stock
   * reserved for 15 minutes (audit Gap #4). The new endpoint runs
   * the canonical allocator preview (no reservation, no
   * AllocationLog) for every live cart line at the supplied
   * pincode and returns a per-line { cartItemId, serviceable,
   * reason } so the cart UI can warn before the customer
   * proceeds.
   *
   * Parallelised across lines (Promise.all) so a 50-item cart
   * completes in one round-trip per allocator stage rather than
   * 50 sequential ones.
   */
  async checkCartServiceability(
    customerId: string,
    pincode: string,
  ): Promise<{
    pincode: string;
    allServiceable: boolean;
    serviceableCount: number;
    unserviceableCount: number;
    items: Array<{
      cartItemId: string;
      productId: string;
      variantId: string | null;
      quantity: number;
      serviceable: boolean;
      reason: string;
    }>;
  }> {
    const cart = await this.cartRepo.findByCustomerId(customerId);
    if (!cart) {
      return {
        pincode,
        allServiceable: true,
        serviceableCount: 0,
        unserviceableCount: 0,
        items: [],
      };
    }
    const liveItems = cart.items.filter((i) => !i.savedForLater);

    const previews = await Promise.all(
      liveItems.map((item) =>
        this.catalog
          .previewServiceability({
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            customerPincode: pincode,
            quantity: item.quantity,
          })
          .catch(() => null),
      ),
    );

    const items = liveItems.map((item, idx) => {
      const preview = previews[idx];
      if (!preview) {
        return {
          cartItemId: item.id,
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          serviceable: false,
          reason: 'NO_MAPPING',
        };
      }
      return {
        cartItemId: item.id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        serviceable: preview.serviceable,
        reason: preview.reason,
      };
    });

    const serviceableCount = items.filter((i) => i.serviceable).length;
    const unserviceableCount = items.length - serviceableCount;
    return {
      pincode,
      allServiceable: unserviceableCount === 0,
      serviceableCount,
      unserviceableCount,
      items,
    };
  }

  /**
   * Phase 61 (2026-05-22) — merge an anonymous-cart payload (held
   * client-side until login) into the authenticated user's cart.
   *
   * Pre-Phase-61 the merge was sequential `for-of await`, swallowed
   * every per-item error with no reason, and the response only
   * carried `{ merged, skipped }`. The Phase 61 path:
   *   - Parallelises with Promise.allSettled so a 50-item merge
   *     completes in one round-trip per validation step rather
   *     than 50 (audit Gap #19).
   *   - Captures a per-item `reason` so the client can show "3
   *     items skipped: 2 out of stock, 1 product unavailable"
   *     instead of an opaque count (audit Gap #15).
   */
  async mergeAnonymousCart(
    customerId: string,
    items: Array<{ productId: string; variantId?: string; quantity: number }>,
  ): Promise<{
    merged: number;
    skipped: number;
    failures: Array<{ productId: string; variantId: string | null; reason: string }>;
  }> {
    const results = await Promise.allSettled(
      items.map((it) =>
        this.addItem(customerId, it.productId, it.variantId, it.quantity).then(() => ({
          ok: true as const,
          item: it,
        })),
      ),
    );
    let merged = 0;
    let skipped = 0;
    const failures: Array<{
      productId: string;
      variantId: string | null;
      reason: string;
    }> = [];
    results.forEach((r, idx) => {
      const item = items[idx]!;
      if (r.status === 'fulfilled') {
        merged++;
      } else {
        skipped++;
        const reason =
          r.reason instanceof Error
            ? r.reason.message
            : typeof r.reason === 'string'
              ? r.reason
              : 'Unknown error';
        failures.push({
          productId: item.productId,
          variantId: item.variantId ?? null,
          reason,
        });
      }
    });
    return { merged, skipped, failures };
  }
}
