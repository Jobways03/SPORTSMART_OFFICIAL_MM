import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { CatalogCacheService } from '../../../catalog/application/services/catalog-cache.service';
import {
  AdminControlTowerRepository,
  ADMIN_CONTROL_TOWER_REPOSITORY,
} from '../../domain/repositories/admin-control-tower.repository.interface';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface BulkPricingUpdate {
  productId: string;
  price?: number;
  variantUpdates?: { variantId: string; price: number }[];
}

export interface BulkPricingResult {
  updatedProducts: number;
  updatedVariants: number;
  errors: { productId: string; error: string }[];
}

export interface MappingSuspensionResult {
  sellerId: string;
  affectedMappings: number;
  affectedMappingIds: string[];
  releasedReservations: number;
  action: 'suspended' | 'activated';
  adminId: string | null;
  reason: string;
  sellerAccountStatus: string;
}

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AdminOperationsService {
  private readonly logger = new Logger(AdminOperationsService.name);

  constructor(
    @Inject(ADMIN_CONTROL_TOWER_REPOSITORY)
    private readonly repo: AdminControlTowerRepository,
    // Phase 59 (2026-05-22) — bulk suspend/activate side-effect wiring.
    // Audit + event + cache invalidation mirror the per-mapping
    // pattern from Phase 56/57/58 so every lifecycle transition
    // (admin/stop, seller/pause, admin/suspend) emits the same
    // observable surface for downstream subscribers.
    private readonly audit: AuditPublicFacade,
    private readonly eventBus: EventBusService,
    private readonly catalogCache: CatalogCacheService,
  ) {}

  // ── T5: Bulk pricing management ─────────────────────────────────────────

  async bulkUpdatePricing(updates: BulkPricingUpdate[]): Promise<BulkPricingResult> {
    if (!updates || updates.length === 0) {
      throw new BadRequestAppException('No updates provided');
    }
    if (updates.length > 50) {
      throw new BadRequestAppException('Maximum 50 updates per request');
    }

    let updatedProducts = 0;
    let updatedVariants = 0;
    const errors: { productId: string; error: string }[] = [];

    for (const update of updates) {
      try {
        // Validate product exists
        const product = await this.repo.findProductById(update.productId);

        if (!product) {
          errors.push({ productId: update.productId, error: 'Product not found' });
          continue;
        }

        if (product.isDeleted) {
          errors.push({ productId: update.productId, error: 'Product is deleted' });
          continue;
        }

        // Update product platform price
        if (update.price !== undefined) {
          if (update.price < 0) {
            errors.push({ productId: update.productId, error: 'Platform price must be non-negative' });
            continue;
          }
          await this.repo.updateProductPrice(update.productId, update.price);
          updatedProducts++;
        }

        // Update variant platform prices
        if (update.variantUpdates && update.variantUpdates.length > 0) {
          for (const vu of update.variantUpdates) {
            if (vu.price < 0) {
              errors.push({ productId: update.productId, error: `Variant ${vu.variantId}: price must be non-negative` });
              continue;
            }
            try {
              const variant = await this.repo.findVariantForProduct(vu.variantId, update.productId);
              if (!variant) {
                errors.push({ productId: update.productId, error: `Variant ${vu.variantId} not found` });
                continue;
              }
              await this.repo.updateVariantPrice(vu.variantId, vu.price);
              updatedVariants++;
            } catch (err) {
              errors.push({
                productId: update.productId,
                error: `Variant ${vu.variantId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
              });
            }
          }
        }
      } catch (err) {
        errors.push({
          productId: update.productId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return { updatedProducts, updatedVariants, errors };
  }

  // ── T6: Override allocation (reassign sub-order) ────────────────────────
  //
  // Phase 78 (2026-05-22) — reassign audit Gap #6/#23/#24. The legacy
  // path used to live here. It diverged from the canonical OrdersService
  // path:
  //   • No OrderReassignmentLog write (Gap #23)
  //   • Hard-coded `customerPincode: 'ADMIN_OVERRIDE'` in AllocationLog (#24)
  //   • SELLER-only (no franchise support)
  //   • No event publish, no reason capture, no admin actor capture
  //
  // It is deleted in Phase 78. The control-tower facade now routes to
  // OrdersService.reassignSubOrder so only one code path can mutate
  // reassignment state. SUPER_ADMIN keeps the higher-tier permissions
  // (orders.reassign + orders.reassign.force) via ALL_PERMISSION_KEYS,
  // so the operational capability is preserved — just unified.

  // ── T7: Seller mapping suspension ───────────────────────────────────────

  /**
   * Phase 59 (2026-05-22) — bulk admin-initiated catalog suspension.
   *
   * Pre-Phase-59 this was a blind isActive flip with no actor /
   * reason / audit log (audit Gaps #1-#11). The new path:
   *   - status-conditional: only APPROVED+active rows move to
   *     SUSPENDED+inactive; PENDING / REJECTED / STOPPED untouched
   *     (audit Gaps #1 + #2)
   *   - stamps suspendedBy / suspendedAt / suspensionReason on
   *     each affected row (audit Gap #3)
   *   - releases every active StockReservation on the affected
   *     mappings inside the same call so customers' carts unlock
   *     without waiting for the 15-min expiry sweep (audit Gap #6)
   *   - writes a tamper-evident AuditPublicFacade entry per
   *     successful row (audit Gap #3 forensic trail)
   *   - emits catalog.seller_mappings.suspended with per-mapping
   *     payload so notification / cart-cleanup subscribers can
   *     pick it up (audit Gap #4)
   *   - invalidates the storefront product-list cache so the
   *     suspended seller's listings drop off within milliseconds,
   *     not on the next TTL boundary (audit Gap #11)
   *   - warns if the seller's account is already SUSPENDED at the
   *     seller-account level (audit Gap #7)
   */
  async suspendSellerMappings(
    sellerId: string,
    adminId: string | undefined,
    reason: string,
  ): Promise<MappingSuspensionResult> {
    if (!sellerId) throw new BadRequestAppException('sellerId is required');

    const seller = await this.repo.findSellerBasic(sellerId);
    if (!seller) {
      throw new NotFoundAppException(`Seller ${sellerId} not found`);
    }
    if (seller.isDeleted) {
      throw new BadRequestAppException(`Seller ${sellerId} is deleted`);
    }
    // Audit Gap #7 — soft warning, not a block. A seller can be
    // SUSPENDED at the account level but still have residual
    // APPROVED+active mappings if a prior bulk-suspend missed them
    // (e.g., crashed before completing) — the bulk endpoint stays
    // a clean-up tool in that case.
    if (seller.status === 'SUSPENDED') {
      this.logger.warn(
        `Seller ${sellerId} account is already SUSPENDED — bulk-suspending mappings as cleanup`,
      );
    }

    const result = await this.repo.suspendSellerMappings(
      sellerId,
      adminId ?? 'unknown-admin',
      reason,
    );

    let releasedCount = 0;
    if (result.affectedMappingIds.length > 0) {
      releasedCount = await this.releaseAndEmit(
        result.affectedMappingIds,
        sellerId,
        adminId,
        'MAPPING_SUSPENDED',
      );
    }

    // Per-mapping audit entries — one tamper-evident chain row per
    // affected mapping so a single audit query answers "what did
    // admin X suspend in batch Y?".
    for (const mappingId of result.affectedMappingIds) {
      try {
        await this.audit.writeAuditLog({
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'MAPPING_SUSPENDED',
          module: 'admin-control-tower',
          resource: 'SellerProductMapping',
          resourceId: mappingId,
          oldValue: { approvalStatus: 'APPROVED', isActive: true },
          newValue: { approvalStatus: 'SUSPENDED', isActive: false },
          metadata: {
            sellerId,
            sellerName: seller.sellerName,
            sellerAccountStatus: seller.status,
            reason,
            bulk: true,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Audit write failed for suspended mapping ${mappingId}: ${(err as Error).message}`,
        );
      }
    }

    // Aggregate event (one per call) so a notification subscriber
    // can email the seller once rather than once per mapping.
    this.eventBus
      .publish({
        eventName: 'catalog.seller_mappings.suspended',
        aggregate: 'Seller',
        aggregateId: sellerId,
        occurredAt: new Date(),
        payload: {
          sellerId,
          sellerName: seller.sellerName,
          affectedMappings: result.count,
          affectedMappingIds: result.affectedMappingIds,
          releasedReservations: releasedCount,
          adminId,
          reason,
        },
      })
      .catch((err) =>
        this.logger.warn(
          `Event publish failed for suspend on seller ${sellerId}: ${(err as Error).message}`,
        ),
      );

    if (result.count > 0) {
      this.catalogCache.invalidateProductLists().catch(() => {});
    }

    this.logger.log(
      `Suspended ${result.count} mappings for seller ${sellerId} (${seller.sellerName}) by admin ${adminId ?? 'unknown'} — reason="${reason}", ${releasedCount} reservation(s) released`,
    );

    return {
      sellerId,
      affectedMappings: result.count,
      affectedMappingIds: result.affectedMappingIds,
      releasedReservations: releasedCount,
      action: 'suspended',
      adminId: adminId ?? null,
      reason,
      sellerAccountStatus: seller.status,
    };
  }

  /**
   * Phase 59 — symmetric reverse. Only lifts mappings that were
   * bulk-suspended via the matching path (approvalStatus='SUSPENDED'
   * + isActive=false). STOPPED / REJECTED / PENDING_APPROVAL rows
   * are left alone — those need their own per-mapping reapprove /
   * resubmit / approve flow so the admin can't silently undo a
   * prior per-mapping decision with one click (audit Gap #1).
   */
  async activateSellerMappings(
    sellerId: string,
    adminId: string | undefined,
    reason: string,
  ): Promise<MappingSuspensionResult> {
    if (!sellerId) throw new BadRequestAppException('sellerId is required');

    const seller = await this.repo.findSellerBasic(sellerId);
    if (!seller) {
      throw new NotFoundAppException(`Seller ${sellerId} not found`);
    }
    if (seller.isDeleted) {
      throw new BadRequestAppException(`Seller ${sellerId} is deleted`);
    }

    const result = await this.repo.activateSellerMappings(
      sellerId,
      adminId ?? 'unknown-admin',
      reason,
    );

    for (const mappingId of result.affectedMappingIds) {
      try {
        await this.audit.writeAuditLog({
          actorId: adminId,
          actorRole: 'ADMIN',
          action: 'MAPPING_REACTIVATED',
          module: 'admin-control-tower',
          resource: 'SellerProductMapping',
          resourceId: mappingId,
          oldValue: { approvalStatus: 'SUSPENDED', isActive: false },
          newValue: { approvalStatus: 'APPROVED', isActive: true },
          metadata: {
            sellerId,
            sellerName: seller.sellerName,
            sellerAccountStatus: seller.status,
            reason,
            bulk: true,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Audit write failed for reactivated mapping ${mappingId}: ${(err as Error).message}`,
        );
      }
    }

    this.eventBus
      .publish({
        eventName: 'catalog.seller_mappings.activated',
        aggregate: 'Seller',
        aggregateId: sellerId,
        occurredAt: new Date(),
        payload: {
          sellerId,
          sellerName: seller.sellerName,
          affectedMappings: result.count,
          affectedMappingIds: result.affectedMappingIds,
          adminId,
          reason,
        },
      })
      .catch((err) =>
        this.logger.warn(
          `Event publish failed for activate on seller ${sellerId}: ${(err as Error).message}`,
        ),
      );

    if (result.count > 0) {
      this.catalogCache.invalidateProductLists().catch(() => {});
    }

    this.logger.log(
      `Activated ${result.count} mappings for seller ${sellerId} (${seller.sellerName}) by admin ${adminId ?? 'unknown'} — reason="${reason}"`,
    );

    return {
      sellerId,
      affectedMappings: result.count,
      affectedMappingIds: result.affectedMappingIds,
      releasedReservations: 0,
      action: 'activated',
      adminId: adminId ?? null,
      reason,
      sellerAccountStatus: seller.status,
    };
  }

  /**
   * Phase 59 — releases active reservations on a set of mappings
   * and emits inventory.reservation.released per row so the cart
   * service can flag affected line-items as unavailable. Returns
   * the number actually released.
   */
  private async releaseAndEmit(
    mappingIds: string[],
    sellerId: string,
    adminId: string | undefined,
    cause: 'MAPPING_SUSPENDED' | 'MAPPING_STOPPED',
  ): Promise<number> {
    let released: Awaited<ReturnType<typeof this.repo.releaseReservationsForMappings>>;
    try {
      released = await this.repo.releaseReservationsForMappings(mappingIds);
    } catch (err) {
      this.logger.warn(
        `Reservation release failed during bulk suspend for seller ${sellerId}: ${(err as Error).message}`,
      );
      return 0;
    }
    for (const r of released) {
      this.eventBus
        .publish({
          eventName: 'inventory.reservation.released',
          aggregate: 'StockReservation',
          aggregateId: r.reservationId,
          occurredAt: new Date(),
          payload: {
            reservationId: r.reservationId,
            mappingId: r.mappingId,
            quantity: r.quantity,
            orderId: r.orderId,
            customerId: r.customerId,
            sessionId: r.sessionId,
            cartId: r.cartId,
            cause,
            sellerId,
            adminId,
          },
        })
        .catch(() => {});
    }
    return released.length;
  }
}
