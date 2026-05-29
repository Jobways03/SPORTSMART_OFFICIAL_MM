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
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { FranchiseProcurementPriceUpsertDto } from '../dtos/franchise-procurement-price-upsert.dto';

// Phase 159l (audit #6) — pricing may only be written for a franchise that is
// operational. Mirrors the procurement.service ACTIVE/APPROVED gate so a
// PENDING/SUSPENDED/DEACTIVATED franchise can't have prices "set up" by mistake.
const WRITABLE_FRANCHISE_STATUSES = ['ACTIVE', 'APPROVED'];

// Landed cost above this multiple of the customer-facing selling price is
// almost certainly a typo (you can't profitably procure above what you sell
// for). A true MRP-based rule is part of the deferred pricing-rule-engine
// follow-up; `price`/`basePrice` is the available selling-price reference.
const COST_SANITY_MULTIPLE = 1.5;

/**
 * Admin-only CRUD on per-franchise negotiated procurement prices
 * (Option C). Each row represents a live negotiation between the
 * platform and one franchise for one SKU. When present, the row
 * overrides the platform default in the procurement approval prefill
 * chain and is the target of the approval write-back.
 *
 * Intentionally NOT exposed to franchise tokens — these rows contain
 * the platform's internal landed cost and must never leak to the
 * franchise UI. Franchise JWTs hit a different auth guard entirely.
 *
 * Phase 159l — writes now require the dedicated
 * `franchise.procurement_pricing` permission (not just `franchise.read`),
 * are gated on franchise status, version-checked for concurrency, and
 * recorded to an append-only history table + audit log + event.
 */
@ApiTags('Admin Franchise Procurement Pricing')
@Controller('admin/franchises/:franchiseId/procurement-prices')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('franchise.read')
export class AdminFranchiseProcurementPricingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    private readonly eventBus: EventBusService,
  ) {}

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
  @Permissions('franchise.procurement_pricing')
  @HttpCode(HttpStatus.OK)
  async upsert(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: FranchiseProcurementPriceUpsertDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const { ipAddress, userAgent } = this.requestMeta(req);

    // Product (and variant) must exist + not be soft-deleted. Pull the
    // selling price so we can sanity-check the cost (audit #16).
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, isDeleted: false },
      select: { id: true, basePrice: true },
    });
    if (!product) {
      throw new BadRequestAppException('Product not found or deleted');
    }
    let sellingPrice: number | null =
      product.basePrice != null ? Number(product.basePrice) : null;
    if (dto.variantId) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: dto.variantId, productId: dto.productId, isDeleted: false },
        select: { id: true, price: true },
      });
      if (!variant) {
        throw new BadRequestAppException(
          'Variant not found, deleted, or belongs to a different product',
        );
      }
      if (variant.price != null) sellingPrice = Number(variant.price);
    }

    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: { id: true, status: true },
    });
    if (!franchise) {
      throw new NotFoundAppException('Franchise not found');
    }
    // Audit #6 — status guard.
    if (!WRITABLE_FRANCHISE_STATUSES.includes(franchise.status)) {
      throw new ForbiddenAppException(
        `Cannot set procurement pricing for a franchise in status ${franchise.status}. Franchise must be ACTIVE or APPROVED.`,
      );
    }

    // Audit #16 — cost-vs-selling-price sanity.
    if (sellingPrice != null && dto.landedUnitCost > sellingPrice * COST_SANITY_MULTIPLE) {
      throw new BadRequestAppException(
        `Landed unit cost ${dto.landedUnitCost} exceeds ${COST_SANITY_MULTIPLE}× the selling price (${sellingPrice}); refusing as a likely typo.`,
      );
    }

    // Strip HTML from notes (XSS guard, consistent with other admin flows).
    const cleanNotes = dto.notes
      ? dto.notes.replace(/<[^>]*>/g, '').trim() || null
      : null;

    const existing = await this.prisma.franchiseProcurementPrice.findUnique({
      where: {
        franchiseId_productId_variantId: {
          franchiseId,
          productId: dto.productId,
          variantId: dto.variantId ?? null,
        } as any,
      },
    });

    // Audit #8 — optimistic concurrency. Reject if the row moved since the
    // client read it (stale modal). The transactional version-CAS below also
    // catches two simultaneous writers that both read the same version.
    if (
      existing &&
      dto.expectedVersion !== undefined &&
      existing.version !== dto.expectedVersion
    ) {
      throw new ConflictAppException(
        'Procurement price changed since you loaded it. Reload and retry.',
      );
    }

    const action = existing ? 'UPSERT_UPDATE' : 'UPSERT_CREATE';
    const oldCost = existing ? existing.landedUnitCost : null;

    // Audit #4 — atomic write + append-only history row in one transaction.
    const row = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        const cas = await tx.franchiseProcurementPrice.updateMany({
          where: { id: existing.id, version: existing.version },
          data: {
            landedUnitCost: dto.landedUnitCost,
            notes: cleanNotes,
            updatedBy: adminId ?? null,
            version: { increment: 1 },
          },
        });
        if (cas.count === 0) {
          throw new ConflictAppException(
            'Procurement price changed concurrently. Reload and retry.',
          );
        }
      } else {
        await tx.franchiseProcurementPrice.create({
          data: {
            franchiseId,
            productId: dto.productId,
            variantId: dto.variantId ?? null,
            landedUnitCost: dto.landedUnitCost,
            notes: cleanNotes,
            createdBy: adminId ?? null,
            updatedBy: adminId ?? null,
          },
        });
      }
      await tx.franchiseProcurementPriceHistory.create({
        data: {
          franchiseId,
          productId: dto.productId,
          variantId: dto.variantId ?? null,
          action,
          oldLandedUnitCost: oldCost,
          newLandedUnitCost: dto.landedUnitCost,
          changeReason: dto.changeReason ?? null,
          changedByAdminId: adminId ?? null,
        },
      });
      return tx.franchiseProcurementPrice.findUnique({
        where: {
          franchiseId_productId_variantId: {
            franchiseId,
            productId: dto.productId,
            variantId: dto.variantId ?? null,
          } as any,
        },
      });
    });

    this.writeAudit({
      adminId,
      action: 'FRANCHISE_PROCUREMENT_PRICE_SET',
      resourceId: row?.id ?? franchiseId,
      oldValue: { landedUnitCost: oldCost?.toString() ?? null },
      newValue: { landedUnitCost: dto.landedUnitCost },
      metadata: {
        franchiseId,
        productId: dto.productId,
        variantId: dto.variantId ?? null,
        changeReason: dto.changeReason ?? null,
      },
      ipAddress,
      userAgent,
    });
    this.publishChanged(franchiseId, {
      productId: dto.productId,
      variantId: dto.variantId ?? null,
      action,
      oldLandedUnitCost: oldCost?.toString() ?? null,
      newLandedUnitCost: dto.landedUnitCost,
    });

    return {
      success: true,
      message: 'Procurement price saved',
      data: row,
    };
  }

  @Delete(':priceId')
  @Permissions('franchise.procurement_pricing')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Param('priceId') priceId: string,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const { ipAddress, userAgent } = this.requestMeta(req);

    const row = await this.prisma.franchiseProcurementPrice.findUnique({
      where: { id: priceId },
    });
    // Ownership check — deleting by id alone would let an admin with
    // scope limited to franchise A nuke franchise B's row if URL is
    // crafted. Cheap safeguard.
    if (!row || row.franchiseId !== franchiseId) {
      throw new NotFoundAppException('Procurement price not found');
    }

    // Audit #4 — delete + append-only history row atomically.
    await this.prisma.$transaction(async (tx) => {
      await tx.franchiseProcurementPrice.delete({ where: { id: priceId } });
      await tx.franchiseProcurementPriceHistory.create({
        data: {
          franchiseId,
          productId: row.productId,
          variantId: row.variantId,
          action: 'DELETE',
          oldLandedUnitCost: row.landedUnitCost,
          newLandedUnitCost: null,
          changedByAdminId: adminId ?? null,
        },
      });
    });

    this.writeAudit({
      adminId,
      action: 'FRANCHISE_PROCUREMENT_PRICE_REMOVED',
      resourceId: priceId,
      oldValue: { landedUnitCost: row.landedUnitCost.toString() },
      newValue: null,
      metadata: {
        franchiseId,
        productId: row.productId,
        variantId: row.variantId,
      },
      ipAddress,
      userAgent,
    });
    this.publishChanged(franchiseId, {
      productId: row.productId,
      variantId: row.variantId,
      action: 'DELETE',
      oldLandedUnitCost: row.landedUnitCost.toString(),
      newLandedUnitCost: null,
    });

    return { success: true, message: 'Procurement price removed' };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private requestMeta(req: Request): {
    ipAddress?: string;
    userAgent?: string;
  } {
    const ua = req.headers['user-agent'];
    return {
      ipAddress: req.ip || req.socket?.remoteAddress || undefined,
      userAgent: typeof ua === 'string' ? ua : undefined,
    };
  }

  private writeAudit(args: {
    adminId?: string;
    action: string;
    resourceId: string;
    oldValue: unknown;
    newValue: unknown;
    metadata: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }): void {
    this.audit
      .writeAuditLog({
        actorId: args.adminId ?? 'unknown',
        actorRole: 'ADMIN',
        action: args.action,
        module: 'franchise',
        resource: 'FranchiseProcurementPrice',
        resourceId: args.resourceId,
        oldValue: args.oldValue,
        newValue: args.newValue,
        metadata: args.metadata,
        ipAddress: args.ipAddress,
        userAgent: args.userAgent,
      })
      .catch(() => undefined);
  }

  private publishChanged(
    franchiseId: string,
    payload: Record<string, unknown>,
  ): void {
    this.eventBus
      .publish({
        eventName: 'franchise.procurement_pricing_changed',
        aggregate: 'franchise',
        aggregateId: franchiseId,
        occurredAt: new Date(),
        payload: { franchiseId, ...payload },
      })
      .catch(() => undefined);
  }
}
