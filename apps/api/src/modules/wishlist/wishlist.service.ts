import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
  ConflictAppException,
} from '../../core/exceptions';

const MAX_NOTE_LENGTH = 280;

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Paginated wishlist for the current user. Newest-first ordering is
   * served from the `(user_id, created_at DESC)` index without an
   * extra sort step.
   */
  async list(userId: string, page = 1, limit = 50) {
    const skip = (Math.max(1, page) - 1) * limit;
    const take = Math.min(Math.max(1, limit), 100);

    const [items, total] = await Promise.all([
      this.prisma.wishlistItem.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          product: {
            select: {
              id: true,
              title: true,
              slug: true,
              basePrice: true,
              status: true,
            },
          },
          variant: {
            select: {
              id: true,
              sku: true,
              price: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.wishlistItem.count({ where: { userId } }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Add a product (or specific variant) to the user's wishlist.
   *
   * Idempotent on (userId, productId, variantId): a second add returns
   * the existing row rather than 409, so the heart-button on the
   * product card can be wired with optimistic UI without worrying
   * about double-fires. Throws 404 if the product / variant doesn't
   * exist so the caller sees a real error instead of an orphan row.
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

    const product = await this.prisma.product.findUnique({
      where: { id: input.productId },
      select: { id: true, isDeleted: true },
    });
    if (!product || product.isDeleted) {
      throw new NotFoundAppException('Product not found');
    }

    if (input.variantId) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: input.variantId },
        select: { id: true, productId: true, isDeleted: true },
      });
      if (!variant || variant.isDeleted) {
        throw new NotFoundAppException('Variant not found');
      }
      if (variant.productId !== input.productId) {
        throw new BadRequestAppException(
          'variantId does not belong to the supplied productId',
        );
      }
    }

    try {
      return await this.prisma.wishlistItem.create({
        data: {
          userId,
          productId: input.productId,
          variantId: input.variantId ?? null,
          note: input.note?.trim() || null,
        },
      });
    } catch (err) {
      // Idempotent re-add — return the existing row.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.wishlistItem.findFirst({
          where: {
            userId,
            productId: input.productId,
            variantId: input.variantId ?? null,
          },
        });
        if (existing) return existing;
        // Fell through (shouldn't happen) — surface conflict.
        throw new ConflictAppException('Wishlist slot already exists');
      }
      throw err;
    }
  }

  /**
   * Remove a wishlist item by its row id. Scoped to the requester so
   * one customer can't delete another's row.
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
}
