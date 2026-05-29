import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
  ConflictAppException,
} from '../../core/exceptions';

// ── Public-facing DTOs ─────────────────────────────────────────────

export interface ProductReviewDto {
  id: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
  verifiedBuyer: boolean;
}

export interface ProductReviewSummary {
  averageRating: number;
  reviewCount: number;
  /** Stars (1..5) → fraction of total (0..1). */
  ratingBreakdown: Record<string, number>;
}

export interface PublicReviewsResponse {
  summary: ProductReviewSummary;
  reviews: ProductReviewDto[];
}

// ── Admin DTO — same as public + the moderation columns. ───────────

export interface AdminReviewDto extends ProductReviewDto {
  status: ReviewStatus;
  productId: string;
  productTitle: string;
  productSlug: string;
  userEmail: string;
  moderatedAt: string | null;
  moderatedById: string | null;
  rejectionReason: string | null;
  updatedAt: string;
}

export interface CreateReviewInput {
  rating: number;
  title?: string;
  body: string;
}

@Injectable()
export class ProductReviewsService {
  private readonly logger = new Logger(ProductReviewsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Public: storefront PDP reads ─────────────────────────────────

  // Hot path — mobile PDP calls this for every product view. Returns
  // approved reviews + the aggregate summary in one query so the
  // mobile client doesn't need two round trips. Cap the row count
  // so a viral product doesn't blow up the response.
  async listPublicByProductSlug(slug: string): Promise<PublicReviewsResponse | null> {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!product) return null;

    const [approved, breakdown] = await Promise.all([
      this.prisma.productReview.findMany({
        where: { productId: product.id, status: ReviewStatus.APPROVED },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      // Single aggregate query for the star distribution. Reads the
      // approved rows only — pending/rejected don't affect the
      // public average.
      this.prisma.productReview.groupBy({
        by: ['rating'],
        where: { productId: product.id, status: ReviewStatus.APPROVED },
        _count: { rating: true },
      }),
    ]);

    const reviewCount = breakdown.reduce(
      (sum, b) => sum + (b._count.rating ?? 0),
      0,
    );
    const weighted = breakdown.reduce(
      (sum, b) => sum + b.rating * (b._count.rating ?? 0),
      0,
    );
    const averageRating = reviewCount > 0 ? weighted / reviewCount : 0;

    // Fill in 1..5 keys so the consumer always renders all five bars.
    const ratingBreakdown: Record<string, number> = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
    };
    if (reviewCount > 0) {
      for (const b of breakdown) {
        ratingBreakdown[String(b.rating)] =
          (b._count.rating ?? 0) / reviewCount;
      }
    }

    return {
      summary: {
        averageRating: Math.round(averageRating * 10) / 10,
        reviewCount,
        ratingBreakdown,
      },
      reviews: approved.map(this.toPublicDto),
    };
  }

  // ── Customer: write path ─────────────────────────────────────────

  async createReview(
    userId: string,
    productSlug: string,
    input: CreateReviewInput,
  ): Promise<ProductReviewDto> {
    const trimmedBody = (input.body ?? '').trim();
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new BadRequestAppException('rating must be an integer between 1 and 5');
    }
    if (trimmedBody.length < 10) {
      throw new BadRequestAppException(
        'review body must be at least 10 characters',
      );
    }
    if (trimmedBody.length > 4000) {
      throw new BadRequestAppException('review body must be at most 4000 characters');
    }

    const product = await this.prisma.product.findUnique({
      where: { slug: productSlug },
      select: { id: true },
    });
    if (!product) throw new NotFoundAppException('Product not found');

    // Verified-buyer flag — true if the user has at least one
    // DELIVERED suborder that included this product. Cheap query
    // because it short-circuits at the first row.
    const verifiedBuyer = await this.hasDeliveredOrderForProduct(
      userId,
      product.id,
    );

    try {
      const created = await this.prisma.productReview.create({
        data: {
          productId: product.id,
          userId,
          rating: input.rating,
          title: input.title?.trim() || null,
          body: trimmedBody,
          status: ReviewStatus.PENDING,
          verifiedBuyer,
        },
        include: {
          user: { select: { firstName: true, lastName: true } },
        },
      });
      return this.toPublicDto(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictAppException(
          'You have already reviewed this product. Edit your existing review instead.',
        );
      }
      throw err;
    }
  }

  // Best-effort verified-buyer check. Joins through the user's
  // master orders → suborders → items. Wrapped in try/catch because
  // the order schema might shift over time and a failed check
  // shouldn't block the review from posting — we just default to
  // verifiedBuyer=false.
  private async hasDeliveredOrderForProduct(
    userId: string,
    productId: string,
  ): Promise<boolean> {
    try {
      const hit = await this.prisma.masterOrder.findFirst({
        where: {
          customerId: userId,
          subOrders: {
            some: {
              fulfillmentStatus: 'DELIVERED',
              items: { some: { productId } },
            },
          },
        },
        select: { id: true },
      });
      return !!hit;
    } catch (err) {
      this.logger.warn(
        `verified-buyer check failed for user=${userId} product=${productId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  // ── Admin: moderation queue ──────────────────────────────────────

  async adminList(params: {
    page: number;
    limit: number;
    status?: ReviewStatus;
    productSlug?: string;
  }): Promise<{
    items: AdminReviewDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, status, productSlug } = params;
    const where: Prisma.ProductReviewWhereInput = {};
    if (status) where.status = status;
    if (productSlug) where.product = { slug: productSlug };

    const [rows, total] = await Promise.all([
      this.prisma.productReview.findMany({
        where,
        orderBy: [
          // Pending first so moderators see new submissions on top.
          { status: 'asc' },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: { firstName: true, lastName: true, email: true },
          },
          product: { select: { title: true, slug: true } },
        },
      }),
      this.prisma.productReview.count({ where }),
    ]);

    return {
      items: rows.map(this.toAdminDto),
      total,
      page,
      limit,
    };
  }

  async approve(id: string, adminId: string): Promise<AdminReviewDto> {
    return this.transition(id, adminId, ReviewStatus.APPROVED, null);
  }

  async reject(
    id: string,
    adminId: string,
    reason: string | undefined,
  ): Promise<AdminReviewDto> {
    return this.transition(
      id,
      adminId,
      ReviewStatus.REJECTED,
      reason?.trim() || null,
    );
  }

  private async transition(
    id: string,
    adminId: string,
    status: ReviewStatus,
    rejectionReason: string | null,
  ): Promise<AdminReviewDto> {
    const existing = await this.prisma.productReview.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundAppException('Review not found');

    const row = await this.prisma.productReview.update({
      where: { id },
      data: {
        status,
        moderatedAt: new Date(),
        moderatedById: adminId,
        rejectionReason,
      },
      include: {
        user: {
          select: { firstName: true, lastName: true, email: true },
        },
        product: { select: { title: true, slug: true } },
      },
    });
    return this.toAdminDto(row);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.prisma.productReview.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundAppException('Review not found');
    await this.prisma.productReview.delete({ where: { id } });
  }

  // ── Mappers ──────────────────────────────────────────────────────

  private toPublicDto = (row: {
    id: string;
    rating: number;
    title: string | null;
    body: string;
    createdAt: Date;
    verifiedBuyer: boolean;
    user: { firstName: string; lastName: string };
  }): ProductReviewDto => ({
    id: row.id,
    // Public-facing name: first name + last initial ("Arjun K.").
    // Keeps reviewers identifiable to friends while protecting the
    // full name from search-engine indexing.
    authorName:
      `${row.user.firstName} ${row.user.lastName.charAt(0)}.`.trim(),
    rating: row.rating,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    verifiedBuyer: row.verifiedBuyer,
  });

  private toAdminDto = (row: {
    id: string;
    productId: string;
    rating: number;
    title: string | null;
    body: string;
    status: ReviewStatus;
    verifiedBuyer: boolean;
    moderatedAt: Date | null;
    moderatedById: string | null;
    rejectionReason: string | null;
    createdAt: Date;
    updatedAt: Date;
    user: { firstName: string; lastName: string; email: string };
    product: { title: string; slug: string };
  }): AdminReviewDto => ({
    id: row.id,
    productId: row.productId,
    productTitle: row.product.title,
    productSlug: row.product.slug,
    userEmail: row.user.email,
    authorName: `${row.user.firstName} ${row.user.lastName}`.trim(),
    rating: row.rating,
    title: row.title,
    body: row.body,
    status: row.status,
    verifiedBuyer: row.verifiedBuyer,
    moderatedAt: row.moderatedAt?.toISOString() ?? null,
    moderatedById: row.moderatedById,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
