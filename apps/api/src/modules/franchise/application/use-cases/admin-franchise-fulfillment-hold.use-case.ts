import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

interface SetHoldInput {
  adminId: string;
  franchiseId: string;
  reason: string;
  ipAddress?: string;
  userAgent?: string;
}

interface ClearHoldInput {
  adminId: string;
  franchiseId: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 232 (eligible-node / allocation-preview audit) — SET / CLEAR a
 * risk/fraud FULFILLMENT HOLD on a franchise.
 *
 * The `FranchisePartner.fulfillmentHold` columns already exist and the
 * allocation engine already excludes any franchise with `fulfillmentHold =
 * true` from eligibility (it can neither be auto-routed nor manually
 * reassigned new orders). What was missing was an admin surface to toggle the
 * flag — until now it was only settable via raw SQL, which left the control
 * inert.
 *
 * Each action stamps the actor + timestamp (`fulfillmentHoldBy` /
 * `fulfillmentHoldAt`) and writes a hash-chained central AuditLog row. SET
 * requires a reason (mandatory at the DTO); CLEAR wipes the reason/at/by.
 *
 * Note (unlike the status use-case): a hold is a risk control, so it is NOT
 * blocked by in-flight orders — the whole point is to bench a node fast.
 * Existing accepted orders keep their current assignment; the hold only stops
 * *new* allocations.
 */
@Injectable()
export class AdminFranchiseFulfillmentHoldUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly audit: AuditPublicFacade,
  ) {
    this.logger.setContext('AdminFranchiseFulfillmentHoldUseCase');
  }

  async setHold(input: SetHoldInput) {
    const { adminId, franchiseId, ipAddress, userAgent } = input;
    // Mirror the franchise status use-case's cleanReason (strip HTML).
    const cleanReason = input.reason.replace(/<[^>]*>/g, '').trim();

    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true,
        isDeleted: true,
        fulfillmentHold: true,
        fulfillmentHoldReason: true,
      },
    });

    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    const now = new Date();
    await this.prisma.franchisePartner.update({
      where: { id: franchiseId },
      data: {
        fulfillmentHold: true,
        fulfillmentHoldReason: cleanReason,
        fulfillmentHoldAt: now,
        fulfillmentHoldBy: adminId,
      },
    });

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'FRANCHISE_FULFILLMENT_HOLD_SET',
        module: 'franchise',
        resource: 'FranchisePartner',
        resourceId: franchiseId,
        oldValue: {
          fulfillmentHold: franchise.fulfillmentHold,
          fulfillmentHoldReason: franchise.fulfillmentHoldReason,
        },
        newValue: { fulfillmentHold: true, fulfillmentHoldReason: cleanReason },
        metadata: { reason: cleanReason },
        ipAddress,
        userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for franchise fulfillment-hold set: ${err}`,
        ),
      );

    this.logger.log(
      `Admin ${adminId} placed fulfillment hold on franchise ${franchiseId}`,
    );

    return {
      franchiseId,
      fulfillmentHold: true,
      fulfillmentHoldReason: cleanReason,
      fulfillmentHoldAt: now,
      fulfillmentHoldBy: adminId,
    };
  }

  async clearHold(input: ClearHoldInput) {
    const { adminId, franchiseId, ipAddress, userAgent } = input;
    const cleanReason = input.reason
      ? input.reason.replace(/<[^>]*>/g, '').trim() || null
      : null;

    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true,
        isDeleted: true,
        fulfillmentHold: true,
        fulfillmentHoldReason: true,
      },
    });

    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    await this.prisma.franchisePartner.update({
      where: { id: franchiseId },
      data: {
        fulfillmentHold: false,
        fulfillmentHoldReason: null,
        fulfillmentHoldAt: null,
        fulfillmentHoldBy: null,
      },
    });

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'FRANCHISE_FULFILLMENT_HOLD_CLEARED',
        module: 'franchise',
        resource: 'FranchisePartner',
        resourceId: franchiseId,
        oldValue: {
          fulfillmentHold: franchise.fulfillmentHold,
          fulfillmentHoldReason: franchise.fulfillmentHoldReason,
        },
        newValue: { fulfillmentHold: false },
        metadata: { reason: cleanReason },
        ipAddress,
        userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for franchise fulfillment-hold clear: ${err}`,
        ),
      );

    this.logger.log(
      `Admin ${adminId} cleared fulfillment hold on franchise ${franchiseId}`,
    );

    return { franchiseId, fulfillmentHold: false };
  }
}
