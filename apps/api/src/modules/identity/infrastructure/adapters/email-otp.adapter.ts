import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailService } from '../../../../integrations/email/email.service';
import { OtpSenderPort } from '../../../../core/ports';

@Injectable()
export class EmailOtpAdapter implements OtpSenderPort {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly emailService: EmailService,
  ) {
    this.logger.setContext('EmailOtpAdapter');
  }

  async sendOtp(destination: string, otp: string): Promise<void> {
    this.logger.log(`Sending OTP to ${destination}`);

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #1f2937; margin: 0;">SPORTSMART</h2>
        </div>
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; text-align: center;">
          <p style="color: #374151; font-size: 16px; margin: 0 0 16px;">Your verification code is:</p>
          <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #2563eb; padding: 16px; background: #fff; border-radius: 8px; border: 2px dashed #2563eb;">
            ${otp}
          </div>
          <p style="color: #6b7280; font-size: 13px; margin: 16px 0 0;">This code expires in 10 minutes. Do not share it with anyone.</p>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 24px;">
          If you did not request this code, please ignore this email.
        </p>
      </div>
    `;

    await this.emailService.send({
      to: destination,
      subject: 'Your SPORTSMART Verification Code',
      html,
      text: `Your SPORTSMART verification code is: ${otp}. It expires in 10 minutes.`,
    });
  }
}
