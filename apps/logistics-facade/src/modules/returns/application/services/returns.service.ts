import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DefaultCourierGatewayResolver } from '../../../shipments/application/factories/courier-gateway.resolver';
import type {
  CreateReturnRequest,
  ReturnResponse,
} from '@sportsmart/logistics-contracts';

/**
 * Customer-initiated reverse pickup orchestration. M0 stub —
 * full implementation lands in M2 (forward shipping ships first
 * in M1).
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: DefaultCourierGatewayResolver,
  ) {}

  async create(_req: CreateReturnRequest): Promise<ReturnResponse> {
    void this.prisma;
    void this.resolver;
    throw new NotImplementedException('Stub — implement in M2');
  }

  async findById(_id: string): Promise<ReturnResponse> {
    void this.prisma;
    throw new NotImplementedException('Stub — implement in M2');
  }
}
