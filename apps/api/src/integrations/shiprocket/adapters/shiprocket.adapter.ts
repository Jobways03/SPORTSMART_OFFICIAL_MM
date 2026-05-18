import { Injectable, Logger } from '@nestjs/common';
import { ShiprocketClient } from '../clients/shiprocket.client';
import { RedisService } from '../../../bootstrap/cache/redis.service';
import {
  NormalizedShipmentCreateResult,
  NormalizedTrackingEvent,
  NormalizedShipmentStatus,
} from '../types/shiprocket.types';

@Injectable()
export class ShiprocketAdapter {
  private readonly logger = new Logger(ShiprocketAdapter.name);

  // Phase 5.1 (2026-05-16) — application-level idempotency.
  //
  // Shiprocket's create-order endpoint does not accept an
  // Idempotency-Key header — a retry that lands AFTER the first call
  // partially succeeded can produce duplicate shipments (their API
  // rejects truly identical `order_id`s but the network can still
  // produce different effective payloads on retry). We layer a Redis-
  // backed dedup key here keyed by our internal order_id; if the same
  // order is "created" again within the TTL window we return the
  // cached result instead of firing a new shipment.
  //
  // TTL: 24h. By then the sub-order has either succeeded (we have
  // the AWB, no retries needed) or moved to a manual-investigation
  // state and engineering is involved.
  private static readonly CREATE_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

  constructor(
    private readonly client: ShiprocketClient,
    private readonly redis: RedisService,
  ) {}

  /**
   * Create a shipment order and generate AWB.
   */
  async createShipment(params: {
    orderId: string;
    orderDate: string;
    pickupLocation: string;
    customerName: string;
    customerAddress: string;
    customerCity: string;
    customerPincode: string;
    customerState: string;
    customerCountry: string;
    customerPhone: string;
    items: Array<{
      name: string;
      sku: string;
      units: number;
      sellingPrice: number;
    }>;
    paymentMethod: string;
    subTotal: number;
    dimensions: { length: number; breadth: number; height: number; weight: number };
  }): Promise<NormalizedShipmentCreateResult> {
    if (!this.client.isConfigured) {
      throw new Error('Shiprocket is not configured');
    }

    // Phase 5.1 (2026-05-16) — idempotency check. If we've already
    // shipped this order_id recently (the redis key was set by an
    // earlier successful createShipment call), return the cached
    // result instead of producing a duplicate at Shiprocket.
    const idempotencyKey = `shiprocket:create-order:${params.orderId}`;
    try {
      const cached = await this.redis.get<NormalizedShipmentCreateResult>(
        idempotencyKey,
      );
      if (cached) {
        this.logger.warn(
          `Shiprocket createShipment idempotency hit for order=${params.orderId} — returning cached result`,
        );
        return cached;
      }
    } catch (err) {
      // Redis outage: log and proceed without idempotency. The next
      // line will go through to Shiprocket — duplicate-shipment risk
      // is the same as pre-2026-05-16.
      this.logger.warn(
        `Shiprocket idempotency cache lookup failed (${(err as Error).message}); proceeding without cache`,
      );
    }

    // Step 1: Create order
    const order = await this.client.createOrder({
      order_id: params.orderId,
      order_date: params.orderDate,
      pickup_location: params.pickupLocation,
      billing_customer_name: params.customerName,
      billing_address: params.customerAddress,
      billing_city: params.customerCity,
      billing_pincode: params.customerPincode,
      billing_state: params.customerState,
      billing_country: params.customerCountry,
      billing_phone: params.customerPhone,
      shipping_is_billing: true,
      order_items: params.items.map((i) => ({
        name: i.name,
        sku: i.sku,
        units: i.units,
        selling_price: i.sellingPrice,
      })),
      payment_method: params.paymentMethod === 'COD' ? 'COD' : 'Prepaid',
      sub_total: params.subTotal,
      length: params.dimensions.length,
      breadth: params.dimensions.breadth,
      height: params.dimensions.height,
      weight: params.dimensions.weight,
    });

    // Step 2: Generate AWB
    const awbResult = await this.client.generateAWB(order.shipment_id);

    this.logger.log(
      `Shipment created: order=${order.order_id}, shipment=${order.shipment_id}, awb=${awbResult.response.data.awb_code}`,
    );

    const result: NormalizedShipmentCreateResult = {
      providerShipmentId: order.shipment_id,
      awb: awbResult.response.data.awb_code,
      labelUrl: '', // Label URL would come from a separate API call
      createdAt: new Date(),
    };

    // Cache the successful result so the next retry within the TTL
    // window hits the cache instead of producing a duplicate.
    try {
      await this.redis.set(
        idempotencyKey,
        result,
        ShiprocketAdapter.CREATE_IDEMPOTENCY_TTL_SECONDS,
      );
    } catch (err) {
      // Cache write failure is non-fatal — the AWB is already on the
      // sub-order via the caller's persistence path.
      this.logger.warn(
        `Shiprocket idempotency cache write failed (${(err as Error).message}); proceeding`,
      );
    }

    return result;
  }

  /**
   * Track a shipment by AWB number.
   */
  async trackShipment(awb: string): Promise<NormalizedTrackingEvent[]> {
    const tracking = await this.client.trackShipment(awb);

    return (tracking.tracking_data.shipment_track_activities || []).map(
      (activity) => ({
        shipmentId: '',
        awb,
        status: this.mapStatus(activity.status),
        location: activity.location || '',
        timestamp: new Date(activity.date),
        rawStatus: activity.status,
      }),
    );
  }

  /**
   * Cancel a shipment order.
   */
  async cancelShipment(orderId: string): Promise<void> {
    await this.client.cancelOrder(orderId);
    this.logger.log(`Shipment cancelled for order ${orderId}`);
  }

  /**
   * Schedule a pickup for a shipment.
   */
  async schedulePickup(shipmentId: string): Promise<{ scheduledDate: string }> {
    const result = await this.client.schedulePickup(shipmentId);
    return {
      scheduledDate: result.response.pickup_scheduled_date,
    };
  }

  private mapStatus(rawStatus: string): NormalizedShipmentStatus {
    const normalized = rawStatus.toUpperCase();

    if (normalized.includes('DELIVERED')) return 'DELIVERED';
    if (normalized.includes('OUT FOR DELIVERY')) return 'OUT_FOR_DELIVERY';
    if (normalized.includes('IN TRANSIT') || normalized.includes('SHIPPED'))
      return 'IN_TRANSIT';
    if (normalized.includes('PICKED UP') || normalized.includes('PICKUP'))
      return 'PICKED_UP';
    if (normalized.includes('RTO')) return 'RTO_INITIATED';
    if (normalized.includes('NDR') || normalized.includes('UNDELIVERED'))
      return 'NDR_RAISED';

    return 'AWB_ASSIGNED';
  }
}
