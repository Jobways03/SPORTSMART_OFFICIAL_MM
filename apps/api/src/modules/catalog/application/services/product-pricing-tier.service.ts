import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

// Shape returned to API callers. We surface the percent + a
// pre-formatted display label so the frontend doesn't need to
// duplicate the "Buy N+ save P%" template.
export interface PricingTierResponse {
  id: string;
  productId: string;
  variantId: string | null;
  minQuantity: number;
  discountPercent: number;
  displayLabel: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PricingTierWriteInput {
  variantId?: string | null;
  minQuantity: number;
  discountPercent: number;
  displayLabel?: string | null;
  isActive?: boolean;
}

/**
 * Story 3.5 — Product Pricing Tiers (display-only at v1).
 *
 * Scope reminder: this service stores + serves the tier ladder.
 * Cart/checkout pricing is intentionally NOT touched at v1 because
 * stacking semantics (tier on top of a coupon? tier wins over BOGO?)
 * + commission base (does seller commission compute on tier-discounted
 * net?) + refund value (refund the tier price or list price?) are all
 * unresolved business decisions. Adding tier-pricing to checkout
 * without these would silently change settlement and is the kind of
 * bug class that costs real money.
 */
@Injectable()
export class ProductPricingTierService {
  private readonly logger = new Logger(ProductPricingTierService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Public reads ───────────────────────────────────────────────

  /**
   * Active tiers for a product (and optionally a specific variant).
   * Sorted ascending by minQuantity so the UI can render the ladder
   * top-to-bottom in qualifier order. When a variantId is provided,
   * we union variant-scoped tiers with tiers that target "any variant
   * of this product" (variantId NULL) so the customer sees both
   * scopes blended.
   */
  async listActiveForProduct(args: {
    productId: string;
    variantId?: string | null;
  }): Promise<PricingTierResponse[]> {
    const productExists = await this.prisma.product.count({
      where: { id: args.productId },
    });
    if (productExists === 0) throw new NotFoundAppException('Product not found');

    const where: Prisma.ProductPricingTierWhereInput = {
      productId: args.productId,
      isActive: true,
    };
    if (args.variantId !== undefined) {
      // Include both variant-scoped + the "any-variant" rows.
      where.OR = [{ variantId: args.variantId }, { variantId: null }];
    }

    const rows = await this.prisma.productPricingTier.findMany({
      where,
      orderBy: { minQuantity: 'asc' },
    });

    return rows.map((r) => this.toResponse(r));
  }

  // ── Admin CRUD ────────────────────────────────────────────────

  async listForAdmin(productId: string): Promise<PricingTierResponse[]> {
    const productExists = await this.prisma.product.count({
      where: { id: productId },
    });
    if (productExists === 0) throw new NotFoundAppException('Product not found');

    const rows = await this.prisma.productPricingTier.findMany({
      where: { productId },
      orderBy: [{ minQuantity: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  async create(
    productId: string,
    input: PricingTierWriteInput,
  ): Promise<PricingTierResponse> {
    this.assertWriteShape(input);

    const productExists = await this.prisma.product.count({
      where: { id: productId },
    });
    if (productExists === 0) throw new NotFoundAppException('Product not found');

    if (input.variantId) {
      const variantOk = await this.prisma.productVariant.count({
        where: { id: input.variantId, productId },
      });
      if (variantOk === 0) {
        throw new BadRequestAppException(
          'variantId does not belong to this product',
        );
      }
    }

    try {
      const row = await this.prisma.productPricingTier.create({
        data: {
          productId,
          variantId: input.variantId ?? null,
          minQuantity: input.minQuantity,
          discountPercent: input.discountPercent,
          displayLabel: input.displayLabel?.trim() || null,
          isActive: input.isActive ?? true,
        },
      });
      this.logger.log(
        `Created pricing tier ${row.id} (product=${productId}, minQty=${input.minQuantity}, off=${input.discountPercent}%)`,
      );
      return this.toResponse(row);
    } catch (e: any) {
      // P2002 = unique constraint. Means (productId, variantId,
      // minQuantity) is already used; ask the caller to PATCH instead.
      if (e?.code === 'P2002') {
        throw new BadRequestAppException(
          'A pricing tier with this minQuantity already exists for this product/variant. Update the existing tier instead.',
        );
      }
      throw e;
    }
  }

  async update(
    tierId: string,
    input: Partial<PricingTierWriteInput>,
  ): Promise<PricingTierResponse> {
    const existing = await this.prisma.productPricingTier.findUnique({
      where: { id: tierId },
    });
    if (!existing) throw new NotFoundAppException('Pricing tier not found');

    // Validate just the fields the caller is touching. Leaves others
    // untouched — partial PATCH semantics.
    if (input.minQuantity !== undefined) {
      this.assertMinQuantity(input.minQuantity);
    }
    if (input.discountPercent !== undefined) {
      this.assertDiscountPercent(input.discountPercent);
    }
    if (input.variantId) {
      const variantOk = await this.prisma.productVariant.count({
        where: { id: input.variantId, productId: existing.productId },
      });
      if (variantOk === 0) {
        throw new BadRequestAppException(
          'variantId does not belong to this tier\'s product',
        );
      }
    }

    try {
      const row = await this.prisma.productPricingTier.update({
        where: { id: tierId },
        data: {
          ...(input.variantId !== undefined ? { variantId: input.variantId } : {}),
          ...(input.minQuantity !== undefined ? { minQuantity: input.minQuantity } : {}),
          ...(input.discountPercent !== undefined
            ? { discountPercent: input.discountPercent }
            : {}),
          ...(input.displayLabel !== undefined
            ? { displayLabel: input.displayLabel?.trim() || null }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      return this.toResponse(row);
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new BadRequestAppException(
          'Another tier with this minQuantity already exists for the same product/variant.',
        );
      }
      throw e;
    }
  }

  async remove(tierId: string): Promise<{ deleted: true; id: string }> {
    try {
      await this.prisma.productPricingTier.delete({ where: { id: tierId } });
      return { deleted: true, id: tierId };
    } catch (e: any) {
      if (e?.code === 'P2025') {
        throw new NotFoundAppException('Pricing tier not found');
      }
      throw e;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

  private assertWriteShape(input: PricingTierWriteInput): void {
    this.assertMinQuantity(input.minQuantity);
    this.assertDiscountPercent(input.discountPercent);
  }

  private assertMinQuantity(n: number): void {
    if (!Number.isInteger(n) || n <= 0) {
      throw new BadRequestAppException(
        'minQuantity must be a positive integer',
      );
    }
    if (n > 100_000) {
      // Sanity guard — no one is buying 100k units in a single line.
      throw new BadRequestAppException(
        'minQuantity unreasonably large (max 100000)',
      );
    }
  }

  private assertDiscountPercent(p: number): void {
    if (typeof p !== 'number' || Number.isNaN(p)) {
      throw new BadRequestAppException(
        'discountPercent must be a number between 0 and 100',
      );
    }
    if (p < 0 || p > 100) {
      throw new BadRequestAppException(
        'discountPercent must be between 0 and 100',
      );
    }
  }

  private toResponse(row: {
    id: string;
    productId: string;
    variantId: string | null;
    minQuantity: number;
    discountPercent: Prisma.Decimal | number | string;
    displayLabel: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): PricingTierResponse {
    const pct = Number(row.discountPercent);
    return {
      id: row.id,
      productId: row.productId,
      variantId: row.variantId,
      minQuantity: row.minQuantity,
      discountPercent: pct,
      // Default copy when ops didn't override. Frontend can still
      // re-format if they want a different shape.
      displayLabel:
        row.displayLabel?.trim() ||
        `Buy ${row.minQuantity}+ save ${formatPercent(pct)}`,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function formatPercent(p: number): string {
  // Strip the trailing .00 for clean copy ("10%" not "10.00%").
  return Number.isInteger(p) ? `${p}%` : `${p.toFixed(2).replace(/\.?0+$/, '')}%`;
}
