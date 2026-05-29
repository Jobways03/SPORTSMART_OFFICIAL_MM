import { Injectable, Inject } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  NotFoundAppException,
  ForbiddenAppException,
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['APPROVED', 'DEACTIVATED'],
  APPROVED: ['ACTIVE', 'DEACTIVATED'],
  ACTIVE: ['SUSPENDED', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE', 'DEACTIVATED'],
  DEACTIVATED: ['ACTIVE'],
};

interface AdminUpdateFranchiseStatusInput {
  adminId: string;
  franchiseId: string;
  status: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 20 (2026-05-20) — Status-transition preconditions.
 *
 * The audit flagged that PENDING → APPROVED would succeed even when
 * the franchise hadn't verified email, hadn't submitted KYC, and had
 * no GSTIN/PAN on file. The new preconditions enforce:
 *
 *   PENDING → APPROVED:
 *     • isEmailVerified === true
 *     • verificationStatus === 'VERIFIED'
 *     • gstNumber present
 *     • panNumber present
 *
 *   APPROVED → ACTIVE:
 *     • verificationStatus === 'VERIFIED'  (defensive — should be by here)
 *     • bank details exist (so payouts can land)
 *
 * Also stamps the approval/activation audit columns (approvedAt /
 * approvedBy / activatedAt / activatedBy) so admin actions are
 * queryable.
 */
@Injectable()
export class AdminUpdateFranchiseStatusUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly audit: AuditPublicFacade,
    private readonly logger: AppLoggerService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.setContext('AdminUpdateFranchiseStatusUseCase');
  }

  async execute(input: AdminUpdateFranchiseStatusInput) {
    const { franchiseId, status, adminId } = input;
    // Phase 159i — strip HTML so the reason can't carry an XSS payload into
    // any admin UI / export that interpolates it.
    const cleanReason = input.reason
      ? input.reason.replace(/<[^>]*>/g, '').trim() || null
      : null;

    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true,
        status: true,
        isDeleted: true,
        verificationStatus: true,
        isEmailVerified: true,
        gstNumber: true,
        panNumber: true,
      },
    });

    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    const currentStatus = franchise.status;
    const allowedNextStatuses = ALLOWED_TRANSITIONS[currentStatus] || [];

    if (!allowedNextStatuses.includes(status)) {
      throw new ForbiddenAppException(
        `Cannot transition from ${currentStatus} to ${status}`,
      );
    }

    // Phase 20 (2026-05-20) — preconditions for the approval path.
    if (status === 'APPROVED') {
      if (!franchise.isEmailVerified) {
        throw new BadRequestAppException(
          'Cannot approve a franchise whose email is not verified.',
        );
      }
      if (franchise.verificationStatus !== 'VERIFIED') {
        throw new BadRequestAppException(
          `Cannot approve a franchise with verification status ${franchise.verificationStatus}. Verification must be VERIFIED first.`,
        );
      }
      if (!franchise.gstNumber) {
        throw new BadRequestAppException(
          'Cannot approve a franchise without a GSTIN on file.',
        );
      }
      if (!franchise.panNumber) {
        throw new BadRequestAppException(
          'Cannot approve a franchise without a PAN on file (required for TDS reporting).',
        );
      }
    }

    // Phase 159i (audit L1) — ANY transition INTO ACTIVE re-checks verification
    // + bank details. Previously only APPROVED→ACTIVE was gated, so a
    // DEACTIVATED/SUSPENDED → ACTIVE bypassed the KYC + payout-readiness gate.
    if (status === 'ACTIVE') {
      if (franchise.verificationStatus !== 'VERIFIED') {
        throw new BadRequestAppException(
          'Cannot activate a franchise whose verification status is not VERIFIED.',
        );
      }
      const hasBank = await this.prisma.franchiseBankDetails
        .findUnique({
          where: { franchisePartnerId: franchiseId },
          select: { id: true },
        })
        .then((r: { id: string } | null) => !!r)
        .catch(() => false);
      if (!hasBank) {
        throw new BadRequestAppException(
          'Cannot activate a franchise without bank details on file. Settlement payouts need them.',
        );
      }
    }

    // Block deactivation/suspension when franchise has active orders.
    if (['DEACTIVATED', 'SUSPENDED'].includes(status)) {
      const activeOrders = await this.prisma.subOrder.count({
        where: {
          franchiseId,
          fulfillmentNodeType: 'FRANCHISE',
          fulfillmentStatus: { in: ['UNFULFILLED', 'PACKED', 'SHIPPED'] },
          acceptStatus: { in: ['OPEN', 'ACCEPTED'] },
        },
      });
      if (activeOrders > 0) {
        throw new BadRequestAppException(
          `Cannot ${status.toLowerCase()} franchise — ${activeOrders} active order(s) still in progress`,
        );
      }
    }

    const now = new Date();
    // Phase 159i — stamp the dedicated actor/reason columns per transition
    // (approve/activate were already stamped; suspend/deactivate now too).
    const updateData: Record<string, unknown> = { status };
    if (status === 'APPROVED') {
      updateData.approvedAt = now;
      updateData.approvedBy = adminId;
    } else if (status === 'ACTIVE') {
      updateData.activatedAt = now;
      updateData.activatedBy = adminId;
    } else if (status === 'SUSPENDED') {
      updateData.suspendedAt = now;
      updateData.suspendedBy = adminId;
      updateData.suspensionReason = cleanReason;
    } else if (status === 'DEACTIVATED') {
      updateData.deactivatedAt = now;
      updateData.deactivatedBy = adminId;
      updateData.deactivationReason = cleanReason;
    }

    // Phase 159i (audit M4) — atomic version-CAS + an ordered status-history
    // row. The CAS (where status = currentStatus) makes a concurrent transition
    // lose instead of silently overwriting.
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.franchisePartner.updateMany({
        where: { id: franchiseId, status: currentStatus },
        data: updateData,
      });
      if (cas.count === 0) {
        throw new ConflictAppException(
          'Franchise status changed concurrently. Please reload and retry.',
        );
      }
      await tx.franchiseStatusHistory.create({
        data: {
          franchiseId,
          fromStatus: currentStatus,
          toStatus: status,
          changedByAdminId: adminId,
          reason: cleanReason,
        },
      });
    });

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action:
          status === 'APPROVED'
            ? 'FRANCHISE_APPROVED'
            : status === 'ACTIVE'
              ? 'FRANCHISE_ACTIVATED'
              : 'FRANCHISE_STATUS_CHANGED',
        module: 'franchise',
        resource: 'FranchisePartner',
        resourceId: franchiseId,
        oldValue: { status: currentStatus },
        newValue: { status },
        metadata: { reason: cleanReason },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((err) =>
        this.logger.error(`Audit log write failed for status change: ${err}`),
      );

    this.eventBus
      .publish({
        eventName: 'franchise.status_updated',
        aggregate: 'franchise',
        aggregateId: franchiseId,
        occurredAt: now,
        payload: {
          franchiseId,
          previousStatus: currentStatus,
          newStatus: status,
          reason: cleanReason,
        },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish franchise status update event: ${err}`);
      });

    this.logger.log(
      `Franchise status updated: ${franchiseId} from ${currentStatus} to ${status}`,
    );

    return { franchiseId, status };
  }
}
