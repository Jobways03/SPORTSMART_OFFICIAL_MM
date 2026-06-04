import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';
import {
  INotificationProvider,
  SendArgs,
  SendResult,
} from '../../application/ports/notification-provider.port';
import { SmsService } from '../../../../integrations/sms/sms.service';

/**
 * Phase 185 (#1/#4) — real SMS provider.
 *
 * Pre-Phase-185 this was a console stub that always reported success, so
 * the SMS channel existed in the enum but never reached a handset and had
 * no TRAI DLT enforcement. It now:
 *
 *   • routes through the provider-switched `SmsService` (stub | MSG91 |
 *     Twilio), and
 *   • enforces TRAI DLT compliance: when `SMS_DLT_ENFORCED=true`, a
 *     transactional SMS with no DLT content-template id is refused with a
 *     non-retryable failure (sending an un-DLT'd SMS attracts per-message
 *     fines and carrier blocking). The DLT ids are resolved from the
 *     template at enqueue time and threaded through `SendArgs`.
 */
@Injectable()
export class SmsNotificationProvider implements INotificationProvider {
  readonly channel: NotificationChannel = 'SMS';
  private readonly logger = new Logger(SmsNotificationProvider.name);

  constructor(private readonly sms: SmsService) {}

  async send(args: SendArgs): Promise<SendResult> {
    // #4 — DLT gate. Only enforced when the flag is on AND a real provider
    // is selected (the stub is for dev/test, where DLT ids don't exist).
    const enforced =
      process.env.SMS_DLT_ENFORCED === 'true' && this.sms.isRealProvider();
    if (enforced && !args.dltTemplateId) {
      const reason =
        `SMS blocked: no TRAI DLT template id for "${args.templateKey ?? '(raw)'}" ` +
        `(SMS_DLT_ENFORCED=true). Register the template on the DLT portal and set ` +
        `dltTemplateId before sending.`;
      this.logger.error(reason);
      return { success: false, failureReason: reason, retryable: false, failureCode: 'NOT_CONFIGURED', provider: 'sms' };
    }

    const outcome = await this.sms.send({
      to: args.to,
      body: args.body,
      dltTemplateId: args.dltTemplateId,
      dltHeaderId: args.dltHeaderId,
    });

    if (outcome.sent) {
      return { success: true, providerMessageId: outcome.providerMessageId, provider: 'sms' };
    }

    // Phase 190 (#6) — map the SMS blockedReason onto a canonical code.
    const failureCode =
      outcome.blockedReason === 'INVALID_NUMBER'
        ? 'INVALID_PHONE'
        : outcome.blockedReason === 'NOT_CONFIGURED'
          ? 'NOT_CONFIGURED'
          : 'PROVIDER_ERROR';
    return {
      success: false,
      failureReason: outcome.detail ?? outcome.blockedReason ?? 'unknown SMS failure',
      retryable: outcome.retryable ?? false,
      failureCode,
      provider: 'sms',
    };
  }
}
