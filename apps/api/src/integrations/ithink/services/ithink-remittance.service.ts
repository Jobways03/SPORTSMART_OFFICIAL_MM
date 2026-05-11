import { Injectable } from '@nestjs/common';

import { IThinkClient } from '../clients/ithink.client';
import type {
  IThinkGetRemittanceRequest,
  IThinkGetRemittanceResponseData,
} from '../dtos/get-remittance.dto';
import type {
  IThinkGetRemittanceDetailsRequest,
  IThinkGetRemittanceDetailsResponseData,
} from '../dtos/get-remittance-details.dto';
import {
  normaliseRemittanceLine,
  normaliseRemittanceSummary,
  type RemittanceLine,
  type RemittanceSummary,
} from '../mappers/ithink-remittance.mapper';

/**
 * COD remittance reconciliation. Daily cron pulls the previous day's
 * summary (Get Remittance) plus the AWB-level breakdown (Get Remittance
 * Details). Writes feed into the `reconciliation` and `settlements`
 * modules so seller payouts don't release before iThink has actually
 * remitted the cash to us.
 */
@Injectable()
export class IThinkRemittanceService {
  constructor(private readonly client: IThinkClient) {}

  async getSummary(remittanceDate: string): Promise<RemittanceSummary[]> {
    const body: IThinkGetRemittanceRequest = { remittance_date: remittanceDate };
    const response = await this.client.post<IThinkGetRemittanceResponseData>(
      'GET_REMITTANCE',
      body as unknown as Record<string, unknown>,
    );
    return (response.data ?? []).map(normaliseRemittanceSummary);
  }

  async getDetails(remittanceDate: string): Promise<RemittanceLine[]> {
    const body: IThinkGetRemittanceDetailsRequest = { remittance_date: remittanceDate };
    const response = await this.client.post<IThinkGetRemittanceDetailsResponseData>(
      'GET_REMITTANCE_DETAILS',
      body as unknown as Record<string, unknown>,
    );
    return (response.data ?? []).map(normaliseRemittanceLine);
  }
}
