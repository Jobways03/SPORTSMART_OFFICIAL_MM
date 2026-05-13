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
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { OrdersPublicFacade } from '../../../orders/application/facades/orders-public.facade';
import { verifyPayload } from '../../../../core/webhooks/webhook-signer';

/**
 * Shiprocket sends tracking events as JSON POSTs. The relevant fields are
 * documented at https://apidocs.shiprocket.in/. Status codes vary by courier
 * but Shiprocket normalises them into a single `current_status` field that
 * lands one of: PICKED UP, IN TRANSIT, OUT FOR DELIVERY, DELIVERED, RTO, NDR.
 *
 * We only act on DELIVERED for now — that's the gap the audit identified
 * (no path to DELIVERED without manual admin action). Other statuses are
 * acknowledged but not yet wired into business logic.
 */
interface ShiprocketWebhookPayload {
  awb?: string;
  current_status?: string;
  current_status_code?: number;
  shipment_status?: string;
  order_id?: string;
  // Phase 4 (PR 4.4) — carrier-side event timestamp. Shiprocket
  // sends this under several names depending on the integration
  // version; we parse whichever is present. ISO-8601 strings or
  // Unix-seconds numbers both accepted.
  current_timestamp?: string | number;
  status_received_at?: string | number;
  etd?: string | number;
  // Shiprocket payloads sometimes nest the AWB inside `data`. Accept both.
  data?: {
    awb?: string;
    current_status?: string;
    shipment_status?: string;
    current_timestamp?: string | number;
    status_received_at?: string | number;
  };
}

/**
 * Phase 4 (PR 4.4) — extract the carrier-side event timestamp from a
 * Shiprocket payload. Falls back to `new Date()` when no usable field
 * is present (treating the event as "happened now"); the monotonic-
 * order property is still defended by the CAS predicate on
 * `lastTrackingEventAt`.
 */
export function parseEventTimestamp(payload: ShiprocketWebhookPayload): Date {
  const raw =
    payload.current_timestamp ??
    payload.status_received_at ??
    payload.etd ??
    payload.data?.current_timestamp ??
    payload.data?.status_received_at;
  if (raw == null) return new Date();
  if (typeof raw === 'number') {
    // Unix-seconds heuristic: values below 10^12 are seconds, above
    // are milliseconds. (Year 33658 ≈ 10^15 ms; anything below 10^12
    // ms is sub-year-1973, which we never see in production.)
    return new Date(raw < 1_000_000_000_000 ? raw * 1000 : raw);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

const WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

// Statuses that map to a delivered sub-order. Shiprocket uses different
// strings depending on integration; treat anything containing "deliver"
// case-insensitively as a delivery confirmation.
const DELIVERY_STATUS_PATTERNS = ['delivered'];

@ApiTags('Shipping Webhooks')
@Controller('shipping/webhooks')
export class TrackingWebhookController {
  private readonly logger = new Logger(TrackingWebhookController.name);

  constructor(
    private readonly envService: EnvService,
    private readonly redis: RedisService,
    private readonly ordersFacade: OrdersPublicFacade,
  ) {}

  /**
   * Phase 1 (PR 1.4) — verify the webhook request using one of two
   * mechanisms, in priority order:
   *
   *   1. **HMAC mode** (preferred, replay-protected): when
   *      `SHIPROCKET_WEBHOOK_HMAC_SECRET` is set, the controller
   *      requires `X-Shiprocket-Signature: t=<unix_ts>,v1=<hex>`
   *      Stripe-style. The HMAC is computed over `<ts>.<rawBody>`
   *      and a 5-minute timestamp window blocks replays beyond that
   *      window. This is the secure path.
   *
   *   2. **Bearer-token mode** (legacy, deprecated): when
   *      `SHIPROCKET_WEBHOOK_HMAC_SECRET` is unset, fall back to
   *      the legacy `x_token`-in-body check. Logs a deprecation
   *      WARN on every successful verification so ops can see the
   *      cutover progress. This path stays for the operator-side
   *      cutover window only.
   *
   * The audit's CR-8: "the token is in the body, easy to intercept;
   * no HMAC, no timestamp window". HMAC mode closes both.
   */
  private verifyRequest(args: {
    rawBody: Buffer | undefined;
    signatureHeader: string | undefined;
    bodyToken: string | undefined;
  }): void {
    const hmacSecret = this.envService.getOptional(
      'SHIPROCKET_WEBHOOK_HMAC_SECRET',
    );
    if (hmacSecret) {
      // HMAC path — preferred.
      if (!args.rawBody) {
        throw new BadRequestAppException('Missing raw request body');
      }
      if (!args.signatureHeader) {
        throw new UnauthorizedAppException(
          'Missing X-Shiprocket-Signature header',
        );
      }
      const ok = verifyPayload(
        args.rawBody.toString('utf8'),
        args.signatureHeader,
        hmacSecret,
      );
      if (!ok) {
        throw new UnauthorizedAppException(
          'Invalid Shiprocket webhook signature',
        );
      }
      return;
    }

    // Legacy bearer-token path — deprecated. Logs a warning each
    // time so operators can see whether the HMAC cutover has
    // actually rolled out.
    this.logger.warn(
      'Shiprocket webhook authenticated via legacy bearer-token path. ' +
        'Set SHIPROCKET_WEBHOOK_HMAC_SECRET and migrate the dashboard ' +
        'config to remove the bearer-token fallback.',
    );
    const expected = this.envService.getOptional('SHIPROCKET_WEBHOOK_TOKEN');
    if (!expected) {
      throw new UnauthorizedAppException(
        'Webhook auth not configured (neither HMAC nor bearer-token)',
      );
    }
    if (!args.bodyToken) {
      throw new UnauthorizedAppException('Missing webhook token');
    }
    if (args.bodyToken.length !== expected.length) {
      throw new UnauthorizedAppException('Invalid webhook token');
    }
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ args.bodyToken.charCodeAt(i);
    }
    if (mismatch !== 0) {
      throw new UnauthorizedAppException('Invalid webhook token');
    }
  }

  /**
   * Idempotency check on webhook delivery. Same primitive used by the
   * Razorpay webhook — Redis SET NX with a 24-hour TTL.
   */
  private async claimEvent(eventKey: string): Promise<boolean> {
    return this.redis.acquireLock(
      `webhook:shiprocket:${eventKey}`,
      WEBHOOK_IDEMPOTENCY_TTL_SECONDS,
    );
  }

  @Post('shiprocket')
  @HttpCode(HttpStatus.OK)
  async handleShiprocketWebhook(
    @Headers('x-shiprocket-signature') signatureHeader: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: ShiprocketWebhookPayload,
  ) {
    // Phase 1 (PR 1.4) — verify via HMAC (preferred) or legacy
    // bearer-token (deprecated). HMAC mode is gated on the env var
    // being set, so operators control the cutover.
    this.verifyRequest({
      rawBody: req.rawBody,
      signatureHeader,
      bodyToken: (payload as any).x_token,
    });

    // Resolve the AWB number — Shiprocket nests it inconsistently.
    const awb =
      payload.awb ??
      payload.data?.awb ??
      undefined;
    const status =
      payload.current_status ??
      payload.shipment_status ??
      payload.data?.current_status ??
      payload.data?.shipment_status ??
      '';

    if (!awb) {
      this.logger.warn('Shiprocket webhook received without AWB');
      return { success: true, message: 'Webhook acknowledged (no AWB)' };
    }

    this.logger.log(
      `Shiprocket webhook: awb=${awb}, status=${status}`,
    );

    // Idempotency: same AWB + status combo is dropped on retry.
    const eventKey = `${awb}:${status.toLowerCase()}`;
    const isFirstDelivery = await this.claimEvent(eventKey);
    if (!isFirstDelivery) {
      this.logger.log(
        `Duplicate Shiprocket event ${eventKey} ignored`,
      );
      return { success: true, message: 'Duplicate event ignored' };
    }

    const isDelivered = DELIVERY_STATUS_PATTERNS.some((pattern) =>
      status.toLowerCase().includes(pattern),
    );

    if (!isDelivered) {
      // Acknowledge non-terminal events without action. Future iterations
      // can wire OUT_FOR_DELIVERY, NDR, RTO, etc. into the order timeline.
      return {
        success: true,
        message: `Status "${status}" acknowledged`,
      };
    }

    // Look up the sub-order by AWB / tracking number and mark it delivered.
    const subOrder = await this.ordersFacade.findSubOrderByTrackingNumber(awb);
    if (!subOrder) {
      this.logger.warn(
        `Shiprocket delivery for unknown AWB ${awb} — no matching sub-order`,
      );
      // Return 200 so Shiprocket doesn't retry. The event is logged for
      // manual investigation.
      return {
        success: false,
        message: 'No matching sub-order for AWB',
      };
    }

    // Phase 4 (PR 4.4) — ordering guard. Compare the incoming event's
    // carrier-side timestamp against the sub-order's
    // `lastTrackingEventAt`. The CAS-style updateMany inside
    // `claimTrackingEvent` only succeeds if the new timestamp is
    // strictly newer (or no prior event has been recorded). A
    // false return means the event arrived out-of-order — typical
    // cause is Shiprocket's at-least-once delivery reordering
    // payloads under load. Drop the late event so the FSM never
    // regresses (e.g. DELIVERED → IN_TRANSIT flapping).
    const eventTimestamp = parseEventTimestamp(payload);
    const claimed = await this.ordersFacade.claimTrackingEvent(
      subOrder.id,
      eventTimestamp,
    );
    if (!claimed) {
      this.logger.warn(
        `Shiprocket out-of-order event for AWB ${awb} ` +
          `(event_ts=${eventTimestamp.toISOString()}, status=${status}); dropped.`,
      );
      return {
        success: true,
        message: 'Out-of-order event dropped',
      };
    }

    try {
      await this.ordersFacade.markSubOrderDelivered(subOrder.id);
      this.logger.log(
        `Sub-order ${subOrder.id} marked DELIVERED via Shiprocket webhook (awb=${awb})`,
      );
      return { success: true, message: 'Delivery confirmed' };
    } catch (err: any) {
      // markSubOrderDelivered throws if the sub-order isn't in SHIPPED
      // state — that's a legitimate idempotency block, not an error worth
      // failing the webhook over. Return 200 to prevent Shiprocket retries.
      if (err instanceof BadRequestAppException) {
        this.logger.warn(
          `Sub-order ${subOrder.id} delivery skipped: ${err.message}`,
        );
        return { success: true, message: err.message };
      }
      this.logger.error(
        `Failed to mark sub-order delivered: ${err.message}`,
      );
      return { success: false, message: err.message };
    }
  }
}
