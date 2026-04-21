import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException, BadRequestAppException } from '../../../../core/exceptions';
import { AdminAuditService } from '../services/admin-audit.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { SellerStatusTransitionPolicy } from '../../../seller/application/policies/seller-status-transition.policy';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface UpdateStatusInput {
  adminId: string;
  sellerId: string;
  status: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminUpdateSellerStatusUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly auditService: AdminAuditService,
    private readonly logger: AppLoggerService,
    private readonly audit: AuditPublicFacade,
    private readonly transitionPolicy: SellerStatusTransitionPolicy,
  ) {
    this.logger.setContext('AdminUpdateSellerStatusUseCase');
  }

  async execute(input: UpdateStatusInput) {
    const { adminId, sellerId, status, reason, ipAddress, userAgent } = input;

    const validStatuses = ['PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'DEACTIVATED'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestAppException(`Invalid status: ${status}`);
    }

    const seller = await this.adminRepo.findSellerByIdWithSelect(sellerId, {
      id: true,
      status: true,
      isDeleted: true,
    });

    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    // Delegates identity-checks + transition rules to the policy so
    // the state machine is testable in isolation and any future
    // mutator of seller.status hits the same gate.
    this.transitionPolicy.assertTransition(seller.status, status);

    const updated = await this.adminRepo.updateSeller(
      sellerId,
      { status: status as any },
      { id: true, status: true },
    );

    await this.auditService.log({
      adminId,
      sellerId,
      actionType: status === 'ACTIVE' ? 'SELLER_ENABLED' : 'SELLER_DISABLED',
      oldValue: { status: seller.status },
      newValue: { status },
      reason,
      ipAddress,
      userAgent,
    });

    // Also write to the central AuditLog table so the action surfaces in
    // the global audit history alongside non-admin events. The two writes
    // are intentionally separate for now: AdminActionAuditLog has admin-
    // specific columns, AuditLog is the canonical cross-cutting log.
    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'UPDATE_SELLER_STATUS',
        module: 'admin',
        resource: 'seller',
        resourceId: sellerId,
        oldValue: { status: seller.status },
        newValue: { status },
        metadata: { reason },
        ipAddress,
        userAgent,
      })
      .catch((err) => {
        this.logger.error(`Audit write failed: ${(err as Error).message}`);
      });

    this.logger.log(`Admin ${adminId} changed seller ${sellerId} status: ${seller.status} -> ${status}`);

    return { sellerId: updated.id, status: updated.status };
  }
}
