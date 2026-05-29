import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../bootstrap/events/domain-event.interface';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../bootstrap/logging/app-logger.service';
import { EnvService } from '../../../bootstrap/env/env.service';
import { EmailService } from '../email.service';

/**
 * HTML entity escaper — replaces the five characters that have special
 * meaning in HTML body / attribute contexts. Same OWASP set used by
 * `TemplateRenderer` so behaviour is consistent across both email
 * paths (the templated facade and this direct-string handler).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Branded marker for "this string is already trusted HTML, don't
 * escape it again." Pass values through `rawHtml(...)` only for
 * platform-controlled fragments (conditional spans, system links).
 * Never wrap user-controlled data — that re-opens the XSS hole this
 * helper exists to close.
 */
const RAW_HTML_TAG = Symbol('raw-html');
type RawHtml = { readonly [RAW_HTML_TAG]: string };
function rawHtml(s: string): RawHtml {
  return { [RAW_HTML_TAG]: s };
}
function isRawHtml(v: unknown): v is RawHtml {
  return typeof v === 'object' && v !== null && RAW_HTML_TAG in v;
}

/**
 * Tagged-template helper for safely building HTML email bodies from
 * runtime data. Every `${value}` interpolation is HTML-escaped so
 * user-controlled strings (seller shop names, customer names, product
 * titles, free-form reasons / notes) cannot inject `<script>` or
 * attribute-breaking quotes into the rendered email.
 *
 * Usage:
 *   safeHtml`<p>Hi ${seller.sellerName},</p>`
 *
 * If a value is genuinely platform-controlled HTML that must render as
 * markup, wrap it with `rawHtml(...)` first — that marks it as
 * pre-trusted and skips the escape. Use sparingly and never for
 * user-controlled data.
 */
function safeHtml(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0]!;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isRawHtml(v)) {
      out += v[RAW_HTML_TAG];
    } else {
      out += escapeHtml(String(v ?? ''));
    }
    out += strings[i + 1];
  }
  return out;
}

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
      html: this.wrap(safeHtml`
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
      html: this.wrap(safeHtml`
        <h2 style="color: #dc2626;">Account Temporarily Locked</h2>
        <p>Hi ${seller.sellerName},</p>
        <p>Your seller account has been temporarily locked due to multiple failed login attempts.</p>
        <p>You can try logging in again after <strong>${new Date(event.payload.lockUntil).toLocaleString()}</strong>.</p>
        <p>If you did not attempt to log in, please reset your password immediately.</p>
      `),
      text: `Hi ${seller.sellerName}, your account has been temporarily locked due to multiple failed login attempts.`,
    });
  }

  /**
   * Phase 28 (2026-05-21) — out-of-band notification when an admin
   * opens a seller's account via the impersonation flow. The seller
   * gets the email even though their session itself wasn't used —
   * this is the only side-channel signal that "support just looked
   * at your account." If the impersonation was malicious (compromised
   * admin token), the seller sees it within minutes.
   */
  @OnEvent('seller.impersonated')
  async onSellerImpersonated(
    event: DomainEvent<{
      sellerId: string;
      adminId: string;
      email?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
      reason?: string | null;
    }>,
  ) {
    const { sellerId, adminId, ipAddress, reason } = event.payload;
    const seller = await this.findSeller(sellerId);
    if (!seller) return;
    try {
      await this.emailService.send({
        to: seller.email,
        subject: 'SPORTSMART support is viewing your account',
        html: this.wrap(safeHtml`
          <h2 style="color: #1f2937;">Your account was just opened by SPORTSMART support</h2>
          <p>Hi ${seller.sellerName},</p>
          <p>An admin opened your seller account for debugging / support.</p>
          <div style="background: #eff6ff; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #bfdbfe; font-size: 13px; color: #1e3a8a;">
            <p style="margin: 0 0 4px 0;"><strong>Admin ID:</strong> ${adminId}</p>
            <p style="margin: 0 0 4px 0;"><strong>IP:</strong> ${ipAddress ?? 'unknown'}</p>
            ${reason ? safeHtml`<p style="margin: 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
          </div>
          <p>Bank details, password, and KYC submissions are blocked during impersonation; the admin can only view + perform debugging actions.</p>
          <p>If you didn't request support, please reply to this email immediately.</p>
        `),
        text: `Your SPORTSMART seller account was opened by an admin (ID ${adminId}) from IP ${ipAddress ?? 'unknown'}. Bank/password/KYC actions are blocked during impersonation.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send seller.impersonated email for ${sellerId}: ${(err as Error)?.message ?? 'unknown'}`,
      );
    }
  }

  @OnEvent('seller.password_reset_completed')
  async onSellerPasswordResetCompleted(event: DomainEvent<{ sellerId: string }>) {
    const seller = await this.findSeller(event.payload.sellerId);
    if (!seller) return;
    await this.emailService.send({
      to: seller.email,
      subject: 'Password Reset Successful — SPORTSMART',
      html: this.wrap(safeHtml`
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
      html: this.wrap(safeHtml`
        <h2 style="color: #1f2937;">Password Changed</h2>
        <p>Hi ${seller.sellerName},</p>
        <p>Your seller account password was changed successfully.</p>
        <p>If you did not make this change, please reset your password immediately and contact support.</p>
      `),
      text: `Hi ${seller.sellerName}, your password has been changed successfully.`,
    });
  }

  /**
   * Phase 19 (2026-05-20) — Onboarding admin queue notification.
   *
   * Fires when a seller submits their KYC for review. The pre-Phase-19
   * event was published with no consumer; admin had to poll the queue
   * manually. This handler sends a structured email to the configured
   * admin team address (ADMIN_SEED_EMAIL) so a real human can act on
   * the pending review.
   */
  @OnEvent('seller.onboarding_submitted')
  async onSellerOnboardingSubmitted(
    event: DomainEvent<{
      sellerId: string;
      legalBusinessName?: string;
      gstRegistrationType?: string;
      panLast4?: string;
    }>,
  ) {
    const { sellerId, legalBusinessName, gstRegistrationType, panLast4 } =
      event.payload;
    try {
      const seller = await this.findSeller(sellerId);
      const appUrl = this.envService.getString(
        'APP_URL',
        'http://localhost:8000',
      );
      const reviewUrl = `${appUrl.replace(/\/$/, '')}/admin/sellers/${sellerId}`;
      await this.emailService.send({
        to: this.adminEmail,
        subject: `Seller onboarding pending review — ${seller?.sellerName ?? sellerId}`,
        html: this.wrap(safeHtml`
          <h2 style="color: #d97706;">New seller onboarding pending review</h2>
          <p>A seller just submitted their KYC details. The verification status is now <strong>UNDER_REVIEW</strong>.</p>
          <div style="background: #fffbeb; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #fde68a;">
            <p style="margin: 0 0 4px 0;"><strong>Seller:</strong> ${seller?.sellerName ?? '(unknown)'} (${seller?.email ?? sellerId})</p>
            <p style="margin: 0 0 4px 0;"><strong>Shop:</strong> ${seller?.sellerName ?? '—'}</p>
            <p style="margin: 0 0 4px 0;"><strong>Legal business name:</strong> ${legalBusinessName ?? '—'}</p>
            <p style="margin: 0 0 4px 0;"><strong>GST type:</strong> ${gstRegistrationType ?? '—'}</p>
            <p style="margin: 0;"><strong>PAN (last 4):</strong> ${panLast4 ?? '—'}</p>
          </div>
          <p>Review and approve / reject from the admin dashboard:</p>
          <p><a href="${reviewUrl}" style="background: #2563eb; color: #ffffff; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">Open review</a></p>
        `),
        text: `A new seller (${seller?.email ?? sellerId}) submitted KYC for review. Open ${reviewUrl} to approve or reject.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send onboarding-submitted email for seller ${sellerId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 19 (2026-05-20) — Seller approved by admin.
   *
   * Fires when admin clicks Approve on the review queue. The
   * pre-Phase-19 event had no consumer; the seller would have to
   * refresh the onboarding page to discover their fate. This handler
   * sends a welcome email pointing at the first-listing wizard.
   */
  @OnEvent('seller.approved')
  async onSellerApproved(
    event: DomainEvent<{ sellerId: string; adminId: string; notes?: string | null }>,
  ) {
    const { sellerId, notes } = event.payload;
    try {
      const seller = await this.findSeller(sellerId);
      if (!seller) {
        this.logger.warn(`seller.approved: seller ${sellerId} not found`);
        return;
      }
      const appUrl = this.envService.getString(
        'APP_URL',
        'http://localhost:8000',
      );
      const sellerPortalUrl = `${appUrl.replace(/\/$/, '')}/dashboard/onboarding/first-listing`;

      const notesBlock = notes && notes.trim().length > 0
        ? safeHtml`<div style="background: #f9fafb; border-left: 3px solid #d1d5db; padding: 12px 16px; margin: 12px 0; font-size: 13px; color: #374151;"><strong>Notes from admin:</strong> ${notes}</div>`
        : '';

      await this.emailService.send({
        to: seller.email,
        subject: 'Your seller account is approved — SPORTSMART',
        html: this.wrap(safeHtml`
          <h2 style="color: #15803d;">You're approved 🎉</h2>
          <p>Hi ${seller.sellerName},</p>
          <p>Your seller account is now <strong>active</strong>. You can list your products, manage inventory, and start accepting orders.</p>
          ${rawHtml(notesBlock)}
          <p>Next step: complete your first-listing checklist.</p>
          <p><a href="${sellerPortalUrl}" style="background: #15803d; color: #ffffff; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">Open seller dashboard</a></p>
          <p style="font-size: 13px; color: #6b7280;">Welcome to the marketplace.</p>
        `),
        text: `Hi ${seller.sellerName}, your seller account has been approved. Open ${sellerPortalUrl} to start listing.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send seller.approved email for seller ${sellerId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 19 (2026-05-20) — Seller rejected by admin.
   *
   * The pre-Phase-19 event had no consumer either; the seller had
   * no automatic notification at all. This handler sends the
   * rejection reason inline so the seller knows exactly what to fix
   * before resubmitting.
   */
  @OnEvent('seller.rejected')
  async onSellerRejected(
    event: DomainEvent<{ sellerId: string; adminId: string; reason: string }>,
  ) {
    const { sellerId, reason } = event.payload;
    try {
      const seller = await this.findSeller(sellerId);
      if (!seller) {
        this.logger.warn(`seller.rejected: seller ${sellerId} not found`);
        return;
      }
      const appUrl = this.envService.getString(
        'APP_URL',
        'http://localhost:8000',
      );
      const onboardingUrl = `${appUrl.replace(/\/$/, '')}/dashboard/onboarding`;
      const safeReason = reason && reason.trim().length > 0
        ? reason
        : 'No reason provided. Please contact support if you need clarification.';

      await this.emailService.send({
        to: seller.email,
        subject: 'Your seller onboarding needs changes — SPORTSMART',
        html: this.wrap(safeHtml`
          <h2 style="color: #dc2626;">Onboarding needs changes</h2>
          <p>Hi ${seller.sellerName},</p>
          <p>Unfortunately, your seller onboarding submission could not be approved as-is. Please review the reason below, fix the issue, and resubmit.</p>
          <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #fecaca;">
            <p style="margin: 0 0 6px 0; font-weight: 600; color: #dc2626;">Reason from admin</p>
            <p style="margin: 0; font-size: 13px; color: #7f1d1d;">${safeReason}</p>
          </div>
          <p><a href="${onboardingUrl}" style="background: #2563eb; color: #ffffff; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">Resubmit onboarding</a></p>
          <p style="font-size: 13px; color: #6b7280;">If you believe this is in error, reply to this email or contact support.</p>
        `),
        text: `Hi ${seller.sellerName}, your onboarding submission was rejected. Reason: ${safeReason}. Resubmit at ${onboardingUrl}.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send seller.rejected email for seller ${sellerId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Admin changed the seller's status (approve / suspend / deactivate /
   * reactivate). Sellers want to know when their account flips,
   * especially "you can now start selling" after approval and "your
   * account has been suspended" warnings. The event is published from
   * `admin-update-seller-status.use-case.ts` so this handler only
   * needs to render the right email per terminal state.
   */
  @OnEvent('seller.status.changed')
  async onSellerStatusChanged(
    event: DomainEvent<{
      sellerId: string;
      previousStatus: string;
      newStatus: string;
      reason?: string;
      adminId?: string;
    }>,
  ) {
    const { sellerId, previousStatus, newStatus, reason } = event.payload;
    const seller = await this.findSeller(sellerId);
    if (!seller) {
      this.logger.warn(`seller.status.changed: seller ${sellerId} not found`);
      return;
    }

    // Pick the message for the new state. INACTIVE is operator-initiated
    // (rare) and uses the suspended template; PENDING_APPROVAL is the
    // reset-to-review case (also rare).
    const variant = (() => {
      switch (newStatus) {
        case 'ACTIVE':
          return {
            subject: 'Your seller account is now active — SPORTSMART',
            heading: 'Account Approved',
            color: '#15803d',
            body: previousStatus === 'PENDING_APPROVAL'
              ? 'Welcome! Your seller account has been approved. You can now list products and start fulfilling orders from your seller dashboard.'
              : 'Your seller account has been reactivated. You can resume selling on the marketplace.',
          };
        case 'SUSPENDED':
          return {
            subject: 'Your seller account has been suspended — SPORTSMART',
            heading: 'Account Suspended',
            color: '#dc2626',
            body: 'Your seller account has been temporarily suspended. While suspended, you cannot list new products or accept new orders. Existing orders remain active until fulfilled.',
          };
        case 'DEACTIVATED':
          return {
            subject: 'Your seller account has been deactivated — SPORTSMART',
            heading: 'Account Deactivated',
            color: '#dc2626',
            body: 'Your seller account has been deactivated. You can no longer access seller features. If you believe this is an error, please contact support.',
          };
        case 'INACTIVE':
          return {
            subject: 'Your seller account is inactive — SPORTSMART',
            heading: 'Account Inactive',
            color: '#d97706',
            body: 'Your seller account has been set to inactive. You can still view your data but cannot list new products or accept orders until the account is reactivated.',
          };
        case 'PENDING_APPROVAL':
          return {
            subject: 'Your seller account is back under review — SPORTSMART',
            heading: 'Account Under Review',
            color: '#d97706',
            body: 'Your seller account has been placed back under review. Our team will contact you with next steps.',
          };
        default:
          return null;
      }
    })();

    if (!variant) {
      this.logger.warn(
        `seller.status.changed: no email template for status ${newStatus}`,
      );
      return;
    }

    // Reason block only renders when admin provided one. Wrapped in
    // safeHtml so the admin-typed string can't break out of the panel.
    const reasonBlock = reason
      ? safeHtml`<div style="background: #f9fafb; border-left: 3px solid #d1d5db; padding: 12px 16px; margin: 12px 0; font-size: 13px; color: #374151;"><strong>Reason from admin:</strong> ${reason}</div>`
      : '';

    await this.emailService.send({
      to: seller.email,
      subject: variant.subject,
      html: this.wrap(safeHtml`
        <h2 style="color: ${variant.color};">${variant.heading}</h2>
        <p>Hi ${seller.sellerName},</p>
        <p>${variant.body}</p>
        ${rawHtml(reasonBlock)}
      `),
      text: `Hi ${seller.sellerName}, your seller account status changed from ${previousStatus} to ${newStatus}.${reason ? ` Reason: ${reason}.` : ''}`,
    });
  }

  /**
   * Settlement (or franchise: see franchise-settlement.service.ts)
   * has been marked paid by finance. The seller should get a
   * confirmation with the UTR they can match against their bank
   * statement. Amount comes through as a number from the event;
   * format with the same INR-locale helper used elsewhere.
   */
  @OnEvent('seller.settlement.paid')
  async onSellerSettlementPaid(
    event: DomainEvent<{
      settlementId: string;
      sellerId: string;
      utrReference: string;
      amount: number;
    }>,
  ) {
    const { settlementId, sellerId, utrReference, amount } = event.payload;
    const seller = await this.findSeller(sellerId);
    if (!seller) {
      this.logger.warn(`seller.settlement.paid: seller ${sellerId} not found`);
      return;
    }
    const formatted = `₹${Number(amount).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    await this.emailService.send({
      to: seller.email,
      subject: `Payout sent — ${formatted}`,
      html: this.wrap(safeHtml`
        <h2 style="color: #15803d;">Payout Sent</h2>
        <p>Hi ${seller.sellerName},</p>
        <p>Your settlement payout has been transferred to your registered bank account.</p>
        <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #bbf7d0;">
          <p style="margin: 0 0 6px 0; font-size: 13px; color: #374151;">Settlement ID</p>
          <p style="margin: 0 0 12px 0; font-family: monospace; font-size: 13px; color: #111827;">${settlementId}</p>
          <p style="margin: 0 0 6px 0; font-size: 13px; color: #374151;">UTR reference</p>
          <p style="margin: 0 0 12px 0; font-family: monospace; font-size: 13px; color: #111827;">${utrReference}</p>
          <p style="margin: 0 0 6px 0; font-size: 13px; color: #374151;">Amount</p>
          <p style="margin: 0; font-size: 18px; font-weight: 700; color: #15803d;">${formatted}</p>
        </div>
        <p style="font-size: 13px; color: #6b7280;">It may take 1–2 business days for the credit to reflect in your account. Match the UTR with your bank statement to confirm.</p>
      `),
      text: `Hi ${seller.sellerName}, your settlement payout of ${formatted} has been sent. Settlement ID: ${settlementId}, UTR: ${utrReference}. Allow 1–2 business days for the credit to reflect.`,
    });
  }

  // ──── Customer Registration Events ────

  /**
   * Phase 16 (2026-05-20) — Customer signed up. Email handler now
   * actually exists (prior to this PR the event was emitted with
   * `.catch(...)` and no subscriber, so the OTP was silently dropped
   * and the user could never verify). Renders the same OTP template
   * as the password-reset flow but with registration-specific copy.
   * The plaintext OTP arrives on the event payload — never logged,
   * never persisted; the handler reads it inline and ships the email.
   */
  @OnEvent('identity.user.registered')
  async onUserRegistered(
    event: DomainEvent<{
      userId: string;
      email: string;
      firstName: string;
      lastName: string;
      otpPlaintext: string;
      otpExpiresAt: string;
    }>,
  ) {
    const { email, firstName, otpPlaintext, otpExpiresAt } = event.payload;
    try {
      await this.emailService.send({
        to: email,
        subject: 'Verify your SPORTSMART account',
        html: this.wrap(this.renderVerificationOtpHtml({
          firstName,
          otp: otpPlaintext,
          expiresAt: new Date(otpExpiresAt),
          isResend: false,
        })),
        text:
          `Hi ${firstName}, your SPORTSMART verification code is ${otpPlaintext}. ` +
          `It expires in 10 minutes. If you did not sign up, you can ignore this email.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send verification email for user ${event.payload.userId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 16 (2026-05-20) — Customer hit "resend code" on the verify
   * page. Same OTP template with a tiny copy tweak ("new code") so
   * the user can tell which one is current at a glance.
   */
  @OnEvent('identity.user.verification_otp_requested')
  async onVerificationOtpRequested(
    event: DomainEvent<{
      userId: string;
      email: string;
      otpPlaintext: string;
      otpExpiresAt: string;
      reason?: string;
    }>,
  ) {
    const { email, otpPlaintext, otpExpiresAt } = event.payload;

    // We don't have the user's firstName on the resend event (the
    // resend use-case looks up only the verification-needed shape).
    // Fetch the name once for the email; if the lookup fails, render
    // the generic salutation.
    let firstName = 'there';
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: event.payload.userId },
        select: { firstName: true },
      });
      if (user?.firstName) firstName = user.firstName;
    } catch {
      // best-effort — render the generic salutation
    }

    try {
      await this.emailService.send({
        to: email,
        subject: 'Your new SPORTSMART verification code',
        html: this.wrap(this.renderVerificationOtpHtml({
          firstName,
          otp: otpPlaintext,
          expiresAt: new Date(otpExpiresAt),
          isResend: true,
        })),
        text:
          `Hi ${firstName}, your new SPORTSMART verification code is ${otpPlaintext}. ` +
          `It expires in 10 minutes. The previous code is no longer valid.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send resend OTP email for user ${event.payload.userId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 16 (2026-05-20) — Customer completed email verification.
   * The account is ACTIVE; greet them and point at the storefront.
   */
  @OnEvent('identity.user.email_verified')
  async onUserEmailVerified(
    event: DomainEvent<{ userId: string; email: string }>,
  ) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: event.payload.userId },
        select: { firstName: true, email: true },
      });
      if (!user) return;
      await this.emailService.send({
        to: user.email,
        subject: 'Welcome to SPORTSMART!',
        html: this.wrap(safeHtml`
          <h2 style="color: #15803d;">Welcome to SPORTSMART!</h2>
          <p>Hi ${user.firstName},</p>
          <p>Your email is verified and your account is now active. You're all set to:</p>
          <ul style="color: #374151; line-height: 1.8;">
            <li>Track your orders and returns in one place</li>
            <li>Save addresses for one-tap repeat orders</li>
            <li>Use your wishlist to plan upcoming buys</li>
            <li>Unlock early access to seasonal sales</li>
          </ul>
          <p>Happy shopping!</p>
        `),
        text: `Hi ${user.firstName}, welcome to SPORTSMART! Your email is verified and your account is active.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send welcome email for user ${event.payload.userId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Render the inner HTML block of the verification OTP email. The
   * OTP value lives inside a <code>-style box. Wrapped by safeHtml
   * so any caller-supplied firstName cannot inject markup.
   */
  private renderVerificationOtpHtml(args: {
    firstName: string;
    otp: string;
    expiresAt: Date;
    isResend: boolean;
  }): string {
    const minutes = Math.max(
      1,
      Math.round((args.expiresAt.getTime() - Date.now()) / 60_000),
    );
    const intro = args.isResend
      ? 'Here is your new verification code. The previous code is no longer valid.'
      : 'Thanks for signing up! Enter this 6-digit code on the verification page to activate your account.';
    return safeHtml`
      <h2 style="color: #1f2937;">${args.isResend ? 'Your new verification code' : 'Verify your email'}</h2>
      <p>Hi ${args.firstName},</p>
      <p>${intro}</p>
      <div style="background: #f9fafb; border: 2px dashed #2563eb; border-radius: 8px; padding: 24px; text-align: center; margin: 16px 0;">
        <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #2563eb;">${args.otp}</div>
        <p style="margin: 12px 0 0 0; color: #6b7280; font-size: 13px;">Expires in ${String(minutes)} minute${minutes === 1 ? '' : 's'}.</p>
      </div>
      <p style="color: #6b7280; font-size: 13px;">If you did not request this code, you can ignore this email — your address will not be added to our records.</p>
    `;
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
      html: this.wrap(safeHtml`
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
    const { orderNumber, totalAmount, itemCount } = event.payload;
    this.logger.log(`Master order created: ${orderNumber}`);

    // Note: Customer-facing order confirmation is handled by OrderNotificationHandler
    // (in modules/notifications). This handler only sends the admin notification.

    // Admin notification — new order pending verification
    try {
      const formattedAmount = `\u20B9${Number(totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      await this.emailService.send({
        to: this.adminEmail,
        subject: `New Order #${orderNumber} — Pending Verification`,
        html: this.wrap(safeHtml`
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
      this.logger.error(`Failed to send admin order notification email: ${(err as Error)?.message ?? "unknown error"}`);
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
    // Platform-controlled markup — wrap in rawHtml so safeHtml leaves
    // the <p> tag intact instead of entity-encoding it.
    const reassignmentNote = isReassignment
      ? rawHtml('<p style="color: #d97706; font-weight: 600;">This order was reassigned to you from another seller.</p>')
      : '';

    await this.emailService.send({
      to: seller.email,
      subject: `New Order #${orderNumber} — SPORTSMART`,
      html: this.wrap(safeHtml`
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
        html: this.wrap(safeHtml`
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
      this.logger.error(`Failed to send admin product review notification email: ${(err as Error)?.message ?? "unknown error"}`);
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
        html: this.wrap(safeHtml`
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
      this.logger.error(`Failed to send seller product approval email: ${(err as Error)?.message ?? "unknown error"}`);
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
        html: this.wrap(safeHtml`
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
      this.logger.error(`Failed to send seller product rejection email: ${(err as Error)?.message ?? "unknown error"}`);
    }
  }

  @OnEvent('catalog.listing.request_changes')
  async onProductChangesRequested(event: DomainEvent<{
    productId: string;
    productTitle: string;
    sellerId: string | null;
    note: string;
    adminId: string;
  }>) {
    const { productTitle, sellerId, note } = event.payload;
    this.logger.log(`Changes requested for product "${productTitle}" from seller ${sellerId}`);

    if (!sellerId) {
      this.logger.warn('No sellerId on changes-requested event — skipping email');
      return;
    }

    try {
      const seller = await this.findSeller(sellerId);
      if (!seller) {
        this.logger.warn(`Seller ${sellerId} not found — cannot send changes-requested email`);
        return;
      }

      await this.emailService.send({
        to: seller.email,
        subject: `Changes requested — ${productTitle}`,
        html: this.wrap(safeHtml`
          <h2 style="color: #d97706;">Changes Requested</h2>
          <p>Hi ${seller.sellerName},</p>
          <p>Our review team needs a few changes before your product can go live.</p>
          <div style="background: #fffbeb; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #fde68a;">
            <p style="margin: 0 0 8px 0; font-weight: 600; color: #92400e;">${productTitle}</p>
            <p style="margin: 0; font-size: 13px; color: #78350f;"><strong>What to update:</strong> ${note || 'No note provided'}</p>
          </div>
          <p>Please apply the changes in your seller dashboard and resubmit for review.</p>
        `),
        text: `Hi ${seller.sellerName}, changes have been requested for your product "${productTitle}". What to update: ${note || 'No note provided'}. Please resubmit from your dashboard.`,
      });
    } catch (err) {
      this.logger.error(`Failed to send seller changes-requested email: ${(err as Error)?.message ?? "unknown error"}`);
    }
  }

  // ──── Commission Events ────

  @OnEvent('commission.locked')
  async onCommissionLocked(event: DomainEvent<{
    subOrderId: string;
    masterOrderId: string;
    orderNumber: string;
    sellerId?: string;
    franchiseId?: string | null;
    nodeType?: 'SELLER' | 'FRANCHISE';
    itemCount: number;
    adminEarning: number;
    sellerEarning: number;
    commissionRate?: number;
  }>) {
    const { orderNumber, itemCount, adminEarning, sellerEarning, nodeType, sellerId, franchiseId } = event.payload;
    const isFranchise = nodeType === 'FRANCHISE' || !!franchiseId;

    try {
      let recipientEmail: string | null = null;
      let recipientName: string | null = null;
      let partnerLabel = 'Seller';

      if (isFranchise && franchiseId) {
        const franchise = await this.prisma.franchisePartner.findUnique({
          where: { id: franchiseId },
          select: { email: true, ownerName: true, businessName: true },
        });
        if (franchise) {
          recipientEmail = franchise.email;
          recipientName = franchise.ownerName || franchise.businessName;
          partnerLabel = 'Franchise';
        }
      } else if (sellerId) {
        const seller = await this.findSeller(sellerId);
        if (seller) {
          recipientEmail = seller.email;
          recipientName = seller.sellerName;
        }
      }

      if (!recipientEmail) {
        this.logger.warn(`commission.locked: recipient not found for sub-order ${event.payload.subOrderId}`);
        return;
      }

      const fmt = (n: number) =>
        `\u20B9${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      await this.emailService.send({
        to: recipientEmail,
        subject: `Commission locked — Order #${orderNumber}`,
        html: this.wrap(safeHtml`
          <h2 style="color: #15803d;">Commission Locked</h2>
          <p>Hi ${recipientName || partnerLabel},</p>
          <p>The return window has passed for your order and the commission for this sub-order is now locked.</p>
          <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #bbf7d0;">
            <p style="margin: 0 0 8px 0;"><strong>Order #${orderNumber}</strong></p>
            <p style="margin: 0 0 4px 0; font-size: 13px; color: #374151;">${itemCount} item${itemCount !== 1 ? 's' : ''}</p>
            <p style="margin: 8px 0 4px 0; font-size: 13px; color: #374151;">Platform earning: <strong>${fmt(adminEarning)}</strong></p>
            <p style="margin: 0; font-size: 16px; font-weight: 700; color: #15803d;">Your earning: ${fmt(sellerEarning)}</p>
          </div>
          <p style="font-size: 13px; color: #6b7280;">This amount will be included in your next settlement cycle.</p>
        `),
        text: `Commission locked for Order #${orderNumber}. Platform earning: ${fmt(adminEarning)}. Your earning: ${fmt(sellerEarning)}. This will be included in your next settlement.`,
      });
    } catch (err) {
      this.logger.error(`Failed to send commission.locked email for sub-order ${event.payload.subOrderId}: ${(err as Error)?.message ?? "unknown error"}`);
    }
  }

  // ──── Franchise lifecycle (Phase 20, 2026-05-20) ────

  /**
   * Phase 20 (2026-05-20) — Franchise registered. Fires welcome
   * email; OTP itself ships via the email-OTP adapter inside the
   * register use case.
   */
  @OnEvent('franchise.registered')
  async onFranchiseRegistered(
    event: DomainEvent<{
      franchiseId: string;
      email: string;
      ownerName: string;
      businessName: string;
    }>,
  ) {
    const { email, ownerName, businessName } = event.payload;
    try {
      const appUrl = this.envService.getString('APP_URL', 'http://localhost:8000');
      const verifyUrl = `${appUrl.replace(/\/$/, '')}/register/verify?email=${encodeURIComponent(email)}`;
      await this.emailService.send({
        to: email,
        subject: 'Welcome to SPORTSMART — verify your franchise email',
        html: this.wrap(safeHtml`
          <h2 style="color: #1f2937;">Welcome, ${ownerName}!</h2>
          <p>Your franchise account for <strong>${businessName}</strong> has been created. Please verify your email — we just sent you a 6-digit code.</p>
          <p><a href="${verifyUrl}" style="background: #2563eb; color: #ffffff; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">Open verification page</a></p>
          <p style="color: #6b7280; font-size: 13px;">Verification code expires in 10 minutes. Once verified, your account stays in <strong>pending admin approval</strong> while our team reviews your KYC submission.</p>
        `),
        text: `Hi ${ownerName}, your franchise account has been created. Verify your email at ${verifyUrl}.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send franchise.registered email for ${event.payload.franchiseId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 20 (2026-05-20) — Franchise email verified.
   */
  @OnEvent('franchise.email_verified')
  async onFranchiseEmailVerified(
    event: DomainEvent<{ franchiseId: string; email?: string }>,
  ) {
    try {
      const franchise = await this.findFranchise(event.payload.franchiseId);
      if (!franchise) return;
      const appUrl = this.envService.getString('APP_URL', 'http://localhost:8000');
      const dashboardUrl = `${appUrl.replace(/\/$/, '')}/dashboard/onboarding`;
      await this.emailService.send({
        to: franchise.email,
        subject: 'Email verified — submit your franchise KYC',
        html: this.wrap(safeHtml`
          <h2 style="color: #15803d;">Email verified ✓</h2>
          <p>Hi ${franchise.ownerName ?? 'there'},</p>
          <p>Your email is verified. The next step is to submit your KYC (GSTIN, PAN, business address). Once approved by our team, you can start managing your franchise.</p>
          <p><a href="${dashboardUrl}" style="background: #15803d; color: #ffffff; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">Continue onboarding</a></p>
        `),
        text: `Hi ${franchise.ownerName ?? 'there'}, your email is verified. Submit KYC at ${dashboardUrl}.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send franchise.email_verified email for ${event.payload.franchiseId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 28 (2026-05-21) — out-of-band notification when an admin
   * impersonates a franchise. Mirror of seller.impersonated.
   */
  @OnEvent('franchise.impersonated')
  async onFranchiseImpersonated(
    event: DomainEvent<{
      franchiseId: string;
      adminId: string;
      email?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
      reason?: string | null;
    }>,
  ) {
    const { franchiseId, adminId, ipAddress, reason } = event.payload;
    const franchise = await this.findFranchise(franchiseId);
    if (!franchise) return;
    try {
      await this.emailService.send({
        to: franchise.email,
        subject: 'SPORTSMART support is viewing your franchise account',
        html: this.wrap(safeHtml`
          <h2 style="color: #1f2937;">Your account was just opened by SPORTSMART support</h2>
          <p>Hi ${franchise.ownerName ?? 'there'},</p>
          <p>An admin opened your franchise account for debugging / support.</p>
          <div style="background: #eff6ff; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #bfdbfe; font-size: 13px; color: #1e3a8a;">
            <p style="margin: 0 0 4px 0;"><strong>Admin ID:</strong> ${adminId}</p>
            <p style="margin: 0 0 4px 0;"><strong>IP:</strong> ${ipAddress ?? 'unknown'}</p>
            ${reason ? safeHtml`<p style="margin: 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
          </div>
          <p>Bank details, password, and KYC submissions are blocked during impersonation.</p>
          <p>If you didn't request support, please reply to this email immediately.</p>
        `),
        text: `Your SPORTSMART franchise account was opened by an admin (ID ${adminId}) from IP ${ipAddress ?? 'unknown'}.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send franchise.impersonated email for ${franchiseId}: ${(err as Error)?.message ?? 'unknown'}`,
      );
    }
  }

  /**
   * Phase 20 (2026-05-20) — Franchise KYC submitted. Admin
   * notification.
   */
  @OnEvent('franchise.onboarding_submitted')
  async onFranchiseOnboardingSubmitted(
    event: DomainEvent<{
      franchiseId: string;
      legalBusinessName?: string;
      gstRegistrationType?: string;
      panLast4?: string;
    }>,
  ) {
    const { franchiseId, legalBusinessName, gstRegistrationType, panLast4 } =
      event.payload;
    try {
      const franchise = await this.findFranchise(franchiseId);
      const appUrl = this.envService.getString('APP_URL', 'http://localhost:8000');
      const reviewUrl = `${appUrl.replace(/\/$/, '')}/admin/franchises/${franchiseId}`;
      await this.emailService.send({
        to: this.adminEmail,
        subject: `Franchise KYC pending review — ${franchise?.businessName ?? franchiseId}`,
        html: this.wrap(safeHtml`
          <h2 style="color: #d97706;">New franchise KYC pending review</h2>
          <p>A franchise just submitted KYC. The verification status is now <strong>UNDER_REVIEW</strong>.</p>
          <div style="background: #fffbeb; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #fde68a;">
            <p style="margin: 0 0 4px 0;"><strong>Franchise:</strong> ${franchise?.businessName ?? '—'} (${franchise?.email ?? franchiseId})</p>
            <p style="margin: 0 0 4px 0;"><strong>Owner:</strong> ${franchise?.ownerName ?? '—'}</p>
            <p style="margin: 0 0 4px 0;"><strong>Legal business name:</strong> ${legalBusinessName ?? '—'}</p>
            <p style="margin: 0 0 4px 0;"><strong>GST type:</strong> ${gstRegistrationType ?? '—'}</p>
            <p style="margin: 0;"><strong>PAN (last 4):</strong> ${panLast4 ?? '—'}</p>
          </div>
          <p><a href="${reviewUrl}" style="background: #2563eb; color: #ffffff; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">Open review</a></p>
        `),
        text: `Franchise ${franchise?.email ?? franchiseId} submitted KYC. Review at ${reviewUrl}.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send franchise onboarding-submitted email for ${franchiseId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 20 (2026-05-20) — Franchise status changed (approve /
   * activate / suspend / etc).
   */
  @OnEvent('franchise.status_updated')
  async onFranchiseStatusUpdated(
    event: DomainEvent<{
      franchiseId: string;
      previousStatus: string;
      newStatus: string;
      reason?: string | null;
    }>,
  ) {
    const { franchiseId, previousStatus, newStatus, reason } = event.payload;
    try {
      const franchise = await this.findFranchise(franchiseId);
      if (!franchise) return;
      const appUrl = this.envService.getString('APP_URL', 'http://localhost:8000');
      const dashboardUrl = `${appUrl.replace(/\/$/, '')}/dashboard`;

      const variant = (() => {
        switch (newStatus) {
          case 'APPROVED':
            return {
              subject: 'Your franchise has been approved — SPORTSMART',
              heading: 'Franchise Approved',
              color: '#15803d',
              body: 'Your franchise has been approved. Our team will activate the account shortly so you can start operations.',
            };
          case 'ACTIVE':
            return {
              subject: 'Your franchise is now active — SPORTSMART',
              heading: 'Franchise Active',
              color: '#15803d',
              body: 'Your franchise is active. You can now manage catalog, inventory, orders, and POS sales from the dashboard.',
            };
          case 'SUSPENDED':
            return {
              subject: 'Franchise suspended — SPORTSMART',
              heading: 'Franchise Suspended',
              color: '#dc2626',
              body: 'Your franchise has been suspended. You cannot accept new orders until reinstated.',
            };
          case 'DEACTIVATED':
            return {
              subject: 'Franchise deactivated — SPORTSMART',
              heading: 'Franchise Deactivated',
              color: '#dc2626',
              body: 'Your franchise has been deactivated. Contact support if you believe this is in error.',
            };
          default:
            return null;
        }
      })();

      if (!variant) return;

      const reasonBlock = reason
        ? safeHtml`<div style="background: #f9fafb; border-left: 3px solid #d1d5db; padding: 12px 16px; margin: 12px 0; font-size: 13px; color: #374151;"><strong>Reason from admin:</strong> ${reason}</div>`
        : '';

      await this.emailService.send({
        to: franchise.email,
        subject: variant.subject,
        html: this.wrap(safeHtml`
          <h2 style="color: ${variant.color};">${variant.heading}</h2>
          <p>Hi ${franchise.ownerName ?? franchise.businessName},</p>
          <p>${variant.body}</p>
          ${rawHtml(reasonBlock)}
          <p><a href="${dashboardUrl}" style="background: #2563eb; color: #ffffff; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">Open dashboard</a></p>
        `),
        text: `Hi ${franchise.ownerName ?? franchise.businessName}, your franchise status changed from ${previousStatus} to ${newStatus}.${reason ? ` Reason: ${reason}.` : ''}`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send franchise.status_updated email for ${franchiseId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 20 (2026-05-20) — Franchise verification result.
   */
  @OnEvent('franchise.verification_updated')
  async onFranchiseVerificationUpdated(
    event: DomainEvent<{
      franchiseId: string;
      previousVerificationStatus: string;
      newVerificationStatus: string;
      reason?: string | null;
    }>,
  ) {
    const { franchiseId, newVerificationStatus, reason } = event.payload;
    if (newVerificationStatus !== 'VERIFIED' && newVerificationStatus !== 'REJECTED') {
      // No user-facing email for intermediate state changes (e.g.
      // NOT_VERIFIED → UNDER_REVIEW is already covered by the
      // onboarding_submitted handler).
      return;
    }
    try {
      const franchise = await this.findFranchise(franchiseId);
      if (!franchise) return;
      const appUrl = this.envService.getString('APP_URL', 'http://localhost:8000');
      const dashboardUrl = `${appUrl.replace(/\/$/, '')}/dashboard/onboarding`;

      if (newVerificationStatus === 'VERIFIED') {
        await this.emailService.send({
          to: franchise.email,
          subject: 'KYC verified — admin approval next — SPORTSMART',
          html: this.wrap(safeHtml`
            <h2 style="color: #15803d;">KYC Verified</h2>
            <p>Hi ${franchise.ownerName ?? franchise.businessName},</p>
            <p>Your KYC documents have been verified. Admin approval is the next and final step before your franchise goes live.</p>
            <p><a href="${dashboardUrl}" style="background: #15803d; color: #ffffff; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">Open dashboard</a></p>
          `),
          text: `Hi ${franchise.ownerName ?? franchise.businessName}, your KYC has been verified. Admin approval is next.`,
        });
      } else {
        const safeReason =
          reason && reason.trim().length > 0
            ? reason
            : 'No reason provided. Please contact support if you need clarification.';
        await this.emailService.send({
          to: franchise.email,
          subject: 'KYC needs changes — SPORTSMART',
          html: this.wrap(safeHtml`
            <h2 style="color: #dc2626;">KYC Needs Changes</h2>
            <p>Hi ${franchise.ownerName ?? franchise.businessName},</p>
            <p>Your KYC submission could not be approved as-is. Review the reason below, fix the issue, and resubmit.</p>
            <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #fecaca;">
              <p style="margin: 0 0 6px 0; font-weight: 600; color: #dc2626;">Reason from admin</p>
              <p style="margin: 0; font-size: 13px; color: #7f1d1d;">${safeReason}</p>
            </div>
            <p><a href="${dashboardUrl}" style="background: #2563eb; color: #ffffff; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">Resubmit KYC</a></p>
          `),
          text: `Hi ${franchise.ownerName ?? franchise.businessName}, KYC was rejected. Reason: ${safeReason}. Resubmit at ${dashboardUrl}.`,
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to send franchise.verification_updated email for ${franchiseId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 20 (2026-05-20) — Account lock notification.
   */
  @OnEvent('franchise.account_locked')
  async onFranchiseAccountLocked(
    event: DomainEvent<{ franchiseId: string; lockUntil: Date }>,
  ) {
    try {
      const franchise = await this.findFranchise(event.payload.franchiseId);
      if (!franchise) return;
      await this.emailService.send({
        to: franchise.email,
        subject: 'Account Temporarily Locked — SPORTSMART Franchise',
        html: this.wrap(safeHtml`
          <h2 style="color: #dc2626;">Account Temporarily Locked</h2>
          <p>Hi ${franchise.ownerName ?? franchise.businessName},</p>
          <p>Your franchise account has been temporarily locked due to multiple failed login attempts.</p>
          <p>You can try logging in again after <strong>${new Date(event.payload.lockUntil).toLocaleString()}</strong>.</p>
          <p>If you did not attempt to log in, please reset your password immediately.</p>
        `),
        text: `Hi ${franchise.ownerName ?? franchise.businessName}, your franchise account has been temporarily locked due to multiple failed login attempts.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send franchise.account_locked email: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  // ──── Affiliate lifecycle (Phase 22, 2026-05-20) ────

  /**
   * Phase 22 (2026-05-20) — Affiliate application received. Sends a
   * "we will review and notify you" confirmation so the storefront's
   * post-register copy stops lying about an email that never sent.
   */
  @OnEvent('affiliate.registered')
  async onAffiliateRegistered(
    event: DomainEvent<{
      affiliateId: string;
      email: string;
      firstName: string;
      lastName: string;
    }>,
  ) {
    const { email, firstName, lastName } = event.payload;
    try {
      await this.emailService.send({
        to: email,
        subject: 'We received your SPORTSMART affiliate application',
        html: this.wrap(safeHtml`
          <h2 style="color: #1f2937;">Application received</h2>
          <p>Hi ${firstName} ${lastName},</p>
          <p>Thanks for applying to the SPORTSMART affiliate program. Your application is now <strong>pending admin review</strong>. We will email you once a decision is made — typically within 2 business days.</p>
          <p style="color: #6b7280; font-size: 13px;">If you didn't submit this application, you can safely ignore this email.</p>
        `),
        text: `Hi ${firstName} ${lastName}, your SPORTSMART affiliate application has been received and is pending review.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send affiliate.registered email for ${event.payload.affiliateId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 22 (2026-05-20) — Affiliate approved. Welcome email with
   * dashboard link.
   */
  @OnEvent('affiliate.approved')
  async onAffiliateApproved(
    event: DomainEvent<{ affiliateId: string; email: string }>,
  ) {
    try {
      const affiliate = await this.findAffiliate(event.payload.affiliateId);
      if (!affiliate) return;
      const appUrl = this.envService.getString('APP_URL', 'http://localhost:8000');
      const dashboardUrl = `${appUrl.replace(/\/$/, '')}/dashboard`;
      await this.emailService.send({
        to: affiliate.email,
        subject: 'Your SPORTSMART affiliate account is active',
        html: this.wrap(safeHtml`
          <h2 style="color: #15803d;">You're in 🎉</h2>
          <p>Hi ${affiliate.firstName},</p>
          <p>Your SPORTSMART affiliate account has been approved. You can sign in to your dashboard now to see your referral code, share links, and track commissions.</p>
          <p><a href="${dashboardUrl}" style="background: #15803d; color: #ffffff; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">Open affiliate dashboard</a></p>
        `),
        text: `Hi ${affiliate.firstName}, your SPORTSMART affiliate account is active. Sign in at ${dashboardUrl}.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send affiliate.approved email for ${event.payload.affiliateId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 22 (2026-05-20) — Affiliate rejected. Surfaces the
   * rejection reason so the applicant knows what to fix before
   * re-applying.
   */
  @OnEvent('affiliate.rejected')
  async onAffiliateRejected(
    event: DomainEvent<{
      affiliateId: string;
      email: string;
      reason?: string | null;
    }>,
  ) {
    try {
      const affiliate = await this.findAffiliate(event.payload.affiliateId);
      if (!affiliate) return;
      const safeReason =
        event.payload.reason && event.payload.reason.trim().length > 0
          ? event.payload.reason
          : 'No specific reason was provided. Please contact support if you would like more detail.';
      await this.emailService.send({
        to: affiliate.email,
        subject: 'Update on your SPORTSMART affiliate application',
        html: this.wrap(safeHtml`
          <h2 style="color: #dc2626;">Application not accepted</h2>
          <p>Hi ${affiliate.firstName},</p>
          <p>Thank you for applying to the SPORTSMART affiliate program. After reviewing your application, we are unable to onboard you at this time.</p>
          <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #fecaca;">
            <p style="margin: 0 0 6px 0; font-weight: 600; color: #dc2626;">Reason from our review team</p>
            <p style="margin: 0; font-size: 13px; color: #7f1d1d;">${safeReason}</p>
          </div>
          <p style="color: #6b7280; font-size: 13px;">If you believe this was in error or would like to re-apply with updated details, please contact support.</p>
        `),
        text: `Hi ${affiliate.firstName}, your SPORTSMART affiliate application was not accepted. Reason: ${safeReason}.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send affiliate.rejected email for ${event.payload.affiliateId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 22 (2026-05-20) — Affiliate suspended.
   */
  @OnEvent('affiliate.suspended')
  async onAffiliateSuspended(
    event: DomainEvent<{
      affiliateId: string;
      email: string;
      reason?: string | null;
    }>,
  ) {
    try {
      const affiliate = await this.findAffiliate(event.payload.affiliateId);
      if (!affiliate) return;
      const reasonBlock = event.payload.reason
        ? safeHtml`<div style="background: #f9fafb; border-left: 3px solid #d1d5db; padding: 12px 16px; margin: 12px 0; font-size: 13px; color: #374151;"><strong>Reason from admin:</strong> ${event.payload.reason}</div>`
        : '';
      await this.emailService.send({
        to: affiliate.email,
        subject: 'Your SPORTSMART affiliate account has been suspended',
        html: this.wrap(safeHtml`
          <h2 style="color: #dc2626;">Account Suspended</h2>
          <p>Hi ${affiliate.firstName},</p>
          <p>Your SPORTSMART affiliate account has been suspended. While suspended you cannot earn new commissions, and any active sessions have been signed out.</p>
          ${rawHtml(reasonBlock)}
          <p style="color: #6b7280; font-size: 13px;">If you believe this is a mistake, please contact support to appeal.</p>
        `),
        text: `Hi ${affiliate.firstName}, your SPORTSMART affiliate account has been suspended.${event.payload.reason ? ` Reason: ${event.payload.reason}.` : ''}`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send affiliate.suspended email for ${event.payload.affiliateId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 22 (2026-05-20) — Affiliate reactivated after a suspension
   * or deactivation.
   */
  @OnEvent('affiliate.reactivated')
  async onAffiliateReactivated(
    event: DomainEvent<{ affiliateId: string; email: string }>,
  ) {
    try {
      const affiliate = await this.findAffiliate(event.payload.affiliateId);
      if (!affiliate) return;
      const appUrl = this.envService.getString('APP_URL', 'http://localhost:8000');
      const dashboardUrl = `${appUrl.replace(/\/$/, '')}/dashboard`;
      await this.emailService.send({
        to: affiliate.email,
        subject: 'Your SPORTSMART affiliate account is active again',
        html: this.wrap(safeHtml`
          <h2 style="color: #15803d;">Welcome back</h2>
          <p>Hi ${affiliate.firstName},</p>
          <p>Your SPORTSMART affiliate account has been reactivated. You can sign in again and resume earning commissions.</p>
          <p><a href="${dashboardUrl}" style="background: #15803d; color: #ffffff; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">Open affiliate dashboard</a></p>
        `),
        text: `Hi ${affiliate.firstName}, your SPORTSMART affiliate account has been reactivated.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send affiliate.reactivated email for ${event.payload.affiliateId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 22 (2026-05-20) — Affiliate account locked due to 5 failed
   * login attempts. Matches the customer / seller / franchise lockout
   * emails.
   */
  @OnEvent('affiliate.account_locked')
  async onAffiliateAccountLocked(
    event: DomainEvent<{
      affiliateId: string;
      email: string;
      lockMinutes: number;
    }>,
  ) {
    try {
      const affiliate = await this.findAffiliate(event.payload.affiliateId);
      if (!affiliate) return;
      await this.emailService.send({
        to: affiliate.email,
        subject: 'Account Temporarily Locked — SPORTSMART Affiliate',
        html: this.wrap(safeHtml`
          <h2 style="color: #dc2626;">Account Temporarily Locked</h2>
          <p>Hi ${affiliate.firstName},</p>
          <p>Your SPORTSMART affiliate account has been temporarily locked due to multiple failed login attempts.</p>
          <p>You can try again after ${String(event.payload.lockMinutes)} minutes.</p>
          <p>If you did not attempt to log in, please reset your password immediately.</p>
        `),
        text: `Hi ${affiliate.firstName}, your SPORTSMART affiliate account has been temporarily locked for ${event.payload.lockMinutes} minutes due to multiple failed login attempts.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send affiliate.account_locked email for ${event.payload.affiliateId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  // ──── Admin MFA recovery (Phase 23, 2026-05-20) ────

  /**
   * Phase 23 (2026-05-20) — Admin backup-code used. Backup codes are
   * a recovery signal: the admin lost their authenticator device or
   * fell back to it instead of TOTP. We email the admin to confirm
   * the access so a compromised account is noticed quickly.
   */
  @OnEvent('admin.mfa.backup_code_used')
  async onAdminMfaBackupCodeUsed(
    event: DomainEvent<{
      adminId: string;
      email?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
    }>,
  ) {
    const { adminId, email, ipAddress, userAgent } = event.payload;
    if (!email) return;
    try {
      await this.emailService.send({
        to: email,
        subject: 'A backup code was used to sign in to your SPORTSMART admin account',
        html: this.wrap(safeHtml`
          <h2 style="color: #d97706;">Backup code used</h2>
          <p>Someone — hopefully you — just signed in to your SPORTSMART admin account using a backup MFA code instead of your authenticator app.</p>
          <div style="background: #fffbeb; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #fde68a; font-size: 13px; color: #92400e;">
            <p style="margin: 0 0 4px 0;"><strong>Admin ID:</strong> ${adminId}</p>
            <p style="margin: 0 0 4px 0;"><strong>IP:</strong> ${ipAddress ?? 'unknown'}</p>
            <p style="margin: 0;"><strong>User agent:</strong> ${userAgent ?? 'unknown'}</p>
          </div>
          <p>If this was you, no action is needed. If not, change your password immediately and rotate your MFA secret.</p>
        `),
        text: `A backup MFA code was used to sign in to your SPORTSMART admin account (IP ${ipAddress ?? 'unknown'}). If this was not you, change your password and rotate your MFA secret immediately.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send admin.mfa.backup_code_used email for ${adminId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  /**
   * Phase 26 (2026-05-20) — every successful MFA login is notified
   * to the admin's address on record. Pre-Phase-26 only backup-code
   * use was notified; a phished password + TOTP let an attacker
   * repeatedly access the account without the legitimate admin
   * seeing any side-channel signal. This handler closes that gap.
   *
   * Repeat-suppression is intentionally NOT implemented yet —
   * device-fingerprint dedup would dampen the signal but also
   * silence the attack case where the attacker reuses the same
   * fingerprint (a stolen cookie + the same browser). The cost of
   * a per-login email is acceptable for the admin surface; tighten
   * later if volume becomes an issue.
   */
  @OnEvent('admin.mfa.login_succeeded')
  async onAdminMfaLoginSucceeded(
    event: DomainEvent<{
      adminId: string;
      email?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
      sessionId?: string;
    }>,
  ) {
    const { adminId, email, ipAddress, userAgent } = event.payload;
    if (!email) return;
    try {
      await this.emailService.send({
        to: email,
        subject: 'Your SPORTSMART admin account was just signed in',
        html: this.wrap(safeHtml`
          <h2 style="color: #2563eb;">New admin sign-in</h2>
          <p>Your SPORTSMART admin account was just signed in with MFA.</p>
          <div style="background: #eff6ff; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #bfdbfe; font-size: 13px; color: #1e3a8a;">
            <p style="margin: 0 0 4px 0;"><strong>Admin ID:</strong> ${adminId}</p>
            <p style="margin: 0 0 4px 0;"><strong>IP:</strong> ${ipAddress ?? 'unknown'}</p>
            <p style="margin: 0;"><strong>User agent:</strong> ${userAgent ?? 'unknown'}</p>
          </div>
          <p>If this was you, no action is needed. If not, change your password immediately and rotate your MFA secret.</p>
        `),
        text: `A successful MFA login happened on your SPORTSMART admin account (IP ${ipAddress ?? 'unknown'}). If this was not you, change your password and rotate your MFA secret immediately.`,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send admin.mfa.login_succeeded email for ${adminId}: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    }
  }

  // ──── Helpers ────

  private async findSeller(sellerId: string) {
    return this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { email: true, sellerName: true, status: true },
    });
  }

  /**
   * Phase 20 (2026-05-20) — franchise lookup helper used by the
   * franchise lifecycle handlers above.
   */
  private async findFranchise(franchiseId: string) {
    return this.prisma.franchisePartner.findUnique({
      where: { id: franchiseId },
      select: {
        email: true,
        ownerName: true,
        businessName: true,
        status: true,
      },
    });
  }

  /**
   * Phase 22 (2026-05-20) — affiliate lookup helper used by the
   * affiliate lifecycle handlers above.
   */
  private async findAffiliate(affiliateId: string) {
    return this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: {
        email: true,
        firstName: true,
        lastName: true,
        status: true,
      },
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
