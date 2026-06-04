import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DefaultCourierGatewayResolver } from '../../../shipments/application/factories/courier-gateway.resolver';
import type { NdrReattemptRequest } from '@sportsmart/logistics-contracts';

@Injectable()
export class NdrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: DefaultCourierGatewayResolver,
  ) {}

  async submitAction(
    _shipmentId: string,
    _req: NdrReattemptRequest,
  ): Promise<{ shipmentId: string; attemptNumber: number }> {
    void this.prisma;
    void this.resolver;
    throw new NotImplementedException('Stub — implement in M2');
  }
}
