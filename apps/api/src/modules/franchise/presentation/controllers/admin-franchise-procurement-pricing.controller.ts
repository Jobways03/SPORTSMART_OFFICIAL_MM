import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { AdminAuthGuard } from '../../../../core/guards';
import { FranchiseProcurementPriceUpsertDto } from '../dtos/franchise-procurement-price-upsert.dto';

/**
 * Admin-only CRUD on per-franchise negotiated procurement prices
 * (Option C). Each row represents a live negotiation between the
 * platform and one franchise for one SKU. When present, the row
 * overrides ProductVariant.costPrice in the procurement approval
 * prefill chain and is the target of the approval write-back.
 *
 * Intentionally NOT exposed to franchise tokens — these rows contain
 * the platform's internal landed cost and must never leak to the
 * franchise UI. Franchise JWTs hit a different auth guard entirely.
 */
@ApiTags('Admin Franchise Procurement Pricing')
@Controller('admin/franchises/:franchiseId/procurement-prices')
@UseGuards(AdminAuthGuard)
export class AdminFranchiseProcurementPricingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Param('franchiseId') franchiseId: string) {
    // Verify the franchise actually exists before returning. Without
    // this, a typo in the URL silently returns an empty list — looks
    // like "no overrides yet" when it's really "wrong franchise id".
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: { id: true },
    });
    if (!franchise) {
      throw new NotFoundAppException('Franchise not found');
    }

    const rows = await this.prisma.franchiseProcurementPrice.findMany({
      where: { franchiseId },
      orderBy: { updatedAt: 'desc' },
    });

    // Hydrate product/variant titles so the UI can render names
    // without another round-trip per row.
    const productIds = Array.from(new Set(rows.map((r) => r.productId)));
    const variantIds = Array.from(
      new Set(rows.map((r) => r.variantId).filter((v): v is string => !!v)),
    );
    const [products, variants] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([] as any[]),
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, title: true, sku: true },
          })
        : Promise.resolve([] as any[]),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const variantById = new Map(variants.map((v) => [v.id, v]));

    return {
      success: true,
      message: 'Procurement prices retrieved',
      data: {
        prices: rows.map((r) => ({
          ...r,
          product: productById.get(r.productId) ?? null,
          variant: r.variantId ? variantById.get(r.variantId) ?? null : null,
        })),
      },
    };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async upsert(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: FranchiseProcurementPriceUpsertDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;

    // Quick sanity: product (and variant, if provided) must exist and
    // not be soft-deleted. Catches typos before an unresolvable row
    // lands in the override table.
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, isDeleted: false },
      select: { id: true },
    });
    if (!product) {
      throw new BadRequestAppException('Product not found or deleted');
    }
    if (dto.variantId) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: dto.variantId, productId: dto.productId, isDeleted: false },
        select: { id: true },
      });
      if (!variant) {
        throw new BadRequestAppException(
          'Variant not found, deleted, or belongs to a different product',
        );
      }
    }

    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: { id: true },
    });
    if (!franchise) {
      throw new NotFoundAppException('Franchise not found');
    }

    // Atomic upsert keyed on the composite unique. Null variantId is
    // treated as its own key by PostgreSQL's unique semantics
    // (NULL != NULL) — same convention the rest of the franchise
    // catalog uses, and intentional so product-level and variant-level
    // overrides can coexist for the same (franchise, product).
    const row = await this.prisma.franchiseProcurementPrice.upsert({
      // Cast needed because Prisma's composite-unique input type
      // doesn't model nullable variantId as nullable (even though
      // Postgres allows it). All other repos hitting this same key
      // apply the same workaround.
      where: {
        franchiseId_productId_variantId: {
          franchiseId,
          productId: dto.productId,
          variantId: dto.variantId ?? null,
        } as any,
      },
      update: {
        landedUnitCost: dto.landedUnitCost,
        notes: dto.notes ?? null,
      },
      create: {
        franchiseId,
        productId: dto.productId,
        variantId: dto.variantId ?? null,
        landedUnitCost: dto.landedUnitCost,
        notes: dto.notes ?? null,
        createdBy: adminId ?? null,
      },
    });

    return {
      success: true,
      message: 'Procurement price saved',
      data: row,
    };
  }

  @Delete(':priceId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('franchiseId') franchiseId: string,
    @Param('priceId') priceId: string,
  ) {
    const row = await this.prisma.franchiseProcurementPrice.findUnique({
      where: { id: priceId },
    });
    // Ownership check — deleting by id alone would let an admin with
    // scope limited to franchise A nuke franchise B's row if URL is
    // crafted. Cheap safeguard.
    if (!row || row.franchiseId !== franchiseId) {
      throw new NotFoundAppException('Procurement price not found');
    }

    await this.prisma.franchiseProcurementPrice.delete({
      where: { id: priceId },
    });

    return { success: true, message: 'Procurement price removed' };
  }
}
