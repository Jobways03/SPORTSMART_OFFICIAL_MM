import { Injectable, Inject } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
  ConflictAppException,
} from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface AdminUpdateFranchiseVerificationInput {
  adminId: string;
  franchiseId: string;
  verificationStatus: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 20 (2026-05-20) — Verification transitions are now guarded.
 *
 * Pre-Phase-20 the use case wrote `verificationStatus` blindly,
 * letting an admin flip VERIFIED → NOT_VERIFIED in one step or set
 * REJECTED on a never-submitted franchise. This map encodes the
 * legal transitions:
 *
 *   NOT_VERIFIED → UNDER_REVIEW
 *   UNDER_REVIEW → VERIFIED, REJECTED
 *   REJECTED     → UNDER_REVIEW     (re-submit path)
 *   VERIFIED     → NOT_VERIFIED     (explicit admin reset)
 *
 * The dedicated ApproveFranchiseUseCase / RejectFranchiseUseCase
 * (Phase 20 — added separately) write directly to the correct
 * verification columns + audit log; this generic endpoint stays
 * available as the admin "edge case" hatch.
 */
const ALLOWED_VERIFICATION_TRANSITIONS: Record<string, string[]> = {
  NOT_VERIFIED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['VERIFIED', 'REJECTED'],
  REJECTED: ['UNDER_REVIEW'],
  VERIFIED: ['NOT_VERIFIED'],
};

@Injectable()
export class AdminUpdateFranchiseVerificationUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly audit: AuditPublicFacade,
    private readonly logger: AppLoggerService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.setContext('AdminUpdateFranchiseVerificationUseCase');
  }

  async execute(input: AdminUpdateFranchiseVerificationInput) {
    const { franchiseId, verificationStatus, adminId } = input;

    // Phase 159j — strip HTML so a reviewer's reason can't carry an XSS
    // payload into any admin UI / export that interpolates it (mirrors the
    // status use-case). Persisted columns + the audit log get the clean value.
    const cleanReason = input.reason
      ? input.reason.replace(/<[^>]*>/g, '').trim() || null
      : null;

    // Phase 159j — read via prisma (was franchiseRepo.findById) so the same
    // connection backs the CAS + history row, and so we can pull the KYC
    // identifiers the VERIFIED gate needs without a second round-trip.
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        id: true,
        isDeleted: true,
        verificationStatus: true,
        panNumber: true,
        gstNumber: true,
      },
    });

    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    const previousStatus = franchise.verificationStatus;

    if (previousStatus === verificationStatus) {
      // Idempotent no-op — same state.
      return {
        franchiseId: franchise.id,
        verificationStatus: franchise.verificationStatus,
      };
    }

    const allowed = ALLOWED_VERIFICATION_TRANSITIONS[previousStatus] ?? [];
    if (!allowed.includes(verificationStatus)) {
      throw new BadRequestAppException(
        `Illegal verification transition: ${previousStatus} → ${verificationStatus}. Allowed: ${
          allowed.join(', ') || '(none)'
        }.`,
        'VERIFICATION_TRANSITION_FORBIDDEN',
      );
    }

    // Phase 159j (audit) — KYC-completeness gate. A franchise cannot be marked
    // VERIFIED unless the identifiers a reviewer is attesting to are actually
    // on file. Without this an admin could one-click VERIFIED on a row with no
    // PAN/GST, which then satisfies the status-activation gate
    // (admin-update-franchise-status: ACTIVE requires VERIFIED) and unlocks
    // payouts + TDS reporting against a franchise with no TIN on record.
    if (verificationStatus === 'VERIFIED') {
      if (!franchise.panNumber) {
        throw new BadRequestAppException(
          'Cannot mark a franchise VERIFIED without a PAN on file (required for TDS reporting).',
        );
      }
      if (!franchise.gstNumber) {
        throw new BadRequestAppException(
          'Cannot mark a franchise VERIFIED without a GSTIN on file.',
        );
      }
    }

    const now = new Date();
    const updateData: Record<string, unknown> = {
      verificationStatus,
      verificationReviewedAt: now,
      verificationReviewedBy: adminId,
    };
    if (verificationStatus === 'REJECTED') {
      updateData.verificationRejectionReason = cleanReason;
      updateData.verificationApprovalNotes = null;
    } else if (verificationStatus === 'VERIFIED') {
      updateData.verificationApprovalNotes = cleanReason;
      updateData.verificationRejectionReason = null;
    } else {
      // NOT_VERIFIED / UNDER_REVIEW — clear both notes columns.
      updateData.verificationRejectionReason = null;
      updateData.verificationApprovalNotes = null;
    }

    // Phase 159j (audit) — atomic status-CAS + an ordered verification-history
    // row, mirroring the status flow. The CAS (where verificationStatus =
    // previousStatus) makes a concurrent reviewer lose instead of silently
    // overwriting a verdict that changed out from under them.
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.franchisePartner.updateMany({
        where: { id: franchiseId, verificationStatus: previousStatus },
        data: updateData,
      });
      if (cas.count === 0) {
        throw new ConflictAppException(
          'Franchise verification changed concurrently. Please reload and retry.',
        );
      }
      await tx.franchiseVerificationEvent.create({
        data: {
          franchiseId,
          fromStatus: previousStatus,
          toStatus: verificationStatus,
          changedByAdminId: adminId,
          reason: cleanReason,
        },
      });
    });

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'FRANCHISE_VERIFICATION_CHANGED',
        module: 'franchise',
        resource: 'FranchisePartner',
        resourceId: franchiseId,
        oldValue: { verificationStatus: previousStatus },
        newValue: { verificationStatus },
        metadata: { reason: cleanReason },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for FRANCHISE_VERIFICATION_CHANGED: ${err}`,
        ),
      );

    this.eventBus
      .publish({
        eventName: 'franchise.verification_updated',
        aggregate: 'franchise',
        aggregateId: franchiseId,
        occurredAt: now,
        payload: {
          franchiseId,
          previousVerificationStatus: previousStatus,
          newVerificationStatus: verificationStatus,
          reason: cleanReason,
        },
      })
      .catch((err) => {
        this.logger.error(
          `Failed to publish franchise verification update event: ${err}`,
        );
      });

    this.logger.log(
      `Franchise verification updated: ${franchiseId} from ${previousStatus} to ${verificationStatus}`,
    );

    return {
      franchiseId,
      verificationStatus,
    };
  }
}
