import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import * as crypto from 'crypto';
import type { Request } from 'express';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { RazorpayRefundWebhookService } from '../../application/services/razorpay-refund-webhook.service';

// Phase 100 (2026-05-23) — Phase 98 audit Gap #20 closure.
//
// Razorpay sends `refund.processed` and `refund.failed` events to a
// configured webhook URL. Pre-Phase-100 we had no handler, so async-
// settled refunds (the normal path for ORIGINAL_PAYMENT routes) never
// auto-confirmed in our system — admin had to manually click confirm.
//
// HMAC verification reuses the same `RAZORPAY_WEBHOOK_SECRET` env as
// the payment webhook. Body is consumed raw (registered via the
// `rawBody: true` Nest factory option) so the signature computes over
// the exact bytes Razorpay sent.

@ApiTags('Razorpay Refund Webhook')
@Controller('webhooks/razorpay/refunds')
export class RazorpayRefundWebhookController {
  private readonly logger = new Logger(RazorpayRefundWebhookController.name);

  constructor(
    private readonly env: EnvService,
    private readonly webhookService: RazorpayRefundWebhookService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string,
    @Body() body: any,
  ) {
    if (!signature) {
      throw new UnauthorizedAppException('Missing x-razorpay-signature header');
    }
    const secret = this.env.getString('RAZORPAY_WEBHOOK_SECRET', '');
    if (!secret) {
      this.logger.error(
        '[razorpay-refund-webhook] RAZORPAY_WEBHOOK_SECRET is not configured — refusing all events',
      );
      throw new UnauthorizedAppException('Webhook secret not configured');
    }

    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(body);
    const expected = crypto
      .createHmac('sha256', secret)
      .update(raw)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const givenBuf = Buffer.from(signature, 'hex');
    if (
      expectedBuf.length !== givenBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, givenBuf)
    ) {
      throw new UnauthorizedAppException('Invalid webhook signature');
    }

    const eventType = body?.event;
    if (
      eventType !== 'refund.processed' &&
      eventType !== 'refund.failed' &&
      eventType !== 'refund.created'
    ) {
      // Acknowledge non-refund events so Razorpay stops resending,
      // but don't act on them. Payment events go to a separate
      // controller.
      return { ok: true, ignored: true, event: eventType };
    }

    const refundEntity = body?.payload?.refund?.entity;
    if (!refundEntity?.id) {
      throw new BadRequestAppException(
        'Razorpay refund webhook missing payload.refund.entity.id',
      );
    }
    const eventId = String(
      body?.event_id ?? body?.id ?? `${refundEntity.id}:${body?.created_at ?? ''}`,
    );

    const outcome = await this.webhookService.handleEvent({
      eventId,
      eventType,
      refundId: String(refundEntity.id),
      paymentId: refundEntity.payment_id
        ? String(refundEntity.payment_id)
        : undefined,
      refundStatus: String(refundEntity.status ?? ''),
      amountInPaise:
        typeof refundEntity.amount === 'number' ? refundEntity.amount : undefined,
      rawPayload: body,
    });

    return { ok: true, ...outcome };
  }
}
