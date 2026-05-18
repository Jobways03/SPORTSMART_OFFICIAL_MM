// Public facade for the Tax module — narrow, cross-module-safe surface
// consumed by Orders (and other modules later). Keep this small: every
// method added here becomes a contract that downstream modules depend on.

import { Injectable, Logger } from '@nestjs/common';
import { TaxDocumentService } from '../services/tax-document.service';

@Injectable()
export class TaxPublicFacade {
  private readonly logger = new Logger(TaxPublicFacade.name);

  constructor(private readonly taxDocs: TaxDocumentService) {}

  /**
   * Generate (or return the existing) tax invoice for a sub-order.
   * Best-effort wrapper: returns null on failure so callers in the order
   * lifecycle don't have to wrap every call in try/catch. The underlying
   * service is idempotent — repeated calls return the existing document
   * rather than creating duplicates.
   *
   * Tax mode (OFF / AUDIT / STRICT) is enforced inside TaxDocumentService;
   * callers don't need to inspect mode themselves.
   */
  async generateInvoiceForSubOrder(
    subOrderId: string,
  ): Promise<{ id: string; documentNumber: string; isNew: boolean } | null> {
    try {
      const result = await this.taxDocs.generateForSubOrder(subOrderId);
      return {
        id: result.document.id,
        documentNumber: result.document.documentNumber,
        isNew: result.isNew,
      };
    } catch (err) {
      this.logger.warn(
        `Invoice generation failed for sub-order ${subOrderId}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
