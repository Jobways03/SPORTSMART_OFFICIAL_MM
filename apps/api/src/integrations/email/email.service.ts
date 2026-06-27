import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EnvService } from '../../bootstrap/env/env.service';
import { AppLoggerService } from '../../bootstrap/logging/app-logger.service';
import { htmlToText } from './html-to-text';

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  /**
   * Plain-text alternative body. When omitted, the EmailService
   * auto-derives one from `html` via `htmlToText`. Pass an explicit
   * `text` only when the auto-derived version would lose structure
   * that hand-formatting can preserve.
   */
  text?: string;
}

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;

  constructor(
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('EmailService');

    const user = this.envService.getString('MAIL_USER', '');
    const pass = this.envService.getString('MAIL_PASS', '');
    this.from =
      this.envService.getString('MAIL_FROM', '') ||
      `SPORTSMART <${user}>`;

    if (!user || !pass) {
      this.logger.warn('MAIL_USER or MAIL_PASS not set — emails will be logged only');
      return;
    }

    // cPanel / shared-hosting SMTP (e.g. GoDaddy) commonly presents a SHARED
    // wildcard cert (e.g. *.prod.phx3.secureserver.net) that does NOT match
    // mail.<domain>, so strict TLS hostname verification fails the handshake and
    // every send errors out. MAIL_TLS_REJECT_UNAUTHORIZED=false skips the
    // hostname check (the connection is still TLS-encrypted) for that case. It
    // defaults to true (strict) for providers whose cert matches (Gmail/SES/…).
    const tlsRejectUnauthorized =
      this.envService.getString('MAIL_TLS_REJECT_UNAUTHORIZED', 'true') !== 'false';

    this.transporter = nodemailer.createTransport({
      host: this.envService.getString('MAIL_HOST', 'smtp.gmail.com'),
      port: this.envService.getNumber('MAIL_PORT', 587),
      secure: this.envService.getString('MAIL_SECURE', 'false') === 'true',
      auth: { user, pass },
      tls: { rejectUnauthorized: tlsRejectUnauthorized },
      // Phase 1 (PR 1.6) — explicit transport timeouts. Nodemailer's
      // defaults are 10 MINUTES on every step, so a hung MX record
      // or unresponsive Gmail server pins each `sendMail` call for
      // 10 min × 3 steps = up to 30 min. Twenty-plus event handlers
      // `await emailService.send` in this codebase; one slow SMTP
      // server is enough to stall order-status / commission flows.
      //
      // Chosen values (all ms):
      //   connectionTimeout — TCP connect; 10s tolerates a slow MX
      //                       lookup but rejects a black-hole router.
      //   greetingTimeout   — SMTP banner (EHLO); 10s is the IETF
      //                       recommendation for typical SMTP servers.
      //   socketTimeout     — read on an established socket; 30s
      //                       lets large attachments transit without
      //                       false positives on transient buffering.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      // Pooling lets a burst of order-confirmation emails reuse the
      // same TLS handshake. Without this, every send opens a fresh
      // connection — adds ~200ms latency under any non-trivial load.
      pool: true,
      maxConnections: 5,
    });

    this.transporter.verify().then(() => {
      this.logger.log('SMTP transport verified and ready');
    }).catch((err) => {
      this.logger.error(`SMTP transport verification failed: ${err.message}`);
    });
  }

  async send(options: SendMailOptions): Promise<boolean> {
    const { to, subject, html } = options;
    // Phase 5 follow-up (2026-05-16) — every email now ships with a
    // plain-text alternative. RFC 2046 strongly recommends a
    // multipart/alternative payload (text + html) so clients that
    // can't or won't render HTML (text-only mail-readers, narrow
    // screen-reader inboxes, spam-filter snippet previews, mobile
    // notification expansions) get a readable body. Callers can
    // still pass an explicit `text` when the auto-derived version
    // would miss important structure.
    const text =
      options.text && options.text.trim().length > 0
        ? options.text
        : htmlToText(html);

    // Dev-only: surface verification/OTP codes in the logs so email-gated
    // flows (email verification + password reset, across every persona —
    // customer, seller, franchise, admin, affiliate) are testable without
    // depending on real inbox delivery. Gated on NODE_ENV so it NEVER logs
    // a code in production. Detects an OTP email by keyword, then extracts
    // the 6-digit code from the body.
    if (process.env.NODE_ENV !== 'production') {
      const looksLikeOtp =
        /\b(otp|verification code|verify your|reset code|one[- ]time|password reset)\b/i.test(
          `${subject} ${text}`,
        );
      const code = looksLikeOtp ? (text.match(/\b(\d{6})\b/) || [])[1] : undefined;
      if (code) {
        this.logger.warn(`🔑 [DEV OTP] for ${to}: ${code}   (subject: "${subject}")`);
      }
    }

    if (!this.transporter) {
      this.logger.warn(`[DEV-MAIL] To: ${to} | Subject: ${subject}`);
      this.logger.warn(`[DEV-MAIL] Body: ${text || html}`);
      return false;
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
        text,
      });
      this.logger.log(`Email sent to ${to}: ${info.messageId}`);
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to send email to ${to}: ${err.message}`);
      return false;
    }
  }
}
