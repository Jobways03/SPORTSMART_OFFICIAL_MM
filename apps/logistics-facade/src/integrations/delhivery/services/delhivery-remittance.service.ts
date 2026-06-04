import { Injectable, NotImplementedException } from '@nestjs/common';
import { DelhiveryClient } from '../clients/delhivery.client';

/**
 * COD remittance pull. Delhivery doesn't push remittance webhooks —
 * the facade pulls a daily invoice report and reconciles against the
 * facade's `Shipment.codAmountPaise` ledger.
 */
@Injectable()
export class DelhiveryRemittanceService {
  constructor(private readonly client: DelhiveryClient) {}

  /**
   * Pull COD remittance entries for a date window.
   *
   * TODO (M1): Implement
   *   • GET `DELHIVERY_PATHS.INVOICE_REPORT`
   *     (= /api/cmu/get_invoice_report/) with `?from_date=…&to_date=…`.
   *   • Parse the CSV body — Delhivery returns this endpoint as
   *     text/csv even though the path JSON-suffixes.
   *   • Map each row to the canonical `RemittanceEntry`
   *     (defined in `@sportsmart/logistics-contracts/cod`).
   *   • Reference: https://docs.delhivery.com/api/cod-remittance/
   */
  async pullRemittance(_input: {
    fromDate: string;
    toDate: string;
  }): Promise<{ entries: unknown[] }> {
    void this.client;
    throw new NotImplementedException(
      `Delhivery pullRemittance not yet implemented. To wire: paste the relevant ` +
        `API schema from one.delhivery.com/developer-portal/documents/b2c into ` +
        `chat, then we generate the request/response DTOs, mapper, and service ` +
        `body. See apps/logistics-facade/src/integrations/delhivery/README.md.`,
    );
  }
}
