import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DefaultCourierGatewayResolver } from '../../../shipments/application/factories/courier-gateway.resolver';
import type { RtoAttemptResult } from '@sportsmart/logistics-contracts';

@Injectable()
export class RtoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: DefaultCourierGatewayResolver,
  ) {}

  async list(_filter: Record<string, string | undefined>): Promise<RtoAttemptResult[]> {
    void this.prisma;
    throw new NotImplementedException('Stub — implement in M2');
  }

  async initiate(_shipmentId: string, _reason: string): Promise<RtoAttemptResult> {
    void this.prisma;
    void this.resolver;
    throw new NotImplementedException('Stub — implement in M2');
  }
}
