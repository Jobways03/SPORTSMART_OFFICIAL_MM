import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { FranchiseBankDetailsService } from '../services/franchise-bank-details.service';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface Input {
  adminId: string;
  franchiseId: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  upiVpa?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Admin-side update of a franchise's payout bank account. Franchises set this
 * once during onboarding and can't self-edit afterwards, so this is the
 * supported correction path (parity with the seller side). Reuses
 * FranchiseBankDetailsService (AES-256-GCM account-number encryption + format
 * validation) and writes a hash-chained audit row. Mirrors
 * AdminUpdateSellerBankUseCase.
 */
@Injectable()
export class AdminUpdateFranchiseBankUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly bankService: FranchiseBankDetailsService,
    private readonly audit: AuditPublicFacade,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminUpdateFranchiseBankUseCase');
  }

  async execute(input: Input) {
    const franchise = await this.franchiseRepo.findById(input.franchiseId);
    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    const data = await this.bankService.upsert({
      franchisePartnerId: input.franchiseId,
      accountHolderName: input.accountHolderName,
      accountNumber: input.accountNumber,
      ifscCode: input.ifscCode,
      bankName: input.bankName,
      upiVpa: input.upiVpa,
    });

    // Sensitive payout-account change — hash-chained audit row, fire-and-forget
    // (same pattern as the franchise status/verification transitions).
    this.audit
      .writeAuditLog({
        actorId: input.adminId,
        actorRole: 'ADMIN',
        action: 'FRANCHISE_BANK_UPDATED',
        module: 'franchise',
        resource: 'FranchiseBankDetails',
        resourceId: input.franchiseId,
        newValue: {
          accountNumberLast4: data.accountNumberLast4,
          bankName: data.bankName,
          ifscCode: data.ifscCode,
        },
        metadata: { source: 'admin-edit' },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((err) =>
        this.logger.error(`Audit log write failed for bank update: ${err}`),
      );

    this.logger.log(
      `Admin ${input.adminId} updated bank details for franchise ${input.franchiseId}`,
    );

    return data;
  }
}
