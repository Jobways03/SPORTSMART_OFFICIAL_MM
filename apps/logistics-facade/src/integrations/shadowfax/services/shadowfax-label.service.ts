import { Injectable, NotImplementedException } from '@nestjs/common';
import { ShadowfaxClient } from '../clients/shadowfax.client';
import type { PrintLabelResult } from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';

/**
 * Label fetch surface. Shadowfax serves PDF only, one-call-per-order
 * — the service batches at the facade layer (parallel fan-out with
 * the same concurrency cap as tracking).
 */
@Injectable()
export class ShadowfaxLabelService {
  constructor(private readonly client: ShadowfaxClient) {}

  /**
   * Fetch and re-host labels for a batch of order ids.
   *
   * TODO (M1): Implement
   *   • For each `orderId`, GET `${SHADOWFAX_PATHS.LABEL}/${orderId}/label`.
   *   • Concatenate the PDFs (use `pdf-lib`) and upload to S3 via
   *     the facade's object-store service (M1 dep).
   *   • Return the presigned URL as `fileUrl`.
   *   • Reference: https://docs.shadowfax.in/api/labels
   *
   * NOTE: The port keys by AWB; Shadowfax keys by `order_id`. The
   * adapter does the AWB -> order_id lookup before calling this
   * service.
   */
  async printLabel(_orderIds: string[]): Promise<PrintLabelResult> {
    void this.client;
    throw new NotImplementedException(
      `[SHADOWFAX] ShadowfaxLabelService.printLabel is a scaffold. ` +
        `Endpoint: GET /api/v1/orders/{id}/label — ` +
        `reference https://docs.shadowfax.in/api/labels`,
    );
  }
}
