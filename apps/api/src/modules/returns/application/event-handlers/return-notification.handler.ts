import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailService } from '../../../../integrations/email/email.service';

@Injectable()
export class ReturnNotificationHandler {
  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ReturnNotificationHandler');
  }

  // Helper to get customer email + name + return + order details
  private async getReturnContext(returnId: string) {
    const ret = await this.prisma.return.findUnique({
      where: { id: returnId },
      include: {
        customer: { select: { firstName: true, lastName: true, email: true } },
        masterOrder: { select: { orderNumber: true, totalAmount: true } },
      },
    });
    return ret;
  }

  private wrapTemplate(content: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #1f2937; margin: 0;">SPORTSMART</h2>
        </div>
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px;">
          ${content}
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 24px;">
          Thank you for shopping with SPORTSMART. If you have questions, contact our support team.
        </p>
      </div>
    `;
  }

  @OnEvent('returns.return.requested')
  async onRequested(event: DomainEvent<{ returnId: string; returnNumber: string; itemCount: number }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = `
        <h3 style="color: #1f2937; margin-top: 0;">Return Request Received</h3>
        <p>Hi ${name},</p>
        <p>We've received your return request for order <strong>${ret.masterOrder.orderNumber}</strong>.</p>
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Return Number:</strong> ${ret.returnNumber}</p>
          <p style="margin: 4px 0;"><strong>Items:</strong> ${event.payload.itemCount}</p>
          <p style="margin: 4px 0;"><strong>Status:</strong> Pending Review</p>
        </div>
        <p>Our team will review your request shortly. You'll receive an update once it's been processed.</p>
      `;

      await this.emailService.send({
        to: ret.customer.email,
        subject: `Return Request ${ret.returnNumber} Received - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send return.requested email: ${(err as Error).message}`);
    }
  }

  @OnEvent('returns.return.approved')
  async onApproved(event: DomainEvent<{ returnId: string; returnNumber: string; autoApproved: boolean }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = `
        <h3 style="color: #16a34a; margin-top: 0;">Return Approved</h3>
        <p>Hi ${name},</p>
        <p>Your return request <strong>${ret.returnNumber}</strong> has been approved${event.payload.autoApproved ? ' automatically' : ''}.</p>
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Order:</strong> ${ret.masterOrder.orderNumber}</p>
          <p style="margin: 4px 0;"><strong>Status:</strong> Approved</p>
        </div>
        <p>We'll arrange a pickup soon. You'll receive a notification with the pickup details.</p>
      `;

      await this.emailService.send({
        to: ret.customer.email,
        subject: `Return ${ret.returnNumber} Approved - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send return.approved email: ${(err as Error).message}`);
    }
  }

  @OnEvent('returns.return.rejected')
  async onRejected(event: DomainEvent<{ returnId: string; returnNumber: string; reason: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = `
        <h3 style="color: #dc2626; margin-top: 0;">Return Request Rejected</h3>
        <p>Hi ${name},</p>
        <p>Unfortunately, your return request <strong>${ret.returnNumber}</strong> has been rejected.</p>
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Reason:</strong> ${event.payload.reason}</p>
        </div>
        <p>If you believe this is an error, please contact our support team.</p>
      `;

      await this.emailService.send({
        to: ret.customer.email,
        subject: `Return ${ret.returnNumber} Rejected - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send return.rejected email: ${(err as Error).message}`);
    }
  }

  @OnEvent('returns.return.pickup_scheduled')
  async onPickupScheduled(event: DomainEvent<{ returnId: string; returnNumber: string; pickupScheduledAt: Date; tracking?: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const pickupDate = new Date(event.payload.pickupScheduledAt).toLocaleDateString('en-IN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });

      const content = `
        <h3 style="color: #2563eb; margin-top: 0;">Pickup Scheduled</h3>
        <p>Hi ${name},</p>
        <p>A pickup has been scheduled for your return <strong>${ret.returnNumber}</strong>.</p>
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Pickup Date:</strong> ${pickupDate}</p>
          ${event.payload.tracking ? `<p style="margin: 4px 0;"><strong>Tracking Number:</strong> ${event.payload.tracking}</p>` : ''}
        </div>
        <p>Please keep the items packaged and ready for pickup.</p>
      `;

      await this.emailService.send({
        to: ret.customer.email,
        subject: `Pickup Scheduled - Return ${ret.returnNumber} - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send return.pickup_scheduled email: ${(err as Error).message}`);
    }
  }

  @OnEvent('returns.return.in_transit')
  async onInTransit(event: DomainEvent<{ returnId: string; returnNumber: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = `
        <h3 style="color: #2563eb; margin-top: 0;">Return In Transit</h3>
        <p>Hi ${name},</p>
        <p>Your return <strong>${ret.returnNumber}</strong> is now in transit to our warehouse.</p>
        <p>We'll inspect the items once received and process your refund accordingly.</p>
      `;

      await this.emailService.send({
        to: ret.customer.email,
        subject: `Return ${ret.returnNumber} In Transit - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send return.in_transit email: ${(err as Error).message}`);
    }
  }

  @OnEvent('returns.return.received')
  async onReceived(event: DomainEvent<{ returnId: string; returnNumber: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = `
        <h3 style="color: #2563eb; margin-top: 0;">Return Received at Warehouse</h3>
        <p>Hi ${name},</p>
        <p>Your return <strong>${ret.returnNumber}</strong> has been received at our warehouse.</p>
        <p>Our team will inspect the items shortly and update you on the next steps.</p>
      `;

      await this.emailService.send({
        to: ret.customer.email,
        subject: `Return ${ret.returnNumber} Received - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send return.received email: ${(err as Error).message}`);
    }
  }

  @OnEvent('returns.return.qc_completed')
  async onQcCompleted(event: DomainEvent<{ returnId: string; returnNumber: string; qcDecision: string; refundAmount: number }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const decisionText = {
        'APPROVED': 'fully approved',
        'PARTIAL': 'partially approved',
        'REJECTED': 'rejected',
        'DAMAGED': 'flagged for review',
      }[event.payload.qcDecision] || event.payload.qcDecision;

      const headerColor = event.payload.qcDecision === 'REJECTED' ? '#dc2626' : '#16a34a';

      const content = `
        <h3 style="color: ${headerColor}; margin-top: 0;">Quality Check Complete</h3>
        <p>Hi ${name},</p>
        <p>The quality check for your return <strong>${ret.returnNumber}</strong> is complete. Your return has been ${decisionText}.</p>
        ${event.payload.refundAmount > 0 ? `
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Refund Amount:</strong> \u20B9${event.payload.refundAmount.toFixed(2)}</p>
        </div>
        <p>Your refund will be processed shortly. We'll send you another notification once it's complete.</p>
        ` : `
        <p>No refund will be issued for this return.</p>
        `}
      `;

      await this.emailService.send({
        to: ret.customer.email,
        subject: `QC Complete - Return ${ret.returnNumber} - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send return.qc_completed email: ${(err as Error).message}`);
    }
  }

  @OnEvent('returns.refund.initiated')
  async onRefundInitiated(event: DomainEvent<{ returnId: string; returnNumber: string; refundAmount: number; refundMethod: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const methodText = {
        'ORIGINAL_PAYMENT': 'your original payment method',
        'BANK_TRANSFER': 'bank transfer',
        'WALLET': 'your SPORTSMART wallet',
        'CASH': 'cash',
      }[event.payload.refundMethod] || event.payload.refundMethod;

      const content = `
        <h3 style="color: #2563eb; margin-top: 0;">Refund Processing</h3>
        <p>Hi ${name},</p>
        <p>We've initiated the refund for your return <strong>${ret.returnNumber}</strong>.</p>
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Refund Amount:</strong> \u20B9${event.payload.refundAmount.toFixed(2)}</p>
          <p style="margin: 4px 0;"><strong>Refund Method:</strong> ${methodText}</p>
        </div>
        <p>Refunds typically take 5-7 business days to reflect in your account.</p>
      `;

      await this.emailService.send({
        to: ret.customer.email,
        subject: `Refund Initiated - Return ${ret.returnNumber} - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send returns.refund.initiated email: ${(err as Error).message}`);
    }
  }

  @OnEvent('returns.refund.completed')
  async onRefundCompleted(event: DomainEvent<{ returnId: string; returnNumber: string; refundAmount: number; refundReference: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = `
        <h3 style="color: #16a34a; margin-top: 0;">Refund Completed</h3>
        <p>Hi ${name},</p>
        <p>Your refund for return <strong>${ret.returnNumber}</strong> has been completed.</p>
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Refund Amount:</strong> \u20B9${event.payload.refundAmount.toFixed(2)}</p>
          <p style="margin: 4px 0;"><strong>Reference:</strong> ${event.payload.refundReference}</p>
        </div>
        <p>The refund should reflect in your account within a few hours to a few days, depending on your bank.</p>
        <p>Thank you for shopping with SPORTSMART!</p>
      `;

      await this.emailService.send({
        to: ret.customer.email,
        subject: `Refund Completed - Return ${ret.returnNumber} - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send returns.refund.completed email: ${(err as Error).message}`);
    }
  }

  // ── Seller / franchise notifications ──────────────────────────────

  /**
   * Resolve the fulfillment node for a return (seller or franchise) and
   * return their email + name. Returns null if lookup fails.
   */
  private async getNodeContext(returnId: string): Promise<{
    email: string;
    name: string;
    nodeType: 'SELLER' | 'FRANCHISE';
  } | null> {
    const ret = await this.prisma.return.findUnique({
      where: { id: returnId },
      select: {
        subOrder: {
          select: {
            fulfillmentNodeType: true,
            sellerId: true,
            franchiseId: true,
          },
        },
      },
    });
    if (!ret?.subOrder) return null;
    const so = ret.subOrder;
    if (so.fulfillmentNodeType === 'FRANCHISE' && so.franchiseId) {
      const f = await this.prisma.franchisePartner.findUnique({
        where: { id: so.franchiseId },
        select: { email: true, ownerName: true, businessName: true },
      });
      if (!f) return null;
      return {
        email: f.email,
        name: f.ownerName || f.businessName,
        nodeType: 'FRANCHISE',
      };
    }
    if (so.sellerId) {
      const s = await this.prisma.seller.findUnique({
        where: { id: so.sellerId },
        select: { email: true, sellerName: true },
      });
      if (!s) return null;
      return { email: s.email, name: s.sellerName, nodeType: 'SELLER' };
    }
    return null;
  }

  @OnEvent('returns.return.requested')
  async onRequestedNodeNotify(event: DomainEvent<{ returnId: string; returnNumber: string; itemCount: number }>) {
    try {
      const node = await this.getNodeContext(event.payload.returnId);
      if (!node) return;
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret) return;

      await this.emailService.send({
        to: node.email,
        subject: `Return request ${ret.returnNumber} — Action needed`,
        html: this.wrapTemplate(`
          <h3 style="color: #d97706; margin-top: 0;">New Return Request</h3>
          <p>Hi ${node.name},</p>
          <p>A return has been requested for order <strong>${ret.masterOrder.orderNumber}</strong>.</p>
          <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Return Number:</strong> ${ret.returnNumber}</p>
            <p style="margin: 4px 0;"><strong>Items:</strong> ${event.payload.itemCount}</p>
          </div>
          <p>Please review this return in your dashboard and prepare for the pickup / QC inspection.</p>
        `),
      });
    } catch (err) {
      this.logger.error(`Failed to send node return.requested email: ${(err as Error).message}`);
    }
  }

  @OnEvent('returns.return.qc_completed')
  async onQcCompletedNodeNotify(event: DomainEvent<{
    returnId: string;
    returnNumber: string;
    qcDecision: string;
    approvedItemCount: number;
    totalItemCount: number;
  }>) {
    try {
      const node = await this.getNodeContext(event.payload.returnId);
      if (!node) return;

      const decision = event.payload.qcDecision;
      const color =
        decision === 'APPROVED'
          ? '#15803d'
          : decision === 'REJECTED'
            ? '#dc2626'
            : '#d97706';

      await this.emailService.send({
        to: node.email,
        subject: `QC ${decision} — Return ${event.payload.returnNumber}`,
        html: this.wrapTemplate(`
          <h3 style="color: ${color}; margin-top: 0;">QC ${decision}</h3>
          <p>Hi ${node.name},</p>
          <p>Quality check for return <strong>${event.payload.returnNumber}</strong> is complete.</p>
          <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Decision:</strong> ${decision}</p>
            <p style="margin: 4px 0;"><strong>Approved items:</strong> ${event.payload.approvedItemCount} of ${event.payload.totalItemCount}</p>
          </div>
          <p>${decision === 'APPROVED' || decision === 'PARTIALLY_APPROVED'
            ? 'The commission reversal and refund will be processed shortly. Your inventory has been updated.'
            : 'No commission adjustment will be made for rejected items.'}</p>
        `),
      });
    } catch (err) {
      this.logger.error(`Failed to send node qc_completed email: ${(err as Error).message}`);
    }
  }

  @OnEvent('returns.refund.completed')
  async onRefundCompletedNodeNotify(event: DomainEvent<{
    returnId: string;
    returnNumber: string;
    refundAmount: number;
    refundReference: string;
  }>) {
    try {
      const node = await this.getNodeContext(event.payload.returnId);
      if (!node) return;

      const fmt = `\u20B9${Number(event.payload.refundAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      await this.emailService.send({
        to: node.email,
        subject: `Refund completed — Return ${event.payload.returnNumber}`,
        html: this.wrapTemplate(`
          <h3 style="color: #15803d; margin-top: 0;">Refund Processed</h3>
          <p>Hi ${node.name},</p>
          <p>The refund for return <strong>${event.payload.returnNumber}</strong> has been processed.</p>
          <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Refund amount:</strong> ${fmt}</p>
            <p style="margin: 4px 0;"><strong>Reference:</strong> ${event.payload.refundReference}</p>
          </div>
          <p style="font-size: 13px; color: #6b7280;">The corresponding commission adjustment has been applied to your account. Check your earnings dashboard for details.</p>
        `),
      });
    } catch (err) {
      this.logger.error(`Failed to send node refund.completed email: ${(err as Error).message}`);
    }
  }

  @OnEvent('returns.return.stale_escalation')
  async onStaleEscalation(event: DomainEvent<{
    returnId: string;
    returnNumber: string;
    currentStatus: string;
    staleDays: number;
  }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret) return;
      // Notify admin via existing admin email
      const adminEmail = 'admin@sportsmart.com';
      await this.emailService.send({
        to: adminEmail,
        subject: `Stale return escalation — ${event.payload.returnNumber}`,
        html: this.wrapTemplate(`
          <h3 style="color: #dc2626; margin-top: 0;">Stale Return Needs Attention</h3>
          <p>Return <strong>${event.payload.returnNumber}</strong> has been stuck in <strong>${event.payload.currentStatus}</strong> for more than ${event.payload.staleDays} days.</p>
          <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Order:</strong> ${ret.masterOrder.orderNumber}</p>
            <p style="margin: 4px 0;"><strong>Customer:</strong> ${ret.customer.firstName} ${ret.customer.lastName}</p>
            <p style="margin: 4px 0;"><strong>Status:</strong> ${event.payload.currentStatus}</p>
          </div>
          <p>Please investigate and resolve this return in the admin dashboard.</p>
        `),
      });
    } catch (err) {
      this.logger.error(`Failed to send stale escalation email: ${(err as Error).message}`);
    }
  }

  @OnEvent('returns.refund.exhausted_escalation')
  async onRefundExhaustedEscalation(event: DomainEvent<{
    returnId: string;
    returnNumber: string;
    refundAmount: number;
    attempts: number;
    lastFailureReason: string | null;
  }>) {
    try {
      const adminEmail = 'admin@sportsmart.com';
      const fmt = `\u20B9${Number(event.payload.refundAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      await this.emailService.send({
        to: adminEmail,
        subject: `Refund exhausted — ${event.payload.returnNumber} (${event.payload.attempts} attempts)`,
        html: this.wrapTemplate(`
          <h3 style="color: #dc2626; margin-top: 0;">Refund Retry Exhausted</h3>
          <p>Return <strong>${event.payload.returnNumber}</strong> has exhausted all ${event.payload.attempts} refund attempts.</p>
          <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Refund amount:</strong> ${fmt}</p>
            <p style="margin: 4px 0;"><strong>Last error:</strong> ${event.payload.lastFailureReason || 'Unknown'}</p>
          </div>
          <p>Manual intervention required. Process the refund via bank transfer or contact the payment gateway.</p>
        `),
      });
    } catch (err) {
      this.logger.error(`Failed to send refund exhausted escalation email: ${(err as Error).message}`);
    }
  }

  // ── Customer: cancelled ─────────────────────────────────────────

  @OnEvent('returns.return.cancelled')
  async onCancelled(event: DomainEvent<{ returnId: string; returnNumber: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = `
        <h3 style="color: #6b7280; margin-top: 0;">Return Cancelled</h3>
        <p>Hi ${name},</p>
        <p>Your return request <strong>${ret.returnNumber}</strong> has been cancelled as requested.</p>
        <p>If you change your mind, you can submit a new return request from your order history (subject to return window).</p>
      `;

      await this.emailService.send({
        to: ret.customer.email,
        subject: `Return ${ret.returnNumber} Cancelled - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(`Failed to send returns.return.cancelled email: ${(err as Error).message}`);
    }
  }
}
