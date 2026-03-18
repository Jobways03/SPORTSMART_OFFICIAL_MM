import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../bootstrap/events/domain-event.interface';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../bootstrap/logging/app-logger.service';
import { EmailService } from '../email.service';

@Injectable()
export class EmailNotificationHandler {
  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('EmailNotificationHandler');
  }

  // ──── Seller Events ────

  @OnEvent('seller.registered')
  async onSellerRegistered(event: DomainEvent<{ sellerId: string; email: string }>) {
    const { email } = event.payload;
    await this.emailService.send({
      to: email,
      subject: 'Welcome to SPORTSMART Marketplace!',
      html: this.wrap(`
        <h2 style="color: #1f2937;">Welcome to SPORTSMART!</h2>
        <p>Thank you for registering as a seller on our marketplace.</p>
        <p>Your account is currently <strong>pending admin approval</strong>. Here's what to do next:</p>
        <ol style="color: #374151; line-height: 1.8;">
          <li>Verify your email address from your seller dashboard</li>
          <li>Complete your seller profile</li>
          <li>Wait for admin approval</li>
          <li>Once approved, start adding products!</li>
        </ol>
        <p>We'll notify you as soon as your account is reviewed.</p>
      `),
      text: 'Welcome to SPORTSMART! Your seller account is pending admin approval. Please verify your email and complete your profile.',
    });
  }

  @OnEvent('seller.email_verified')
  async onSellerEmailVerified(event: DomainEvent<{ sellerId: string }>) {
    const seller = await this.findSeller(event.payload.sellerId);
    if (!seller) return;
    await this.emailService.send({
      to: seller.email,
      subject: 'Email Verified — SPORTSMART',
      html: this.wrap(`
        <h2 style="color: #15803d;">Email Verified Successfully!</h2>
        <p>Hi ${seller.sellerName},</p>
        <p>Your email address has been verified. ${
          seller.status === 'ACTIVE'
            ? 'You can now start adding products to your store.'
            : 'Your account is still pending admin approval. We will notify you once it is activated.'
        }</p>
      `),
      text: `Hi ${seller.sellerName}, your email has been verified successfully.`,
    });
  }

  @OnEvent('seller.account_locked')
  async onSellerAccountLocked(event: DomainEvent<{ sellerId: string; lockUntil: Date }>) {
    const seller = await this.findSeller(event.payload.sellerId);
    if (!seller) return;
    await this.emailService.send({
      to: seller.email,
      subject: 'Account Temporarily Locked — SPORTSMART',
      html: this.wrap(`
        <h2 style="color: #dc2626;">Account Temporarily Locked</h2>
        <p>Hi ${seller.sellerName},</p>
        <p>Your seller account has been temporarily locked due to multiple failed login attempts.</p>
        <p>You can try logging in again after <strong>${new Date(event.payload.lockUntil).toLocaleString()}</strong>.</p>
        <p>If you did not attempt to log in, please reset your password immediately.</p>
      `),
      text: `Hi ${seller.sellerName}, your account has been temporarily locked due to multiple failed login attempts.`,
    });
  }

  @OnEvent('seller.password_reset_completed')
  async onSellerPasswordResetCompleted(event: DomainEvent<{ sellerId: string }>) {
    const seller = await this.findSeller(event.payload.sellerId);
    if (!seller) return;
    await this.emailService.send({
      to: seller.email,
      subject: 'Password Reset Successful — SPORTSMART',
      html: this.wrap(`
        <h2 style="color: #1f2937;">Password Reset Successful</h2>
        <p>Hi ${seller.sellerName},</p>
        <p>Your password has been reset successfully. All existing sessions have been revoked for security.</p>
        <p>If you did not make this change, please contact support immediately.</p>
      `),
      text: `Hi ${seller.sellerName}, your password has been reset successfully.`,
    });
  }

  @OnEvent('seller.password_changed')
  async onSellerPasswordChanged(event: DomainEvent<{ sellerId: string }>) {
    const seller = await this.findSeller(event.payload.sellerId);
    if (!seller) return;
    await this.emailService.send({
      to: seller.email,
      subject: 'Password Changed — SPORTSMART',
      html: this.wrap(`
        <h2 style="color: #1f2937;">Password Changed</h2>
        <p>Hi ${seller.sellerName},</p>
        <p>Your seller account password was changed successfully.</p>
        <p>If you did not make this change, please reset your password immediately and contact support.</p>
      `),
      text: `Hi ${seller.sellerName}, your password has been changed successfully.`,
    });
  }

  // ──── Admin User Events ────

  @OnEvent('identity.user.password_reset_completed')
  async onUserPasswordResetCompleted(event: DomainEvent<{ userId: string }>) {
    const user = await this.prisma.user.findUnique({
      where: { id: event.payload.userId },
      select: { email: true, firstName: true },
    });
    if (!user) return;
    await this.emailService.send({
      to: user.email,
      subject: 'Password Reset Successful — SPORTSMART Admin',
      html: this.wrap(`
        <h2 style="color: #1f2937;">Password Reset Successful</h2>
        <p>Hi ${user.firstName},</p>
        <p>Your admin password has been reset successfully. All sessions have been revoked.</p>
        <p>If you did not make this change, contact your administrator immediately.</p>
      `),
      text: `Hi ${user.firstName}, your admin password has been reset successfully.`,
    });
  }

  // ──── Helpers ────

  private async findSeller(sellerId: string) {
    return this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { email: true, sellerName: true, status: true },
    });
  }

  private wrap(body: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e5e7eb;">
          <h1 style="color: #2563eb; margin: 0; font-size: 20px; letter-spacing: 2px;">SPORTSMART</h1>
        </div>
        ${body}
        <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            This is an automated message from SPORTSMART Marketplace. Please do not reply.
          </p>
        </div>
      </div>
    `;
  }
}
