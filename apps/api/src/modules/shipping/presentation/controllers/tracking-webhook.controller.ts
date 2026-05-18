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
import * as crypto from 'crypto';
import { IngestTrackingUpdateUseCase } from '../../application/use-cases/ingest-tracking-update.use-case';
import type { TrackingSnapshot } from '../../application/ports/outbound/courier-gateway.port';

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

/**
 * iThink webhook payload — shape derived from their integration
 * documentation. Fields are all optional so a partial payload
 * doesn't crash the parser; the controller validates presence at
 * the boundary.
 */
interface IThinkWebhookPayload {
  awb_number?: string;
  status?: string;
  status_code?: number | string;
  status_date?: string;
  status_location?: string;
  remarks?: string;
  order_id?: string;
}

/**
 * Map iThink's status strings onto the carrier-neutral
 * ShipmentStatusInternal labels used by IngestTrackingUpdateUseCase.
 * Returns null for unknown values — the caller acknowledges + logs
 * rather than guessing.
 *
 * The list mirrors iThink's documented status codes; new ones get
 * added here as the integration evolves. The match is case-insensitive
 * + tolerant of underscores/spaces because iThink isn't consistent
 * between dashboard exports and webhook payloads.
 */
function mapIThinkStatus(status: string): string | null {
  const norm = status.toLowerCase().replace(/[_\s]+/g, ' ').trim();
  if (!norm) return null;
  if (norm.includes('delivered') && !norm.includes('rto')) return 'DELIVERED';
  if (norm.includes('rto delivered') || norm === 'rto') return 'RTO_DELIVERED';
  if (norm.includes('out for delivery')) return 'OUT_FOR_DELIVERY';
  if (norm.includes('in transit')) return 'IN_TRANSIT';
  if (norm.includes('picked up') || norm.includes('pickup done')) {
    return 'PICKED_UP';
  }
  if (norm.includes('manifested') || norm.includes('shipment booked')) {
    return 'MANIFESTED';
  }
  if (norm.includes('cancelled')) return 'CANCELLED';
  if (norm.includes('undelivered') || norm.includes('ndr')) return 'UNDELIVERED';
  return null;
}

/**
 * Parse iThink's status_date into a Date. Accepts ISO-8601 + a
 * fallback to `new Date()` so a malformed timestamp doesn't strand
 * the event — the application layer's CAS-style timestamp check
 * still defends ordering.
 */
function parseIThinkTimestamp(raw: string | undefined): Date {
  if (!raw) return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

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
    // Phase 5 follow-up (2026-05-16) — iThink webhook needs to feed
    // the same ingest path the polling cron uses, so we share the
    // application use-case rather than re-implementing the
    // snapshot→SubOrder mapping in the controller.
    private readonly ingestTracking: IngestTrackingUpdateUseCase,
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

  /**
   * Phase 5 follow-up (2026-05-16) — iThink webhook signature check.
   *
   * iThink signs the raw request body with HMAC-SHA256 and sends the
   * hex digest in `X-Ithink-Signature`. We compute the same digest
   * locally with the pre-shared `ITHINK_WEBHOOK_SECRET` and compare
   * in constant time. The verification fails closed: a missing secret
   * (configuration drift) AND a missing signature both 401.
   *
   * Replay protection: the per-event Redis idempotency key (AWB +
   * status + carrier timestamp) blocks duplicate events even without
   * a Stripe-style timestamp window. iThink's payload doesn't carry
   * a stable signing timestamp today, so a separate replay-window
   * gate is deferred to a future iteration if the integration
   * exposes one.
   */
  private verifyIThinkRequest(args: {
    rawBody: Buffer | undefined;
    signatureHeader: string | undefined;
  }): void {
    const secret = this.envService.getOptional('ITHINK_WEBHOOK_SECRET');
    if (!secret) {
      // Fail closed — missing secret in production is a misconfiguration
      // that should surface as 401, not as silent acceptance of unsigned
      // webhooks. In dev the operator sets the env var.
      throw new UnauthorizedAppException(
        'iThink webhook auth not configured (ITHINK_WEBHOOK_SECRET unset)',
      );
    }
    if (!args.rawBody) {
      throw new BadRequestAppException('Missing raw request body');
    }
    if (!args.signatureHeader) {
      throw new UnauthorizedAppException('Missing X-Ithink-Signature header');
    }
    const expected = crypto
      .createHmac('sha256', secret)
      .update(args.rawBody)
      .digest('hex');
    const sigBuf = Buffer.from(args.signatureHeader.trim().toLowerCase(), 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expectedBuf.length) {
      throw new UnauthorizedAppException('Invalid iThink webhook signature');
    }
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new UnauthorizedAppException('Invalid iThink webhook signature');
    }
  }

  /**
   * Phase 5 follow-up (2026-05-16) — iThink webhook receiver.
   *
   * iThink (when their delivery dashboard pushes status events to us)
   * POSTs a payload of the rough shape:
   *
   *   {
   *     awb_number: "AWB123",
   *     status: "Delivered" | "In Transit" | "Out for Delivery" | ...,
   *     status_code: number,
   *     status_date: "2026-05-16T10:30:00+05:30",
   *     status_location: "Mumbai Hub",
   *     remarks: "Free-form notes",
   *     // optionally:
   *     order_id: "<our_sub_order_ref>",
   *   }
   *
   * We map status → carrier-neutral `ShipmentStatusInternal` and feed
   * the standard `IngestTrackingUpdateUseCase.ingestSingleSnapshot`
   * path — same logic the polling cron uses, so a SubOrder ends up in
   * exactly the same state regardless of whether the event arrived
   * via push or pull.
   *
   * Always returns HTTP 200 once the signature passes; iThink retries
   * any non-2xx aggressively, and a malformed payload is more useful
   * surfaced as a logged warning than as a retry storm.
   */
  @Post('ithink')
  @HttpCode(HttpStatus.OK)
  async handleIThinkWebhook(
    @Headers('x-ithink-signature') signatureHeader: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: IThinkWebhookPayload,
  ) {
    this.verifyIThinkRequest({
      rawBody: req.rawBody,
      signatureHeader,
    });

    const awb = payload.awb_number?.trim();
    const status = payload.status?.trim() ?? '';
    if (!awb) {
      this.logger.warn('iThink webhook received without awb_number');
      return { success: true, message: 'Webhook acknowledged (no AWB)' };
    }
    this.logger.log(`iThink webhook: awb=${awb}, status=${status}`);

    // Idempotency key: AWB + status + carrier timestamp. A duplicate
    // delivery of the same event is dropped; a genuine status change
    // (e.g. IN_TRANSIT → DELIVERED) gets its own key.
    const eventKey = `${awb}:${status.toLowerCase()}:${payload.status_date ?? 'no-ts'}`;
    const claimed = await this.redis.acquireLock(
      `webhook:ithink:${eventKey}`,
      WEBHOOK_IDEMPOTENCY_TTL_SECONDS,
    );
    if (!claimed) {
      this.logger.log(`Duplicate iThink event ${eventKey} ignored`);
      return { success: true, message: 'Duplicate event ignored' };
    }

    const carrierStatus = mapIThinkStatus(status);
    if (!carrierStatus) {
      // We acknowledge unknown statuses but don't try to map them —
      // future iThink scan types should land in this branch first
      // (log + ack) so engineering sees them surface in production.
      this.logger.warn(`Unmapped iThink status "${status}" for awb=${awb}`);
      return { success: true, message: `Status "${status}" acknowledged (unmapped)` };
    }

    const scanAt = parseIThinkTimestamp(payload.status_date);
    const snapshot: TrackingSnapshot = {
      awb,
      carrier: 'iThink',
      direction: 'forward',
      currentStatus: carrierStatus,
      rawCurrentStatus: status,
      scans: [
        {
          status: carrierStatus,
          rawStatus: status,
          rawStatusCode: String(payload.status_code ?? ''),
          scanLocation: payload.status_location ?? '',
          remark: payload.remarks ?? '',
          scanAt,
        },
      ],
    };

    const result = await this.ingestTracking.ingestSingleSnapshot(awb, snapshot);
    if (!result.applied) {
      // Orphan AWB — return 200 so iThink doesn't retry. The original
      // log line already surfaced "unknown AWB".
      return { success: false, message: 'No matching sub-order for AWB' };
    }
    return { success: true, message: 'Tracking update applied' };
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
