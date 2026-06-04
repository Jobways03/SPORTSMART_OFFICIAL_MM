import { Injectable, NotImplementedException } from '@nestjs/common';
import { ShipmentRepository } from '../../infrastructure/repositories/shipment.repository';
import type { ShipmentResponse } from '../dto';

/**
 * Loads a single shipment for the GET endpoints. M0 stub — repository
 * lookup is wired through but throws NotImplementedException so the
 * controller's contract surface is honest about the M0 state.
 */
@Injectable()
export class GetShipmentService {
  constructor(private readonly repo: ShipmentRepository) {}

  async execute(_id: string): Promise<ShipmentResponse> {
    void this.repo;
    throw new NotImplementedException('Stub — implement in M1');
  }

  async list(_filter: Record<string, string | undefined>): Promise<ShipmentResponse[]> {
    void this.repo;
    throw new NotImplementedException('Stub — implement in M1');
  }
}
