import { Inject, Injectable } from '@nestjs/common';
import { NotFoundAppException } from '../../../../core/exceptions';
import { SellerBankDetailsService } from '../../../seller/application/services/seller-bank-details.service';
import { AdminAuditService } from '../services/admin-audit.service';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface Input {
  adminId: string;
  sellerId: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  upiVpa?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Admin-side update of a seller's payout bank account. Sellers can no
 * longer self-edit after onboarding (the form is one-time), so this gives
 * an admin a supported path to correct/update the account. Reuses the
 * seller bank service (account-number encryption + format validation) and
 * writes an audit row.
 */
@Injectable()
export class AdminUpdateSellerBankUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly bankService: SellerBankDetailsService,
    private readonly auditService: AdminAuditService,
  ) {}

  async execute(input: Input) {
    const seller = await this.adminRepo.findSellerByIdWithSelect(input.sellerId, {
      id: true,
      isDeleted: true,
    });
    if (!seller || (seller as any).isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    const data = await this.bankService.upsert({
      sellerId: input.sellerId,
      accountHolderName: input.accountHolderName,
      accountNumber: input.accountNumber,
      ifscCode: input.ifscCode,
      bankName: input.bankName,
      upiVpa: input.upiVpa,
    });

    await this.auditService.log({
      adminId: input.adminId,
      sellerId: input.sellerId,
      actionType: 'SELLER_BANK_UPDATED',
      metadata: {
        accountNumberLast4: data.accountNumberLast4,
        bankName: data.bankName,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return data;
  }
}
