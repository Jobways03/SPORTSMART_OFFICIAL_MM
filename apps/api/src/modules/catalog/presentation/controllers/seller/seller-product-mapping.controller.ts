import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AppLoggerService } from '../../../../../bootstrap/logging/app-logger.service';
import { RedisService } from '../../../../../bootstrap/cache/redis.service';
import { EventBusService } from '../../../../../bootstrap/events/event-bus.service';
import {
  NotFoundAppException,
  BadRequestAppException,
  ForbiddenAppException,
  ConflictAppException,
} from '../../../../../core/exceptions';
import { SellerAuthGuard } from '../../../../../core/guards';
import { Idempotent } from '../../../../../core/decorators/idempotent.decorator';
import {
  SELLER_MAPPING_REPOSITORY,
  ISellerMappingRepository,
} from '../../../domain/repositories/seller-mapping.repository.interface';
import {
  STOREFRONT_REPOSITORY,
  IStorefrontRepository,
} from '../../../domain/repositories/storefront.repository.interface';
import { StockSyncService } from '../../../application/services/stock-sync.service';
import { CatalogCacheService } from '../../../application/services/catalog-cache.service';
import { StockMovementLedgerService } from '../../../../inventory/application/services/stock-movement-ledger.service';
import { AuditPublicFacade } from '../../../../audit/application/facades/audit-public.facade';
import { StockBelowReservedError } from '../../../domain/errors/stock-below-reserved.error';
import {
  BulkStockUpdateDto,
  MapProductDto,
  SellerPauseMappingDto,
  SellerPauseProductDto,
  UpdateMappingDto,
} from './dtos/seller-mapping.dto';

/**
 * Phase 51 (2026-05-21) — seller stock-entry controller hardened.
 *
 * Changes vs. pre-Phase-51:
 *   - DTOs are class-validator-backed (no more inline TS interfaces)
 *   - Single batched ownership query replaces N+1 findById loop
 *   - Every successful single + bulk stock update writes a
 *     MANUAL_ADJUST StockMovement ledger row (the largest forensic
 *     gap pre-Phase-51)
 *   - deleteMapping refuses when reservedQty > 0 and soft-deletes via
 *     deletedAt (preserves ledger trail)
 *   - bulk endpoint now also accepts lowStockThreshold per row
 *   - createMapping accepts lowStockThreshold inline (no second PATCH)
 *   - @Idempotent() on the bulk update so a retried CSV import
 *     doesn't double-fire variant-sync side effects
 *   - Auto-repair gated by per-seller 5-minute Redis lock so the
 *     my-products endpoint stops paying N read-queries on every hit
 *   - Catches Prisma P2010 (CHECK constraint) on single update and
 *     translates to a clean 400 with the offending reservedQty
 */
const AUTO_REPAIR_LOCK_PREFIX = 'seller-mapping:auto-repair:v1:';
const AUTO_REPAIR_LOCK_TTL_SECONDS = 300;

@ApiTags('Seller Catalog')
@Controller('seller/catalog')
@UseGuards(SellerAuthGuard)
export class SellerProductMappingController {
  constructor(
    @Inject(SELLER_MAPPING_REPOSITORY) private readonly sellerMappingRepo: ISellerMappingRepository,
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
    private readonly logger: AppLoggerService,
    private readonly stockSyncService: StockSyncService,
    private readonly stockLedger: StockMovementLedgerService,
    private readonly redis: RedisService,
    // Phase 58 (2026-05-22) — audit + event + cache wiring for the
    // new /mapping/:id/pause endpoint (audit Gaps #3 + #9). Symmetric
    // with admin-side approve/reject/stop side effects.
    private readonly audit: AuditPublicFacade,
    private readonly eventBus: EventBusService,
    private readonly catalogCache: CatalogCacheService,
  ) {
    this.logger.setContext('SellerProductMappingController');
  }

  // ─── Browse master product catalog ────────────────────────────────

  @Get('browse')
  @HttpCode(HttpStatus.OK)
  async browseCatalog(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
  ) {
    const sellerId = (req as any).sellerId;
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const { products, total } = await this.storefrontRepo.findBrowsableProducts(
      sellerId, pageNum, limitNum, search, categoryId, brandId,
    );

    const mapped = products.map((p: any) => ({
      id: p.id,
      productCode: p.productCode,
      title: p.title,
      slug: p.slug,
      hasVariants: p.hasVariants,
      basePrice: p.basePrice,
      categoryName: p.category?.name ?? null,
      categoryId: p.category?.id ?? null,
      brandName: p.brand?.name ?? null,
      brandId: p.brand?.id ?? null,
      primaryImageUrl: p.images?.[0]?.url ?? null,
      variantCount: p._count?.variants ?? 0,
    }));

    return {
      success: true,
      message: 'Catalog products retrieved successfully',
      data: {
        products: mapped,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  // ─── Map self to a product ────────────────────────────────────────

  @Post('map')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent()
  async mapProduct(@Req() req: Request, @Body() dto: MapProductDto) {
    const sellerId = (req as any).sellerId;

    const product = await this.sellerMappingRepo.findProductForMapping(dto.productId);
    if (!product || product.isDeleted) {
      throw new NotFoundAppException('Product not found');
    }
    if (product.status !== 'ACTIVE') {
      throw new BadRequestAppException(
        'Only ACTIVE products can be mapped. Current status: ' + product.status,
      );
    }

    if (dto.variantId) {
      const variant = await this.sellerMappingRepo.findVariantForMapping(
        dto.variantId,
        dto.productId,
      );
      if (!variant) {
        throw new NotFoundAppException(
          'Variant not found or does not belong to this product',
        );
      }
    }

    // Auto-lookup coordinates from PostOffice if pincode provided but
    // no explicit coords given.
    let resolvedLat = dto.latitude ?? null;
    let resolvedLon = dto.longitude ?? null;
    if (dto.pickupPincode && (resolvedLat == null || resolvedLon == null)) {
      const postOffice = await this.sellerMappingRepo.findPostOfficeByPincode(dto.pickupPincode);
      if (postOffice?.latitude && postOffice?.longitude) {
        resolvedLat = Number(postOffice.latitude);
        resolvedLon = Number(postOffice.longitude);
      }
    }

    const baseMappingData = {
      sellerId,
      productId: dto.productId,
      stockQty: dto.stockQty,
      ...(dto.lowStockThreshold !== undefined ? { lowStockThreshold: dto.lowStockThreshold } : {}),
      settlementPrice: dto.settlementPrice,
      procurementCost: dto.procurementCost,
      sellerInternalSku: dto.sellerInternalSku,
      pickupAddress: dto.pickupAddress,
      pickupPincode: dto.pickupPincode,
      latitude: resolvedLat,
      longitude: resolvedLon,
      dispatchSla: dto.dispatchSla ?? 2,
      approvalStatus: 'PENDING_APPROVAL' as const,
      isActive: false,
    };

    if (product.hasVariants && !dto.variantId) {
      if (product.variants.length === 0) {
        throw new BadRequestAppException(
          'Product is marked as having variants but has no active variants',
        );
      }

      const existingMappings = await this.sellerMappingRepo.findBySellerForProduct(sellerId, dto.productId);
      const existingVariantIds = new Set(existingMappings.map((m: any) => m.variantId));
      const variantsToMap = product.variants.filter(
        (v: any) => !existingVariantIds.has(v.id),
      );

      if (variantsToMap.length === 0) {
        throw new ConflictAppException(
          'You have already mapped all variants of this product',
        );
      }

      // Phase 56 (2026-05-22) — catch P2002 race. The window between
      // findBySellerForProduct and createMany lets two concurrent
      // mapProduct calls each see the same "missing variants" set
      // and both attempt the insert. The @@unique constraint catches
      // the second one with P2002; pre-Phase-56 that surfaced as 500.
      let createdMappings;
      try {
        createdMappings = await this.sellerMappingRepo.createMany(
          variantsToMap.map((variant: any) => ({
            ...baseMappingData,
            variantId: variant.id,
          })),
        );
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new ConflictAppException(
            'A concurrent request mapped some of these variants — refresh and retry',
          );
        }
        throw err;
      }

      // Phase 51 — INITIAL ledger entry per mapping so the trail
      // starts at the row's birth.
      for (const m of createdMappings) {
        await this.stockLedger.record({
          resource: 'SellerProductMapping',
          resourceId: m.id,
          kind: 'INITIAL',
          quantityDelta: m.stockQty ?? 0,
          beforeStockQty: 0,
          afterStockQty: m.stockQty ?? 0,
          reason: 'Initial mapping create (variant fan-out)',
          referenceType: 'SELLER_MAP',
          referenceId: m.id,
          actorId: sellerId,
          actorRole: 'SELLER',
        });
      }

      this.logger.log(
        `Seller ${sellerId} mapped to product ${dto.productId} — ${createdMappings.length} variant mapping(s) created`,
      );

      return {
        success: true,
        message: `Mapped to ${createdMappings.length} variant(s) successfully`,
        data: createdMappings,
      };
    }

    const variantId = dto.variantId || null;
    const existing = await this.sellerMappingRepo.findBySellerAndProduct(sellerId, dto.productId, variantId);
    if (existing && !existing.deletedAt) {
      throw new ConflictAppException(
        'You have already mapped to this product' + (variantId ? ' variant' : ''),
      );
    }

    const mapping = await this.sellerMappingRepo.create({
      ...baseMappingData,
      variantId,
    });

    await this.stockLedger.record({
      resource: 'SellerProductMapping',
      resourceId: mapping.id,
      kind: 'INITIAL',
      quantityDelta: dto.stockQty,
      beforeStockQty: 0,
      afterStockQty: dto.stockQty,
      reason: 'Initial mapping create',
      referenceType: 'SELLER_MAP',
      referenceId: mapping.id,
      actorId: sellerId,
      actorRole: 'SELLER',
    });

    this.logger.log(
      `Seller ${sellerId} mapped to product ${dto.productId}${variantId ? ` variant ${variantId}` : ''}`,
    );

    return {
      success: true,
      message: 'Product mapped successfully',
      data: mapping,
    };
  }

  // ─── Resubmit a rejected mapping ─────────────────────────────────

  /**
   * Phase 56 (2026-05-22) — seller-driven resubmit (audit Gap #11).
   *
   * Once admin REJECTS a mapping, the @@unique([sellerId, productId,
   * variantId]) constraint blocks the seller from creating a NEW
   * row for the same (product, variant). Pre-Phase-56 their only
   * option was to delete-and-recreate. This endpoint flips the
   * existing REJECTED row back to PENDING_APPROVAL so the admin
   * queue re-picks it up. Ownership is verified against the JWT.
   * rejectedBy/At/Reason are kept on the row so the admin reviewer
   * can see the previous rejection while re-evaluating.
   */
  @Post('mapping/:mappingId/resubmit')
  @HttpCode(HttpStatus.OK)
  async resubmitMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
  ) {
    const sellerId = (req as any).sellerId;
    const existing = await this.sellerMappingRepo.findById(mappingId);
    if (!existing || existing.deletedAt) {
      throw new NotFoundAppException('Mapping not found');
    }
    if (existing.sellerId !== sellerId) {
      throw new ForbiddenAppException(
        'You do not have permission to resubmit this mapping',
      );
    }
    if (existing.approvalStatus !== 'REJECTED') {
      throw new BadRequestAppException(
        `Only REJECTED mappings can be resubmitted (current status: ${existing.approvalStatus})`,
      );
    }
    const updated = await this.sellerMappingRepo.resubmit(mappingId);
    this.logger.log(`Mapping ${mappingId} resubmitted by seller ${sellerId}`);
    return {
      success: true,
      message: 'Mapping resubmitted for approval',
      data: updated,
    };
  }

  // ─── Seller-pause endpoint ───────────────────────────────────────

  /**
   * Phase 58 (2026-05-22) — POST /seller/catalog/mapping/:id/pause
   *
   * Seller-initiated pause of an APPROVED mapping. Pre-Phase-58 the
   * seller PATCH endpoint accepted `isActive: false` and silently
   * left `approvalStatus=APPROVED`, then PATCH `isActive: true`
   * re-enabled it with no admin gate. The audit (Gaps #3 + #9)
   * flagged that as both asymmetric with admin /stop and a way to
   * bypass the lifecycle.
   *
   * The pause endpoint reuses the same status-conditional repo.stop
   * call as admin /stop (APPROVED-only), stamps stoppedBy with the
   * seller's id (so the audit log distinguishes seller-pause from
   * admin-stop via actorRole), releases any active reservations on
   * the row, fires the same cart-update event, and invalidates the
   * storefront cache. Re-activation requires admin /reapprove.
   */
  @Post('mapping/:mappingId/pause')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  async pauseMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Body() dto: SellerPauseMappingDto,
  ) {
    const sellerId = (req as any).sellerId;
    const existing = await this.sellerMappingRepo.findById(mappingId);
    if (!existing || existing.deletedAt) {
      throw new NotFoundAppException('Mapping not found');
    }
    if (existing.sellerId !== sellerId) {
      throw new ForbiddenAppException(
        'You do not have permission to pause this mapping',
      );
    }
    const res = await this.pauseOneMapping(existing, sellerId, dto.reason);
    if (!res) {
      throw new BadRequestAppException(
        `Cannot pause — mapping is in ${existing.approvalStatus} status. Only APPROVED mappings can be paused.`,
      );
    }
    this.catalogCache.invalidateProductLists().catch(() => {});
    this.logger.log(
      `Mapping ${mappingId} paused by seller ${sellerId} — reason="${dto.reason}" (${res.releasedCount} reservation(s) released)`,
    );
    return {
      success: true,
      message: 'Mapping paused successfully',
      data: { ...res.updated, releasedReservations: res.releasedCount },
    };
  }

  // 2026-06-15 — extracted per-mapping pause so the single-mapping pause and
  // the product-scoped "pause all my offers" (My Products) share one path.
  // Stops the mapping (APPROVED→STOPPED, stoppedBy=seller via repo.stop),
  // releases its active reservations (+ledger +events), writes the audit row.
  // Returns null when the mapping wasn't APPROVED (nothing to pause).
  private async pauseOneMapping(
    existing: any,
    sellerId: string,
    reason: string,
  ): Promise<{ updated: any; releasedCount: number } | null> {
    const mappingId = existing.id;
    // repo.stop is APPROVED-only (Phase 58 Gap #13) — one entry path to STOPPED.
    const updated = await this.sellerMappingRepo.stop(
      mappingId,
      sellerId,
      `[SellerPause] ${reason}`,
    );
    if (!updated) return null;

    // Release active reservations on this now-stopped mapping (Gap #8).
    let releasedCount = 0;
    try {
      const released = await this.sellerMappingRepo.releaseActiveReservationsForMapping(mappingId);
      releasedCount = released.length;
      for (const r of released) {
        try {
          await this.stockLedger.record({
            resource: 'SellerProductMapping',
            resourceId: mappingId,
            kind: 'RELEASED',
            quantityDelta: r.quantity,
            beforeStockQty: r.stockQty,
            afterStockQty: r.stockQty,
            beforeReservedQty: r.beforeReservedQty,
            afterReservedQty: r.afterReservedQty,
            reason: 'Seller paused mapping — reservation released',
            referenceType: 'MAPPING_STOPPED',
            referenceId: r.reservationId,
            actorId: sellerId,
            actorRole: 'SELLER',
          });
        } catch (err) {
          this.logger.warn(
            `Ledger write failed for released reservation ${r.reservationId}: ${(err as Error).message}`,
          );
        }
        this.eventBus
          .publish({
            eventName: 'inventory.reservation.released',
            aggregate: 'StockReservation',
            aggregateId: r.reservationId,
            occurredAt: new Date(),
            payload: {
              reservationId: r.reservationId,
              mappingId,
              quantity: r.quantity,
              orderId: r.orderId,
              customerId: r.customerId,
              sessionId: r.sessionId,
              cartId: r.cartId,
              cause: 'MAPPING_STOPPED',
              sellerId,
            },
          })
          .catch(() => {});
      }
    } catch (err) {
      this.logger.warn(
        `Failed to release reservations for paused mapping ${mappingId}: ${(err as Error).message}`,
      );
    }

    // Audit log — actorRole='SELLER' so a forensic query can
    // distinguish seller-pause from admin-stop on the same column.
    try {
      await this.audit.writeAuditLog({
        actorId: sellerId,
        actorRole: 'SELLER',
        action: 'MAPPING_STOPPED',
        module: 'catalog',
        resource: 'SellerProductMapping',
        resourceId: mappingId,
        oldValue: { approvalStatus: existing.approvalStatus, isActive: existing.isActive },
        newValue: { approvalStatus: 'STOPPED', isActive: false },
        metadata: {
          productId: existing.productId,
          variantId: existing.variantId,
          sellerId,
          reason,
          initiator: 'SELLER',
          releasedReservations: releasedCount,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Audit write failed for seller pause on ${mappingId}: ${(err as Error).message}`,
      );
    }

    this.eventBus
      .publish({
        eventName: 'catalog.seller_mapping.stopped',
        aggregate: 'SellerProductMapping',
        aggregateId: mappingId,
        occurredAt: new Date(),
        payload: {
          mappingId,
          sellerId,
          productId: existing.productId,
          variantId: existing.variantId,
          oldStatus: existing.approvalStatus,
          newStatus: 'STOPPED',
          reason,
          initiator: 'SELLER',
        },
      })
      .catch(() => {});

    return { updated, releasedCount };
  }

  // 2026-06-15 — seller resumes their OWN paused offer (STOPPED-by-seller →
  // APPROVED+active via the stoppedBy-guarded repo method). Returns the
  // updated row, or null when it wasn't a self-paused mapping (e.g. an admin
  // STOP/SUSPEND, which only an admin can lift).
  private async resumeOneMapping(existing: any, sellerId: string): Promise<any | null> {
    const updated = await this.sellerMappingRepo.resumeBySeller(existing.id, sellerId);
    if (!updated) return null;
    try {
      await this.audit.writeAuditLog({
        actorId: sellerId,
        actorRole: 'SELLER',
        action: 'MAPPING_REAPPROVED',
        module: 'catalog',
        resource: 'SellerProductMapping',
        resourceId: existing.id,
        oldValue: { approvalStatus: existing.approvalStatus, isActive: existing.isActive },
        newValue: { approvalStatus: 'APPROVED', isActive: true },
        metadata: {
          productId: existing.productId,
          variantId: existing.variantId,
          sellerId,
          initiator: 'SELLER',
        },
      });
    } catch (err) {
      this.logger.warn(
        `Audit write failed for seller resume on ${existing.id}: ${(err as Error).message}`,
      );
    }
    this.eventBus
      .publish({
        eventName: 'catalog.seller_mapping.resumed',
        aggregate: 'SellerProductMapping',
        aggregateId: existing.id,
        occurredAt: new Date(),
        payload: {
          mappingId: existing.id,
          sellerId,
          productId: existing.productId,
          variantId: existing.variantId,
          oldStatus: existing.approvalStatus,
          newStatus: 'APPROVED',
          initiator: 'SELLER',
        },
      })
      .catch(() => {});
    return updated;
  }

  // 2026-06-15 — "Pause sales" from My Products: pause ALL of this seller's
  // APPROVED offers (all variants) for one product. Only this seller's
  // mappings change — other sellers keep selling and the shared product stays
  // live. Does NOT touch Product.status (that would hide it for everyone).
  @Post('product/:productId/pause-sales')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  async pauseSalesForProduct(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Body() dto: SellerPauseProductDto,
  ) {
    const sellerId = (req as any).sellerId;
    const reason = dto?.reason?.trim() || 'Paused from My Products';
    const offers = await this.sellerMappingRepo.findSellerOffersForProduct(sellerId, productId);
    const approved = offers.filter((m) => m.approvalStatus === 'APPROVED');
    if (approved.length === 0) {
      throw new BadRequestAppException('No active offer to pause for this product.');
    }
    const pausedMappingIds: string[] = [];
    let releasedReservations = 0;
    for (const m of approved) {
      const res = await this.pauseOneMapping(m, sellerId, reason);
      if (res) {
        pausedMappingIds.push(m.id);
        releasedReservations += res.releasedCount;
      }
    }
    this.catalogCache.invalidateProductLists().catch(() => {});
    this.logger.log(
      `Seller ${sellerId} paused sales for product ${productId} — ${pausedMappingIds.length} offer(s), ${releasedReservations} reservation(s) released`,
    );
    return {
      success: true,
      message: 'Your sales are paused for this product',
      data: { productId, pausedMappingIds, releasedReservations },
    };
  }

  // 2026-06-15 — "Resume sales" from My Products: resume this seller's OWN
  // paused offers for a product. Guarded so it only lifts seller self-pauses,
  // never an admin STOP/SUSPEND.
  @Post('product/:productId/resume-sales')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  async resumeSalesForProduct(
    @Req() req: Request,
    @Param('productId') productId: string,
  ) {
    const sellerId = (req as any).sellerId;
    const offers = await this.sellerMappingRepo.findSellerOffersForProduct(sellerId, productId);
    const selfPaused = offers.filter(
      (m) => m.approvalStatus === 'STOPPED' && m.stoppedBy === sellerId,
    );
    if (selfPaused.length === 0) {
      throw new BadRequestAppException('No paused offer to resume for this product.');
    }
    const resumedMappingIds: string[] = [];
    for (const m of selfPaused) {
      const updated = await this.resumeOneMapping(m, sellerId);
      if (updated) resumedMappingIds.push(m.id);
    }
    this.catalogCache.invalidateProductLists().catch(() => {});
    this.logger.log(
      `Seller ${sellerId} resumed sales for product ${productId} — ${resumedMappingIds.length} offer(s)`,
    );
    return {
      success: true,
      message: 'Your sales are live again for this product',
      data: { productId, resumedMappingIds },
    };
  }

  // ─── My mapped products ──────────────────────────────────────────

  @Get('my-products')
  @HttpCode(HttpStatus.OK)
  async myProducts(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const sellerId = (req as any).sellerId;
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    // Phase 51 — auto-repair gated by a per-seller 5-minute Redis
    // lock. Pre-Phase-51 this ran on every my-products call (N read
    // queries per page hit), wasted on the steady state where
    // mappings are already healthy.
    await this.maybeAutoRepair(sellerId);

    const { products, total } = await this.sellerMappingRepo.findMyProductsPaginated(
      sellerId, pageNum, limitNum, search,
    );

    const mapped = products.map((p: any) => {
      // 2026-06-15 — derive this seller's product-level offer state for the My
      // Products Pause/Resume toggle. SELLING = a live offer; PAUSED = the seller
      // self-paused (stoppedBy=self, so an admin STOP resolves to NONE — no dead
      // Resume CTA); NONE = nothing to pause/resume.
      const liveMaps = (p.sellerMappings ?? []).filter((m: any) => !m.deletedAt);
      const selling = liveMaps.some(
        (m: any) => m.approvalStatus === 'APPROVED' && m.isActive,
      );
      const selfPaused = liveMaps.some(
        (m: any) => m.approvalStatus === 'STOPPED' && m.stoppedBy === sellerId,
      );
      return {
      id: p.id,
      productCode: p.productCode,
      title: p.title,
      slug: p.slug,
      hasVariants: p.hasVariants,
      basePrice: p.basePrice,
      status: p.status,
      categoryName: p.category?.name ?? null,
      brandName: p.brand?.name ?? null,
      primaryImageUrl: p.images?.[0]?.url ?? null,
      hsnCode: p.hsnCode ?? null,
      gstRateBps: p.gstRateBps ?? 0,
      defaultUqcCode: p.defaultUqcCode ?? null,
      sellerOfferState: (selling ? 'SELLING' : selfPaused ? 'PAUSED' : 'NONE'),
      // Phase 51 — exclude soft-deleted mappings from the seller's
      // own product list.
      mappings: liveMaps
        .map((m: any) => ({
          id: m.id,
          variantId: m.variantId,
          variantSku: m.variant?.sku ?? null,
          variantPrice: m.variant?.price ?? null,
          variantOptions: m.variant?.optionValues?.map((ov: any) => ({
            option: ov.optionValue?.optionDefinition?.name,
            value: ov.optionValue?.value,
          })) ?? [],
          stockQty: m.stockQty,
          reservedQty: m.reservedQty,
          sellerInternalSku: m.sellerInternalSku,
          settlementPrice: m.settlementPrice,
          procurementCost: m.procurementCost,
          pickupAddress: m.pickupAddress,
          pickupPincode: m.pickupPincode,
          dispatchSla: m.dispatchSla,
          isActive: m.isActive,
          approvalStatus: m.approvalStatus,
          operationalPriority: m.operationalPriority,
          lowStockThreshold: m.lowStockThreshold,
          createdAt: m.createdAt,
        })),
      };
    });

    return {
      success: true,
      message: 'My mapped products retrieved successfully',
      data: {
        products: mapped,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  // ─── Bulk stock update ─────────────────────────────────────────────

  @Patch('mapping/bulk-stock')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  async bulkStockUpdate(@Req() req: Request, @Body() dto: BulkStockUpdateDto) {
    const sellerId = (req as any).sellerId;

    const mappingIds = dto.updates.map((u) => u.mappingId);

    // Phase 51 — single-query ownership verification. Pre-Phase-51
    // this was N findById calls (one round-trip per mapping).
    const owned = await this.sellerMappingRepo.findManyByIdsForSeller(mappingIds, sellerId);
    if (owned.length !== mappingIds.length) {
      const ownedIds = new Set(owned.map((m) => m.id));
      const missing = mappingIds.filter((id) => !ownedIds.has(id));
      throw new ForbiddenAppException(
        `Some mappings are not yours or do not exist: ${missing.join(', ')}`,
      );
    }
    const liveOwned = owned.filter((m) => !m.deletedAt);
    if (liveOwned.length !== owned.length) {
      throw new BadRequestAppException(
        'Some mappings have been deleted — refresh and retry',
      );
    }

    // Phase 51 — bulkUpdateStockWithBefore returns per-row before/after
    // so we can write a MANUAL_ADJUST ledger entry per mapping.
    let result: Awaited<ReturnType<typeof this.sellerMappingRepo.bulkUpdateStockWithBefore>>;
    try {
      result = await this.sellerMappingRepo.bulkUpdateStockWithBefore(dto.updates);
    } catch (err) {
      if (err instanceof StockBelowReservedError) {
        const lines = err.violations
          .map(
            (v) =>
              `mapping ${v.mappingId}: requested ${v.requestedStock}, reserved ${v.reservedQty}`,
          )
          .join('; ');
        throw new BadRequestAppException(
          `Bulk stock update rejected — ${err.violations.length} row(s) below reserved stock: ${lines}`,
        );
      }
      throw err;
    }

    // Phase 51 — ledger writes (Gap #1).
    for (const u of result.updated) {
      if (u.beforeStockQty === u.afterStockQty) continue; // no-op rows skipped
      await this.stockLedger.record({
        resource: 'SellerProductMapping',
        resourceId: u.id,
        kind: 'MANUAL_ADJUST',
        quantityDelta: Math.abs(u.afterStockQty - u.beforeStockQty),
        beforeStockQty: u.beforeStockQty,
        afterStockQty: u.afterStockQty,
        beforeReservedQty: u.reservedQty,
        afterReservedQty: u.reservedQty,
        reason: 'Seller bulk stock update',
        referenceType: 'SELLER_BULK_UPDATE',
        referenceId: u.id,
        actorId: sellerId,
        actorRole: 'SELLER',
      });
    }

    // Phase 51 — variant-sync deduplicated by (productId, variantId)
    // from the result set itself (no extra fetch round-trips, vs
    // pre-Phase-51 which did N findById calls inside the sync loop).
    const synced = new Set<string>();
    for (const u of result.updated) {
      const key = `${u.productId}:${u.variantId ?? 'null'}`;
      if (!synced.has(key)) {
        synced.add(key);
        await this.stockSyncService.syncVariantStockFromMappings(u.productId, u.variantId);
      }
    }

    this.logger.log(
      `Bulk stock update: ${result.updated.length} mappings updated by seller ${sellerId}`,
    );

    return {
      success: true,
      message: `${result.updated.length} mapping(s) stock updated successfully`,
      data: result.updated.map((u) => ({
        id: u.id,
        productId: u.productId,
        variantId: u.variantId,
        stockQty: u.afterStockQty,
      })),
    };
  }

  // ─── Update a mapping ─────────────────────────────────────────────

  /**
   * Phase 51 polish (2026-05-21) — updates now run through the
   * repository's row-locked path so the floor check is atomic with
   * the write. The legacy pre-check + P2010-catch path is replaced
   * by a typed FLOOR_VIOLATION thrown from inside the SELECT FOR
   * UPDATE transaction; a concurrent reservation that bumps
   * reservedQty either commits before our lock acquires (and we see
   * the new reservedQty) or waits for our update to commit (its
   * later FOR UPDATE serializes after ours).
   */
  @Patch('mapping/:mappingId')
  @HttpCode(HttpStatus.OK)
  async updateMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Body() dto: UpdateMappingDto,
  ) {
    const sellerId = (req as any).sellerId;

    // Resolve pickup coordinates from PostOffice OUTSIDE the lock —
    // it's a read-only lookup against an unrelated table and adds
    // network latency we don't need to hold the row lock for.
    let resolvedLat = dto.latitude;
    let resolvedLon = dto.longitude;
    let pincodeNeedsCoordReset = false;
    if (dto.pickupPincode !== undefined) {
      // We don't know the previous pincode here (we're skipping the
      // upfront findById). Always re-resolve when a pickupPincode is
      // supplied AND coords were not explicitly given.
      if (dto.latitude === undefined && dto.longitude === undefined) {
        const postOffice = await this.sellerMappingRepo.findPostOfficeByPincode(dto.pickupPincode);
        if (postOffice?.latitude && postOffice?.longitude) {
          resolvedLat = Number(postOffice.latitude);
          resolvedLon = Number(postOffice.longitude);
        } else {
          pincodeNeedsCoordReset = true;
        }
      }
    }

    const updateData: Record<string, unknown> = {};
    if (dto.stockQty !== undefined) updateData.stockQty = dto.stockQty;
    if (dto.sellerInternalSku !== undefined) updateData.sellerInternalSku = dto.sellerInternalSku;
    if (dto.settlementPrice !== undefined) updateData.settlementPrice = dto.settlementPrice;
    if (dto.procurementCost !== undefined) updateData.procurementCost = dto.procurementCost;
    if (dto.pickupAddress !== undefined) updateData.pickupAddress = dto.pickupAddress;
    if (dto.pickupPincode !== undefined) updateData.pickupPincode = dto.pickupPincode;
    if (resolvedLat !== undefined) updateData.latitude = resolvedLat;
    if (resolvedLon !== undefined) updateData.longitude = resolvedLon;
    if (pincodeNeedsCoordReset) {
      updateData.latitude = null;
      updateData.longitude = null;
    }
    if (dto.dispatchSla !== undefined) updateData.dispatchSla = dto.dispatchSla;
    // Phase 58 (2026-05-22) — isActive intentionally NOT copied here
    // (audit Gaps #3 + #9). Sellers go through POST
    // /mapping/:id/pause for an explicit STOPPED transition; admin
    // /reapprove is required to lift the pause.
    if (dto.lowStockThreshold !== undefined) updateData.lowStockThreshold = dto.lowStockThreshold;

    let result;
    try {
      result = await this.sellerMappingRepo.updateWithRowLock(mappingId, sellerId, updateData);
    } catch (err: any) {
      if (err?.code === 'NOT_FOUND') throw new NotFoundAppException('Mapping not found');
      if (err?.code === 'FORBIDDEN') {
        throw new ForbiddenAppException('You do not have permission to update this mapping');
      }
      if (err?.code === 'FLOOR_VIOLATION') {
        throw new BadRequestAppException(
          `stockQty (${err.requestedStock}) cannot be less than reservedQty (${err.reservedQty}) — ${err.reservedQty} unit(s) are committed to in-flight orders`,
        );
      }
      // Defense-in-depth: the DB CHECK constraint can still fire if
      // another writer bypasses the lock (raw SQL or schema-level
      // tooling). P2010 → 409.
      const msg = err?.message ?? '';
      if (
        err?.code === 'P2010' ||
        (typeof msg === 'string' &&
          (msg.includes('reserved_qty') || msg.includes('stock_qty')))
      ) {
        throw new ConflictAppException(
          'Stock change conflicts with a concurrent reservation — please retry',
        );
      }
      throw err;
    }

    if (dto.stockQty !== undefined && result.before.stockQty !== result.after.stockQty) {
      await this.stockLedger.record({
        resource: 'SellerProductMapping',
        resourceId: mappingId,
        kind: 'MANUAL_ADJUST',
        quantityDelta: Math.abs(result.after.stockQty - result.before.stockQty),
        beforeStockQty: result.before.stockQty,
        afterStockQty: result.after.stockQty,
        beforeReservedQty: result.before.reservedQty,
        afterReservedQty: result.after.reservedQty,
        reason: 'Seller stock update',
        referenceType: 'SELLER_UPDATE',
        referenceId: mappingId,
        actorId: sellerId,
        actorRole: 'SELLER',
      });
    }

    if (dto.stockQty !== undefined) {
      await this.stockSyncService.syncVariantStockFromMappings(
        result.row.productId,
        result.row.variantId,
      );
    }

    this.logger.log(`Mapping ${mappingId} updated by seller ${sellerId}`);

    return {
      success: true,
      message: 'Mapping updated successfully',
      data: result.row,
    };
  }

  // ─── Stock movement history ──────────────────────────────────────

  /**
   * Phase 51 polish (2026-05-21) — seller-facing audit trail. Lets a
   * seller answer "why did my stock for this SKU change from 100 to
   * 50 on Aug 5" without filing a support ticket. Ownership is
   * verified before any ledger rows are returned.
   */
  @Get('mapping/:mappingId/history')
  @HttpCode(HttpStatus.OK)
  async stockHistory(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const sellerId = (req as any).sellerId;
    const existing = await this.sellerMappingRepo.findById(mappingId);
    if (!existing) throw new NotFoundAppException('Mapping not found');
    if (existing.sellerId !== sellerId) {
      throw new ForbiddenAppException('You do not have permission to view this mapping');
    }
    const movements = await this.sellerMappingRepo.listStockMovementsForMapping(mappingId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return {
      success: true,
      message: 'Stock movement history',
      data: movements,
    };
  }

  // ─── Delete a mapping ─────────────────────────────────────────────

  @Delete('mapping/:mappingId')
  @HttpCode(HttpStatus.OK)
  async deleteMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
  ) {
    const sellerId = (req as any).sellerId;

    const existing = await this.sellerMappingRepo.findById(mappingId);

    if (!existing || existing.deletedAt) {
      throw new NotFoundAppException('Mapping not found');
    }

    if (existing.sellerId !== sellerId) {
      throw new ForbiddenAppException(
        'You do not have permission to delete this mapping',
      );
    }

    // Phase 51 — block delete when units are reserved for in-flight
    // orders. Pre-Phase-51 the hard delete cascaded to StockMovement,
    // and a delete with reservedQty>0 silently dropped the order's
    // reference rows.
    if ((existing.reservedQty ?? 0) > 0) {
      throw new ConflictAppException(
        `Cannot delete mapping with ${existing.reservedQty} reserved unit(s) — wait for in-flight orders to resolve`,
      );
    }

    await this.sellerMappingRepo.softDelete(mappingId);

    await this.stockLedger.record({
      resource: 'SellerProductMapping',
      resourceId: mappingId,
      kind: 'MANUAL_ADJUST',
      quantityDelta: existing.stockQty ?? 0,
      beforeStockQty: existing.stockQty ?? 0,
      afterStockQty: 0,
      beforeReservedQty: existing.reservedQty ?? 0,
      afterReservedQty: existing.reservedQty ?? 0,
      reason: 'Seller deleted mapping',
      referenceType: 'SELLER_DELETE',
      referenceId: mappingId,
      actorId: sellerId,
      actorRole: 'SELLER',
    });

    this.logger.log(`Mapping ${mappingId} soft-deleted by seller ${sellerId}`);

    return {
      success: true,
      message: 'Mapping deleted successfully',
      data: null,
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────

  /**
   * Phase 51 — gate the per-call auto-repair behind a 5-minute Redis
   * lock per seller. The repair is presumed idempotent; running it
   * on every my-products fetch was wasted DB work in the steady
   * state. We still trap-and-log any failure so a Redis outage
   * degrades to the pre-Phase-51 behaviour rather than breaking the
   * list endpoint.
   */
  private async maybeAutoRepair(sellerId: string): Promise<void> {
    try {
      const acquired = await this.redis.acquireLock(
        `${AUTO_REPAIR_LOCK_PREFIX}${sellerId}`,
        AUTO_REPAIR_LOCK_TTL_SECONDS,
      );
      if (!acquired) return;
      const repaired = await this.sellerMappingRepo.autoRepairMissingMappingsForSeller(sellerId);
      if (repaired > 0) {
        this.logger.log(
          `Auto-repaired ${repaired} missing mapping(s) for seller ${sellerId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to auto-repair mappings for seller ${sellerId}: ${err}`,
      );
    }
  }
}
