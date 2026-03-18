import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EnvService } from '../../bootstrap/env/env.service';
import { AppLoggerService } from '../../bootstrap/logging/app-logger.service';

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
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

    this.transporter = nodemailer.createTransport({
      host: this.envService.getString('MAIL_HOST', 'smtp.gmail.com'),
      port: this.envService.getNumber('MAIL_PORT', 587),
      secure: this.envService.getString('MAIL_SECURE', 'false') === 'true',
      auth: { user, pass },
    });

    this.transporter.verify().then(() => {
      this.logger.log('SMTP transport verified and ready');
    }).catch((err) => {
      this.logger.error(`SMTP transport verification failed: ${err.message}`);
    });
  }

  async send(options: SendMailOptions): Promise<boolean> {
    const { to, subject, html, text } = options;

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
        text: text || undefined,
      });
      this.logger.log(`Email sent to ${to}: ${info.messageId}`);
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to send email to ${to}: ${err.message}`);
      return false;
    }
  }
}
