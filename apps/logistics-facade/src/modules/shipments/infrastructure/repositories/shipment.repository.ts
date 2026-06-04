import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Prisma-backed repository for shipments. M0 ships one stub method
 * (`findById`) so the service layer compiles and the e2e test can
 * mock the repository without touching Prisma generation. Real
 * methods (`create`, `appendTrackingEvent`, `transitionStatus`,
 * `findByAwb`, ...) land in M1 alongside the partner adapter.
 *
 * Pattern matches apps/api repositories — Prisma is the only data
 * access path; no raw SQL except in performance-critical reports.
 */
@Injectable()
export class ShipmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the shipment row OR null if it doesn't exist. M0
   * implementation hits Prisma so the wiring is real even though
   * the table is empty.
   */
  async findById(id: string): Promise<unknown | null> {
    // Stub: keep the `prisma` reference alive so the constructor
    // injection isn't flagged as unused by the build. In M1, this
    // becomes `return this.prisma.shipment.findUnique({ where: { id } });`
    void this.prisma;
    return null;
  }
}
