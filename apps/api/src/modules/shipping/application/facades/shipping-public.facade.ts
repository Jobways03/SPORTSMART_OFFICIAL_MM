import { Injectable } from '@nestjs/common';

@Injectable()
export class ShippingPublicFacade {
  async createShipment(subOrderId: string, shipmentData: unknown): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async getShipmentBySubOrderId(subOrderId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async updateShipmentFromTrackingEvent(shipmentId: string, event: unknown): Promise<void> {
    throw new Error('Not implemented');
  }

  async getNdrRtoState(shipmentId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async getLabelInfo(shipmentId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async validateShipmentStage(shipmentId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }
}
