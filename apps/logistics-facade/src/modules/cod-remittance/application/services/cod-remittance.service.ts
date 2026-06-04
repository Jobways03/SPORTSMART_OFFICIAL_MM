import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DefaultCourierGatewayResolver } from '../../../shipments/application/factories/courier-gateway.resolver';
import type {
  CodRemittancePullResult,
  CodRemittanceRow,
} from '@sportsmart/logistics-contracts';

/**
 * Owns the partner-side COD remittance pull and the variance
 * computation. M0 stub; the cron in `crons/pull-remittance.cron.ts`
 * is declared-but-disabled and will call into this service in M3.
 */
@Injectable()
export class CodRemittanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: DefaultCourierGatewayResolver,
  ) {}

  async list(_filter: Record<string, string | undefined>): Promise<CodRemittanceRow[]> {
    void this.prisma;
    throw new NotImplementedException('Stub — implement in M3');
  }

  async pull(_partner: string): Promise<CodRemittancePullResult> {
    void this.prisma;
    void this.resolver;
    throw new NotImplementedException('Stub — implement in M3');
  }
}
