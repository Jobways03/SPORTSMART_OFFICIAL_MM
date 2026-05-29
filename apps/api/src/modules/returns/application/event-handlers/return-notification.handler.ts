import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EmailService } from '../../../../integrations/email/email.service';
import { escapeHtml, safeHtml } from '../../../../core/util/escape-html';

@Injectable()
export class ReturnNotificationHandler {
  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly env: EnvService,
    // Phase 2 / M21-M32 — outbox-replay dedup. See wallet handler.
    protected readonly eventDedup: EventDeduplicationService,
  ) {
    this.logger.setContext('ReturnNotificationHandler');
  }

  /**
   * Phase 5.3 (2026-05-16) — escalation recipient.
   *
   * Pre-2026-05-16 this was hardcoded `admin@sportsmart.com` in two
   * places (stale-return + refund-exhaustion). Now sourced from env
   * `ADMIN_ESCALATION_EMAIL` so ops can redirect alerts to a
   * distribution list or PagerDuty inbox without a code change. The
   * fallback retains the legacy address so a missing env value
   * doesn't drop the alert silently — but a log warning fires so
   * the misconfiguration surfaces.
   */
  private getEscalationEmail(): string {
    const configured = this.env.getString('ADMIN_ESCALATION_EMAIL', '');
    if (configured && configured.trim().length > 0) {
      return configured.trim();
    }
    this.logger.warn(
      'ADMIN_ESCALATION_EMAIL is not configured — falling back to admin@sportsmart.com. Set this env var to route escalations to your ops distribution list.',
    );
    return 'admin@sportsmart.com';
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
  @IdempotentHandler()
  async onRequested(event: DomainEvent<{ returnId: string; returnNumber: string; itemCount: number }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = safeHtml`
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
  @IdempotentHandler()
  async onApproved(event: DomainEvent<{ returnId: string; returnNumber: string; autoApproved: boolean }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = safeHtml`
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
  @IdempotentHandler()
  async onRejected(event: DomainEvent<{ returnId: string; returnNumber: string; reason: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = safeHtml`
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
  @IdempotentHandler()
  async onPickupScheduled(event: DomainEvent<{ returnId: string; returnNumber: string; pickupScheduledAt: Date; tracking?: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const pickupDate = new Date(event.payload.pickupScheduledAt).toLocaleDateString('en-IN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });

      const content = safeHtml`
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
  @IdempotentHandler()
  async onInTransit(event: DomainEvent<{ returnId: string; returnNumber: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = safeHtml`
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

  /**
   * Phase 96 (2026-05-23) — Mark Received audit Gap #11 closure.
   *
   * Pre-Phase-96 the QC team had no signal that a parcel had been
   * received; they polled the admin dashboard for `status=RECEIVED`.
   * We now create an AdminTask{ kind: RETURN_QC_PENDING } so the QC
   * queue is durable + has a 48h SLA via the AdminTask escalation
   * machinery. Unique key prevents duplicates on retry.
   */
  @OnEvent('returns.return.received')
  @IdempotentHandler()
  async onReceivedCreateQcTask(
    event: DomainEvent<{ returnId: string; returnNumber: string }>,
  ) {
    try {
      const slaHours = this.env.getNumber(
        'RETURN_QC_PENDING_SLA_HOURS' as any,
        48,
      );
      const slaBreachAt = new Date(Date.now() + slaHours * 60 * 60 * 1000);
      await (this.prisma as any).adminTask.upsert({
        where: { uniqueKey: `return-qc-pending:${event.payload.returnId}` },
        update: {},
        create: {
          kind: 'RETURN_QC_PENDING' as any,
          uniqueKey: `return-qc-pending:${event.payload.returnId}`,
          severity: 'MEDIUM',
          status: 'OPEN',
          title: `QC pending for return ${event.payload.returnNumber}`,
          details: `Return parcel received. QC inspection required within ${slaHours}h.`,
          relatedResource: 'return',
          relatedResourceId: event.payload.returnId,
          slaBreachAt,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create RETURN_QC_PENDING AdminTask for ${event.payload.returnNumber}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('returns.return.received')
  @IdempotentHandler()
  async onReceived(event: DomainEvent<{ returnId: string; returnNumber: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = safeHtml`
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
  @IdempotentHandler()
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

      const content = safeHtml`
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
  @IdempotentHandler()
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

      const content = safeHtml`
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

  /**
   * Phase 105 (2026-05-23) — Phase 101 audit Gap #17 closure.
   *
   * After every 3rd failed attempt (3, 6, 9, ...), send the customer
   * a "we're still on it" email so they don't feel ghosted. Cap
   * exhaustion gets its own message via `onRefundFailedCustomerNotify`
   * below.
   */
  @OnEvent('returns.refund.failed')
  @IdempotentHandler()
  async onRefundFailedMilestoneEmail(
    event: DomainEvent<{
      returnId: string;
      returnNumber: string;
      attemptNumber?: number;
      capReached?: boolean;
    }>,
  ) {
    try {
      const attempts = event.payload.attemptNumber ?? 0;
      // Skip cap-reached (handled by the next handler with stronger
      // copy) + skip non-milestone attempts.
      if (event.payload.capReached) return;
      if (attempts === 0 || attempts % 3 !== 0) return;
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();
      const content = safeHtml`
        <h3 style="color: #2563eb; margin-top: 0;">Refund Still in Progress</h3>
        <p>Hi ${name},</p>
        <p>Your refund for return <strong>${ret.returnNumber}</strong> is taking longer than expected (attempt ${String(attempts)}). Our payments team is investigating with the bank/gateway.</p>
        <p>You don&rsquo;t need to take any action right now &mdash; we&rsquo;ll keep retrying automatically and notify you the moment it lands.</p>
      `;
      await this.emailService.send({
        to: ret.customer.email,
        subject: `Refund update — Return ${ret.returnNumber}`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(
        `Failed to send milestone refund-attempt email: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Phase 101 (2026-05-23) — Phase 102 audit Gap #1 closure.
   *
   * Pre-Phase-101 `returns.refund.failed` had zero subscribers — admin
   * could mark a refund failed all day and the customer would never
   * know. This handler sends a friendly notification + tells the
   * customer ops is involved.
   *
   * Cap-reached failures (the auto-escalation) are still routed via
   * the dedicated `returns.refund.exhausted_escalation` admin email
   * path; customer message stays neutral either way.
   */
  @OnEvent('returns.refund.failed')
  @IdempotentHandler()
  async onRefundFailedCustomerNotify(
    event: DomainEvent<{
      returnId: string;
      returnNumber: string;
      reason?: string;
      attemptNumber?: number;
      capReached?: boolean;
    }>,
  ) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();
      const capCopy = event.payload.capReached
        ? '<p>Our team has been notified and will reach out shortly with next steps. You do not need to do anything right now.</p>'
        : '<p>We&rsquo;re investigating and will retry shortly. You don&rsquo;t need to take any action.</p>';
      const content = safeHtml`
        <h3 style="color: #dc2626; margin-top: 0;">Refund Update — Action Required from Our Team</h3>
        <p>Hi ${name},</p>
        <p>We hit an issue processing your refund for return <strong>${ret.returnNumber}</strong>.</p>
      ` + capCopy;
      await this.emailService.send({
        to: ret.customer.email,
        subject: `Update on refund for return ${ret.returnNumber}`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(
        `Failed to send returns.refund.failed customer email: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('returns.refund.completed')
  @IdempotentHandler()
  async onRefundCompleted(event: DomainEvent<{ returnId: string; returnNumber: string; refundAmount: number; refundReference: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = safeHtml`
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
  @IdempotentHandler()
  async onRequestedNodeNotify(event: DomainEvent<{ returnId: string; returnNumber: string; itemCount: number }>) {
    try {
      const node = await this.getNodeContext(event.payload.returnId);
      if (!node) {
        // Phase 93 (2026-05-23) — Gap #9. Sub-order with BOTH sellerId
        // and franchiseId null is a data-corruption signal — raise an
        // AdminTask so ops can investigate instead of dropping the
        // notification silently.
        await this.raiseOrphanNodeAdminTask(event.payload.returnId, event.payload.returnNumber);
        return;
      }
      // Phase 93 — Gap #10/#11. Load enriched return (items + reasons +
      // dueAt) so the email surfaces actionable detail rather than
      // sending the seller hunting through the dashboard.
      const ret = await this.getReturnContextEnriched(event.payload.returnId);
      if (!ret) return;

      const itemRows = (ret.items ?? [])
        .map((it: any) => {
          const title = it.orderItem?.productTitle ?? 'Item';
          const sku = it.orderItem?.sku ? ` (SKU ${it.orderItem.sku})` : '';
          const reason = it.reasonCategory ?? '';
          return `<li style="margin:4px 0;">${title}${sku} — qty ${it.quantity} — <em>${reason}</em></li>`;
        })
        .join('');
      const dueAtBlock = ret.sellerResponseDueAt
        ? `<p style="margin:8px 0;"><strong>Response due:</strong> ${ret.sellerResponseDueAt.toISOString()}</p>`
        : '';

      await this.emailService.send({
        to: node.email,
        subject: `Return request ${ret.returnNumber} — Action needed`,
        html: this.wrapTemplate(`
          <h3 style="color: #d97706; margin-top: 0;">New Return Request</h3>
          <p>Hi ${node.name},</p>
          <p>A return has been requested for order <strong>${ret.masterOrder.orderNumber}</strong>.</p>
          <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Return Number:</strong> ${ret.returnNumber}</p>
            <p style="margin: 4px 0;"><strong>Items:</strong></p>
            <ul style="margin: 4px 0 4px 20px; padding: 0;">${itemRows}</ul>
            ${dueAtBlock}
          </div>
          <p>Please review this return in your dashboard and prepare for the pickup / QC inspection.</p>
        `),
      });
    } catch (err) {
      this.logger.error(`Failed to send node return.requested email: ${(err as Error).message}`);
    }
  }

  /**
   * Phase 93 (2026-05-23) — Gap #28. Node-side notification on
   * auto-approval. Pre-Phase-93 the seller saw REQUESTED in their
   * dashboard, the system auto-approved, and the seller had no signal
   * of the state change until they polled.
   */
  @OnEvent('returns.return.approved')
  @IdempotentHandler()
  async onApprovedNodeNotify(event: DomainEvent<{ returnId: string; returnNumber: string }>) {
    try {
      const node = await this.getNodeContext(event.payload.returnId);
      if (!node) return;
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret) return;
      await this.emailService.send({
        to: node.email,
        subject: `Return ${ret.returnNumber} approved — pickup imminent`,
        html: this.wrapTemplate(`
          <h3 style="color: #15803d; margin-top: 0;">Return Approved</h3>
          <p>Hi ${node.name},</p>
          <p>Return <strong>${ret.returnNumber}</strong> for order <strong>${ret.masterOrder.orderNumber}</strong>
          has been approved. The courier will pick the item up shortly; please prepare for QC inspection on arrival.</p>
        `),
      });
    } catch (err) {
      this.logger.error(`Failed to send node return.approved email: ${(err as Error).message}`);
    }
  }

  /**
   * Phase 93 (2026-05-23) — Gap #29. Node-side notification on
   * customer cancel.
   */
  @OnEvent('returns.return.cancelled')
  @IdempotentHandler()
  async onCancelledNodeNotify(event: DomainEvent<{ returnId: string; returnNumber: string }>) {
    try {
      const node = await this.getNodeContext(event.payload.returnId);
      if (!node) return;
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret) return;
      await this.emailService.send({
        to: node.email,
        subject: `Return ${ret.returnNumber} cancelled by customer`,
        html: this.wrapTemplate(`
          <h3 style="color: #6b7280; margin-top: 0;">Return Cancelled</h3>
          <p>Hi ${node.name},</p>
          <p>The customer cancelled return <strong>${ret.returnNumber}</strong> for order
          <strong>${ret.masterOrder.orderNumber}</strong>. No action needed; the commission
          freeze has been lifted.</p>
        `),
      });
    } catch (err) {
      this.logger.error(`Failed to send node return.cancelled email: ${(err as Error).message}`);
    }
  }

  /**
   * Phase 93 (2026-05-23) — Gap #10/#11 enriched return context for
   * node email (items + reasons + dueAt).
   */
  private async getReturnContextEnriched(returnId: string) {
    return this.prisma.return.findUnique({
      where: { id: returnId },
      include: {
        customer: { select: { firstName: true, lastName: true, email: true } },
        masterOrder: { select: { orderNumber: true, totalAmount: true } },
        items: { include: { orderItem: true } },
      },
    });
  }

  /**
   * Phase 93 (2026-05-23) — Gap #9. AdminTask for sub-orders with no
   * fulfillment node attached.
   */
  private async raiseOrphanNodeAdminTask(
    returnId: string,
    returnNumber: string,
  ): Promise<void> {
    try {
      await (this.prisma as any).adminTask.upsert({
        where: { uniqueKey: `return-no-node:${returnId}` },
        update: {},
        create: {
          kind: 'RETURN_NOTIFICATION_NO_NODE' as any,
          uniqueKey: `return-no-node:${returnId}`,
          severity: 'HIGH',
          status: 'OPEN',
          title: `Return ${returnNumber} has no fulfillment node`,
          details:
            'Sub-order has neither sellerId nor franchiseId — seller/franchise notification was skipped. Backfill the node on the sub-order then re-emit the requested event manually.',
          relatedResource: 'return',
          relatedResourceId: returnId,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to raise orphan-node AdminTask for return ${returnNumber}: ${
          (err as Error).message
        }`,
      );
    }
  }

  @OnEvent('returns.return.qc_completed')
  @IdempotentHandler()
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
  @IdempotentHandler()
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

  /**
   * Phase 100 (2026-05-23) — Phase 96 audit Gap #20 closure.
   *
   * Pre-Phase-100 the stale-return processor published
   * `returns.return.stale_escalation` and the only subscriber was the
   * admin email handler below — no durable AdminTask was created. We
   * now upsert a RETURN_QC_PENDING task (for RECEIVED stale) or fall
   * back to a generic OTHER kind, so the queue accurately reflects
   * what's outstanding.
   */
  /**
   * Phase 100 (2026-05-23) — Mark Received audit Gap #14 closure.
   *
   * iThink / Shiprocket REV_DELIVERED webhook publishes
   * `shipping.reverse_delivered`. We locate the Return by the
   * sub-order's pickupTrackingNumber and auto-mark it RECEIVED with
   * actorType=SYSTEM. Best-effort — a failure here doesn't break
   * the shipping webhook itself.
   */
  @OnEvent('shipping.reverse_delivered')
  @IdempotentHandler()
  async onReverseDelivered(
    event: DomainEvent<{ subOrderId: string; awb?: string; source?: string }>,
  ) {
    try {
      // Find any active (non-terminal) Return on this sub-order whose
      // status is one of the pre-receive states. We don't need awb
      // matching — there's typically one in-flight return per sub-order.
      const ret = await this.prisma.return.findFirst({
        where: {
          subOrderId: event.payload.subOrderId,
          status: { in: ['IN_TRANSIT', 'PICKUP_SCHEDULED'] as any },
        },
        select: { id: true, returnNumber: true, status: true },
      });
      if (!ret) {
        this.logger.log(
          `[reverse_delivered] no in-flight return for sub-order ${event.payload.subOrderId}`,
        );
        return;
      }
      // Best-effort markReceived — call the service via Prisma direct.
      // Inline the same update logic the service does so we don't
      // create a circular dep from the handler back to ReturnService.
      const now = new Date();
      await this.prisma.return.update({
        where: { id: ret.id, status: ret.status as any } as any,
        data: {
          status: 'RECEIVED' as any,
          receivedAt: now,
          receivedBy: 'SYSTEM',
          receivedByActorType: 'SYSTEM',
          qcStatus: 'PENDING_QC' as any,
          receivedBypassedInTransit: false,
        } as any,
      });
      await this.prisma.returnStatusHistory.create({
        data: {
          returnId: ret.id,
          fromStatus: ret.status as any,
          toStatus: 'RECEIVED' as any,
          changedBy: 'SYSTEM',
          changedById: null as any,
          notes: `Reverse delivery webhook (awb=${event.payload.awb ?? 'n/a'}, source=${event.payload.source ?? 'unknown'})`,
        },
      });
      this.logger.log(
        `[reverse_delivered] Return ${ret.returnNumber} auto-flipped to RECEIVED`,
      );
    } catch (err) {
      this.logger.error(
        `[reverse_delivered] auto-mark failed for sub-order ${event.payload.subOrderId}: ${
          (err as Error)?.message ?? 'unknown error'
        }`,
      );
    }
  }

  @OnEvent('returns.return.stale_escalation')
  @IdempotentHandler()
  async onStaleEscalationCreateTask(
    event: DomainEvent<{
      returnId: string;
      returnNumber: string;
      currentStatus: string;
      staleDays: number;
    }>,
  ) {
    try {
      const kind =
        event.payload.currentStatus === 'RECEIVED'
          ? 'RETURN_QC_PENDING'
          : 'OTHER';
      await (this.prisma as any).adminTask.upsert({
        where: {
          uniqueKey: `return-stale:${event.payload.returnId}:${event.payload.currentStatus}`,
        },
        update: {
          severity: 'HIGH',
          details: `Return stuck in ${event.payload.currentStatus} for ${event.payload.staleDays} day(s).`,
        },
        create: {
          kind: kind as any,
          uniqueKey: `return-stale:${event.payload.returnId}:${event.payload.currentStatus}`,
          severity: 'HIGH',
          status: 'OPEN',
          title: `Stale return ${event.payload.returnNumber} (${event.payload.currentStatus})`,
          details: `Return stuck in ${event.payload.currentStatus} for ${event.payload.staleDays} day(s).`,
          relatedResource: 'return',
          relatedResourceId: event.payload.returnId,
          slaBreachAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create stale-return AdminTask for ${event.payload.returnNumber}: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('returns.return.stale_escalation')
  @IdempotentHandler()
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
      const adminEmail = this.getEscalationEmail();
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
  @IdempotentHandler()
  async onRefundExhaustedEscalation(event: DomainEvent<{
    returnId: string;
    returnNumber: string;
    refundAmount: number;
    attempts: number;
    lastFailureReason: string | null;
  }>) {
    try {
      const adminEmail = this.getEscalationEmail();
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

  // ── Phase 94 (2026-05-23): seller-response notifications ─────────
  //
  // Pre-Phase-94 `respondAsSeller` updated the row + audit-logged in
  // place; nobody downstream was told. Customers waited the full 48h
  // for a state change they couldn't observe; admin had to manually
  // refresh the QC queue to spot CONTESTED items. Three handlers added:
  //
  //   onSellerRespondedCustomerNotify — Gap #10. "Seller responded;
  //     QC will proceed shortly" email so the customer has a
  //     non-silent signal between request and refund.
  //   onSellerRespondedAdminNotify    — Gap #11. CONTESTED returns
  //     get an admin-only email so the QC reviewer can prioritise the
  //     dispute (seller evidence is in the dashboard).
  //   onSellerResponseExpiredAdmin    — Gap #15b. Sweeper now emits
  //     per-row events; admin gets a single notification so the
  //     EXPIRED-but-still-PENDING queue stays observable.

  @OnEvent('returns.seller.responded')
  @IdempotentHandler()
  async onSellerRespondedCustomerNotify(
    event: DomainEvent<{
      returnId: string;
      returnNumber: string;
      decision: 'ACCEPTED' | 'CONTESTED';
      evidenceCount: number;
      hasNotes: boolean;
    }>,
  ) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();
      // Customer-facing copy is deliberately neutral — we don't say
      // "the seller agrees / disagrees with you" because the binding
      // decision lives at QC. We tell them their case has movement so
      // they don't feel ghosted.
      const decisionPhrase =
        event.payload.decision === 'ACCEPTED'
          ? 'The seller has acknowledged your claim'
          : 'The seller has provided their side of the story';

      const content = safeHtml`
        <h3 style="color: #2563eb; margin-top: 0;">Return Update</h3>
        <p>Hi ${name},</p>
        <p>${decisionPhrase} for your return <strong>${ret.returnNumber}</strong>. Our team will review and proceed with QC inspection once the item arrives.</p>
        <p>You'll receive another update once the QC outcome is decided.</p>
      `;

      await this.emailService.send({
        to: ret.customer.email,
        subject: `Return ${ret.returnNumber} — seller responded - SPORTSMART`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(
        `Failed to send returns.seller.responded customer email: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('returns.seller.responded')
  @IdempotentHandler()
  async onSellerRespondedAdminNotify(
    event: DomainEvent<{
      returnId: string;
      returnNumber: string;
      decision: 'ACCEPTED' | 'CONTESTED';
      evidenceCount: number;
      hasNotes: boolean;
    }>,
  ) {
    try {
      // Only ping admin for CONTESTED responses — ACCEPTED is the
      // common / boring case and would noise up the queue.
      if (event.payload.decision !== 'CONTESTED') return;
      const adminEmail = this.getEscalationEmail();
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret) return;
      const content = safeHtml`
        <h3 style="color: #d97706; margin-top: 0;">Seller Contested a Return</h3>
        <p>Return <strong>${event.payload.returnNumber}</strong> has been <strong>CONTESTED</strong> by the seller.</p>
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Order:</strong> ${ret.masterOrder.orderNumber}</p>
          <p style="margin: 4px 0;"><strong>Customer:</strong> ${ret.customer.firstName} ${ret.customer.lastName}</p>
          <p style="margin: 4px 0;"><strong>Seller evidence count:</strong> ${event.payload.evidenceCount}</p>
          <p style="margin: 4px 0;"><strong>Notes attached:</strong> ${event.payload.hasNotes ? 'yes' : 'no'}</p>
        </div>
        <p>Please review the seller's evidence + notes in the admin dashboard before completing QC.</p>
      `;
      await this.emailService.send({
        to: adminEmail,
        subject: `Seller contested return ${event.payload.returnNumber}`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(
        `Failed to send returns.seller.responded admin email: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('returns.seller.response.expired')
  @IdempotentHandler()
  async onSellerResponseExpiredAdmin(
    event: DomainEvent<{
      returnId: string;
      returnNumber: string;
      expiredAt: string;
    }>,
  ) {
    try {
      const adminEmail = this.getEscalationEmail();
      const ret = await this.getReturnContext(event.payload.returnId);
      const orderNumber = ret?.masterOrder?.orderNumber ?? 'n/a';
      const content = safeHtml`
        <h3 style="color: #6b7280; margin-top: 0;">Seller Response Window Expired</h3>
        <p>The seller did not respond before the deadline on return <strong>${event.payload.returnNumber}</strong>.</p>
        <div style="background: #fff; border-radius: 6px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0;"><strong>Order:</strong> ${orderNumber}</p>
          <p style="margin: 4px 0;"><strong>Expired at:</strong> ${event.payload.expiredAt}</p>
        </div>
        <p>QC can proceed without seller input; liability defaults to the seller unless evidence at inspection says otherwise.</p>
      `;
      await this.emailService.send({
        to: adminEmail,
        subject: `Seller response expired — Return ${event.payload.returnNumber}`,
        html: this.wrapTemplate(content),
      });
    } catch (err) {
      this.logger.error(
        `Failed to send returns.seller.response.expired admin email: ${(err as Error).message}`,
      );
    }
  }

  // ── Customer: cancelled ─────────────────────────────────────────

  @OnEvent('returns.return.cancelled')
  @IdempotentHandler()
  async onCancelled(event: DomainEvent<{ returnId: string; returnNumber: string }>) {
    try {
      const ret = await this.getReturnContext(event.payload.returnId);
      if (!ret?.customer?.email) return;
      const name = `${ret.customer.firstName} ${ret.customer.lastName}`.trim();

      const content = safeHtml`
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
