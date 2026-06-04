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
import { Throttle } from '@nestjs/throttler';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { OrdersPublicFacade } from '../../../orders/application/facades/orders-public.facade';
import { verifyPayload } from '../../../../core/webhooks/webhook-signer';
import { IngestTrackingUpdateUseCase } from '../../application/use-cases/ingest-tracking-update.use-case';
import type { TrackingSnapshot } from '../../application/ports/outbound/courier-gateway.port';
// Phase 86 (2026-05-23) — Gap #16. class-validator DTO to reject
// malformed payloads at the global ValidationPipe boundary instead
// of trusting whatever shape the carrier posted.
import { ShiprocketWebhookDto } from '../dtos/tracking-webhook.dto';
// Phase 86 (2026-05-23) — Gap #15. IP allowlist primitive.
import {
  ipMatchesAllowlist,
  parseAllowlist,
  type IpAllowlistEntry,
} from '../../../../core/webhooks/ip-allowlist';

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

// Phase 86 (2026-05-23) — Gap #4. Sanity window for carrier
// timestamps. Carrier clocks drift but should still land within a
// few days of "now"; a payload that says the scan happened in 2030
// or in 1999 is almost certainly malformed (or hostile — backdating
// a "DELIVERED" event to bypass the FSM ordering guard). The window
// is generous so legitimate post-dated estimates (ETD beyond
// transit) and replays from out-of-date carrier mirrors still land,
// while clearly-bogus values fall back to `new Date()`.
const TIMESTAMP_PAST_TOLERANCE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days back
const TIMESTAMP_FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000; // 1 day forward

function clampToSanityWindow(parsed: Date, now: Date = new Date()): Date {
  const drift = parsed.getTime() - now.getTime();
  if (drift > TIMESTAMP_FUTURE_TOLERANCE_MS) return now;
  if (-drift > TIMESTAMP_PAST_TOLERANCE_MS) return now;
  return parsed;
}

/**
 * Phase 4 (PR 4.4) — extract the carrier-side event timestamp from a
 * Shiprocket payload. Falls back to `new Date()` when no usable field
 * is present (treating the event as "happened now"); the monotonic-
 * order property is still defended by the CAS predicate on
 * `lastTrackingEventAt`.
 *
 * Phase 86 (2026-05-23) — Gap #4. Values outside the sanity window
 * (±days from now) are clamped to `new Date()` so a malicious or
 * malformed payload can't backdate a scan to bypass the FSM ordering
 * guard.
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
    return clampToSanityWindow(
      new Date(raw < 1_000_000_000_000 ? raw * 1000 : raw),
    );
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? new Date()
    : clampToSanityWindow(parsed);
}

const WEBHOOK_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

// Statuses that map to a delivered sub-order. Shiprocket uses different
// strings depending on integration; treat anything containing "deliver"
// case-insensitively as a delivery confirmation.
const DELIVERY_STATUS_PATTERNS = ['delivered'];

/**
 * Phase 86 (2026-05-23) — Gap #20. Map Shiprocket's free-form
 * `current_status` / `shipment_status` strings onto the internal
 * ShipmentStatusInternal labels. Case-insensitive + underscore/space
 * normalised so adding a new carrier follows a known pattern.
 *
 * Pre-Phase-86 the Shiprocket controller only acted on the literal
 * "delivered" substring and ack'd every other status with a 200.
 * That left the FSM blind to OUT_FOR_DELIVERY, IN_TRANSIT, NDR, RTO
 * — the customer track-your-order page had no way to show "out for
 * delivery today" until the parcel was already in their hands.
 */
export function mapShiprocketStatus(status: string): string | null {
  const norm = status.toLowerCase().replace(/[_\s]+/g, ' ').trim();
  if (!norm) return null;
  // Match "RTO Delivered" before bare "delivered" — both contain "delivered".
  if (norm.includes('rto delivered')) return 'RTO_DELIVERED';
  if (norm.includes('rto in transit') || norm.includes('rto initiated')) {
    return 'RTO_IN_TRANSIT';
  }
  if (norm.includes('rto')) return 'RTO_INITIATED';
  // Check "undelivered" / "ndr" BEFORE "delivered" — the substring
  // match would otherwise misroute NDR events as deliveries.
  if (norm.includes('undelivered') || norm.includes('ndr')) {
    return 'UNDELIVERED';
  }
  if (norm.includes('delivered')) return 'DELIVERED';
  if (norm.includes('out for delivery')) return 'OUT_FOR_DELIVERY';
  if (norm.includes('in transit')) return 'IN_TRANSIT';
  if (norm.includes('picked up') || norm.includes('pickup')) return 'PICKED_UP';
  if (norm.includes('shipped') || norm.includes('manifested')) {
    return 'IN_TRANSIT';
  }
  if (norm.includes('lost')) return 'LOST';
  if (norm.includes('damaged')) return 'DAMAGED';
  if (norm.includes('cancelled') || norm.includes('canceled')) {
    return 'CANCELLED';
  }
  return null;
}

/**
 * Phase 3 Delhivery wiring (2026-06-02) — map Delhivery's scan/status
 * vocabulary onto the same internal ShipmentStatusInternal labels
 * mapShiprocketStatus returns. Ported from the logistics-facade's
 * delhivery-status.mapper.ts (derived from Delhivery's developer
 * portal), with the ordering corrected so "Undelivered" / NDR is
 * matched BEFORE "Delivered" (substring trap) and "RTO Delivered"
 * before bare "RTO".
 *
 * Delhivery forward vocabulary: Manifested / Not Picked / In Transit /
 * Pending / Dispatched / Out for Delivery / Delivered. RTO adds RTO /
 * RTO Delivered. Undelivered = NDR.
 */
export function mapDelhiveryStatus(status: string): string | null {
  const norm = status.toLowerCase().replace(/[_\s]+/g, ' ').trim();
  if (!norm) return null;
  if (norm.includes('rto delivered')) return 'RTO_DELIVERED';
  if (norm.includes('rto in transit')) return 'RTO_IN_TRANSIT';
  if (norm.includes('rto')) return 'RTO_INITIATED';
  // NDR / undelivered BEFORE delivered — "undelivered" contains "delivered".
  if (
    norm.includes('undelivered') ||
    norm.includes('ndr') ||
    norm.includes('not attempted') ||
    norm.includes('not contactable')
  ) {
    return 'UNDELIVERED';
  }
  if (norm.includes('out for delivery')) return 'OUT_FOR_DELIVERY';
  if (norm.includes('delivered')) return 'DELIVERED';
  // "Not Picked" = pre-pickup; acknowledge without a misleading state.
  if (norm.includes('not picked')) return null;
  if (norm.includes('picked') || norm.includes('pickup')) return 'PICKED_UP';
  if (
    norm.includes('in transit') ||
    norm.includes('dispatched') ||
    norm.includes('manifested') ||
    norm.includes('pending') ||
    norm.includes('shipped')
  ) {
    return 'IN_TRANSIT';
  }
  if (norm.includes('lost')) return 'LOST';
  if (norm.includes('damaged')) return 'DAMAGED';
  if (norm.includes('cancel')) return 'CANCELLED';
  return null;
}

/**
 * Phase 3 Delhivery wiring — Delhivery scan-push payload. Shape mirrors
 * the logistics-facade DelhiveryWebhookDto (Shipment envelope). Typed as
 * an interface (erased at runtime) so the global ValidationPipe does not
 * reject Delhivery's payload while the exact live shape is unverified.
 * Top-level fallbacks accept flatter variants defensively.
 */
interface DelhiveryWebhookPayload {
  Shipment?: {
    AWB?: string;
    Status?: string;
    StatusCode?: string;
    StatusType?: string;
    StatusDateTime?: string;
    StatusLocation?: string;
    Instructions?: string;
    Scan?: string;
    ScanType?: string;
  };
  AWB?: string;
  awb?: string;
  waybill?: string;
  Status?: string;
  status?: string;
  token?: string;
}

/** Read the AWB from a Delhivery payload across the known field paths. */
function delhiveryAwb(p: DelhiveryWebhookPayload): string | undefined {
  return (
    p.Shipment?.AWB ?? p.AWB ?? p.awb ?? p.waybill ?? undefined
  );
}

/** Read the status string from a Delhivery payload across known paths. */
function delhiveryStatus(p: DelhiveryWebhookPayload): string {
  return (
    p.Shipment?.Status ??
    p.Shipment?.Scan ??
    p.Shipment?.ScanType ??
    p.Status ??
    p.status ??
    ''
  );
}

/**
 * Delhivery emits StatusDateTime as IST local time with no offset
 * ("YYYY-MM-DDTHH:mm:ss"). Append +05:30 so it parses to the correct
 * instant, then clamp to the sanity window. Falls back to now().
 */
function parseDelhiveryTimestamp(p: DelhiveryWebhookPayload): Date {
  const raw = p.Shipment?.StatusDateTime;
  if (!raw || typeof raw !== 'string') return new Date();
  const hasOffset = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw.trim());
  const parsed = new Date(hasOffset ? raw : `${raw.trim()}+05:30`);
  return Number.isNaN(parsed.getTime())
    ? new Date()
    : clampToSanityWindow(parsed);
}

@ApiTags('Shipping Webhooks')
@Controller('shipping/webhooks')
export class TrackingWebhookController {
  private readonly logger = new Logger(TrackingWebhookController.name);
  // Phase 86 (2026-05-23) — Gap #15. Per-carrier allowlists parsed
  // once at construction. Empty array = pass-through (unset env in
  // dev). Parse errors surface as construction failures so a
  // typo in env doesn't silently fail-open.
  private readonly shiprocketAllowlist: IpAllowlistEntry[];
  // Phase 3 Delhivery wiring (2026-06-02) — Delhivery webhook allowlist.
  private readonly delhiveryAllowlist: IpAllowlistEntry[];

  constructor(
    private readonly envService: EnvService,
    private readonly redis: RedisService,
    private readonly ordersFacade: OrdersPublicFacade,
    // Shared ingest path (same one the tracking pipeline uses) so a
    // SubOrder ends up in the same state regardless of event source.
    private readonly ingestTracking: IngestTrackingUpdateUseCase,
    // Phase 83 (2026-05-23) — delivery audit Gap #8. Persistent
    // webhook-event log. Every webhook hit (verified or not) lands
    // here so disputes past the Redis 24h TTL are answerable from
    // our own DB.
    private readonly prisma: PrismaService,
  ) {
    this.shiprocketAllowlist = parseAllowlist(
      this.envService.getOptional('SHIPROCKET_WEBHOOK_IP_ALLOWLIST'),
    );
    this.delhiveryAllowlist = parseAllowlist(
      this.envService.getOptional('DELHIVERY_WEBHOOK_IP_ALLOWLIST'),
    );
  }

  /**
   * Phase 86 (2026-05-23) — Gap #15. IP allowlist guard. Behavior:
   *
   *   - Allowlist empty / env unset → pass-through (dev-mode, also
   *     production until ops populates the env). The HMAC + idempotency
   *     layers remain the primary defense.
   *   - Allowlist populated → request source IP MUST match. Mismatch
   *     throws Unauthorized before any signature verification or DB
   *     write fires, so a probing attacker burns no cycles.
   *
   * The candidate IP comes from `req.ip`, which respects Nest's
   * `trust proxy` setting (so a real client IP is surfaced when
   * behind the load balancer rather than the LB's own IP). When
   * tracing requires the unfiltered peer IP, `req.socket.remoteAddress`
   * is the fallback — but for an allowlist policy you want the
   * actual carrier-side IP, which is what trust-proxy resolves to.
   */
  private requireAllowlistedIp(args: {
    req: Request;
    allowlist: IpAllowlistEntry[];
    provider: 'shiprocket' | 'delhivery';
  }): void {
    if (args.allowlist.length === 0) return;
    const ip = (args.req.ip ?? args.req.socket?.remoteAddress ?? '').trim();
    if (!ip) {
      this.logger.warn(
        `${args.provider} webhook rejected: no source IP available`,
      );
      throw new UnauthorizedAppException(
        `${args.provider} webhook source IP not available`,
      );
    }
    // Strip IPv4-mapped-in-IPv6 prefix (`::ffff:1.2.3.4`) so the
    // candidate matches IPv4 allowlist entries.
    const normalised = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    if (!ipMatchesAllowlist(normalised, args.allowlist)) {
      this.logger.warn(
        `${args.provider} webhook rejected: source IP ${normalised} not in allowlist`,
      );
      throw new UnauthorizedAppException(
        `${args.provider} webhook source IP not allowlisted`,
      );
    }
  }

  /**
   * Phase 83 (2026-05-23) — delivery audit Gap #8. Append-only
   * webhook event log. The unique constraint on (provider, eventKey)
   * gives DB-level idempotency — if the same key has been seen, the
   * upsert no-ops, and the returned row's `id` is the original
   * insertion's id (so process-outcome updates land on the right
   * row even after Redis lock TTL expires).
   *
   * `processedAt` and `processOutcome` are filled in by a
   * follow-up `recordWebhookOutcome` call once the controller
   * decides what to do with the event. Webhook signature failures
   * record `signatureValid: false, processOutcome: 'SIGNATURE_FAIL'`
   * directly so an attacker probing the endpoint is logged.
   */
  private async recordWebhookEvent(args: {
    provider: string;
    eventKey: string;
    awb?: string | null;
    status?: string | null;
    rawPayload: unknown;
    signatureValid: boolean;
  }): Promise<string | null> {
    try {
      const created = await this.prisma.webhookEvent.upsert({
        where: {
          provider_eventKey: {
            provider: args.provider,
            eventKey: args.eventKey,
          },
        },
        update: {},
        create: {
          provider: args.provider,
          eventKey: args.eventKey,
          awb: args.awb ?? null,
          status: args.status ?? null,
          rawPayload: args.rawPayload as any,
          signatureValid: args.signatureValid,
        },
      });
      return created.id;
    } catch (err) {
      // Webhook ingestion must not be blocked by an audit-log
      // failure. Log loudly so ops sees the gap, return null so
      // outcome recording is a no-op for this event.
      this.logger.error(
        `Failed to write webhook_events row: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Update the webhook_events row's `processedAt` + `processOutcome`
   * + optional `subOrderId` after the controller finishes
   * processing. Null `id` (audit-log write failed earlier) is a
   * no-op so the controller doesn't have to guard.
   */
  private async recordWebhookOutcome(args: {
    id: string | null;
    outcome:
      | 'APPLIED'
      | 'DROPPED_OOO'
      | 'NO_MATCH'
      | 'DUPLICATE'
      | 'FSM_REJECTED'
      | 'UNKNOWN_STATUS'
      | 'REVERSE_LEG_SKIPPED'
      | 'ERROR';
    subOrderId?: string | null;
    errorMessage?: string | null;
  }): Promise<void> {
    if (!args.id) return;
    await this.prisma.webhookEvent
      .update({
        where: { id: args.id },
        data: {
          processedAt: new Date(),
          processOutcome: args.outcome,
          subOrderId: args.subOrderId ?? null,
          errorMessage: args.errorMessage ?? null,
        },
      })
      .catch((err) => {
        this.logger.error(
          `Failed to update webhook_events row ${args.id}: ${(err as Error).message}`,
        );
      });
  }

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

    // Phase 83 (2026-05-23) — delivery audit Gap #5. Fail-closed in
    // production. The legacy bearer-token-in-body path is a known
    // spoofing risk (any actor who learned the token via a log leak
    // can post forged delivery events). It survived as a cutover
    // safety net for dev/staging; production must run HMAC.
    if (this.envService.getString('NODE_ENV', 'development') === 'production') {
      throw new UnauthorizedAppException(
        'Shiprocket webhook auth not configured for production — ' +
          'SHIPROCKET_WEBHOOK_HMAC_SECRET must be set',
      );
    }

    // Legacy bearer-token path — deprecated. Logs a warning each
    // time so operators can see whether the HMAC cutover has
    // actually rolled out. Reachable only in non-production NODE_ENV.
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
   * Phase 3 Delhivery wiring (2026-06-02) — Delhivery verification.
   * Mirrors verifyRequest with Delhivery env keys. HMAC mode preferred
   * (DELHIVERY_WEBHOOK_HMAC_SECRET, X-Delhivery-Signature); legacy
   * bearer-token fallback (DELHIVERY_WEBHOOK_TOKEN) is blocked in
   * production. With neither configured, dev/staging passes through so
   * a local curl simulation works.
   */
  private verifyDelhiveryRequest(args: {
    rawBody: Buffer | undefined;
    signatureHeader: string | undefined;
    bodyToken: string | undefined;
  }): void {
    const hmacSecret = this.envService.getOptional(
      'DELHIVERY_WEBHOOK_HMAC_SECRET',
    );
    if (hmacSecret) {
      if (!args.rawBody) {
        throw new BadRequestAppException('Missing raw request body');
      }
      if (!args.signatureHeader) {
        throw new UnauthorizedAppException(
          'Missing X-Delhivery-Signature header',
        );
      }
      const ok = verifyPayload(
        args.rawBody.toString('utf8'),
        args.signatureHeader,
        hmacSecret,
      );
      if (!ok) {
        throw new UnauthorizedAppException(
          'Invalid Delhivery webhook signature',
        );
      }
      return;
    }

    const expected = this.envService.getOptional('DELHIVERY_WEBHOOK_TOKEN');
    if (!expected) {
      // Neither HMAC nor token configured. Fail-closed in production;
      // pass-through in dev/staging so local testing works.
      if (
        this.envService.getString('NODE_ENV', 'development') === 'production'
      ) {
        throw new UnauthorizedAppException(
          'Delhivery webhook auth not configured for production — ' +
            'DELHIVERY_WEBHOOK_HMAC_SECRET must be set',
        );
      }
      this.logger.warn(
        'Delhivery webhook accepted WITHOUT verification (no HMAC/token configured — dev/staging only)',
      );
      return;
    }

    // Legacy bearer-token path (deprecated; non-production only).
    if (this.envService.getString('NODE_ENV', 'development') === 'production') {
      throw new UnauthorizedAppException(
        'Delhivery webhook auth not configured for production — ' +
          'DELHIVERY_WEBHOOK_HMAC_SECRET must be set',
      );
    }
    if (!args.bodyToken || args.bodyToken.length !== expected.length) {
      throw new UnauthorizedAppException('Invalid Delhivery webhook token');
    }
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ args.bodyToken.charCodeAt(i);
    }
    if (mismatch !== 0) {
      throw new UnauthorizedAppException('Invalid Delhivery webhook token');
    }
  }

  private async claimEventDelhivery(eventKey: string): Promise<boolean> {
    return this.redis.acquireLock(
      `webhook:delhivery:${eventKey}`,
      WEBHOOK_IDEMPOTENCY_TTL_SECONDS,
    );
  }

  @Post('shiprocket')
  @HttpCode(HttpStatus.OK)
  // Phase 83 (2026-05-23) — delivery audit Gap #17. Per-IP rate limit
  // so a misbehaving carrier (or DDoS via the webhook URL) can't
  // saturate the DB. Generous because legitimate Shiprocket traffic
  // can burst on bulk-delivery days.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async handleShiprocketWebhook(
    @Headers('x-shiprocket-signature') signatureHeader: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: ShiprocketWebhookDto,
  ) {
    // Phase 86 — Gap #15. IP allowlist gate. Fires before signature
    // verification + DB writes so probing scanners don't burn cycles.
    this.requireAllowlistedIp({
      req,
      allowlist: this.shiprocketAllowlist,
      provider: 'shiprocket',
    });

    // Phase 83 — Gap #5 fail-closed. Phase 1 (PR 1.4) — verify via
    // HMAC (preferred) or legacy bearer-token (deprecated; blocked
    // in production env). Signature failure logs to webhook_events
    // BEFORE throwing so spoofing attempts are persistently recorded.
    let signatureValid = false;
    try {
      this.verifyRequest({
        rawBody: req.rawBody,
        signatureHeader,
        bodyToken: (payload as any).x_token,
      });
      signatureValid = true;
    } catch (err) {
      // Record the failed-signature attempt before re-throwing.
      await this.recordWebhookEvent({
        provider: 'shiprocket',
        eventKey: `signature-fail:${Date.now()}:${Math.random()}`,
        awb: payload?.awb ?? payload?.data?.awb ?? null,
        status:
          payload?.current_status ??
          payload?.shipment_status ??
          payload?.data?.current_status ??
          payload?.data?.shipment_status ??
          null,
        rawPayload: payload,
        signatureValid: false,
      }).then((id) =>
        this.recordWebhookOutcome({
          id,
          outcome: 'ERROR',
          errorMessage: (err as Error).message,
        }),
      );
      throw err;
    }

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
      await this.recordWebhookEvent({
        provider: 'shiprocket',
        eventKey: `no-awb:${Date.now()}:${Math.random()}`,
        awb: null,
        status,
        rawPayload: payload,
        signatureValid,
      }).then((id) => this.recordWebhookOutcome({ id, outcome: 'NO_MATCH' }));
      return { success: true, message: 'Webhook acknowledged (no AWB)' };
    }

    this.logger.log(
      `Shiprocket webhook: awb=${awb}, status=${status}`,
    );

    // Phase 83 — Gap #13. Include carrier timestamp in the idempotency
    // key so a re-delivery after NDR ("Delivered" → "Delivered (NDR
    // Resolved)") isn't dropped as a duplicate. iThink's webhook
    // already keys on AWB+status+timestamp; this aligns Shiprocket's
    // shape with that.
    const eventTimestamp = parseEventTimestamp(payload);
    const eventKey = `${awb}:${status.toLowerCase()}:${eventTimestamp.toISOString()}`;

    // Phase 83 — Gap #8. Persistent webhook log keyed on
    // (provider, eventKey). Same key the Redis lock uses for fast
    // idempotency — the DB row is the durable fallback.
    const webhookEventId = await this.recordWebhookEvent({
      provider: 'shiprocket',
      eventKey,
      awb,
      status,
      rawPayload: payload,
      signatureValid: true,
    });

    const isFirstDelivery = await this.claimEvent(eventKey);
    if (!isFirstDelivery) {
      this.logger.log(
        `Duplicate Shiprocket event ${eventKey} ignored`,
      );
      await this.recordWebhookOutcome({ id: webhookEventId, outcome: 'DUPLICATE' });
      return { success: true, message: 'Duplicate event ignored' };
    }

    const isDelivered = DELIVERY_STATUS_PATTERNS.some((pattern) =>
      status.toLowerCase().includes(pattern),
    );

    // Phase 86 (2026-05-23) — Gap #20. Non-DELIVERED scans
    // (OUT_FOR_DELIVERY, IN_TRANSIT, NDR, RTO_*, etc.) now feed
    // ingestSingleSnapshot so the FSM matrix + ShipmentTrackingEvent
    // history table see them. Previously these were ack'd with 200
    // and discarded, leaving the customer's track page stuck on the
    // last persisted status.
    //
    // The DELIVERED branch keeps the existing markSubOrderDelivered
    // path because it carries master-order rollup, invoice gen, and
    // refund-flow side effects that aren't yet wired into the
    // applySnapshot pipeline.
    if (!isDelivered) {
      const mapped = mapShiprocketStatus(status);
      if (!mapped) {
        // Genuinely unknown status string — record + ack so ops can
        // backfill the mapping later.
        await this.recordWebhookOutcome({
          id: webhookEventId,
          outcome: 'UNKNOWN_STATUS',
        });
        return {
          success: true,
          message: `Status "${status}" acknowledged`,
        };
      }
      const snapshot: TrackingSnapshot = {
        awb,
        carrier: 'Shiprocket',
        direction: mapped.startsWith('RTO_') ? 'reverse' : 'forward',
        currentStatus: mapped,
        rawCurrentStatus: status,
        scans: [
          {
            status: mapped,
            rawStatus: status,
            rawStatusCode: String(payload.current_status_code ?? ''),
            scanLocation: '',
            remark: '',
            scanAt: eventTimestamp,
          },
        ],
      };
      const result = await this.ingestTracking.ingestSingleSnapshot(
        awb,
        snapshot,
        { source: 'WEBHOOK_SHIPROCKET', rawPayload: payload },
      );
      if (!result.applied) {
        const outcome = !result.subOrderId
          ? 'NO_MATCH'
          : result.reason === 'FSM_REJECTED'
            ? 'FSM_REJECTED'
            : result.reason === 'DUPLICATE_SCAN'
              ? 'DUPLICATE'
              : result.reason === 'REVERSE_LEG_SKIPPED'
                ? 'REVERSE_LEG_SKIPPED'
                : 'DROPPED_OOO';
        await this.recordWebhookOutcome({
          id: webhookEventId,
          outcome,
          subOrderId: result.subOrderId,
        });
        return {
          success: outcome === 'NO_MATCH' ? false : true,
          message:
            outcome === 'NO_MATCH'
              ? 'No matching sub-order for AWB'
              : `Event acknowledged (${outcome.toLowerCase()})`,
        };
      }
      await this.recordWebhookOutcome({
        id: webhookEventId,
        outcome: 'APPLIED',
        subOrderId: result.subOrderId,
      });
      return { success: true, message: 'Tracking update applied' };
    }

    // Phase 83 — Gap #1. AWB lookup matches the sub-order's trackingNumber
    // (see prisma-order.repository.findSubOrderByTrackingNumber).
    const subOrder = await this.ordersFacade.findSubOrderByTrackingNumber(awb);
    if (!subOrder) {
      this.logger.warn(
        `Shiprocket delivery for unknown AWB ${awb} — no matching sub-order`,
      );
      await this.recordWebhookOutcome({ id: webhookEventId, outcome: 'NO_MATCH' });
      // Return 200 so Shiprocket doesn't retry. The event is logged for
      // manual investigation.
      return {
        success: false,
        message: 'No matching sub-order for AWB',
      };
    }

    // Phase 4 (PR 4.4) — ordering guard via lastTrackingEventAt CAS.
    const claimed = await this.ordersFacade.claimTrackingEvent(
      subOrder.id,
      eventTimestamp,
    );
    if (!claimed) {
      this.logger.warn(
        `Shiprocket out-of-order event for AWB ${awb} ` +
          `(event_ts=${eventTimestamp.toISOString()}, status=${status}); dropped.`,
      );
      await this.recordWebhookOutcome({
        id: webhookEventId,
        outcome: 'DROPPED_OOO',
        subOrderId: subOrder.id,
      });
      return {
        success: true,
        message: 'Out-of-order event dropped',
      };
    }

    try {
      // Phase 83 — Gap #3. Thread source + actor through so the
      // SubOrder row records WEBHOOK_SHIPROCKET + the AWB as the
      // delivered-by surrogate.
      await this.ordersFacade.markSubOrderDelivered(subOrder.id, {
        source: 'WEBHOOK_SHIPROCKET',
        deliveredBy: `shiprocket:${awb}`,
      });
      this.logger.log(
        `Sub-order ${subOrder.id} marked DELIVERED via Shiprocket webhook (awb=${awb})`,
      );
      await this.recordWebhookOutcome({
        id: webhookEventId,
        outcome: 'APPLIED',
        subOrderId: subOrder.id,
      });
      return { success: true, message: 'Delivery confirmed' };
    } catch (err: any) {
      // Phase 83 — Gap #7. FSM rejection (sub-order in non-SHIPPED
      // state) used to silently 200 with no audit trail. We now log
      // the outcome to webhook_events with FSM_REJECTED so ops can
      // surface "carrier reports delivered for cancelled order"
      // events in a dashboard. Still return 200 to Shiprocket so
      // they don't retry forever.
      if (err instanceof BadRequestAppException) {
        this.logger.warn(
          `Sub-order ${subOrder.id} delivery skipped (FSM): ${err.message}`,
        );
        await this.recordWebhookOutcome({
          id: webhookEventId,
          outcome: 'FSM_REJECTED',
          subOrderId: subOrder.id,
          errorMessage: err.message,
        });
        return { success: true, message: err.message };
      }
      this.logger.error(
        `Failed to mark sub-order delivered: ${err.message}`,
      );
      await this.recordWebhookOutcome({
        id: webhookEventId,
        outcome: 'ERROR',
        subOrderId: subOrder.id,
        errorMessage: err.message,
      });
      return { success: false, message: err.message };
    }
  }

  // ─── Phase 3 Delhivery wiring (2026-06-02) — Delhivery tracking webhook.
  // Clone of handleShiprocketWebhook: IP allowlist → verify → extract
  // awb/status from the Delhivery Shipment envelope → idempotency →
  // non-DELIVERED scans through ingestSingleSnapshot, DELIVERED through
  // markSubOrderDelivered. source=WEBHOOK_DELHIVERY throughout.
  //
  // NOTE: Delhivery (staging/prod) cannot reach a localhost dev server,
  // so in dev this route is exercised with a manual curl that posts a
  // Delhivery-shaped JSON body (see DELHIVERY_WIRING_STATUS.md).
  @Post('delhivery')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async handleDelhiveryWebhook(
    @Headers('x-delhivery-signature') signatureHeader: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: DelhiveryWebhookPayload,
  ) {
    this.requireAllowlistedIp({
      req,
      allowlist: this.delhiveryAllowlist,
      provider: 'delhivery',
    });

    let signatureValid = false;
    try {
      this.verifyDelhiveryRequest({
        rawBody: req.rawBody,
        signatureHeader,
        bodyToken: payload?.token,
      });
      signatureValid = true;
    } catch (err) {
      await this.recordWebhookEvent({
        provider: 'delhivery',
        eventKey: `signature-fail:${Date.now()}:${Math.random()}`,
        awb: delhiveryAwb(payload) ?? null,
        status: delhiveryStatus(payload) || null,
        rawPayload: payload,
        signatureValid: false,
      }).then((id) =>
        this.recordWebhookOutcome({
          id,
          outcome: 'ERROR',
          errorMessage: (err as Error).message,
        }),
      );
      throw err;
    }

    const awb = delhiveryAwb(payload);
    const status = delhiveryStatus(payload);

    if (!awb) {
      this.logger.warn('Delhivery webhook received without AWB');
      await this.recordWebhookEvent({
        provider: 'delhivery',
        eventKey: `no-awb:${Date.now()}:${Math.random()}`,
        awb: null,
        status,
        rawPayload: payload,
        signatureValid,
      }).then((id) => this.recordWebhookOutcome({ id, outcome: 'NO_MATCH' }));
      return { success: true, message: 'Webhook acknowledged (no AWB)' };
    }

    this.logger.log(`Delhivery webhook: awb=${awb}, status=${status}`);

    const eventTimestamp = parseDelhiveryTimestamp(payload);
    const eventKey = `${awb}:${status.toLowerCase()}:${eventTimestamp.toISOString()}`;

    const webhookEventId = await this.recordWebhookEvent({
      provider: 'delhivery',
      eventKey,
      awb,
      status,
      rawPayload: payload,
      signatureValid: true,
    });

    const isFirst = await this.claimEventDelhivery(eventKey);
    if (!isFirst) {
      this.logger.log(`Duplicate Delhivery event ${eventKey} ignored`);
      await this.recordWebhookOutcome({
        id: webhookEventId,
        outcome: 'DUPLICATE',
      });
      return { success: true, message: 'Duplicate event ignored' };
    }

    const isDelivered = DELIVERY_STATUS_PATTERNS.some((p) =>
      status.toLowerCase().includes(p),
    );
    // "Undelivered" contains "delivered" — exclude it from the delivered
    // branch so an NDR scan is not treated as a delivery confirmation.
    const isUndelivered = status.toLowerCase().includes('undelivered');

    if (!isDelivered || isUndelivered) {
      const mapped = mapDelhiveryStatus(status);
      if (!mapped) {
        await this.recordWebhookOutcome({
          id: webhookEventId,
          outcome: 'UNKNOWN_STATUS',
        });
        return { success: true, message: `Status "${status}" acknowledged` };
      }
      const snapshot: TrackingSnapshot = {
        awb,
        carrier: 'Delhivery',
        direction: mapped.startsWith('RTO_') ? 'reverse' : 'forward',
        currentStatus: mapped,
        rawCurrentStatus: status,
        scans: [
          {
            status: mapped,
            rawStatus: status,
            rawStatusCode: String(payload.Shipment?.StatusCode ?? ''),
            scanLocation: payload.Shipment?.StatusLocation ?? '',
            remark: payload.Shipment?.Instructions ?? '',
            scanAt: eventTimestamp,
          },
        ],
      };
      const result = await this.ingestTracking.ingestSingleSnapshot(
        awb,
        snapshot,
        { source: 'WEBHOOK_DELHIVERY', rawPayload: payload },
      );
      if (!result.applied) {
        const outcome = !result.subOrderId
          ? 'NO_MATCH'
          : result.reason === 'FSM_REJECTED'
            ? 'FSM_REJECTED'
            : result.reason === 'DUPLICATE_SCAN'
              ? 'DUPLICATE'
              : result.reason === 'REVERSE_LEG_SKIPPED'
                ? 'REVERSE_LEG_SKIPPED'
                : 'DROPPED_OOO';
        await this.recordWebhookOutcome({
          id: webhookEventId,
          outcome,
          subOrderId: result.subOrderId,
        });
        return {
          success: outcome === 'NO_MATCH' ? false : true,
          message:
            outcome === 'NO_MATCH'
              ? 'No matching sub-order for AWB'
              : `Event acknowledged (${outcome.toLowerCase()})`,
        };
      }
      await this.recordWebhookOutcome({
        id: webhookEventId,
        outcome: 'APPLIED',
        subOrderId: result.subOrderId,
      });
      return { success: true, message: 'Tracking update applied' };
    }

    // DELIVERED branch.
    const subOrder = await this.ordersFacade.findSubOrderByTrackingNumber(awb);
    if (!subOrder) {
      this.logger.warn(
        `Delhivery delivery for unknown AWB ${awb} — no matching sub-order`,
      );
      await this.recordWebhookOutcome({
        id: webhookEventId,
        outcome: 'NO_MATCH',
      });
      return { success: false, message: 'No matching sub-order for AWB' };
    }

    const claimed = await this.ordersFacade.claimTrackingEvent(
      subOrder.id,
      eventTimestamp,
    );
    if (!claimed) {
      this.logger.warn(
        `Delhivery out-of-order event for AWB ${awb} ` +
          `(event_ts=${eventTimestamp.toISOString()}, status=${status}); dropped.`,
      );
      await this.recordWebhookOutcome({
        id: webhookEventId,
        outcome: 'DROPPED_OOO',
        subOrderId: subOrder.id,
      });
      return { success: true, message: 'Out-of-order event dropped' };
    }

    try {
      await this.ordersFacade.markSubOrderDelivered(subOrder.id, {
        source: 'WEBHOOK_DELHIVERY',
        deliveredBy: `delhivery:${awb}`,
      });
      this.logger.log(
        `Sub-order ${subOrder.id} marked DELIVERED via Delhivery webhook (awb=${awb})`,
      );
      await this.recordWebhookOutcome({
        id: webhookEventId,
        outcome: 'APPLIED',
        subOrderId: subOrder.id,
      });
      return { success: true, message: 'Delivery confirmed' };
    } catch (err: any) {
      if (err instanceof BadRequestAppException) {
        this.logger.warn(
          `Sub-order ${subOrder.id} delivery skipped (FSM): ${err.message}`,
        );
        await this.recordWebhookOutcome({
          id: webhookEventId,
          outcome: 'FSM_REJECTED',
          subOrderId: subOrder.id,
          errorMessage: err.message,
        });
        return { success: true, message: err.message };
      }
      this.logger.error(`Failed to mark sub-order delivered: ${err.message}`);
      await this.recordWebhookOutcome({
        id: webhookEventId,
        outcome: 'ERROR',
        subOrderId: subOrder.id,
        errorMessage: err.message,
      });
      return { success: false, message: err.message };
    }
  }
}
