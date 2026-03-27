import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException, BadRequestAppException } from '../../../../core/exceptions';
import { AdminAuditService } from '../services/admin-audit.service';
import { EmailService } from '../../../../integrations/email/email.service';

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
    private readonly emailService: EmailService,
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

    // Send email to seller
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a56db; padding: 20px; text-align: center;">
          <h1 style="color: #fff; margin: 0; font-size: 22px;">SPORTSMART</h1>
          <p style="color: #dbeafe; margin: 4px 0 0; font-size: 13px;">Seller Portal</p>
        </div>
        <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none;">
          <p style="margin: 0 0 8px; color: #374151;">Hi <strong>${seller.sellerName}</strong>,</p>
          <p style="margin: 0 0 16px; color: #374151;">You have a new message from the SPORTSMART admin team:</p>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <p style="margin: 0 0 8px; font-weight: 600; color: #111827;">${subject.trim()}</p>
            <p style="margin: 0; color: #374151; white-space: pre-wrap;">${message.trim()}</p>
          </div>
          <p style="margin: 0; font-size: 13px; color: #6b7280;">
            If you have questions, log in to your seller dashboard or reply to this email.
          </p>
        </div>
        <div style="padding: 16px; text-align: center; font-size: 12px; color: #9ca3af;">
          &copy; SPORTSMART Marketplace
        </div>
      </div>
    `;

    const emailSent = await this.emailService.send({
      to: seller.email,
      subject: `SPORTSMART: ${subject.trim()}`,
      html: emailHtml,
      text: `Hi ${seller.sellerName},\n\nYou have a new message from the SPORTSMART admin team:\n\nSubject: ${subject.trim()}\n\n${message.trim()}\n\n— SPORTSMART Marketplace`,
    });

    if (!emailSent) {
      this.logger.warn(`Email delivery failed for seller ${seller.email}, message logged to DB only`);
    }

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
