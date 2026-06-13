import {
  Body,
  Controller,
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
import { EventBusService } from '../../../../../bootstrap/events/event-bus.service';
import { RedisService } from '../../../../../bootstrap/cache/redis.service';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../../core/exceptions';
import {
  AdminAuthGuard,
  PermissionsGuard,
  AdminMappingSellerScopeGuard,
  AdminProductSellerScopeGuard,
} from '../../../../../core/guards';
import {
  resolveSellerScope,
  scopeAllowsType,
} from '../../../../../core/authorization/seller-scope';
import { Permissions } from '../../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../../core/decorators/idempotent.decorator';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../../domain/repositories/product.repository.interface';
import { SELLER_MAPPING_REPOSITORY, ISellerMappingRepository } from '../../../domain/repositories/seller-mapping.repository.interface';
import { StockSyncService } from '../../../application/services/stock-sync.service';
import { CatalogCacheService } from '../../../application/services/catalog-cache.service';
import { StockMovementLedgerService } from '../../../../inventory/application/services/stock-movement-ledger.service';
import { AuditPublicFacade } from '../../../../audit/application/facades/audit-public.facade';
import {
  AdminUpdateMappingDto,
  BulkApproveDto,
  BulkStopDto,
  ReapproveMappingDto,
  RejectMappingDto,
  StopMappingDto,
} from './dtos/admin-seller-mapping.dto';

const PINCODE_PATTERN = /^\d{6}$/;

// Phase 60 (2026-05-22) — per-product Redis lock for the stale-
// mapping auto-repair. 60-second TTL is long enough to cover the
// fan-out + ledger writes but short enough that a crashed admin
// request doesn't block subsequent migrations for an hour.
const STALE_REPAIR_LOCK_PREFIX = 'catalog:auto-repair-stale:v1:';
const STALE_REPAIR_LOCK_TTL_SECONDS = 60;

/**
 * Phase 56 (2026-05-22) — admin seller-mapping controller.
 *
 * Changes:
 *   - Per-method @Permissions (replaces the class-wide
 *     `catalog.approve` that previously forced GETs to require the
 *     same high-tier perm as approve).
 *   - New POST /:mappingId/reject endpoint with mandatory reason —
 *     the audit-flagged MappingApprovalStatus.REJECTED enum value
 *     is no longer dead.
 *   - approve/reject/stop pass adminId so the new audit columns
 *     (approvedBy/At, rejectedBy/At, stoppedBy/At, rejectionReason)
 *     get populated.
 *   - PATCH endpoint uses AdminUpdateMappingDto (class-validator);
 *     reservedQty is no longer writable from this surface (audit
 *     Gap #14) — use the inventory-adjust flow.
 *   - PATCH writes a MANUAL_ADJUST StockMovement ledger row when
 *     stockQty changes (audit Gap #10), with actorRole='ADMIN'.
 */
@ApiTags('Admin Seller Mappings')
@Controller('admin')
// Seller-type scope enforcement (Phase 38 boundary, extended here). The mapping
// guard scopes every `:mappingId` route (approve/reject/stop/reapprove/update)
// by the mapping's owning seller type; the product guard scopes the
// `products/:productId/seller-mappings` read. Bulk routes carry no id param —
// both guards no-op there and the handlers filter out-of-scope ids per-row.
@UseGuards(
  AdminAuthGuard,
  PermissionsGuard,
  AdminMappingSellerScopeGuard,
  AdminProductSellerScopeGuard,
)
export class AdminSellerMappingsController {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    @Inject(SELLER_MAPPING_REPOSITORY) private readonly sellerMappingRepo: ISellerMappingRepository,
    private readonly logger: AppLoggerService,
    private readonly stockSyncService: StockSyncService,
    private readonly stockLedger: StockMovementLedgerService,
    // Phase 57 (2026-05-22) — forensic chain + downstream signals
    // + storefront cache invalidation are all wired together so
    // every mapping-lifecycle transition leaves a tamper-evident
    // trail, fires events for notification/reindex subscribers, and
    // refreshes the storefront within milliseconds instead of
    // waiting for the cache TTL.
    private readonly audit: AuditPublicFacade,
    private readonly eventBus: EventBusService,
    private readonly catalogCache: CatalogCacheService,
    // Phase 60 (2026-05-22) — per-product Redis lock for the
    // stale-mapping auto-repair (audit Gap #7). Pre-Phase-60 two
    // admins racing the same GET endpoint could both run the
    // fan-out, with the second hitting a Prisma P2002 mid-loop
    // and the try/catch silently swallowing it.
    private readonly redis: RedisService,
  ) {
    this.logger.setContext('AdminSellerMappingsController');
  }

  /**
   * Phase 57 (2026-05-22) — shared post-transition side effects so
   * every approve/reject/stop/reapprove path emits consistent
   * audit + event + cache traffic. Best-effort: a downstream
   * failure logs but does NOT throw (the source of truth is the
   * SellerProductMapping row, which has already been written).
   */
  private async writeTransitionSideEffects(opts: {
    action: 'MAPPING_APPROVED' | 'MAPPING_REJECTED' | 'MAPPING_STOPPED' | 'MAPPING_REAPPROVED';
    eventName: string;
    mappingId: string;
    adminId: string | undefined;
    oldStatus: string;
    newStatus: string;
    before: any;
    after: any;
    reason?: string;
  }): Promise<void> {
    try {
      await this.audit.writeAuditLog({
        actorId: opts.adminId,
        actorRole: 'ADMIN',
        action: opts.action,
        module: 'catalog',
        resource: 'SellerProductMapping',
        resourceId: opts.mappingId,
        oldValue: { approvalStatus: opts.oldStatus, isActive: opts.before.isActive },
        newValue: { approvalStatus: opts.newStatus, isActive: opts.after.isActive },
        metadata: {
          productId: opts.before.productId,
          variantId: opts.before.variantId,
          sellerId: opts.before.sellerId,
          reason: opts.reason,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Audit write failed for ${opts.action} on ${opts.mappingId}: ${(err as Error).message}`,
      );
    }
    this.eventBus
      .publish({
        eventName: opts.eventName,
        aggregate: 'SellerProductMapping',
        aggregateId: opts.mappingId,
        occurredAt: new Date(),
        payload: {
          mappingId: opts.mappingId,
          sellerId: opts.before.sellerId,
          productId: opts.before.productId,
          variantId: opts.before.variantId,
          adminId: opts.adminId,
          oldStatus: opts.oldStatus,
          newStatus: opts.newStatus,
          reason: opts.reason,
        },
      })
      .catch((err) =>
        this.logger.warn(
          `Event publish failed for ${opts.eventName} on ${opts.mappingId}: ${(err as Error).message}`,
        ),
      );
    // Cache invalidation — admin approval needs to surface on
    // storefront within milliseconds, not after the cache TTL.
    this.catalogCache.invalidateProductLists().catch(() => {});
  }

  /**
   * GET /admin/products/:productId/seller-mappings
   * Returns all seller mappings for a specific product, sorted by operationalPriority DESC.
   */
  @Get('products/:productId/seller-mappings')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  async getMappingsForProduct(
    @Param('productId') productId: string,
  ) {
    const product = await this.productRepo.findByIdBasic(productId);

    if (!product) {
      throw new NotFoundAppException('Product not found');
    }

    // Auto-repair: if product has variants but only has product-level mappings
    // (variantId=null), replace them with per-variant mappings
    if (product.hasVariants) {
      await this.autoRepairStaleMappings(productId);
    }

    const mappings = await this.sellerMappingRepo.findByProduct(productId);

    const data = mappings.map((m: any) => {
      const availableQty = m.stockQty - m.reservedQty;
      let mappingDisplayStatus: string;
      if (m.approvalStatus === 'PENDING_APPROVAL') {
        mappingDisplayStatus = 'PENDING_APPROVAL';
      } else if (m.approvalStatus === 'STOPPED' || !m.isActive) {
        mappingDisplayStatus = 'INACTIVE';
      } else if (m.stockQty === 0) {
        mappingDisplayStatus = 'OUT_OF_STOCK';
      } else if (availableQty <= m.lowStockThreshold) {
        mappingDisplayStatus = 'LOW_STOCK';
      } else {
        mappingDisplayStatus = 'ACTIVE';
      }
      return {
        id: m.id,
        productId: m.productId,
        variantId: m.variantId,
        seller: m.seller,
        variant: m.variant,
        stockQty: m.stockQty,
        reservedQty: m.reservedQty,
        availableQty,
        lowStockThreshold: m.lowStockThreshold,
        mappingDisplayStatus,
        sellerInternalSku: m.sellerInternalSku,
        settlementPrice: m.settlementPrice,
        procurementCost: m.procurementCost,
        pickupAddress: m.pickupAddress,
        pickupPincode: m.pickupPincode,
        latitude: m.latitude,
        longitude: m.longitude,
        dispatchSla: m.dispatchSla,
        isActive: m.isActive,
        approvalStatus: m.approvalStatus,
        operationalPriority: m.operationalPriority,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      };
    });

    return {
      success: true,
      message: 'Seller mappings retrieved for product',
      data: {
        product: { id: product.id, title: product.title },
        mappings: data,
        total: data.length,
      },
    };
  }

  /**
   * GET /admin/seller-mappings
   * List all seller mappings across all products with filtering, search, and pagination.
   */
  @Get('seller-mappings')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  async listAllMappings(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sellerId') sellerId?: string,
    @Query('productId') productId?: string,
    @Query('isActive') isActive?: string,
    @Query('approvalStatus') approvalStatus?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '10', 10) || 10));

    const { mappings, total } = await this.sellerMappingRepo.findAllPaginated({
      page: pageNum,
      limit: limitNum,
      sellerId,
      productId,
      isActive: isActive !== undefined && isActive !== '' ? isActive === 'true' : undefined,
      approvalStatus,
      search,
    });

    const enrichedMappings = mappings.map((m: any) => {
      const availableQty = m.stockQty - m.reservedQty;
      let mappingDisplayStatus: string;
      if (m.approvalStatus === 'PENDING_APPROVAL') {
        mappingDisplayStatus = 'PENDING_APPROVAL';
      } else if (m.approvalStatus === 'STOPPED' || !m.isActive) {
        mappingDisplayStatus = 'INACTIVE';
      } else if (m.stockQty === 0) {
        mappingDisplayStatus = 'OUT_OF_STOCK';
      } else if (availableQty <= m.lowStockThreshold) {
        mappingDisplayStatus = 'LOW_STOCK';
      } else {
        mappingDisplayStatus = 'ACTIVE';
      }
      return {
        ...m,
        availableQty,
        mappingDisplayStatus,
      };
    });

    return {
      success: true,
      message: 'Seller mappings retrieved successfully',
      data: {
        mappings: enrichedMappings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  // ─── A5: Pending mappings (must be before parameterized :mappingId routes) ──

  /**
   * GET /admin/seller-mappings/pending
   * List all PENDING_APPROVAL mappings (for dashboard badge).
   */
  @Get('seller-mappings/pending')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  async listPendingMappings(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));

    const { mappings, total } = await this.sellerMappingRepo.findPendingPaginated(pageNum, limitNum);

    return {
      success: true,
      message: 'Pending approval mappings retrieved',
      data: {
        mappings,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  /**
   * PATCH /admin/seller-mappings/:mappingId
   * Admin can override any mapping field (stock, SLA, priority, isActive, settlement price, etc.)
   */
  @Patch('seller-mappings/:mappingId')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  async updateMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Body() dto: AdminUpdateMappingDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;

    const existing = await this.sellerMappingRepo.findById(mappingId);
    if (!existing) {
      throw new NotFoundAppException('Seller mapping not found');
    }

    // Phase 56 — the DTO already validates each field; reservedQty
    // is intentionally NOT part of AdminUpdateMappingDto (audit
    // Gap #14). Build updateData by copying defined fields only.
    const updateData: Record<string, unknown> = {};
    for (const key of [
      'stockQty',
      'lowStockThreshold',
      'sellerInternalSku',
      'settlementPrice',
      'procurementCost',
      'pickupAddress',
      'pickupPincode',
      'latitude',
      'longitude',
      'dispatchSla',
      'isActive',
      'operationalPriority',
    ] as const) {
      if ((dto as any)[key] !== undefined) updateData[key] = (dto as any)[key];
    }

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestAppException('No valid fields provided for update');
    }

    const stockBefore = existing.stockQty;
    const updated = await this.sellerMappingRepo.update(mappingId, updateData);

    // Phase 56 — write a MANUAL_ADJUST ledger row when admin changes
    // stockQty (audit Gap #10). Pre-Phase-56 admin's stockQty edits
    // bypassed the ledger, making post-incident forensics
    // incomplete. actorRole='ADMIN' so seller-vs-admin manual
    // changes are distinguishable in queries.
    if (dto.stockQty !== undefined && dto.stockQty !== stockBefore) {
      await this.stockLedger.record({
        resource: 'SellerProductMapping',
        resourceId: mappingId,
        kind: 'MANUAL_ADJUST',
        quantityDelta: Math.abs(dto.stockQty - stockBefore),
        beforeStockQty: stockBefore,
        afterStockQty: dto.stockQty,
        beforeReservedQty: existing.reservedQty ?? 0,
        afterReservedQty: existing.reservedQty ?? 0,
        reason: 'Admin override',
        referenceType: 'ADMIN_OVERRIDE',
        referenceId: mappingId,
        actorId: adminId,
        actorRole: 'ADMIN',
      });
    }

    // Sync variant stock from all mappings when mapping stockQty changes
    if (dto.stockQty !== undefined) {
      await this.stockSyncService.syncVariantStockFromMappings(
        existing.productId, existing.variantId,
      );
    }

    this.logger.log(
      `Seller mapping ${mappingId} updated by admin ${adminId ?? 'unknown'}: ${JSON.stringify(updateData)}`,
    );

    return {
      success: true,
      message: 'Seller mapping updated successfully',
      data: updated,
    };
  }

  // ─── A5: Approval & stop endpoints ──────────────────────────────────

  /**
   * POST /admin/seller-mappings/:mappingId/approve
   * Approves a seller mapping — sets approvalStatus to APPROVED and isActive to true.
   */
  @Post('seller-mappings/:mappingId/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.approve')
  @Idempotent()
  async approveMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const existing = await this.sellerMappingRepo.findById(mappingId);
    if (!existing) {
      throw new NotFoundAppException('Seller mapping not found');
    }
    // Don't approve a mapping onto a product that has been removed or archived
    // (the seller /map product-status gate only ran at creation time; the
    // product may have been taken down since). Pre-live states (DRAFT/SUBMITTED/
    // APPROVED) are allowed — the mapping simply won't allocate until the
    // product itself goes ACTIVE.
    const mappedProduct = await this.productRepo.findByIdBasic(existing.productId);
    if (!mappedProduct || mappedProduct.status === 'ARCHIVED') {
      throw new BadRequestAppException(
        'Cannot approve mapping — the product has been archived or removed.',
      );
    }
    // Phase 57 (2026-05-22) — precondition: pickup pincode must be a
    // valid 6-digit Indian pincode (audit Gap #12). Pre-Phase-57 a
    // mapping with `pickupPincode='abc'` could be approved; the
    // routing engine's PostOffice lookup would then miss, the
    // distance score would stay null, and the seller would never
    // be picked despite "in stock" showing on the storefront.
    if (
      !existing.pickupPincode ||
      !PINCODE_PATTERN.test(existing.pickupPincode)
    ) {
      throw new BadRequestAppException(
        'Cannot approve mapping — pickup pincode must be a valid 6-digit Indian pincode',
      );
    }

    // Phase 57 — status-conditional. Returns null if the mapping
    // wasn't in PENDING_APPROVAL (audit Gap #2). The repo's
    // updateMany WHERE clause is the lock equivalent: concurrent
    // approve + stop are serialized by Postgres, and the loser
    // sees count=0 → 400.
    const updated = await this.sellerMappingRepo.approve(mappingId, adminId);
    if (!updated) {
      throw new BadRequestAppException(
        `Cannot approve — mapping is in ${existing.approvalStatus} status. ` +
          (existing.approvalStatus === 'STOPPED'
            ? 'Use /reapprove with a reason to lift a stopped mapping.'
            : existing.approvalStatus === 'REJECTED'
              ? 'A REJECTED mapping must be resubmitted by the seller first.'
              : 'Only PENDING_APPROVAL mappings can be approved.'),
      );
    }

    await this.writeTransitionSideEffects({
      action: 'MAPPING_APPROVED',
      eventName: 'catalog.seller_mapping.approved',
      mappingId,
      adminId,
      oldStatus: existing.approvalStatus,
      newStatus: 'APPROVED',
      before: existing,
      after: updated,
    });

    this.logger.log(
      `Seller mapping ${mappingId} APPROVED by admin ${adminId ?? 'unknown'}`,
    );
    return {
      success: true,
      message: 'Seller mapping approved successfully',
      data: updated,
    };
  }

  /**
   * Phase 56 (2026-05-22) — POST /admin/seller-mappings/:mappingId/reject
   *
   * The missing third lifecycle transition (audit Gap #1). Admins
   * can now formally REJECT a submission with a mandatory reason
   * instead of resorting to STOP (which conflates "didn't pass
   * review" with "live mapping turned off"). The reason surfaces
   * to the seller via their my-products view, and on the seller
   * side a /resubmit endpoint flips the row back to
   * PENDING_APPROVAL.
   */
  @Post('seller-mappings/:mappingId/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.approve')
  @Idempotent()
  async rejectMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Body() dto: RejectMappingDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const existing = await this.sellerMappingRepo.findById(mappingId);
    if (!existing) {
      throw new NotFoundAppException('Seller mapping not found');
    }
    const updated = await this.sellerMappingRepo.reject(
      mappingId,
      adminId ?? 'unknown-admin',
      dto.reason,
    );
    if (!updated) {
      throw new BadRequestAppException(
        `Cannot reject — mapping is in ${existing.approvalStatus} status. Only PENDING_APPROVAL mappings can be rejected.`,
      );
    }
    await this.writeTransitionSideEffects({
      action: 'MAPPING_REJECTED',
      eventName: 'catalog.seller_mapping.rejected',
      mappingId,
      adminId,
      oldStatus: existing.approvalStatus,
      newStatus: 'REJECTED',
      before: existing,
      after: updated,
      reason: dto.reason,
    });
    this.logger.log(
      `Seller mapping ${mappingId} REJECTED by admin ${adminId ?? 'unknown'} — reason="${dto.reason}"`,
    );
    return {
      success: true,
      message: 'Seller mapping rejected successfully',
      data: updated,
    };
  }

  /**
   * POST /admin/seller-mappings/:mappingId/stop
   * Stops a seller mapping — sets approvalStatus to STOPPED and isActive to false.
   *
   * Phase 56 — now stamps stoppedBy/At and accepts an optional reason
   * that lands in rejectionReason so seller sees why their live
   * mapping was paused.
   */
  @Post('seller-mappings/:mappingId/stop')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.approve')
  @Idempotent()
  async stopMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Body() dto: StopMappingDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const existing = await this.sellerMappingRepo.findById(mappingId);
    if (!existing) {
      throw new NotFoundAppException('Seller mapping not found');
    }
    const updated = await this.sellerMappingRepo.stop(mappingId, adminId, dto.reason);
    if (!updated) {
      // Phase 58 (2026-05-22) — stop is APPROVED-only (audit Gap #13).
      // Route PENDING_APPROVAL callers to /reject and STOPPED callers
      // to /reapprove so they don't retry blindly.
      throw new BadRequestAppException(
        `Cannot stop — mapping is in ${existing.approvalStatus} status. ` +
          (existing.approvalStatus === 'PENDING_APPROVAL'
            ? 'A PENDING_APPROVAL mapping was never live — use /reject instead.'
            : existing.approvalStatus === 'STOPPED'
              ? 'Mapping is already stopped.'
              : 'Only APPROVED mappings can be stopped.'),
      );
    }
    // Phase 58 (2026-05-22) — release active reservations BEFORE the
    // event fires (audit Gap #8). Customers with a reserved cart
    // line on this mapping would otherwise hit checkout limbo until
    // the expiry sweep catches up. We release inside the same
    // request so the cart UI can show "no longer available" the
    // next time it polls.
    const released = await this.releaseAndLogReservations(mappingId, adminId);
    await this.writeTransitionSideEffects({
      action: 'MAPPING_STOPPED',
      eventName: 'catalog.seller_mapping.stopped',
      mappingId,
      adminId,
      oldStatus: existing.approvalStatus,
      newStatus: 'STOPPED',
      before: existing,
      after: updated,
      reason: dto.reason,
    });
    this.logger.log(
      `Seller mapping ${mappingId} STOPPED by admin ${adminId ?? 'unknown'} — reason="${dto.reason}" (${released} reservation(s) released)`,
    );
    return {
      success: true,
      message: 'Seller mapping stopped successfully',
      data: { ...updated, releasedReservations: released },
    };
  }

  /**
   * Phase 58 (2026-05-22) — release every active reservation on a
   * stopped mapping (audit Gap #8) and write the matching ledger +
   * cart-update event for each. Returns the count actually released
   * so the caller can include it in the response. Best-effort:
   * downstream ledger or event-bus failures log but don't throw so
   * the parent /stop response stays clean.
   */
  private async releaseAndLogReservations(
    mappingId: string,
    adminId: string | undefined,
  ): Promise<number> {
    let released: Awaited<ReturnType<typeof this.sellerMappingRepo.releaseActiveReservationsForMapping>>;
    try {
      released = await this.sellerMappingRepo.releaseActiveReservationsForMapping(mappingId);
    } catch (err) {
      this.logger.warn(
        `Failed to release reservations for stopped mapping ${mappingId}: ${(err as Error).message}`,
      );
      return 0;
    }
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
          reason: 'Mapping stopped — reservation released',
          referenceType: 'MAPPING_STOPPED',
          referenceId: r.reservationId,
          actorId: adminId,
          actorRole: 'ADMIN',
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
            adminId,
          },
        })
        .catch((err) =>
          this.logger.warn(
            `Event publish failed for released reservation ${r.reservationId}: ${(err as Error).message}`,
          ),
        );
    }
    return released.length;
  }

  /**
   * Phase 57 (2026-05-22) — POST /admin/seller-mappings/:id/reapprove
   *
   * Explicit STOPPED → APPROVED transition with a required reason
   * (audit Gap #2 — pre-Phase-57 admins could silently re-approve
   * a stopped mapping by calling /approve, masking the
   * re-evaluation step that compliance / quality stops imply). The
   * reason lands on the row's rejectionReason column prefixed with
   * `[Reapproved]` so the historical stoppedReason isn't lost.
   */
  @Post('seller-mappings/:mappingId/reapprove')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.approve')
  @Idempotent()
  async reapproveMapping(
    @Req() req: Request,
    @Param('mappingId') mappingId: string,
    @Body() dto: ReapproveMappingDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const existing = await this.sellerMappingRepo.findById(mappingId);
    if (!existing) {
      throw new NotFoundAppException('Seller mapping not found');
    }
    // Don't re-activate a mapping onto a removed/archived product (see approve).
    const mappedProduct = await this.productRepo.findByIdBasic(existing.productId);
    if (!mappedProduct || mappedProduct.status === 'ARCHIVED') {
      throw new BadRequestAppException(
        'Cannot reapprove mapping — the product has been archived or removed.',
      );
    }
    if (
      !existing.pickupPincode ||
      !PINCODE_PATTERN.test(existing.pickupPincode)
    ) {
      throw new BadRequestAppException(
        'Cannot reapprove — pickup pincode must be a valid 6-digit Indian pincode',
      );
    }
    const updated = await this.sellerMappingRepo.reapprove(
      mappingId,
      adminId ?? 'unknown-admin',
      dto.reason,
    );
    if (!updated) {
      throw new BadRequestAppException(
        `Cannot reapprove — mapping is in ${existing.approvalStatus} status. /reapprove is only valid for STOPPED mappings.`,
      );
    }
    await this.writeTransitionSideEffects({
      action: 'MAPPING_REAPPROVED',
      eventName: 'catalog.seller_mapping.reapproved',
      mappingId,
      adminId,
      oldStatus: 'STOPPED',
      newStatus: 'APPROVED',
      before: existing,
      after: updated,
      reason: dto.reason,
    });
    this.logger.log(
      `Seller mapping ${mappingId} REAPPROVED by admin ${adminId ?? 'unknown'} — reason="${dto.reason}"`,
    );
    return {
      success: true,
      message: 'Seller mapping reapproved successfully',
      data: updated,
    };
  }

  /**
   * Phase 57 (2026-05-22) — POST /admin/seller-mappings/bulk/approve
   *
   * Bulk approval for the pending queue (audit Gap #6). Up to 100
   * mappings per call. Each row uses the same status-conditional
   * update inside a single transaction; rows that aren't in
   * PENDING_APPROVAL come back as `ok:false` with the current
   * status so the admin UI can flag them without failing the whole
   * batch. Audit + event + cache invalidation fire per
   * successfully-approved row.
   */
  /**
   * Partition a list of mapping ids by the caller's seller-type scope. A scoped
   * admin may only act on mappings whose owning seller is in scope; out-of-scope
   * ids are returned separately so bulk handlers can report them as not-found
   * (no existence leak), mirroring the product bulk-approve pattern. Unrestricted
   * admins (no scope perm / SUPER_ADMIN) get everything in scope.
   */
  private async partitionMappingsByScope(
    mappingIds: string[],
    permissions: readonly string[] | undefined,
  ): Promise<{ inScope: string[]; outOfScope: string[] }> {
    const scope = resolveSellerScope(permissions);
    if (scope.unrestricted) return { inScope: mappingIds, outOfScope: [] };
    const rows = await this.sellerMappingRepo.findSellerScopeByIds(mappingIds);
    const typeById = new Map(rows.map((r) => [r.id, r.sellerType]));
    const inScope: string[] = [];
    const outOfScope: string[] = [];
    for (const id of mappingIds) {
      if (scopeAllowsType(scope, typeById.get(id) as any)) inScope.push(id);
      else outOfScope.push(id);
    }
    return { inScope, outOfScope };
  }

  @Post('seller-mappings/bulk/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.approve')
  @Idempotent()
  async bulkApproveMappings(
    @Req() req: Request,
    @Body() dto: BulkApproveDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;

    // Seller-type scope filter — bulk routes carry no :mappingId param, so the
    // class guard can't scope them; filter here (out-of-scope → reported not-found).
    const { inScope, outOfScope } = await this.partitionMappingsByScope(
      dto.mappingIds,
      (req as any).user?.permissions,
    );

    // Snapshot before-state per row for the audit log.
    const beforeMap = new Map<string, any>();
    for (const id of inScope) {
      const row = await this.sellerMappingRepo.findById(id);
      if (row) beforeMap.set(id, row);
    }

    const results = await this.sellerMappingRepo.bulkApprove(
      inScope,
      adminId ?? 'unknown-admin',
    );
    for (const id of outOfScope) {
      results.push({ mappingId: id, ok: false, reason: 'not_found' });
    }

    // Side effects per successful row. We invalidate the catalog
    // cache once at the end rather than per row.
    for (const r of results) {
      if (!r.ok) continue;
      const beforeRow = beforeMap.get(r.mappingId);
      if (!beforeRow) continue;
      const afterRow = await this.sellerMappingRepo.findById(r.mappingId);
      try {
        await this.audit.writeAuditLog({
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'MAPPING_APPROVED',
          module: 'catalog',
          resource: 'SellerProductMapping',
          resourceId: r.mappingId,
          oldValue: { approvalStatus: 'PENDING_APPROVAL', isActive: beforeRow.isActive },
          newValue: { approvalStatus: 'APPROVED', isActive: true },
          metadata: {
            productId: beforeRow.productId,
            variantId: beforeRow.variantId,
            sellerId: beforeRow.sellerId,
            bulk: true,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Bulk audit write failed for ${r.mappingId}: ${(err as Error).message}`,
        );
      }
      this.eventBus
        .publish({
          eventName: 'catalog.seller_mapping.approved',
          aggregate: 'SellerProductMapping',
          aggregateId: r.mappingId,
          occurredAt: new Date(),
          payload: {
            mappingId: r.mappingId,
            sellerId: beforeRow.sellerId,
            productId: beforeRow.productId,
            variantId: beforeRow.variantId,
            adminId,
            oldStatus: 'PENDING_APPROVAL',
            newStatus: 'APPROVED',
            bulk: true,
          },
        })
        .catch(() => {});
      void afterRow;
    }
    // Single cache invalidation at the end — no need to spam it per
    // row since the storefront list query is the same.
    if (results.some((r) => r.ok)) {
      this.catalogCache.invalidateProductLists().catch(() => {});
    }

    const okCount = results.filter((r) => r.ok).length;
    this.logger.log(
      `Bulk approve by admin ${adminId ?? 'unknown'}: ${okCount}/${results.length} mapped to APPROVED`,
    );

    return {
      success: true,
      message: `${okCount} of ${results.length} mappings approved`,
      data: { results },
    };
  }

  /**
   * Phase 58 (2026-05-22) — POST /admin/seller-mappings/bulk/stop
   *
   * Bulk stop for compliance / quality sweeps (audit Gap #17). Up to
   * 100 mappings per call with one shared reason. Each row uses the
   * same APPROVED-only status-conditional update inside a single
   * transaction; rows not in APPROVED come back as ok:false with
   * their current status. Side effects per successful row:
   *   - audit log entry (MAPPING_STOPPED with bulk:true metadata)
   *   - catalog.seller_mapping.stopped event
   *   - active reservations released + ledger entries written
   *   - catalog cache invalidated once at the end
   */
  @Post('seller-mappings/bulk/stop')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.approve')
  @Idempotent()
  async bulkStopMappings(
    @Req() req: Request,
    @Body() dto: BulkStopDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;

    // Seller-type scope filter (see bulkApproveMappings).
    const { inScope, outOfScope } = await this.partitionMappingsByScope(
      dto.mappingIds,
      (req as any).user?.permissions,
    );

    // Snapshot before-state per row for the audit log.
    const beforeMap = new Map<string, any>();
    for (const id of inScope) {
      const row = await this.sellerMappingRepo.findById(id);
      if (row) beforeMap.set(id, row);
    }

    const results = await this.sellerMappingRepo.bulkStop(
      inScope,
      adminId ?? 'unknown-admin',
      dto.reason,
    );
    for (const id of outOfScope) {
      results.push({ mappingId: id, ok: false, reason: 'not_found' });
    }

    let totalReleased = 0;
    for (const r of results) {
      if (!r.ok) continue;
      const beforeRow = beforeMap.get(r.mappingId);
      if (!beforeRow) continue;
      // Release reservations + write ledger + emit cart events per row.
      const releasedCount = await this.releaseAndLogReservations(r.mappingId, adminId);
      totalReleased += releasedCount;
      try {
        await this.audit.writeAuditLog({
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'MAPPING_STOPPED',
          module: 'catalog',
          resource: 'SellerProductMapping',
          resourceId: r.mappingId,
          oldValue: { approvalStatus: 'APPROVED', isActive: beforeRow.isActive },
          newValue: { approvalStatus: 'STOPPED', isActive: false },
          metadata: {
            productId: beforeRow.productId,
            variantId: beforeRow.variantId,
            sellerId: beforeRow.sellerId,
            reason: dto.reason,
            bulk: true,
            releasedReservations: releasedCount,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Bulk-stop audit write failed for ${r.mappingId}: ${(err as Error).message}`,
        );
      }
      this.eventBus
        .publish({
          eventName: 'catalog.seller_mapping.stopped',
          aggregate: 'SellerProductMapping',
          aggregateId: r.mappingId,
          occurredAt: new Date(),
          payload: {
            mappingId: r.mappingId,
            sellerId: beforeRow.sellerId,
            productId: beforeRow.productId,
            variantId: beforeRow.variantId,
            adminId,
            oldStatus: 'APPROVED',
            newStatus: 'STOPPED',
            reason: dto.reason,
            bulk: true,
          },
        })
        .catch(() => {});
    }

    const okCount = results.filter((r) => r.ok).length;
    if (okCount > 0) {
      this.catalogCache.invalidateProductLists().catch(() => {});
    }
    this.logger.log(
      `Bulk stop by admin ${adminId ?? 'unknown'}: ${okCount}/${results.length} mapped to STOPPED — reason="${dto.reason}", ${totalReleased} reservation(s) released`,
    );

    return {
      success: true,
      message: `${okCount} of ${results.length} mappings stopped`,
      data: { results, releasedReservations: totalReleased },
    };
  }

  /**
   * Phase 60 (2026-05-22) — safe auto-repair for stale (variantId=
   * null) seller-product mappings.
   *
   * Pre-Phase-60 this method was a critical-risk hot path: every
   * admin read of a product's mappings triggered a destructive
   * fan-out that (a) silently zeroed seller hand inventory by
   * sourcing stock from `variant.stock` instead of the stale
   * mapping (audit Gap #1), (b) hard-deleted the stale row
   * cascading away its ledger + active reservations + LowStockAlert
   * FK refs (audit Gap #2), (c) ran without a transaction so a
   * crash mid-loop left partial state that subsequent runs skipped
   * (audit Gaps #3 + #11), (d) propagated the stale row's
   * APPROVED+active state to brand-new variants the admin had
   * never reviewed (audit Gaps #4 + #5), and (e) had no audit /
   * ledger / event trail (audit Gap #8).
   *
   * The Phase 60 path:
   *   - Fast count pre-check skips the heavy logic when nothing
   *     is stale (audit Gap #6).
   *   - Per-product Redis lock prevents concurrent admin reads
   *     from racing (audit Gap #7).
   *   - Repo `repairStaleMappingsForProduct` does the actual
   *     fan-out inside a single $transaction, soft-deletes the
   *     stale row, blocks when stock > 0 unless the caller opted
   *     in, defaults new mappings to PENDING_APPROVAL+inactive,
   *     re-resolves lat/lng, stamps migratedFromMappingId, and
   *     only creates variants that don't already have a mapping
   *     for this seller.
   *   - This method then writes the StockMovement WRITE_OFF on
   *     the stale + INITIAL on each new mapping, fires the
   *     tamper-evident audit-chain entry, emits the event, and
   *     invalidates the storefront cache.
   */
  private async autoRepairStaleMappings(productId: string): Promise<void> {
    try {
      // Audit Gap #6 — hot-path skip. The composite index
      // (productId, variantId, deletedAt) makes this a single
      // index scan and the steady state (no stale) costs ~1ms.
      const staleCount = await this.sellerMappingRepo.countStaleMappingsForProduct(productId);
      if (staleCount === 0) return;

      // Audit Gap #7 — per-product Redis lock. Concurrent admin
      // reads for the same product see acquired=false and skip
      // the repair; the lock holder does the work and writes the
      // results. The 60s TTL is short enough that a crashed
      // request unblocks subsequent migrations quickly.
      const lockKey = `${STALE_REPAIR_LOCK_PREFIX}${productId}`;
      let acquired = false;
      try {
        acquired = await this.redis.acquireLock(lockKey, STALE_REPAIR_LOCK_TTL_SECONDS);
      } catch {
        // Redis outage degrades to pre-Phase-60 behavior (no
        // lock), but the repair itself is still safe thanks to
        // the transaction-internal CAS.
        acquired = true;
      }
      if (!acquired) return;

      const adminId = 'auto-repair-system';
      const outcomes = await this.sellerMappingRepo.repairStaleMappingsForProduct(
        productId,
        adminId,
      );
      if (outcomes.length === 0) return;

      let totalNew = 0;
      for (const outcome of outcomes) {
        if (outcome.blockedReason) {
          // Audit Gap #1 — block surfaced as a logger.warn so
          // the admin can see "this stale mapping has hand
          // inventory; use the explicit migration tool" without
          // breaking the read.
          this.logger.warn(
            `Auto-repair blocked for stale mapping ${outcome.staleMappingId} on product ${productId}: ${outcome.blockedReason}`,
          );
          continue;
        }

        totalNew += outcome.newMappings.length;

        // Audit Gap #8 — WRITE_OFF on the stale row captures
        // where the stock went; INITIAL per new mapping seeds
        // the per-variant ledger. Best-effort: a ledger outage
        // doesn't unwind the migration, but the warning is
        // visible in logs.
        if (outcome.staleStockQty > 0) {
          this.stockLedger
            .record({
              resource: 'SellerProductMapping',
              resourceId: outcome.staleMappingId,
              kind: 'WRITE_OFF',
              quantityDelta: outcome.staleStockQty,
              beforeStockQty: outcome.staleStockQty,
              afterStockQty: 0,
              reason: 'Auto-repair: stale mapping fanned out to per-variant',
              referenceType: 'MAPPING_MIGRATION',
              referenceId: outcome.staleMappingId,
              actorId: adminId,
              actorRole: 'SYSTEM',
            })
            .catch((err) =>
              this.logger.warn(
                `Ledger WRITE_OFF failed for stale ${outcome.staleMappingId}: ${(err as Error).message}`,
              ),
            );
        }
        for (const m of outcome.newMappings) {
          if (m.stockQty <= 0) continue;
          this.stockLedger
            .record({
              resource: 'SellerProductMapping',
              resourceId: m.id,
              kind: 'INITIAL',
              quantityDelta: m.stockQty,
              beforeStockQty: 0,
              afterStockQty: m.stockQty,
              reason: `Auto-repair: migrated from stale mapping ${outcome.staleMappingId}`,
              referenceType: 'MAPPING_MIGRATION',
              referenceId: outcome.staleMappingId,
              actorId: adminId,
              actorRole: 'SYSTEM',
            })
            .catch((err) =>
              this.logger.warn(
                `Ledger INITIAL failed for new mapping ${m.id}: ${(err as Error).message}`,
              ),
            );
        }

        // Audit log — tamper-evident chain entry per migration
        // event so "show every stale-mapping fan-out in Q4" is a
        // single audit-log query.
        try {
          await this.audit.writeAuditLog({
            actorId: adminId,
            actorRole: 'SYSTEM',
            action: 'SELLER_MAPPING_AUTO_REPAIRED',
            module: 'catalog',
            resource: 'SellerProductMapping',
            resourceId: outcome.staleMappingId,
            oldValue: {
              variantId: null,
              stockQty: outcome.staleStockQty,
              isActive: true,
            },
            newValue: {
              softDeleted: true,
              newMappingIds: outcome.newMappings.map((m) => m.id),
            },
            metadata: {
              productId,
              sellerId: outcome.sellerId,
              variantCount: outcome.newMappings.length,
              stockStrategy: 'reset',
            },
          });
        } catch (err) {
          this.logger.warn(
            `Audit write failed for auto-repair of ${outcome.staleMappingId}: ${(err as Error).message}`,
          );
        }

        this.eventBus
          .publish({
            eventName: 'catalog.seller_mapping.auto_repaired',
            aggregate: 'SellerProductMapping',
            aggregateId: outcome.staleMappingId,
            occurredAt: new Date(),
            payload: {
              productId,
              sellerId: outcome.sellerId,
              staleMappingId: outcome.staleMappingId,
              newMappingIds: outcome.newMappings.map((m) => m.id),
              variantCount: outcome.newMappings.length,
              staleStockQty: outcome.staleStockQty,
            },
          })
          .catch(() => {});

        this.logger.log(
          `Auto-repaired stale mapping ${outcome.staleMappingId} (product=${productId}, seller=${outcome.sellerId}): ${outcome.newMappings.length} new variant mapping(s) created (PENDING_APPROVAL)`,
        );
      }

      if (totalNew > 0) {
        this.catalogCache.invalidateProductLists().catch(() => {});
      }
    } catch (err) {
      this.logger.warn(
        `Failed to auto-repair stale mappings for product ${productId}: ${(err as Error).message}`,
      );
    }
  }
}
