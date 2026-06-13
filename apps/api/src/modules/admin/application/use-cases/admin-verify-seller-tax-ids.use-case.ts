import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../core/exceptions';
import { AdminAuditService } from '../services/admin-audit.service';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface VerifyInput {
  adminId: string;
  sellerId: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 254 — manual admin verification of a seller's statutory tax IDs.
 *
 * Two separate confirmations, both reachable from the seller detail page:
 *
 *   verifyPan  — flips Seller.panVerified=true. This is the flag the §194-O
 *                TDS engine keys off (Tds194OService.computeForSeller):
 *                an UNVERIFIED PAN forces the §206AA penalty rate (5%);
 *                a VERIFIED PAN drops it to the admin-configured rate (1%).
 *                Nothing else in the app wrote this flag before, so a seller
 *                could never reach the 1% rate through the UI.
 *
 *   verifyGst  — flips Seller.isGstVerified + isGstinManuallyVerified=true and
 *                stamps gstVerifiedAt/By. Manual confirmation that the admin
 *                checked the GSTIN on the portal (the automated GSTN provider
 *                is a stub today). Feeds tax invoicing, NOT the TDS rate.
 *
 * Both are idempotent (re-verifying an already-verified ID returns success
 * without a second write) and write a tamper-evident audit row.
 */
@Injectable()
export class AdminVerifySellerTaxIdsUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly auditService: AdminAuditService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminVerifySellerTaxIdsUseCase');
  }

  async verifyPan(input: VerifyInput) {
    const { adminId, sellerId, reason, ipAddress, userAgent } = input;

    const seller = await this.adminRepo.findSellerByIdWithSelect(sellerId, {
      id: true,
      isDeleted: true,
      panNumber: true,
      panVerified: true,
    });
    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }
    if (!seller.panNumber) {
      throw new BadRequestAppException(
        'Seller has no PAN on file. The seller must submit a PAN via onboarding before it can be verified.',
      );
    }
    if (seller.panVerified === true) {
      return { sellerId: seller.id, panVerified: true, alreadyVerified: true };
    }

    const updated = await this.adminRepo.updateSeller(
      sellerId,
      { panVerified: true },
      { id: true, panVerified: true },
    );

    await this.auditService.log({
      adminId,
      sellerId,
      actionType: 'SELLER_PAN_VERIFIED',
      oldValue: { panVerified: false },
      newValue: { panVerified: true },
      reason,
      ipAddress,
      userAgent,
    });

    this.logger.log(
      `Admin ${adminId} verified PAN for seller ${sellerId} — §194-O TDS now ` +
        `uses the configured rate (no §206AA penalty).`,
    );

    return {
      sellerId: updated.id,
      panVerified: updated.panVerified,
      alreadyVerified: false,
    };
  }

  async verifyGst(input: VerifyInput) {
    const { adminId, sellerId, reason, ipAddress, userAgent } = input;

    const seller = await this.adminRepo.findSellerByIdWithSelect(sellerId, {
      id: true,
      isDeleted: true,
      gstin: true,
      isGstVerified: true,
    });
    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }
    if (!seller.gstin) {
      throw new BadRequestAppException(
        'Seller has no GSTIN on file. The seller must submit a GSTIN via onboarding before it can be verified.',
      );
    }
    if (seller.isGstVerified === true) {
      return {
        sellerId: seller.id,
        isGstVerified: true,
        alreadyVerified: true,
      };
    }

    const now = new Date();
    const updated = await this.adminRepo.updateSeller(
      sellerId,
      {
        isGstVerified: true,
        isGstinManuallyVerified: true,
        gstVerifiedAt: now,
        gstVerifiedBy: adminId,
      },
      { id: true, isGstVerified: true },
    );

    await this.auditService.log({
      adminId,
      sellerId,
      actionType: 'SELLER_GST_VERIFIED',
      oldValue: { isGstVerified: false },
      newValue: {
        isGstVerified: true,
        isGstinManuallyVerified: true,
        method: 'MANUAL',
      },
      reason,
      ipAddress,
      userAgent,
    });

    this.logger.log(
      `Admin ${adminId} manually verified GSTIN for seller ${sellerId}.`,
    );

    return {
      sellerId: updated.id,
      isGstVerified: updated.isGstVerified,
      alreadyVerified: false,
    };
  }
}
