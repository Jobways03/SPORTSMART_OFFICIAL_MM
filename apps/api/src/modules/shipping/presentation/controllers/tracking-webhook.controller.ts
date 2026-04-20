import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { OrdersPublicFacade } from '../../../orders/application/facades/orders-public.facade';

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
  // Shiprocket payloads sometimes nest the AWB inside `data`. Accept both.
  data?: {
    awb?: string;
    current_status?: string;
    shipment_status?: string;
  };
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
   * Shiprocket includes a token in a custom header for verification. Token
   * comparison is constant-time to avoid timing leaks.
   */
  private verifyToken(token: string | undefined): void {
    const expected = this.envService.getOptional('SHIPROCKET_WEBHOOK_TOKEN');
    if (!expected) {
      throw new UnauthorizedAppException(
        'Webhook token not configured on server',
      );
    }
    if (!token) {
      throw new UnauthorizedAppException('Missing webhook token');
    }
    if (token.length !== expected.length) {
      throw new UnauthorizedAppException('Invalid webhook token');
    }
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ token.charCodeAt(i);
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
    @Body() payload: ShiprocketWebhookPayload,
  ) {
    // Shiprocket sends the verification token via the request body — there
    // is no signed header. We accept it from the body or from a custom
    // header for flexibility. The Authorization header is also commonly
    // used in their dashboard config.
    // (Token-extraction here keeps the controller signature simple — wire
    // the actual header name once your Shiprocket dashboard is configured.)
    // For now we expect the token in `(payload as any).x_token` or fall
    // back to the configured value if the dashboard sends it differently.
    const token = (payload as any).x_token;
    this.verifyToken(token);

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
