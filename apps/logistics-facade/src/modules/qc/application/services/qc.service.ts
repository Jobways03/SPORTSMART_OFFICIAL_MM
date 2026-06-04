import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import type { CreateQcRecordRequest } from '@sportsmart/logistics-contracts';

@Injectable()
export class QcService {
  constructor(private readonly prisma: PrismaService) {}

  async create(_req: CreateQcRecordRequest): Promise<{ qcRecordId: string }> {
    void this.prisma;
    throw new NotImplementedException('Stub — implement in M2');
  }

  async findById(_id: string): Promise<unknown> {
    void this.prisma;
    throw new NotImplementedException('Stub — implement in M2');
  }
}
