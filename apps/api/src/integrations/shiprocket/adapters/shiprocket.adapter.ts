import { Injectable, Logger } from '@nestjs/common';
import { ShiprocketClient } from '../clients/shiprocket.client';
import {
  NormalizedShipmentCreateResult,
  NormalizedTrackingEvent,
  NormalizedShipmentStatus,
} from '../types/shiprocket.types';

@Injectable()
export class ShiprocketAdapter {
  private readonly logger = new Logger(ShiprocketAdapter.name);

  constructor(private readonly client: ShiprocketClient) {}

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

    return {
      providerShipmentId: order.shipment_id,
      awb: awbResult.response.data.awb_code,
      labelUrl: '', // Label URL would come from a separate API call
      createdAt: new Date(),
    };
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
