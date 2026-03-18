import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException, BadRequestAppException } from '../../../../core/exceptions';
import { AdminAuditService } from '../services/admin-audit.service';

interface SendMessageInput {
  adminId: string;
  sellerId: string;
  subject: string;
  message: string;
  channel?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminSendSellerMessageUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AdminAuditService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminSendSellerMessageUseCase');
  }

  async execute(input: SendMessageInput) {
    const { adminId, sellerId, subject, message, channel = 'EMAIL', ipAddress, userAgent } = input;

    if (!subject || subject.trim().length === 0) {
      throw new BadRequestAppException('Subject is required');
    }
    if (subject.trim().length > 200) {
      throw new BadRequestAppException('Subject must not exceed 200 characters');
    }
    if (!message || message.trim().length === 0) {
      throw new BadRequestAppException('Message is required');
    }
    if (message.trim().length > 5000) {
      throw new BadRequestAppException('Message must not exceed 5000 characters');
    }

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, email: true, sellerName: true, isDeleted: true },
    });

    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    // Store message log
    const messageLog = await this.prisma.adminSellerMessage.create({
      data: {
        sellerId,
        sentByAdminId: adminId,
        subject: subject.trim(),
        message: message.trim(),
        channel,
        status: 'SENT',
      },
    });

    // TODO: Integrate actual email/SMS/notification sending here
    this.logger.warn(`[DEV] Message to seller ${seller.email}: "${subject.trim()}"`);

    await this.auditService.log({
      adminId,
      sellerId,
      actionType: 'SELLER_MESSAGE_SENT',
      metadata: { messageId: messageLog.id, channel, subject: subject.trim() },
      ipAddress,
      userAgent,
    });

    this.logger.log(`Admin ${adminId} sent message to seller ${sellerId}`);

    return {
      messageId: messageLog.id,
      sellerId,
      subject: messageLog.subject,
      channel: messageLog.channel,
      status: messageLog.status,
      createdAt: messageLog.createdAt,
    };
  }
}
