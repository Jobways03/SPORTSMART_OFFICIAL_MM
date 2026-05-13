import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
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

/**
 * Phase 0 (PR 0.13) — error codes from the gateway-verifier helper and
 * standard app exceptions that represent PERMANENT failures. For these,
 * Razorpay retrying will never produce a different outcome (the payment
 * captured amount won't change, the order won't materialise out of
 * NOT_FOUND, etc.). We acknowledge with 200 and a `code` field so the
 * gateway stops redelivering — the alert side-effects in the facade
 * already recorded the diagnostic.
 *
 * Anything NOT in this set is treated as transient (DB outage, network
 * blip, P2002 from a concurrent partner). For transient errors we
 * release the Redis idempotency claim and return 500 so the gateway's
 * retry policy kicks in and a future replay can succeed.
 */
const PERMANENT_ERROR_CODES = new Set<string>([
  'GATEWAY_PAYMENT_NOT_CAPTURED',
  'GATEWAY_ORDER_ID_MISMATCH',
  'GATEWAY_AMOUNT_MISMATCH',
  'BAD_REQUEST',
  'NOT_FOUND',
]);

interface RazorpayWebhookPayload {
  event: string;
  // Phase 4 (PR 4.7) — Unix seconds, set by Razorpay at event
  // creation. The replay-window check rejects events whose
  // `created_at` is outside ±RAZORPAY_WEBHOOK_REPLAY_WINDOW_SECONDS
  // of the server clock. Missing in some legacy payloads / manual-
  // replay tools — the controller falls through with a warn log
  // rather than breaking those flows.
  created_at?: number;
  payload: {
    payment?: {
      entity: {
        id: string;
        // Razorpay always includes order_id on captured/failed events. Kept
        // optional here for type-safety (legacy payloads from manual replay
        // tools may omit it); the assertion below rejects when absent.
        order_id?: string;
        notes?: { masterOrderId?: string };
        status: string;
        // Paise. Razorpay's API speaks paise natively — no conversion
        // needed. Used by the Phase 0 (PR 0.1) amount-mismatch guard.
        amount: number;
        // Phase 0 (PR 0.1) — required by the amount verifier. Captured
        // events always have this true; reject otherwise as a defense
        // in depth.
        captured?: boolean;
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
   * Phase 0 (PR 0.13) — release the claim so a retry can re-run.
   * Used only on transient error paths (DB outage, etc.) where the
   * gateway's retry policy should kick in. Permanent errors keep the
   * claim so the retry storm doesn't keep hitting the same wall.
   *
   * Plain `redis.del` (not the PR 1.7 fenced variant): the claim's
   * 24h TTL is two orders of magnitude longer than any request can
   * run, so the "TTL expired mid-work and a successor acquired"
   * race that fenced release was built to fix simply doesn't apply
   * here. The whole webhook request is over in seconds.
   */
  private async releaseClaim(eventId: string): Promise<void> {
    await this.redis.del(`webhook:razorpay:${eventId}`);
  }

  /**
   * Phase 4 (PR 4.7) — replay-window check on `payload.created_at`.
   *
   * The HMAC signature only proves the payload was emitted with our
   * webhook secret. It does NOT prove WHEN. A captured legitimate
   * payload (leaked log, TLS-strip proxy, mirrored traffic) can be
   * replayed indefinitely until the Redis idempotency claim's 24h
   * TTL expires.
   *
   * The narrower defence: Razorpay's payload carries a top-level
   * `created_at` (Unix seconds, when the event was emitted). Reject
   * events whose timestamp is outside ±replayWindowSeconds of the
   * server clock — 5 min by default (matches Stripe). A future
   * forged-clock payload also gets rejected for symmetry.
   *
   * Missing `created_at`: rare (legacy / manual replay) but possible.
   * Log a warn and let the request through — the other defences
   * (Redis claim, downstream TOCTOU) still apply.
   */
  private assertWithinReplayWindow(createdAtSeconds: number | undefined): void {
    if (createdAtSeconds == null) {
      this.logger.warn(
        'Razorpay webhook missing `created_at` — replay-window check skipped; ' +
          'relying on Redis idempotency + downstream TOCTOU for replay protection.',
      );
      return;
    }
    const windowSeconds = this.envService.getNumber(
      'RAZORPAY_WEBHOOK_REPLAY_WINDOW_SECONDS',
      300,
    );
    const nowSeconds = Math.floor(Date.now() / 1000);
    const driftSeconds = Math.abs(nowSeconds - createdAtSeconds);
    if (driftSeconds > windowSeconds) {
      throw new UnauthorizedAppException(
        `Razorpay webhook outside replay window: created_at=${createdAtSeconds}, ` +
          `now=${nowSeconds}, drift=${driftSeconds}s, allowed=${windowSeconds}s. ` +
          `Replay attack or clock skew — reject.`,
      );
    }
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

    // Phase 4 (PR 4.7) — replay-window check. Runs after signature
    // verification (no point checking timestamp on an unsigned/forged
    // payload) and BEFORE the Redis idempotency claim (no point
    // claiming an event we're about to reject). A stale event throws
    // 401, the gateway will not retry (Razorpay 4xx → no retry).
    this.assertWithinReplayWindow(payload.created_at);

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
          // Phase 0 (PR 0.1) — gateway snapshot drives the silent-money-loss
          // guard inside the facade. The webhook signature has already been
          // verified above, so we trust these fields as gateway-truth.
          gatewaySnapshot: {
            amount: payment.amount,
            status: payment.status,
            captured: payment.captured ?? false,
            order_id: payment.order_id ?? '',
          },
        });
        return { success: true, message: 'Payment processed' };
      } catch (err: any) {
        // Phase 0 (PR 0.13) — branch on permanent vs transient.
        // Permanent (GATEWAY_*, BAD_REQUEST, NOT_FOUND): keep the
        // claim, return 200 with the stable code. Razorpay should not
        // retry — the diagnostic is already in `PaymentMismatchAlert`.
        // Transient (DB outage, network, P2002 from a parallel
        // partner): release the claim and throw 500 so the gateway
        // retry policy kicks in and a future replay can succeed.
        const isPermanent = PERMANENT_ERROR_CODES.has(err?.code ?? '');
        const logSuffix = err.code ? ` [code=${err.code}]` : '';
        if (isPermanent) {
          this.logger.error(
            `Failed to process webhook payment ${payment.id} (permanent): ${err.message}${logSuffix}`,
          );
          return { success: false, message: err.message, code: err.code };
        }
        // Transient — release the Redis claim so retry can re-run.
        this.logger.error(
          `Failed to process webhook payment ${payment.id} (transient): ${err.message}${logSuffix} — releasing claim for retry`,
        );
        await this.releaseClaim(eventKey).catch((relErr) =>
          this.logger.error(
            `Failed to release Redis claim for ${eventKey}: ${relErr?.message ?? relErr}`,
          ),
        );
        throw new InternalServerErrorException(
          `Webhook processing failed transiently: ${err.message}`,
        );
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
            // Phase 0 (PR 0.13) — same permanent/transient split as
            // the captured branch above. The most common permanent
            // case here is BAD_REQUEST ("Cannot mark a PAID order as
            // failed") — happens when a captured+failed pair arrives
            // for the same payment in unusual order.
            const isPermanent = PERMANENT_ERROR_CODES.has(err?.code ?? '');
            if (isPermanent) {
              this.logger.error(
                `Failed to mark order as failed (permanent): ${err.message}` +
                  (err.code ? ` [code=${err.code}]` : ''),
              );
              // Don't release the claim; don't retry.
            } else {
              this.logger.error(
                `Failed to mark order as failed (transient): ${err.message} — releasing claim`,
              );
              await this.releaseClaim(eventKey).catch(() => undefined);
              throw new InternalServerErrorException(
                `Webhook processing failed transiently: ${err.message}`,
              );
            }
          }
        }
      }
      return { success: true, message: 'Payment failure recorded' };
    }

    // Other events — acknowledge but don't act
    return { success: true, message: `Event ${payload.event} acknowledged` };
  }
}
