import { Injectable, NotImplementedException } from '@nestjs/common';
import { ShadowfaxClient } from '../clients/shadowfax.client';

/**
 * COD remittance pull. Shadowfax exposes a JSON remittance report —
 * the facade pulls daily and reconciles against the
 * `Shipment.codAmountPaise` ledger.
 */
@Injectable()
export class ShadowfaxRemittanceService {
  constructor(private readonly client: ShadowfaxClient) {}

  /**
   * Pull COD remittance entries for a date window.
   *
   * TODO (M1): Implement
   *   • GET `/api/v1/finance/cod-remittance?from=…&to=…`.
   *   • Map each row to the canonical `RemittanceEntry` shape from
   *     `@sportsmart/logistics-contracts/cod`.
   *   • Reference: https://docs.shadowfax.in/api/cod-remittance
   */
  async pullRemittance(_input: {
    fromDate: string;
    toDate: string;
  }): Promise<{ entries: unknown[] }> {
    void this.client;
    throw new NotImplementedException(
      `[SHADOWFAX] ShadowfaxRemittanceService.pullRemittance is a scaffold. ` +
        `Endpoint: GET /api/v1/finance/cod-remittance — ` +
        `reference https://docs.shadowfax.in/api/cod-remittance`,
    );
  }
}
