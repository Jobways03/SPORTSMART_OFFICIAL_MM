import { toDelhiveryShipment } from './delhivery-shipment.mapper';
import type { CreateShipmentPayload } from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';

function basePayload(
  over: Partial<CreateShipmentPayload> = {},
): CreateShipmentPayload {
  return {
    subOrderId: 'so-1',
    pickupAddressId: '500001',
    returnAddressId: '500001',
    weightGrams: 500,
    dimensionsCm: { lengthCm: 10, widthCm: 10, heightCm: 10 },
    declaredValuePaise: 100000n,
    cod: false,
    pickup: {
      name: 'WH',
      phone: '9999999999',
      line1: 'Warehouse',
      city: 'Hyderabad',
      state: 'TG',
      pincode: '500001',
    },
    drop: {
      name: 'Customer',
      phone: '8888888888',
      line1: 'Home',
      city: 'Hyderabad',
      state: 'TG',
      pincode: '500002',
    },
    items: [{ sku: 'SKU1', name: 'Bat', quantity: 1, unitValuePaise: 100000n }],
    direction: 'forward',
    ...over,
  };
}

describe('toDelhiveryShipment — transport_speed', () => {
  const opts = { pickupWarehouseName: 'WH-1' };

  it("sets transport_speed='F' when the payload says NDD", () => {
    const body = toDelhiveryShipment(basePayload({ transportSpeed: 'F' }), opts);
    expect(body.shipments[0]!.transport_speed).toBe('F');
  });

  it("sets transport_speed='D' when the payload says standard", () => {
    const body = toDelhiveryShipment(basePayload({ transportSpeed: 'D' }), opts);
    expect(body.shipments[0]!.transport_speed).toBe('D');
  });

  it("defaults transport_speed to 'D' when absent (never silently NDD)", () => {
    const body = toDelhiveryShipment(basePayload(), opts);
    expect(body.shipments[0]!.transport_speed).toBe('D');
  });
});
