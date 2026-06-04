import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import type { TrackingSnapshot } from '@sportsmart/logistics-contracts';

/**
 * Returns the headline status + ordered event list for a given AWB.
 * M0 stub — repository wiring drops in in M1 alongside the first
 * partner adapter that emits real TrackingEvent rows.
 */
@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async timeline(_awb: string): Promise<TrackingSnapshot> {
    void this.prisma;
    throw new NotImplementedException('Stub — implement in M1');
  }
}
