import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../bootstrap/events/domain-event.interface';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../bootstrap/logging/app-logger.service';
import { EnvService } from '../../../bootstrap/env/env.service';
import { EmailService } from '../email.service';

@Injectable()
export class EmailNotificationHandler {
  private readonly adminEmail: string;

  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly envService: EnvService,
  ) {
    this.logger.setContext('EmailNotificationHandler');
    this.adminEmail = this.envService.getString('ADMIN_SEED_EMAIL', 'admin@sportsmart.com');
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

  // ──── Order Events ────

  @OnEvent('orders.master.created')
  async onMasterOrderCreated(event: DomainEvent<{
    masterOrderId: string;
    orderNumber: string;
    customerId: string;
    totalAmount: number;
    itemCount: number;
  }>) {
    const { orderNumber, customerId, totalAmount, itemCount } = event.payload;
    this.logger.log(`Master order created: ${orderNumber}`);

    // 1. Customer order confirmation email
    try {
      const customer = await this.prisma.user.findUnique({
        where: { id: customerId },
        select: { email: true, firstName: true },
      });

      if (customer) {
        const formattedAmount = `\u20B9${Number(totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        await this.emailService.send({
          to: customer.email,
          subject: `Order Confirmed — #${orderNumber}`,
          html: this.wrap(`
            <h2 style="color: #15803d;">Thank you for your order!</h2>
            <p>Hi ${customer.firstName || 'there'},</p>
            <p>Your order has been placed successfully. Here are the details:</p>
            <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="margin: 0 0 8px 0;"><strong>Order #${orderNumber}</strong></p>
              <p style="margin: 0 0 4px 0;">${itemCount} item${itemCount !== 1 ? 's' : ''}</p>
              <p style="margin: 0; font-size: 18px; font-weight: 700; color: #2563eb;">${formattedAmount}</p>
            </div>
            <p>We'll send you updates as your order is processed and shipped.</p>
            <p style="font-size: 13px; color: #6b7280;">If you have any questions about your order, please contact our support team.</p>
          `),
          text: `Thank you for your order! Order #${orderNumber}, ${itemCount} items, total ${formattedAmount}. We'll send you updates as your order is processed.`,
        });
      }
    } catch (err) {
      this.logger.error(`Failed to send customer order confirmation email: ${err}`);
    }

    // 2. Admin notification — new order pending verification
    try {
      const formattedAmount = `\u20B9${Number(totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      await this.emailService.send({
        to: this.adminEmail,
        subject: `New Order #${orderNumber} — Pending Verification`,
        html: this.wrap(`
          <h2 style="color: #d97706;">New Order Placed</h2>
          <p>A new order has been placed and requires verification.</p>
          <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0 0 8px 0;"><strong>Order #${orderNumber}</strong></p>
            <p style="margin: 0 0 4px 0;">${itemCount} item${itemCount !== 1 ? 's' : ''}</p>
            <p style="margin: 0; font-size: 18px; font-weight: 700; color: #2563eb;">${formattedAmount}</p>
          </div>
          <p>Please log in to the admin dashboard to verify this order.</p>
        `),
        text: `New order #${orderNumber} placed (${itemCount} items, ${formattedAmount}). Please verify in the admin dashboard.`,
      });
    } catch (err) {
      this.logger.error(`Failed to send admin order notification email: ${err}`);
    }
  }

  @OnEvent('orders.sub_order.created')
  async onSubOrderCreated(event: DomainEvent<{
    subOrderId: string;
    masterOrderId: string;
    orderNumber: string;
    sellerId: string;
    sellerName: string | null;
    subTotal: number;
    itemCount: number;
    isReassignment?: boolean;
  }>) {
    const { sellerId, orderNumber, subTotal, itemCount, isReassignment } = event.payload;

    // Look up seller email
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { email: true, sellerName: true },
    });

    if (!seller) {
      this.logger.warn(`Seller ${sellerId} not found — cannot send order notification`);
      return;
    }

    const formattedAmount = `\u20B9${Number(subTotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const reassignmentNote = isReassignment
      ? '<p style="color: #d97706; font-weight: 600;">This order was reassigned to you from another seller.</p>'
      : '';

    await this.emailService.send({
      to: seller.email,
      subject: `New Order #${orderNumber} — SPORTSMART`,
      html: this.wrap(`
        <h2 style="color: #1f2937;">You have a new order!</h2>
        <p>Hi ${seller.sellerName},</p>
        ${reassignmentNote}
        <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0;"><strong>Order #${orderNumber}</strong></p>
          <p style="margin: 0 0 4px 0;">${itemCount} item${itemCount !== 1 ? 's' : ''}</p>
          <p style="margin: 0; font-size: 18px; font-weight: 700; color: #2563eb;">${formattedAmount}</p>
        </div>
        <p>Please log in to your seller dashboard to accept or reject this order.</p>
        <p style="font-size: 13px; color: #6b7280;">Orders that are not accepted within a reasonable time may be reassigned to another seller.</p>
      `),
      text: `You have a new order! Order #${orderNumber}, ${itemCount} items, total ${formattedAmount}. Log in to your seller dashboard to manage it.`,
    });
  }

  @OnEvent('orders.sub_order.cancelled')
  async onSubOrderCancelled(event: DomainEvent<{
    subOrderId: string;
    masterOrderId: string;
    orderNumber: string;
    customerId: string;
    reason: string;
  }>) {
    this.logger.log(`Sub-order cancelled: ${event.payload.subOrderId}, reason: ${event.payload.reason}`);
    // Could send customer notification about partial cancellation
  }

  @OnEvent('orders.sub_order.status_changed')
  async onSubOrderStatusChanged(event: DomainEvent<{
    subOrderId: string;
    sellerId: string;
    previousStatus: string;
    newStatus: string;
  }>) {
    this.logger.log(
      `Sub-order ${event.payload.subOrderId} status changed: ${event.payload.previousStatus} -> ${event.payload.newStatus}`,
    );
  }

  // ──── Catalog / Product Events ────

  @OnEvent('catalog.listing.submitted_for_qc')
  async onProductSubmittedForQc(event: DomainEvent<{
    productId: string;
    productTitle: string;
    sellerId: string;
  }>) {
    const { productTitle, sellerId } = event.payload;
    this.logger.log(`Product "${productTitle}" submitted for QC by seller ${sellerId}`);

    try {
      const seller = await this.findSeller(sellerId);
      const sellerName = seller?.sellerName || 'A seller';

      await this.emailService.send({
        to: this.adminEmail,
        subject: `New Product for Review — ${productTitle}`,
        html: this.wrap(`
          <h2 style="color: #d97706;">New Product Submitted for Review</h2>
          <p>A seller has submitted a new product for your review.</p>
          <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0 0 8px 0;"><strong>${productTitle}</strong></p>
            <p style="margin: 0; font-size: 13px; color: #6b7280;">Submitted by: ${sellerName}</p>
          </div>
          <p>Please log in to the admin dashboard to review and approve or reject this product.</p>
        `),
        text: `New product "${productTitle}" submitted for review by ${sellerName}. Please review in the admin dashboard.`,
      });
    } catch (err) {
      this.logger.error(`Failed to send admin product review notification email: ${err}`);
    }
  }

  @OnEvent('catalog.listing.approved')
  async onProductApproved(event: DomainEvent<{
    productId: string;
    productTitle: string;
    sellerId: string | null;
    adminId: string;
  }>) {
    const { productTitle, sellerId } = event.payload;
    this.logger.log(`Product "${productTitle}" approved for seller ${sellerId}`);

    if (!sellerId) {
      this.logger.warn(`No sellerId on approved product — cannot send approval notification`);
      return;
    }

    try {
      const seller = await this.findSeller(sellerId);
      if (!seller) {
        this.logger.warn(`Seller ${sellerId} not found — cannot send approval notification`);
        return;
      }

      await this.emailService.send({
        to: seller.email,
        subject: `Product Approved — ${productTitle}`,
        html: this.wrap(`
          <h2 style="color: #15803d;">Product Approved!</h2>
          <p>Hi ${seller.sellerName},</p>
          <p>Great news! Your product has been approved and is now active on the marketplace.</p>
          <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #bbf7d0;">
            <p style="margin: 0; font-weight: 600; color: #15803d;">${productTitle}</p>
          </div>
          <p>Customers can now find and purchase this product. Make sure your inventory is up to date.</p>
        `),
        text: `Hi ${seller.sellerName}, your product "${productTitle}" has been approved and is now active on the marketplace!`,
      });
    } catch (err) {
      this.logger.error(`Failed to send seller product approval email: ${err}`);
    }
  }

  @OnEvent('catalog.listing.rejected')
  async onProductRejected(event: DomainEvent<{
    productId: string;
    productTitle: string;
    sellerId: string | null;
    reason: string;
    adminId: string;
  }>) {
    const { productTitle, sellerId, reason } = event.payload;
    this.logger.log(`Product "${productTitle}" rejected for seller ${sellerId}`);

    if (!sellerId) {
      this.logger.warn(`No sellerId on rejected product — cannot send rejection notification`);
      return;
    }

    try {
      const seller = await this.findSeller(sellerId);
      if (!seller) {
        this.logger.warn(`Seller ${sellerId} not found — cannot send rejection notification`);
        return;
      }

      await this.emailService.send({
        to: seller.email,
        subject: `Product Rejected — ${productTitle}`,
        html: this.wrap(`
          <h2 style="color: #dc2626;">Product Rejected</h2>
          <p>Hi ${seller.sellerName},</p>
          <p>Unfortunately, your product has been rejected during review.</p>
          <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #fecaca;">
            <p style="margin: 0 0 8px 0; font-weight: 600; color: #dc2626;">${productTitle}</p>
            <p style="margin: 0; font-size: 13px; color: #7f1d1d;"><strong>Reason:</strong> ${reason || 'No reason provided'}</p>
          </div>
          <p>You can update your product and resubmit it for review from your seller dashboard.</p>
        `),
        text: `Hi ${seller.sellerName}, your product "${productTitle}" has been rejected. Reason: ${reason || 'No reason provided'}. You can update and resubmit from your dashboard.`,
      });
    } catch (err) {
      this.logger.error(`Failed to send seller product rejection email: ${err}`);
    }
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
