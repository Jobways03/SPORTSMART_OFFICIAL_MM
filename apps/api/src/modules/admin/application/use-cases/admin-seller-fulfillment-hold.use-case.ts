import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface SetHoldInput {
  adminId: string;
  sellerId: string;
  reason: string;
  ipAddress?: string;
  userAgent?: string;
}

interface ClearHoldInput {
  adminId: string;
  sellerId: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 232 (eligible-node / allocation-preview audit) — SET / CLEAR a
 * risk/fraud FULFILLMENT HOLD on a seller.
 *
 * The `Seller.fulfillmentHold` columns already exist and the allocation engine
 * already excludes any seller with `fulfillmentHold = true` from eligibility
 * (it can neither be auto-routed nor manually reassigned new orders). What was
 * missing was an admin surface to toggle the flag — until now it was only
 * settable via raw SQL, which left the control inert.
 *
 * Each action stamps the actor + timestamp (`fulfillmentHoldBy` /
 * `fulfillmentHoldAt`) and writes a hash-chained central AuditLog row. SET
 * requires a reason (mandatory at the DTO); CLEAR wipes the reason/at/by.
 */
@Injectable()
export class AdminSellerFulfillmentHoldUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly logger: AppLoggerService,
    private readonly audit: AuditPublicFacade,
  ) {
    this.logger.setContext('AdminSellerFulfillmentHoldUseCase');
  }

  async setHold(input: SetHoldInput) {
    const { adminId, sellerId, ipAddress, userAgent } = input;
    // Defense-in-depth: strip HTML even though the DTO charset guard already
    // blocks markup, mirroring the franchise status use-case's cleanReason.
    const cleanReason = input.reason.replace(/<[^>]*>/g, '').trim();

    const seller = await this.adminRepo.findSellerByIdWithSelect(sellerId, {
      id: true,
      isDeleted: true,
      fulfillmentHold: true,
      fulfillmentHoldReason: true,
    });

    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    const now = new Date();
    const updated = await this.adminRepo.updateSeller(
      sellerId,
      {
        fulfillmentHold: true,
        fulfillmentHoldReason: cleanReason,
        fulfillmentHoldAt: now,
        fulfillmentHoldBy: adminId,
      },
      { id: true, fulfillmentHold: true },
    );

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'SELLER_FULFILLMENT_HOLD_SET',
        module: 'admin',
        resource: 'seller',
        resourceId: sellerId,
        oldValue: {
          fulfillmentHold: seller.fulfillmentHold,
          fulfillmentHoldReason: seller.fulfillmentHoldReason,
        },
        newValue: { fulfillmentHold: true, fulfillmentHoldReason: cleanReason },
        metadata: { reason: cleanReason },
        ipAddress,
        userAgent,
      })
      .catch((err) => {
        this.logger.error(
          `Audit write failed for seller fulfillment-hold set: ${(err as Error).message}`,
        );
      });

    this.logger.log(
      `Admin ${adminId} placed fulfillment hold on seller ${sellerId}`,
    );

    return {
      sellerId: updated.id,
      fulfillmentHold: updated.fulfillmentHold,
      fulfillmentHoldReason: cleanReason,
      fulfillmentHoldAt: now,
      fulfillmentHoldBy: adminId,
    };
  }

  async clearHold(input: ClearHoldInput) {
    const { adminId, sellerId, ipAddress, userAgent } = input;
    const cleanReason = input.reason
      ? input.reason.replace(/<[^>]*>/g, '').trim() || null
      : null;

    const seller = await this.adminRepo.findSellerByIdWithSelect(sellerId, {
      id: true,
      isDeleted: true,
      fulfillmentHold: true,
      fulfillmentHoldReason: true,
    });

    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    const updated = await this.adminRepo.updateSeller(
      sellerId,
      {
        fulfillmentHold: false,
        fulfillmentHoldReason: null,
        fulfillmentHoldAt: null,
        fulfillmentHoldBy: null,
      },
      { id: true, fulfillmentHold: true },
    );

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'SELLER_FULFILLMENT_HOLD_CLEARED',
        module: 'admin',
        resource: 'seller',
        resourceId: sellerId,
        oldValue: {
          fulfillmentHold: seller.fulfillmentHold,
          fulfillmentHoldReason: seller.fulfillmentHoldReason,
        },
        newValue: { fulfillmentHold: false },
        metadata: { reason: cleanReason },
        ipAddress,
        userAgent,
      })
      .catch((err) => {
        this.logger.error(
          `Audit write failed for seller fulfillment-hold clear: ${(err as Error).message}`,
        );
      });

    this.logger.log(
      `Admin ${adminId} cleared fulfillment hold on seller ${sellerId}`,
    );

    return { sellerId: updated.id, fulfillmentHold: updated.fulfillmentHold };
  }
}
