import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';

/**
 * Phase 185 (#1) — SMS integration. Exposes a single provider-switched
 * `SmsService` the notifications SMS provider depends on. Kept as a thin
 * module (no controllers) mirroring the email/whatsapp integration shape.
 */
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
