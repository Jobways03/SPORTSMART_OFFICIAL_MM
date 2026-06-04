import { Injectable } from '@nestjs/common';

import { LogisticsFacadeClient } from '../../../../integrations/logistics-facade/clients/logistics-facade.client';
import { BadRequestAppException } from '../../../../core/exceptions';

const BASE = '/api/v1/internal/delhivery';

/**
 * Phase 4 Delhivery wiring (2026-06-02) — API-side client for the facade's
 * Delhivery "tools" routes (serviceability / heavy-serviceability /
 * expected-TAT / shipping-cost / fetch-waybill / raise-pickup /
 * shipment-edit / e-waybill update). Thin pass-through to the facade via
 * LogisticsFacadeClient; surfaces the facade error message on non-2xx.
 */
@Injectable()
export class DelhiveryToolsService {
  constructor(private readonly facade: LogisticsFacadeClient) {}

  private unwrap(res: { status: number; body: any }) {
    const d = res.body && (res.body.data ?? res.body);
    if (res.status < 200 || res.status >= 300) {
      const msg =
        (d && (d.message || d.detail)) ||
        `Delhivery request failed (facade ${res.status})`;
      throw new BadRequestAppException(String(msg));
    }
    return d;
  }

  async serviceability(pincode: string) {
    return this.unwrap(
      await this.facade.get<any>(
        `${BASE}/serviceability/${encodeURIComponent(pincode)}`,
      ),
    );
  }

  async heavyServiceability(pincode: string) {
    return this.unwrap(
      await this.facade.get<any>(
        `${BASE}/serviceability/${encodeURIComponent(pincode)}/heavy`,
      ),
    );
  }

  async expectedTat(q: {
    origin: string;
    destination: string;
    mot?: string;
    productType?: string;
    expectedPickupDate?: string;
  }) {
    const qs = new URLSearchParams();
    qs.set('origin', q.origin);
    qs.set('destination', q.destination);
    if (q.mot) qs.set('mot', q.mot);
    if (q.productType) qs.set('productType', q.productType);
    if (q.expectedPickupDate) qs.set('expectedPickupDate', q.expectedPickupDate);
    return this.unwrap(await this.facade.get<any>(`${BASE}/tat?${qs.toString()}`));
  }

  async calculateCost(q: {
    mode?: string;
    weightGrams: number;
    origin: string;
    destination: string;
    paymentType?: string;
    lengthCm?: number;
    breadthCm?: number;
    heightCm?: number;
  }) {
    const qs = new URLSearchParams();
    if (q.mode) qs.set('mode', q.mode);
    qs.set('weightGrams', String(q.weightGrams));
    qs.set('origin', q.origin);
    qs.set('destination', q.destination);
    if (q.paymentType) qs.set('paymentType', q.paymentType);
    if (q.lengthCm != null) qs.set('lengthCm', String(q.lengthCm));
    if (q.breadthCm != null) qs.set('breadthCm', String(q.breadthCm));
    if (q.heightCm != null) qs.set('heightCm', String(q.heightCm));
    return this.unwrap(await this.facade.get<any>(`${BASE}/cost?${qs.toString()}`));
  }

  async fetchWaybills(count: number) {
    return this.unwrap(
      await this.facade.get<any>(`${BASE}/waybill?count=${count}`),
    );
  }

  async raisePickup(body: {
    warehouseName: string;
    date: string;
    time: string;
    expectedPackageCount: number;
  }) {
    return this.unwrap(
      await this.facade.post<typeof body, any>(`${BASE}/pickup`, body, {
        idempotencyKey: `pickup-${body.warehouseName}-${body.date}`,
      }),
    );
  }

  async editShipment(awb: string, changes: Record<string, unknown>) {
    return this.unwrap(
      await this.facade.post<typeof changes, any>(
        `${BASE}/shipments/${encodeURIComponent(awb)}/edit`,
        changes,
        { idempotencyKey: `edit-${awb}` },
      ),
    );
  }

  async updateEwaybill(awb: string, dcn: string, ewbn: string) {
    return this.unwrap(
      await this.facade.post<{ dcn: string; ewbn: string }, any>(
        `${BASE}/shipments/${encodeURIComponent(awb)}/ewaybill`,
        { dcn, ewbn },
        { idempotencyKey: `ewaybill-${awb}-${dcn}` },
      ),
    );
  }
}
