import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class ProductCodeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates a unique product code like PRD-000001, PRD-000002, etc.
   * Uses an atomic database sequence to prevent race conditions.
   */
  async generateProductCode(): Promise<string> {
    const sequence = await this.prisma.$transaction(async (tx) => {
      const seq = await tx.productCodeSequence.upsert({
        where: { id: 1 },
        create: { id: 1, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      return seq;
    });

    return `PRD-${String(sequence.lastNumber).padStart(6, '0')}`;
  }
}
