import { Injectable, NotImplementedException } from '@nestjs/common';
import { DelhiveryClient } from '../clients/delhivery.client';

/**
 * Daily manifest surface. Delhivery doesn't require a "close
 * manifest" call — manifests auto-close on first pickup scan — but
 * exposes a generated-manifest PDF endpoint that ops download every
 * day for the warehouse runner-sheet.
 */
@Injectable()
export class DelhiveryManifestService {
  constructor(private readonly client: DelhiveryClient) {}

  /**
   * Generate the day's manifest PDF.
   *
   * TODO (M1): Implement
   *   • POST to `/api/p/generate_manifest` with the list of AWBs
   *     to include and the pickup-location alias.
   *   • Stream-pipe the resulting PDF to S3.
   *   • Reference: https://docs.delhivery.com/api/manifest/
   */
  async generateDailyManifest(_input: {
    pickupLocation: string;
    awbs: string[];
    forDate: string;
  }): Promise<{ fileUrl: string }> {
    void this.client;
    throw new NotImplementedException(
      `Delhivery generateDailyManifest not yet implemented. To wire: paste the ` +
        `relevant API schema from one.delhivery.com/developer-portal/documents/b2c ` +
        `into chat, then we generate the request/response DTOs, mapper, and service ` +
        `body. See apps/logistics-facade/src/integrations/delhivery/README.md.`,
    );
  }
}
