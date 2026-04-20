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
import { PaymentsPublicFacade } from '../../application/facades/payments-public.facade';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';

// Cache duplicate event IDs for 24h. Razorpay's retry window is shorter
// than this so anything we've already processed within the window will
// be silently dropped on retry.
const WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment?: {
      entity: {
        id: string;
        order_id?: string;
        notes?: { masterOrderId?: string };
        status: string;
        amount: number;
      };
    };
  };
}

@ApiTags('Payment Webhooks')
@Controller('payments/webhooks')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    private readonly paymentsFacade: PaymentsPublicFacade,
    private readonly envService: EnvService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Idempotency check using Redis SET NX. Returns true if this is the first
   * time we're seeing the given event ID; false if it's a duplicate.
   * Reuses the distributed-lock primitive — semantically the same operation.
   */
  private async claimEvent(eventId: string): Promise<boolean> {
    return this.redis.acquireLock(
      `webhook:razorpay:${eventId}`,
      WEBHOOK_IDEMPOTENCY_TTL_SECONDS,
    );
  }

  /**
   * Verify the Razorpay webhook signature using HMAC SHA256.
   * Razorpay computes the signature over the raw request body using the
   * webhook secret configured in the dashboard.
   */
  private verifySignature(rawBody: Buffer | undefined, signature: string): void {
    if (!signature) {
      throw new UnauthorizedAppException('Missing webhook signature');
    }
    if (!rawBody) {
      throw new BadRequestAppException('Missing raw request body');
    }

    const secret = this.envService.getOptional('RAZORPAY_WEBHOOK_SECRET');
    if (!secret) {
      // Without a configured secret we cannot verify — fail closed.
      throw new UnauthorizedAppException(
        'Webhook secret not configured on server',
      );
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Use constant-time comparison to prevent timing attacks.
    const expectedBuf = Buffer.from(expected, 'utf8');
    const signatureBuf = Buffer.from(signature, 'utf8');
    if (
      expectedBuf.length !== signatureBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, signatureBuf)
    ) {
      throw new UnauthorizedAppException('Invalid webhook signature');
    }
  }

  /**
   * Razorpay webhook endpoint.
   * Validates the HMAC SHA256 signature against RAZORPAY_WEBHOOK_SECRET before
   * processing the event.
   */
  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  async handleRazorpayWebhook(
    @Headers('x-razorpay-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: RazorpayWebhookPayload,
  ) {
    this.verifySignature(req.rawBody, signature);

    this.logger.log(`Razorpay webhook received: ${payload.event}`);

    if (payload.event === 'payment.captured') {
      const payment = payload.payload.payment?.entity;
      if (!payment) {
        throw new BadRequestAppException('Missing payment entity in webhook');
      }
      const masterOrderId = payment.notes?.masterOrderId;
      if (!masterOrderId) {
        this.logger.warn(
          `Webhook received without masterOrderId in notes: ${payment.id}`,
        );
        return {
          success: true,
          message: 'Webhook acknowledged but no order linked',
        };
      }

      // Idempotency: drop the duplicate without re-running side effects.
      // Keyed on payment.id + event so a captured + failed for the same
      // payment ID don't collide.
      const eventKey = `payment.captured:${payment.id}`;
      const isFirstDelivery = await this.claimEvent(eventKey);
      if (!isFirstDelivery) {
        this.logger.log(
          `Duplicate webhook event ${eventKey} ignored (already processed)`,
        );
        return { success: true, message: 'Duplicate event ignored' };
      }

      try {
        await this.paymentsFacade.markOrderPaid({
          masterOrderId,
          actorType: 'WEBHOOK',
          actorId: payment.id,
          paymentReference: payment.id,
          notes: `Razorpay payment ${payment.id} captured`,
        });
        return { success: true, message: 'Payment processed' };
      } catch (err: any) {
        this.logger.error(
          `Failed to process webhook payment: ${err.message}`,
        );
        // Return 200 to prevent Razorpay retries — log for manual investigation
        return { success: false, message: err.message };
      }
    }

    if (payload.event === 'payment.failed') {
      const payment = payload.payload.payment?.entity;
      if (payment) {
        const masterOrderId = payment.notes?.masterOrderId;
        if (masterOrderId) {
          // Idempotency for failed events too — same dedup key namespace.
          const eventKey = `payment.failed:${payment.id}`;
          const isFirstDelivery = await this.claimEvent(eventKey);
          if (!isFirstDelivery) {
            this.logger.log(
              `Duplicate webhook event ${eventKey} ignored (already processed)`,
            );
            return { success: true, message: 'Duplicate event ignored' };
          }

          try {
            await this.paymentsFacade.markOrderPaymentFailed({
              masterOrderId,
              reason: 'Payment failed at gateway',
              actorType: 'WEBHOOK',
            });
          } catch (err: any) {
            this.logger.error(
              `Failed to mark order as failed: ${err.message}`,
            );
          }
        }
      }
      return { success: true, message: 'Payment failure recorded' };
    }

    // Other events — acknowledge but don't act
    return { success: true, message: `Event ${payload.event} acknowledged` };
  }
}
