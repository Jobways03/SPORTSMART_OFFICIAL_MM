import { Injectable } from '@nestjs/common';

import { DelhiveryRatesService } from '../../../../integrations/delhivery/services/delhivery-rates.service';
import { DelhiveryWaybillService } from '../../../../integrations/delhivery/services/delhivery-waybill.service';
import { DelhiveryPickupService } from '../../../../integrations/delhivery/services/delhivery-pickup.service';
import { DelhiveryOrderService } from '../../../../integrations/delhivery/services/delhivery-order.service';

/**
 * Phase 4 Delhivery wiring (2026-06-02) — exposes the remaining Delhivery
 * capabilities (serviceability, expected-TAT, shipping-cost, fetch-waybill,
 * raise-pickup, shipment-edit, e-waybill update) that already exist as
 * client services in the integrations/delhivery layer but were never wired
 * to an internal HTTP route. ShipmentsModule imports DelhiveryModule, which
 * exports these services, so they inject directly here.
 *
 * BigInt money fields are stringified at this boundary — they cross the
 * facade HTTP wire as JSON and JSON.stringify cannot serialise BigInt.
 */
@Injectable()
export class DelhiveryToolsService {
  constructor(
    private readonly rates: DelhiveryRatesService,
    private readonly waybill: DelhiveryWaybillService,
    private readonly pickup: DelhiveryPickupService,
    private readonly order: DelhiveryOrderService,
  ) {}

  serviceability(pincode: string) {
    return this.rates.checkServiceability(pincode);
  }

  heavyServiceability(pincode: string) {
    return this.rates.checkHeavyServiceability(pincode);
  }

  expectedTat(input: Parameters<DelhiveryRatesService['getExpectedTat']>[0]) {
    return this.rates.getExpectedTat(input);
  }

  async calculateCost(
    input: Parameters<DelhiveryRatesService['calculateCost']>[0],
  ) {
    const r = await this.rates.calculateCost(input);
    return { ...r, pricePaise: r.pricePaise.toString() };
  }

  fetchWaybills(count: number) {
    return this.waybill.fetchBulk(count);
  }

  raisePickup(
    input: Parameters<DelhiveryPickupService['createPickupRequest']>[0],
  ) {
    return this.pickup.createPickupRequest(input);
  }

  editShipment(
    awb: string,
    changes: Parameters<DelhiveryOrderService['updateShipment']>[1],
  ) {
    return this.order.updateShipment(awb, changes);
  }

  updateEwaybill(awb: string, dcn: string, ewbn: string) {
    return this.order.updateEwaybill(awb, dcn, ewbn);
  }
}
