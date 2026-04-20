import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EmailService } from '../../../../integrations/email/email.service';
import { redactEmail } from '../../../../bootstrap/logging/log-redact';

@Injectable()
export class NotificationsPublicFacade {
  private readonly logger = new Logger(NotificationsPublicFacade.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Send a notification on the specified channel (email, sms, whatsapp).
   * Currently only email is implemented.
   */
  async sendNotification(params: {
    recipientId: string;
    channel: string;
    templateKey: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    const { recipientId, channel, templateKey, data } = params;

    try {
      if (channel === 'email') {
        // Look up recipient email from user/seller/admin tables
        const email = await this.resolveRecipientEmail(recipientId);
        if (!email) {
          this.logger.warn(`No email found for recipient ${recipientId}`);
          return;
        }

        const subject = (data.subject as string) || templateKey;
        const body = (data.body as string) || `Notification: ${templateKey}`;

        await this.emailService.send({
          to: email,
          subject,
          html: body,
        });

        this.logger.log(
          `Email notification sent to ${redactEmail(email)} [${templateKey}] recipient=${recipientId}`,
        );
      } else {
        this.logger.warn(`Channel "${channel}" is not yet implemented`);
      }
    } catch (error) {
      this.logger.error(`Failed to send ${channel} notification: ${(error as Error).message}`);
    }
  }

  /**
   * Send a pre-defined template to a recipient.
   */
  async sendTemplatedCommunication(
    templateId: string,
    recipientId: string,
    variables: Record<string, unknown>,
  ): Promise<void> {
    const email = await this.resolveRecipientEmail(recipientId);
    if (!email) {
      this.logger.warn(`No email found for recipient ${recipientId}`);
      return;
    }

    // Build HTML from variables
    let html = `<h2>${variables.title || templateId}</h2>`;
    if (variables.message) html += `<p>${variables.message}</p>`;
    if (variables.actionUrl) {
      html += `<p><a href="${variables.actionUrl}">${variables.actionLabel || 'Click here'}</a></p>`;
    }

    try {
      await this.emailService.send({
        to: email,
        subject: (variables.subject as string) || templateId,
        html,
      });
      this.logger.log(
        `Templated communication "${templateId}" sent to ${redactEmail(email)} recipient=${recipientId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send templated communication: ${(error as Error).message}`);
    }
  }

  /**
   * Send an operational reminder (e.g., accept deadline approaching).
   */
  async sendOperationalReminder(params: {
    recipientId: string;
    subject: string;
    message: string;
  }): Promise<void> {
    const email = await this.resolveRecipientEmail(
      (params as any).recipientId,
    );
    if (!email) return;

    try {
      await this.emailService.send({
        to: email,
        subject: (params as any).subject || 'Operational Reminder',
        html: `<p>${(params as any).message}</p>`,
      });
      this.logger.log(
        `Operational reminder sent to ${redactEmail(email)} recipient=${params.recipientId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send operational reminder: ${(error as Error).message}`);
    }
  }

  // ── Private helpers ─────────────────────────────────────────

  private async resolveRecipientEmail(recipientId: string): Promise<string | null> {
    // Try User table
    const user = await this.prisma.user.findUnique({
      where: { id: recipientId },
      select: { email: true },
    });
    if (user) return user.email;

    // Try Seller table
    const seller = await this.prisma.seller.findUnique({
      where: { id: recipientId },
      select: { email: true },
    });
    if (seller) return seller.email;

    // Try Admin table
    const admin = await this.prisma.admin.findUnique({
      where: { id: recipientId },
      select: { email: true },
    });
    if (admin) return admin.email;

    // Try FranchisePartner table
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: recipientId },
      select: { email: true },
    });
    if (franchise) return franchise.email;

    return null;
  }
}
