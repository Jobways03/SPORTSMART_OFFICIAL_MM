import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class ShiprocketClient implements OnModuleInit {
  private readonly logger = new Logger(ShiprocketClient.name);
  private baseUrl = 'https://apiv2.shiprocket.in/v1/external';
  private token: string | null = null;
  private tokenExpiresAt: Date | null = null;

  onModuleInit() {
    if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) {
      this.logger.warn('Shiprocket credentials not configured — shipping operations will fail');
    }
  }

  get isConfigured(): boolean {
    return !!(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD);
  }

  private async authenticate(): Promise<string> {
    // Reuse token if still valid (tokens last 10 days)
    if (this.token && this.tokenExpiresAt && this.tokenExpiresAt > new Date()) {
      return this.token;
    }

    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.SHIPROCKET_EMAIL,
        password: process.env.SHIPROCKET_PASSWORD,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shiprocket auth failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    this.token = data.token;
    // Token valid for ~10 days, refresh after 9
    this.tokenExpiresAt = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);

    return this.token!;
  }

  async createOrder(params: {
    order_id: string;
    order_date: string;
    pickup_location: string;
    billing_customer_name: string;
    billing_address: string;
    billing_city: string;
    billing_pincode: string;
    billing_state: string;
    billing_country: string;
    billing_phone: string;
    shipping_is_billing: boolean;
    order_items: Array<{
      name: string;
      sku: string;
      units: number;
      selling_price: number;
    }>;
    payment_method: string;
    sub_total: number;
    length: number;
    breadth: number;
    height: number;
    weight: number;
  }): Promise<{
    order_id: string;
    shipment_id: string;
    status: string;
  }> {
    const token = await this.authenticate();
    const res = await fetch(`${this.baseUrl}/orders/create/adhoc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shiprocket createOrder failed (${res.status}): ${body}`);
    }

    return res.json();
  }

  async generateAWB(shipmentId: string, courierId?: number): Promise<{
    awb_assign_status: number;
    response: {
      data: {
        awb_code: string;
        courier_name: string;
      };
    };
  }> {
    const token = await this.authenticate();
    const body: any = { shipment_id: shipmentId };
    if (courierId) body.courier_id = courierId;

    const res = await fetch(`${this.baseUrl}/courier/assign/awb`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const respBody = await res.text();
      throw new Error(`Shiprocket generateAWB failed (${res.status}): ${respBody}`);
    }

    return res.json();
  }

  async trackShipment(awb: string): Promise<{
    tracking_data: {
      track_status: number;
      shipment_status: number;
      shipment_track: Array<{
        current_status: string;
        delivered_date: string;
        origin: string;
        destination: string;
      }>;
      shipment_track_activities: Array<{
        date: string;
        status: string;
        activity: string;
        location: string;
      }>;
    };
  }> {
    const token = await this.authenticate();
    const res = await fetch(
      `${this.baseUrl}/courier/track/awb/${awb}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shiprocket tracking failed (${res.status}): ${body}`);
    }

    return res.json();
  }

  async cancelOrder(orderId: string): Promise<void> {
    const token = await this.authenticate();
    const res = await fetch(`${this.baseUrl}/orders/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ids: [orderId] }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shiprocket cancelOrder failed (${res.status}): ${body}`);
    }
  }

  async schedulePickup(shipmentId: string): Promise<{
    pickup_status: number;
    response: { pickup_scheduled_date: string };
  }> {
    const token = await this.authenticate();
    const res = await fetch(`${this.baseUrl}/courier/generate/pickup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ shipment_id: [shipmentId] }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shiprocket schedulePickup failed (${res.status}): ${body}`);
    }

    return res.json();
  }
}
