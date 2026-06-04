import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
  ConflictAppException,
} from '../../core/exceptions';

const MAX_NOTE_LENGTH = 280;

// Phase 202 (#6) — hard ceiling on a single user's wishlist. A wishlist
// is a self-service, append-mostly list; without a cap a hostile (or
// runaway-script) client could insert unbounded rows under one account.
// 200 is generous for genuine use while bounding the blast radius.
const MAX_WISHLIST_SIZE = 200;

/**
 * Phase 202 (#3 / #12) — public product gate, mirrored from the
 * storefront catalog reads (prisma-storefront.repository.ts): a product
 * is "available" on a customer surface only when it is live
 * (status=ACTIVE), moderation-approved (moderationStatus=APPROVED) and
 * not soft-deleted. Variants must be live (status=ACTIVE) and not
 * soft-deleted.
 *
 * Wishlist rows are NOT cascade-removed when a product is merely
 * unpublished (only on hard-delete), so the list MUST compute an
 * `available` boolean rather than trust the row's existence — otherwise
 * a soft-deleted / suspended / un-moderated product leaks through with a
 * live price.
 */
function isProductPublic(p: {
  status: string;
  moderationStatus: string;
  isDeleted: boolean;
}): boolean {
  return (
    p.status === 'ACTIVE' &&
    p.moderationStatus === 'APPROVED' &&
    p.isDeleted === false
  );
}

function isVariantPublic(
  v: { status: string; isDeleted: boolean } | null | undefined,
): boolean {
  if (!v) return true; // no specific variant pinned → product gate decides
  return v.status === 'ACTIVE' && v.isDeleted === false;
}

@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Paginated wishlist for the current user. Newest-first ordering is
   * served from the `(user_id, created_at DESC)` index without an extra
   * sort step.
   *
   * Phase 202 (#3/#12/#16): the product/variant `status` columns are
   * read for the availability decision but NEVER serialized — each item
   * is projected to a customer-safe shape with a computed `available`
   * boolean, and the price is suppressed (null) for unavailable rows so
   * a soft-deleted / suspended product can't surface a stale price. The
   * select also pulls the primary image + brand name (#16) so the list
   * renders a real card without a second roundtrip, and the add-time
   * price snapshot (#13) is serialized as a string (money discipline).
   */
  async list(userId: string, page = 1, limit = 50) {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const skip = (Math.max(1, page) - 1) * safeLimit;

    const [rows, total] = await Promise.all([
      this.prisma.wishlistItem.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: safeLimit,
        select: {
          id: true,
          productId: true,
          variantId: true,
          note: true,
          unitPriceInPaiseAtAdd: true,
          createdAt: true,
          product: {
            select: {
              id: true,
              title: true,
              slug: true,
              basePrice: true,
              // Gate inputs — used to compute `available`, then dropped.
              status: true,
              moderationStatus: true,
              isDeleted: true,
              brand: { select: { id: true, name: true } },
              images: {
                where: { isPrimary: true },
                take: 1,
                select: { url: true, altText: true },
              },
            },
          },
          variant: {
            select: {
              id: true,
              sku: true,
              price: true,
              // Gate inputs — used to compute `available`, then dropped.
              status: true,
              isDeleted: true,
            },
          },
        },
      }),
      this.prisma.wishlistItem.count({ where: { userId } }),
    ]);

    const items = rows.map((row) => this.toCustomerSafeItem(row));
    return { items, total, page, limit: safeLimit };
  }

  /**
   * Project a raw wishlist row to the customer-safe wire shape. Internal
   * product/variant `status` / `moderationStatus` / `isDeleted` columns
   * are NEVER exposed (#12) — they're folded into a single `available`
   * boolean. Money is serialized as a string (#14): the live price comes
   * from the variant when pinned, else the product base price, and is
   * suppressed entirely when the item is unavailable.
   */
  private toCustomerSafeItem(row: {
    id: string;
    productId: string;
    variantId: string | null;
    note: string | null;
    unitPriceInPaiseAtAdd: bigint | null;
    createdAt: Date;
    product: {
      id: string;
      title: string;
      slug: string;
      basePrice: Prisma.Decimal | null;
      status: string;
      moderationStatus: string;
      isDeleted: boolean;
      brand: { id: string; name: string } | null;
      images: { url: string; altText: string | null }[];
    };
    variant: {
      id: string;
      sku: string | null;
      price: Prisma.Decimal | null;
      status: string;
      isDeleted: boolean;
    } | null;
  }) {
    const available =
      isProductPublic(row.product) && isVariantPublic(row.variant);

    const livePrice = available
      ? (row.variant?.price ?? row.product.basePrice ?? null)
      : null;

    const image = row.product.images[0] ?? null;

    return {
      id: row.id,
      productId: row.productId,
      variantId: row.variantId,
      note: row.note,
      createdAt: row.createdAt,
      available,
      product: {
        id: row.product.id,
        title: row.product.title,
        slug: row.product.slug,
        brand: row.product.brand
          ? { id: row.product.brand.id, name: row.product.brand.name }
          : null,
        imageUrl: image?.url ?? null,
        imageAlt: image?.altText ?? null,
      },
      variant: row.variant
        ? { id: row.variant.id, sku: row.variant.sku }
        : null,
      // Money on the wire is a string (Decimal/BigInt → string). The FE
      // coerces with Number() only at the format boundary.
      priceInPaise:
        livePrice != null
          ? String(BigInt(Math.round(Number(livePrice) * 100)))
          : null,
      // Add-time snapshot (#13) — also string-serialized.
      unitPriceInPaiseAtAdd:
        row.unitPriceInPaiseAtAdd != null
          ? row.unitPriceInPaiseAtAdd.toString()
          : null,
    };
  }

  /**
   * Add a product (or specific variant) to the user's wishlist.
   *
   * Idempotent on (userId, productId, variantId): a second add returns
   * the existing row rather than 409, so the heart-button can be wired
   * with optimistic UI without worrying about double-fires.
   *
   * Phase 202:
   *   - #2: the product must be live (status=ACTIVE), moderation-
   *     approved and not soft-deleted; a pinned variant must be live and
   *     not soft-deleted. Pre-202 the check was `isDeleted` only, so a
   *     suspended / un-moderated / draft product could be wishlisted by
   *     id even though it's invisible in the catalog.
   *   - #6: the per-user size cap is enforced before insert.
   *   - #13: the add-time unit price is snapshotted (integer paise).
   */
  async add(
    userId: string,
    input: { productId: string; variantId?: string; note?: string },
  ) {
    if (!input.productId?.trim()) {
      throw new BadRequestAppException('productId is required');
    }
    if (input.note && input.note.length > MAX_NOTE_LENGTH) {
      throw new BadRequestAppException(
        `note must be ${MAX_NOTE_LENGTH} characters or fewer`,
      );
    }

    // #2 — public product gate (not just "exists & not deleted").
    const product = await this.prisma.product.findUnique({
      where: { id: input.productId },
      select: {
        id: true,
        status: true,
        moderationStatus: true,
        isDeleted: true,
        basePrice: true,
      },
    });
    if (!product || !isProductPublic(product)) {
      throw new NotFoundAppException('Product not found or not available');
    }

    let variantPrice: Prisma.Decimal | null = null;
    if (input.variantId) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: input.variantId },
        select: {
          id: true,
          productId: true,
          status: true,
          isDeleted: true,
          price: true,
        },
      });
      if (!variant || !isVariantPublic(variant)) {
        throw new NotFoundAppException('Variant not found or not available');
      }
      if (variant.productId !== input.productId) {
        throw new BadRequestAppException(
          'variantId does not belong to the supplied productId',
        );
      }
      variantPrice = variant.price;
    }

    // #6 — size cap. Counted before the insert; a genuine re-add of an
    // existing slot is idempotent below and never trips the cap because
    // we only block when strictly at/over the ceiling AND the slot is new.
    const existing = await this.prisma.wishlistItem.findFirst({
      where: {
        userId,
        productId: input.productId,
        variantId: input.variantId ?? null,
      },
    });
    if (existing) return existing;

    const count = await this.prisma.wishlistItem.count({ where: { userId } });
    if (count >= MAX_WISHLIST_SIZE) {
      throw new ConflictAppException(
        `Wishlist is full (max ${MAX_WISHLIST_SIZE} items). Remove an item before adding another.`,
      );
    }

    // #13 — price snapshot at add-time (integer paise, BigInt). Variant
    // price wins when a variant is pinned; else the product base price.
    // Null when neither is set (abstract save on a variant-only product).
    const snapshotSource = variantPrice ?? product.basePrice ?? null;
    const unitPriceInPaiseAtAdd =
      snapshotSource != null
        ? BigInt(Math.round(Number(snapshotSource) * 100))
        : null;

    try {
      return await this.prisma.wishlistItem.create({
        data: {
          userId,
          productId: input.productId,
          variantId: input.variantId ?? null,
          note: input.note?.trim() || null,
          unitPriceInPaiseAtAdd,
        },
      });
    } catch (err) {
      // Idempotent re-add — return the existing row (covers the race
      // where a concurrent add landed between our findFirst and create).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.prisma.wishlistItem.findFirst({
          where: {
            userId,
            productId: input.productId,
            variantId: input.variantId ?? null,
          },
        });
        if (raced) return raced;
        throw new ConflictAppException('Wishlist slot already exists');
      }
      throw err;
    }
  }

  /**
   * Remove a wishlist item by its row id. Scoped to the requester so one
   * customer can't delete another's row.
   */
  async remove(userId: string, itemId: string) {
    const row = await this.prisma.wishlistItem.findUnique({
      where: { id: itemId },
      select: { id: true, userId: true },
    });
    if (!row || row.userId !== userId) {
      throw new NotFoundAppException('Wishlist item not found');
    }
    await this.prisma.wishlistItem.delete({ where: { id: itemId } });
  }

  /**
   * Phase 202 (#8) — lightweight "what have I wishlisted" projection for
   * client-side seeding. The catalog/PDP fetches this once on mount so
   * every heart renders in its correct filled/empty state without an
   * N-call fan-out. Returns just the ids (no product payload):
   *   - productIds: every product the user has saved (any variant)
   *   - variantPairs: {productId, variantId} for variant-pinned saves
   * The FE marks a product's heart "on" if its id is in productIds; a
   * PDP marks the selected variant "on" if the pair matches.
   */
  async getWishlistedIds(userId: string) {
    const rows = await this.prisma.wishlistItem.findMany({
      where: { userId },
      select: { productId: true, variantId: true },
    });

    const productIds = Array.from(new Set(rows.map((r) => r.productId)));
    const variantPairs = rows
      .filter((r) => r.variantId != null)
      .map((r) => ({ productId: r.productId, variantId: r.variantId as string }));

    return { productIds, variantPairs };
  }

  /**
   * Phase 202 (#7) — backend half of move-to-cart.
   *
   * Re-validates the product + pinned variant against the SAME public
   * gate the cart's add path uses (active + approved + not soft-deleted),
   * removes the wishlist row, and emits `wishlist.moved_to_cart` so the
   * cart module can perform the actual cart insert via its own service
   * (no cross-module write from here — keeps the dependency one-way and
   * avoids an import cycle).
   *
   * NOTE for the storefront: the shipping UX performs the cart insert by
   * calling the existing `POST /customer/cart/items` endpoint directly,
   * then calls `DELETE /customer/wishlist/:itemId`. This endpoint exists
   * so a pure-backend caller (and the event-driven cart insert) has a
   * single validated entry point. SURFACED: a fully server-side move
   * needs a one-line `addItem` passthrough on CartPublicFacade (a
   * cart-owned file) OR a handler in the cart module consuming
   * `wishlist.moved_to_cart`; see notes.
   */
  async moveToCart(
    userId: string,
    itemId: string,
    quantity = 1,
  ): Promise<{ productId: string; variantId: string | null; quantity: number }> {
    const row = await this.prisma.wishlistItem.findUnique({
      where: { id: itemId },
      select: { id: true, userId: true, productId: true, variantId: true },
    });
    if (!row || row.userId !== userId) {
      throw new NotFoundAppException('Wishlist item not found');
    }

    const product = await this.prisma.product.findUnique({
      where: { id: row.productId },
      select: {
        id: true,
        status: true,
        moderationStatus: true,
        isDeleted: true,
      },
    });
    if (!product || !isProductPublic(product)) {
      throw new ConflictAppException(
        'This product is no longer available to add to cart',
      );
    }

    if (row.variantId) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: row.variantId },
        select: { id: true, status: true, isDeleted: true, stock: true },
      });
      if (!variant || !isVariantPublic(variant)) {
        throw new ConflictAppException(
          'This option is no longer available to add to cart',
        );
      }
      if (variant.stock <= 0) {
        throw new ConflictAppException('This option is out of stock');
      }
    }

    // Remove the wishlist row first; the cart insert is owned by the cart
    // module (event consumer / direct FE call). Removing first keeps the
    // wishlist authoritative and avoids a dangling row if the cart insert
    // is retried.
    await this.prisma.wishlistItem.delete({ where: { id: itemId } });

    const payload = {
      userId,
      productId: row.productId,
      variantId: row.variantId,
      quantity: Math.max(1, quantity),
    };
    this.events.emit('wishlist.moved_to_cart', payload);

    return {
      productId: row.productId,
      variantId: row.variantId,
      quantity: payload.quantity,
    };
  }
}
