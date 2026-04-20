import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { EmailService } from '../../../../integrations/email/email.service';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface SendMessageInput {
  adminId: string;
  franchiseId: string;
  subject: string;
  message: string;
  channel?: string;
}

@Injectable()
export class AdminSendFranchiseMessageUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly emailService: EmailService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminSendFranchiseMessageUseCase');
  }

  async execute(input: SendMessageInput) {
    const { adminId, franchiseId, subject, message } = input;

    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    await this.emailService.send({
      to: franchise.email,
      subject,
      html: `<div style="font-family:sans-serif;max-width:600px">
        <h2 style="color:#2563eb">Message from SPORTSMART Admin</h2>
        <p>Hi ${franchise.ownerName},</p>
        <div style="background:#f9fafb;padding:16px;border-radius:8px;margin:16px 0">${message}</div>
        <p style="color:#6b7280;font-size:13px">This message was sent to your franchise account (${franchise.businessName}).</p>
      </div>`,
    });

    this.logger.log(`Admin ${adminId} sent message to franchise ${franchiseId}`);

    return { franchiseId, email: franchise.email, sent: true };
  }
}
