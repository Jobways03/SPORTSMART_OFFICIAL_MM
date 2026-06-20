import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Optional,
  Post,
  Req,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as crypto from 'crypto';
import type { Request } from 'express';
import { PaymentsPublicFacade } from '../../application/facades/payments-public.facade';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
// Phase 169 (Payment Ops audit #1/#2) — Razorpay dispute / chargeback ingestion.
// PaymentOpsModule is @Global so this injects without a PaymentsModule import.
import { ChargebackService } from '../../../payments-ops/application/services/chargeback.service';
import { z } from 'zod';

// Phase 69 (2026-05-22) — Phase 66 audit Gap #23. Defence-in-depth
// Zod schema for the webhook payload. The HMAC signature already
// gates integrity, but the schema makes the failure mode explicit
// for malformed payloads (manual-replay tools, payload-shape drift
// after a Razorpay API update) — instead of TypeScript silently
// trusting an `as` cast and the downstream code throwing a less
// helpful "Cannot read properties of undefined" surface, we reject
// at the boundary with a structured error.
const razorpayPaymentEntitySchema = z.object({
  id: z.string().min(1, 'payment.entity.id is required'),
  // order_id is optional in the type for legacy compatibility,
  // but the amount-mismatch guard rejects when absent.
  order_id: z.string().optional(),
  notes: z
    .object({
      masterOrderId: z.string().optional(),
    })
    .passthrough()
    .optional(),
  status: z.string().min(1, 'payment.entity.status is required'),
  // Paise as integer. Razorpay always speaks integer paise; reject
  // negatives or floats so the amount-mismatch guard receives a
  // safe value.
  amount: z.number().int().nonnegative(),
  captured: z.boolean().optional(),
  // Phase 165 (#5) — gateway-side failure detail on payment.failed.
  error_code: z.string().optional(),
  error_description: z.string().optional(),
});

// Phase 169 (Payment Ops audit #1/#2) — Razorpay dispute entity (chargeback).
// Razorpay sends payment.dispute.* events whose payload carries a `dispute`
// entity (not `payment`). amount is integer paise; respond_by is Unix seconds.
const razorpayDisputeEntitySchema = z.object({
  id: z.string().min(1, 'dispute.entity.id is required'),
  payment_id: z.string().optional(),
  amount: z.number().int().nonnegative().optional(),
  currency: z.string().optional(),
  reason_code: z.string().optional(),
  status: z.string().optional(),
  // Unix seconds — the contest deadline.
  respond_by: z.number().int().positive().optional(),
});

const razorpayWebhookSchema = z.object({
  event: z.string().min(1, 'event is required'),
  // Unix seconds, optional for legacy replay tools.
  created_at: z.number().int().positive().optional(),
  payload: z.object({
    payment: z
      .object({
        entity: razorpayPaymentEntitySchema,
      })
      .optional(),
    // Phase 169 — dispute payload (present on payment.dispute.* events).
    dispute: z
      .object({
        entity: razorpayDisputeEntitySchema,
      })
      .optional(),
  }),
});

type ZodParsedWebhook = z.infer<typeof razorpayWebhookSchema>;

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
    // Phase 165 (#3/#16) — durable webhook ledger + defense-in-depth
    // order resolution by gateway order_id.
    private readonly prisma: PrismaService,
    // Phase 165 (#15) — compliance audit trail. @Optional so unit specs
    // can construct the controller without the audit DI (AuditModule is
    // @Global in the running app, so it resolves in production).
    @Optional() private readonly audit?: AuditPublicFacade,
    // Phase 169 (#2) — dispute ingestion. @Optional for the same spec-harness
    // reason; PaymentOpsModule is @Global so it resolves in production.
    @Optional() private readonly chargebacks?: ChargebackService,
    // Option B (Phase 4) — emit `payments.gateway_capture_unresolved` so the
    // checkout module can materialize a deferred order from its CheckoutSession.
    // @Optional for the spec harness; EventsModule is @Global so it resolves in
    // production.
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Phase 165 (#3) — durable idempotency claim. The Redis claim (above)
   * is the fast concurrency gate; THIS is the backstop that survives a
   * Redis flush/outage within the 24h TTL. Returns 'DROP' when the event
   * was already terminally processed (PROCESSED / FAILED_PERMANENT) — that
   * is exactly the Redis-flush replay the audit flagged — or when a
   * concurrent worker just created the row (P2002). 'PROCEED' otherwise
   * (first delivery, or a retry of a transiently-incomplete one).
   */
  private async durableClaim(meta: {
    eventKey: string;
    eventType: string;
    providerEventId?: string | null;
    providerPaymentId?: string | null;
    masterOrderId?: string | null;
    payloadSha256: string;
    signature?: string | null;
  }): Promise<'PROCEED' | 'DROP'> {
    try {
      const existing = await this.prisma.paymentWebhookEvent.findUnique({
        where: { eventKey: meta.eventKey },
      });
      if (
        existing &&
        (existing.processingStatus === 'PROCESSED' ||
          existing.processingStatus === 'FAILED_PERMANENT')
      ) {
        this.logger.log(
          `Durable ledger: event ${meta.eventKey} already ${existing.processingStatus} — dropping replay.`,
        );
        return 'DROP';
      }
      if (!existing) {
        await this.prisma.paymentWebhookEvent.create({
          data: {
            eventKey: meta.eventKey,
            eventType: meta.eventType,
            providerEventId: meta.providerEventId ?? null,
            providerPaymentId: meta.providerPaymentId ?? null,
            masterOrderId: meta.masterOrderId ?? null,
            payloadSha256: meta.payloadSha256,
            signature: meta.signature ?? null,
            processingStatus: 'PROCESSING',
          },
        });
      }
      return 'PROCEED';
    } catch (err: any) {
      // P2002 unique violation = a concurrent delivery just claimed it.
      if (err?.code === 'P2002') {
        this.logger.log(
          `Durable ledger: concurrent claim on ${meta.eventKey} — dropping.`,
        );
        return 'DROP';
      }
      // Any other DB error: do NOT silently proceed without a durable
      // claim (that's the whole point). Surface as transient so the
      // gateway retries.
      throw err;
    }
  }

  private async durableFinalize(
    eventKey: string,
    status: 'PROCESSED' | 'FAILED_PERMANENT' | 'IGNORED',
    errorMessage?: string,
  ): Promise<void> {
    await this.prisma.paymentWebhookEvent
      .update({
        where: { eventKey },
        data: {
          processingStatus: status,
          processedAt: new Date(),
          errorMessage: errorMessage ?? null,
        },
      })
      .catch((err) =>
        this.logger.error(
          `Durable ledger finalize failed for ${eventKey}: ${(err as Error).message}`,
        ),
      );
  }

  /**
   * Phase 165 (#16) — defense-in-depth. The webhook routes by
   * payment.notes.masterOrderId, which a compromised merchant dashboard
   * could in principle forge. The gateway's own order_id is the trusted
   * routing key: resolve the order by razorpay_order_id and, if the note
   * disagrees, trust the gateway and log the discrepancy. (The facade's
   * amount + order_id guard is the ultimate backstop, but resolving by
   * gateway-truth closes the routing hole earlier.)
   */
  private async resolveMasterOrderId(payment: {
    order_id?: string;
    notes?: { masterOrderId?: string };
    id: string;
  }): Promise<string | null> {
    const noted = payment.notes?.masterOrderId ?? null;
    if (!payment.order_id) return noted;
    const byGateway = await this.prisma.masterOrder
      .findFirst({
        where: { razorpayOrderId: payment.order_id },
        select: { id: true },
      })
      .catch(() => null);
    if (byGateway && noted && byGateway.id !== noted) {
      this.logger.warn(
        `Webhook note masterOrderId (${noted}) disagrees with gateway order ` +
          `${payment.order_id} → order ${byGateway.id}. Trusting the gateway order_id.`,
      );
    }
    return byGateway?.id ?? noted;
  }

  private async auditWebhook(
    action: string,
    payment: { id: string },
    extra: Record<string, unknown>,
  ): Promise<void> {
    if (!this.audit) return;
    await this.audit
      .writeAuditLog({
        actorId: `razorpay:${payment.id}`,
        actorRole: 'SYSTEM',
        action,
        module: 'payments',
        resource: 'payment_webhook',
        resourceId: payment.id,
        metadata: extra,
      })
      .catch(() => undefined);
  }

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
  // Phase 165 (#14) — bound the request rate. Generous: legitimate
  // Razorpay retries are bursty but bounded; this stops a forged-signature
  // flood (each request computes an HMAC) from burning CPU unbounded.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  async handleRazorpayWebhook(
    @Headers('x-razorpay-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() rawPayload: unknown,
    // Phase 165 — last + optional so existing 3-arg test calls still compile;
    // NestJS injects by decorator regardless of parameter position.
    @Headers('x-razorpay-event-id') eventIdHeader?: string,
  ) {
    this.verifySignature(req.rawBody, signature);

    // Phase 165 (#3) — hash the exact bytes processed for the durable ledger
    // (forensic proof without storing the PII-bearing full payload).
    const payloadSha256 = req.rawBody
      ? crypto.createHash('sha256').update(req.rawBody).digest('hex')
      : 'no-raw-body';

    // Phase 69 (2026-05-22) — Phase 66 audit Gap #23. Zod-validate
    // the payload shape AFTER the HMAC pass. The signature has
    // already proven the body is authentic; the schema check
    // prevents downstream `Cannot read property of undefined`
    // surfaces if Razorpay drifts the payload shape, and surfaces
    // malformed events as a clear 400 (with code WEBHOOK_PAYLOAD_INVALID).
    const parseResult = razorpayWebhookSchema.safeParse(rawPayload);
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      this.logger.warn(`Razorpay webhook payload failed schema: ${issues}`);
      throw new BadRequestAppException(
        `Webhook payload shape invalid: ${issues}`,
      );
    }
    const payload: ZodParsedWebhook = parseResult.data;

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
      // Phase 165 (#16) — route by gateway order_id (trusted), not the
      // forgeable note, falling back to the note when order_id is absent.
      const masterOrderId = await this.resolveMasterOrderId(payment);
      if (!masterOrderId) {
        // Option B (Phase 4) — a captured payment with NO MasterOrder is the
        // NORMAL deferred case (the order is materialized only on capture). When
        // the flag is on, announce it so the checkout module materializes the
        // order from its CheckoutSession; if no session owns this gateway order
        // the handler no-ops (a genuine legacy orphan). The checkout recovery
        // cron is the backstop if this event's handler fails. The session CAS
        // owns exactly-once, so the lightweight Redis claim here is enough to
        // dedupe rapid duplicate deliveries.
        if (
          payment.order_id &&
          this.envService.getBoolean('CHECKOUT_DEFERRED_ORDER_CREATION', false)
        ) {
          const eventKey = `payment.captured:${payment.id}`;
          if (await this.claimEvent(eventKey)) {
            await this.eventBus
              ?.publish({
                eventName: 'payments.gateway_capture_unresolved',
                aggregate: 'CheckoutSession',
                aggregateId: payment.order_id,
                occurredAt: new Date(),
                payload: {
                  razorpayOrderId: payment.order_id,
                  razorpayPaymentId: payment.id,
                  capturedAmountInPaise: String(payment.amount),
                },
              })
              .catch(async (e: unknown) => {
                this.logger.error(
                  `deferred capture-event publish failed for ${payment.id}: ${
                    (e as Error)?.message ?? e
                  }`,
                );
                // Release the claim so a webhook retry can re-emit. The recovery
                // cron is still a backstop, but don't silently swallow the retry
                // by leaving the 24h claim held on a failed publish.
                await this.releaseClaim(eventKey).catch(() => undefined);
              });
          }
          await this.auditWebhook('payments.webhook.deferred_capture', payment, {
            event: payload.event,
            order_id: payment.order_id,
          });
          return {
            success: true,
            message: 'Deferred capture routed for materialization',
          };
        }
        this.logger.warn(
          `Webhook received without resolvable masterOrderId: ${payment.id}`,
        );
        await this.auditWebhook('payments.webhook.unlinked', payment, {
          event: payload.event,
          order_id: payment.order_id ?? null,
        });
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
      // Phase 165 (#3) — durable backstop (survives a Redis flush).
      if (
        (await this.durableClaim({
          eventKey,
          eventType: payload.event,
          providerEventId: eventIdHeader ?? null,
          providerPaymentId: payment.id,
          masterOrderId,
          payloadSha256,
          signature,
        })) === 'DROP'
      ) {
        return { success: true, message: 'Duplicate event ignored (durable)' };
      }
      await this.auditWebhook('payments.webhook.received', payment, {
        event: payload.event,
        masterOrderId,
        amount: payment.amount,
      });

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
        await this.durableFinalize(eventKey, 'PROCESSED');
        await this.auditWebhook('payments.webhook.processed', payment, {
          event: payload.event,
          masterOrderId,
          outcome: 'captured',
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
          await this.durableFinalize(eventKey, 'FAILED_PERMANENT', err.message);
          await this.auditWebhook('payments.webhook.failed_permanent', payment, {
            event: payload.event,
            masterOrderId,
            code: err.code ?? null,
            message: err.message,
          });
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
        // Delete the durable PROCESSING row so the retry can re-claim it.
        await this.prisma.paymentWebhookEvent
          .delete({ where: { eventKey } })
          .catch(() => undefined);
        throw new InternalServerErrorException(
          `Webhook processing failed transiently: ${err.message}`,
        );
      }
    }

    if (payload.event === 'payment.failed') {
      const payment = payload.payload.payment?.entity;
      if (payment) {
        // Phase 165 (#16) — resolve by gateway order_id, not just the note.
        const masterOrderId = await this.resolveMasterOrderId(payment);
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
          // Phase 165 (#3) — durable backstop.
          if (
            (await this.durableClaim({
              eventKey,
              eventType: payload.event,
              providerEventId: eventIdHeader ?? null,
              providerPaymentId: payment.id,
              masterOrderId,
              payloadSha256,
              signature,
            })) === 'DROP'
          ) {
            return { success: true, message: 'Duplicate event ignored (durable)' };
          }
          await this.auditWebhook('payments.webhook.received', payment, {
            event: payload.event,
            masterOrderId,
            errorCode: payment.error_code ?? null,
          });

          try {
            await this.paymentsFacade.markOrderPaymentFailed({
              masterOrderId,
              // Phase 165 (#5) — surface the gateway's own reason instead of
              // a generic string; #6 — persist the failed payment id.
              reason: payment.error_description ?? 'Payment failed at gateway',
              actorType: 'WEBHOOK',
              failedPaymentId: payment.id,
              failureCode: payment.error_code ?? null,
              failureReason: payment.error_description ?? null,
            });
            await this.durableFinalize(eventKey, 'PROCESSED');
            await this.auditWebhook('payments.webhook.processed', payment, {
              event: payload.event,
              masterOrderId,
              outcome: 'failed',
              errorCode: payment.error_code ?? null,
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
              await this.durableFinalize(eventKey, 'FAILED_PERMANENT', err.message);
            } else {
              this.logger.error(
                `Failed to mark order as failed (transient): ${err.message} — releasing claim`,
              );
              await this.releaseClaim(eventKey).catch(() => undefined);
              await this.prisma.paymentWebhookEvent
                .delete({ where: { eventKey } })
                .catch(() => undefined);
              throw new InternalServerErrorException(
                `Webhook processing failed transiently: ${err.message}`,
              );
            }
          }
        }
      }
      return { success: true, message: 'Payment failure recorded' };
    }

    // Phase 165 (#10) — payment.authorized arrives only when the Razorpay
    // account is in MANUAL-capture mode (Sportsmart uses auto-capture, so a
    // capture follows immediately). Previously this fell through to a silent
    // generic ack and the order could sit in PENDING_PAYMENT forever. We now
    // explicitly record it in the durable ledger + audit so ops can SEE that
    // an authorized-but-uncaptured payment exists (the poller's orphan
    // recovery + the capture webhook still drive the actual flip).
    if (payload.event === 'payment.authorized') {
      const payment = payload.payload.payment?.entity;
      if (payment) {
        // Informational, no money flip — never 500 on a DB blip here (it would
        // make Razorpay retry a non-actionable event). Best-effort record + ack.
        try {
          const masterOrderId = await this.resolveMasterOrderId(payment);
          const eventKey = `payment.authorized:${payment.id}`;
          if (await this.claimEvent(eventKey)) {
            await this.durableClaim({
              eventKey,
              eventType: payload.event,
              providerEventId: eventIdHeader ?? null,
              providerPaymentId: payment.id,
              masterOrderId,
              payloadSha256,
              signature,
            });
            await this.durableFinalize(eventKey, 'IGNORED', 'authorized (auto-capture mode expects a follow-up capture)');
            await this.auditWebhook('payments.webhook.authorized', payment, {
              event: payload.event,
              masterOrderId,
              amount: payment.amount,
            });
            this.logger.warn(
              `payment.authorized received for ${payment.id} (order ${masterOrderId ?? 'unlinked'}). ` +
                `Auto-capture expected; if this order stalls, capture manually or it will expire.`,
            );
          }
        } catch (err) {
          this.logger.error(
            `payment.authorized handling failed for ${payment.id} (acked anyway — informational event): ${(err as Error).message}`,
          );
        }
      }
      return { success: true, message: 'Payment authorization recorded' };
    }

    // Phase 169 (Payment Ops audit #1/#2) — payment.dispute.* (chargeback)
    // ingestion. Pre-169 these were silently 200-ack'd and dropped, so the
    // platform lost contestable disputes by default. Mirrors the captured
    // branch's claim→ingest→finalize→audit structure.
    if (payload.event.startsWith('payment.dispute.')) {
      const dispute = payload.payload.dispute?.entity;
      if (!dispute) {
        // A dispute event with no dispute entity is malformed but not
        // retryable — record nothing, ack so Razorpay stops.
        this.logger.warn(
          `${payload.event} received with no dispute entity — acknowledged, no action.`,
        );
        return { success: true, message: `Event ${payload.event} acknowledged (no dispute entity)` };
      }

      const eventKey = `${payload.event}:${dispute.id}`;
      if (!(await this.claimEvent(eventKey))) {
        return { success: true, message: 'Duplicate dispute event ignored' };
      }
      try {
        // Resolve the order via the disputed payment id (gateway truth).
        // Phase 169 review (L1#1/L1#3) — try the MasterOrder column first, then
        // fall back to the Payment ledger (which records providerPaymentId at
        // capture independently of the MasterOrder write) to shrink the window
        // where a dispute lands before/around the capture write and would
        // otherwise open unlinked. Still null-safe: an unlinked chargeback
        // persists with its providerPaymentId for later reconciliation.
        let masterOrder: { id: string; orderNumber: string; customerId: string } | null = null;
        if (dispute.payment_id) {
          masterOrder = await this.prisma.masterOrder
            .findFirst({
              where: { razorpayPaymentId: dispute.payment_id },
              select: { id: true, orderNumber: true, customerId: true },
            })
            .catch(() => null);
          if (!masterOrder) {
            const pay = await this.prisma.payment
              .findFirst({
                where: { providerPaymentId: dispute.payment_id },
                select: { masterOrderId: true },
              })
              .catch(() => null);
            if (pay?.masterOrderId) {
              masterOrder = await this.prisma.masterOrder
                .findUnique({
                  where: { id: pay.masterOrderId },
                  select: { id: true, orderNumber: true, customerId: true },
                })
                .catch(() => null);
            }
          }
        }

        if (
          (await this.durableClaim({
            eventKey,
            eventType: payload.event,
            providerEventId: eventIdHeader ?? null,
            providerPaymentId: dispute.payment_id ?? null,
            masterOrderId: masterOrder?.id ?? null,
            payloadSha256,
            signature,
          })) === 'DROP'
        ) {
          return { success: true, message: 'Duplicate dispute event ignored (durable)' };
        }

        if (!this.chargebacks) {
          // Service not wired (shouldn't happen in prod — @Global). Keep the
          // durable claim so a redelivery after wiring is fixed can reprocess.
          await this.durableFinalize(eventKey, 'IGNORED', 'ChargebackService unavailable');
          this.logger.error(
            `payment.dispute received but ChargebackService is not injected — dispute ${dispute.id} NOT persisted.`,
          );
          return { success: true, message: 'Dispute acknowledged (service unavailable)' };
        }

        const result = await this.chargebacks.ingestDisputeEvent({
          eventType: payload.event,
          providerDisputeId: dispute.id,
          providerPaymentId: dispute.payment_id ?? null,
          masterOrderId: masterOrder?.id ?? null,
          orderNumber: masterOrder?.orderNumber ?? null,
          customerId: masterOrder?.customerId ?? null,
          reasonCode: dispute.reason_code ?? null,
          amountInPaise: BigInt(dispute.amount ?? 0),
          currency: dispute.currency ?? 'INR',
          dueDate: dispute.respond_by ? new Date(dispute.respond_by * 1000) : null,
          entityStatus: dispute.status ?? null,
          rawPayload: dispute,
        });

        await this.durableFinalize(eventKey, 'PROCESSED', `chargeback ${result.chargeback.id} ${result.opened ? 'opened' : 'updated'}`);
        await this.auditWebhook('payments.webhook.dispute', { id: dispute.id }, {
          event: payload.event,
          chargebackId: result.chargeback.id,
          masterOrderId: masterOrder?.id ?? null,
          status: result.chargeback.status,
          amount: dispute.amount,
        });
        return { success: true, message: `Dispute ${payload.event} processed` };
      } catch (err) {
        // Dispute ingestion is informational-but-important; never 500 on a DB
        // blip (Razorpay would retry a non-money event). Release the claim so a
        // retry can re-run, and ack.
        await this.releaseClaim(eventKey);
        await this.prisma.paymentWebhookEvent
          .deleteMany({ where: { eventKey } })
          .catch(() => undefined);
        this.logger.error(
          `payment.dispute ingestion failed for ${dispute.id} (acked; will reprocess on redelivery): ${(err as Error).message}`,
        );
        return { success: true, message: 'Dispute acknowledged (will reprocess)' };
      }
    }

    // Other events — acknowledge but don't act. (refund.* events are handled
    // by the dedicated RazorpayRefundWebhookController in the returns module.)
    return { success: true, message: `Event ${payload.event} acknowledged` };
  }
}
