import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { EmailService } from '../../../../integrations/email/email.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { ContactDto } from '../../presentation/dtos/contact.dto';

// Minimal HTML-escape so user-supplied contact fields can never inject markup
// into the notification email we send to the support inbox.
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const METHOD_LABEL: Record<ContactDto['contactMethod'], string> = {
  email: 'Email',
  phone: 'Phone',
  sms: 'SMS',
};

@Injectable()
export class ContactService {
  constructor(
    private readonly email: EmailService,
    private readonly env: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ContactService');
  }

  /**
   * Email a "Contact us" submission to the support inbox. Throws only when SMTP
   * is actually configured and the send fails — in dev/log-only mode
   * (EmailService returns false and logs `[DEV-MAIL]`) we treat it as delivered
   * so the local form is testable without SMTP creds.
   */
  async submit(dto: ContactDto): Promise<void> {
    const to = this.env.getString('SUPPORT_EMAIL', 'support@sportsmart.com');
    const name = [dto.firstName, dto.lastName].filter(Boolean).join(' ').trim();

    const rows: Array<[string, string]> = [
      ['Name', name || dto.firstName],
      ['Email', dto.email],
    ];
    if (dto.phone) rows.push(['Phone', dto.phone]);
    rows.push(
      ['Preferred contact', METHOD_LABEL[dto.contactMethod]],
      ['Reason', dto.reason],
    );

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
        <h2 style="margin: 0 0 4px; color: #0f1115;">New contact enquiry</h2>
        <p style="color: #6b7280; margin: 0 0 20px; font-size: 13px;">Submitted via the SPORTSMART contact form.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          ${rows
            .map(
              ([k, v]) => `
            <tr>
              <td style="padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600; width: 160px;">${esc(k)}</td>
              <td style="padding: 8px 12px; border: 1px solid #e5e7eb;">${esc(v)}</td>
            </tr>`,
            )
            .join('')}
        </table>
        <h3 style="margin: 20px 0 8px; font-size: 14px; color: #0f1115;">Message</h3>
        <div style="padding: 12px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; white-space: pre-wrap; font-size: 14px;">${esc(dto.message)}</div>
        <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">Reply directly to ${esc(dto.email)}.</p>
      </div>`;

    const text =
      `New contact enquiry (SPORTSMART)\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
      `\n\nMessage:\n${dto.message}\n\nReply to: ${dto.email}`;

    const sent = await this.email.send({
      to,
      subject: `Contact form: ${dto.reason} — ${name || dto.email}`,
      html,
      text,
    });

    // EmailService returns false both on a real SMTP failure AND in log-only
    // dev mode (no MAIL_USER/MAIL_PASS). Only surface an error when mail is
    // genuinely configured — otherwise localhost would always 500.
    const mailConfigured =
      !!this.env.getString('MAIL_USER', '') && !!this.env.getString('MAIL_PASS', '');

    if (!sent && mailConfigured) {
      // EmailService already logged the SMTP error with its "Failed to send" prefix.
      this.logger.error(
        `Contact email to ${to} failed to send (from ${dto.email}, reason "${dto.reason}")`,
      );
      throw new InternalServerErrorException(
        'We could not send your message right now. Please try again shortly.',
      );
    }
  }
}
