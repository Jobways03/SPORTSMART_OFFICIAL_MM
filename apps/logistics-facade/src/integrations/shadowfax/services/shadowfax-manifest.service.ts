import { Injectable, NotImplementedException } from '@nestjs/common';
import { ShadowfaxClient } from '../clients/shadowfax.client';

/**
 * Daily manifest surface.
 *
 * For INTRACITY orders Shadowfax doesn't manifest — pickups happen
 * order-by-order via the on-demand rider sweep, so there is no
 * "close-of-day" call. For EXPRESS, Shadowfax auto-closes manifests
 * on first hub scan; the manifest PDF is fetched on demand.
 */
@Injectable()
export class ShadowfaxManifestService {
  constructor(private readonly client: ShadowfaxClient) {}

  /**
   * Generate the EXPRESS manifest PDF for a given day.
   *
   * TODO (M1): Implement
   *   • POST to `/api/v1/express/manifest` with the day's order ids.
   *   • Stream the PDF to S3.
   *   • Reference: https://docs.shadowfax.in/api/express/manifest
   */
  async generateDailyManifest(_input: {
    orderIds: string[];
    forDate: string;
  }): Promise<{ fileUrl: string }> {
    void this.client;
    throw new NotImplementedException(
      `[SHADOWFAX] ShadowfaxManifestService.generateDailyManifest is a scaffold. ` +
        `Endpoint: POST /api/v1/express/manifest — ` +
        `reference https://docs.shadowfax.in/api/express/manifest`,
    );
  }
}
