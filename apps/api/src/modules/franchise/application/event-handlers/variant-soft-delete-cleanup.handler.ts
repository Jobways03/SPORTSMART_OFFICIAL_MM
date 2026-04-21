import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

interface VariantSoftDeletedPayload {
  variantId: string;
  productId: string;
  deletedBy?: string;
}

/**
 * When a ProductVariant is soft-deleted in the catalog module, stop
 * every FranchiseCatalogMapping that pointed at it.
 *
 * Why this exists:
 *   - The repo's `findByFranchise*` queries already filter out dead-
 *     variant mappings (see franchise-catalog-variant-soft-delete.spec).
 *     That hides them from UI + business logic, which is the important
 *     part.
 *   - Without this handler, the mapping rows still sit in the DB with
 *     `approvalStatus = APPROVED, isActive = true`. Re-activating the
 *     variant later (by setting isDeleted back to false — rare but
 *     possible) would silently re-expose mappings the franchise never
 *     re-confirmed. That's bad.
 *   - Explicitly STOPPING the mapping makes the lifecycle auditable:
 *     admins can see in the catalog grid that a mapping was auto-
 *     stopped because the variant was deleted, and they can decide
 *     whether to re-approve (if the variant comes back).
 *
 * The handler is intentionally idempotent — the event may fire more
 * than once under emitAsync retry paths; running `updateMany` with a
 * narrow where clause is safe to repeat.
 */
@Injectable()
export class VariantSoftDeleteCleanupHandler {
  private readonly logger = new Logger(VariantSoftDeleteCleanupHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('catalog.variant.soft_deleted')
  async handleVariantSoftDeleted(
    event: DomainEvent<VariantSoftDeletedPayload>,
  ): Promise<void> {
    const { variantId } = event.payload;
    if (!variantId) {
      this.logger.warn(
        `catalog.variant.soft_deleted received with no variantId — ignoring`,
      );
      return;
    }

    try {
      const result = await this.prisma.franchiseCatalogMapping.updateMany({
        // Only touch rows that are still considered live. Prevents an
        // already-STOPPED mapping from getting its updatedAt bumped
        // every time the same variant-delete event replays. The
        // MappingApprovalStatus enum has only PENDING_APPROVAL,
        // APPROVED, STOPPED — so "not STOPPED" covers both live
        // states.
        where: {
          variantId,
          approvalStatus: { not: 'STOPPED' },
        },
        data: { approvalStatus: 'STOPPED', isActive: false },
      });

      if (result.count > 0) {
        this.logger.log(
          `Auto-stopped ${result.count} franchise mapping(s) after variant ${variantId} soft-delete`,
        );
      }
    } catch (err) {
      // Swallow — the mapping is already hidden from reads by the
      // catalog repo's soft-delete filter, so leaving it in its prior
      // state doesn't affect customers. Loud log so ops can follow up.
      this.logger.error(
        `Failed to auto-stop franchise mappings for variant ${variantId}: ${(err as Error).message}`,
      );
    }
  }
}
