// Public facade for the Tax module — narrow, cross-module-safe surface
// consumed by Orders (and other modules later). Keep this small: every
// method added here becomes a contract that downstream modules depend on.

import { Injectable, Logger } from '@nestjs/common';
import { TaxDocumentService } from '../services/tax-document.service';
import { CustomerTaxProfileService } from '../services/customer-tax-profile.service';

@Injectable()
export class TaxPublicFacade {
  private readonly logger = new Logger(TaxPublicFacade.name);

  constructor(
    private readonly taxDocs: TaxDocumentService,
    private readonly customerProfiles: CustomerTaxProfileService,
  ) {}

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

  /**
   * Follow-up #133 — POS counterpart to generateInvoiceForSubOrder.
   * Best-effort: returns null on failure so the POS sale commit is
   * never blocked by an invoice issue. The underlying service is
   * idempotent — repeated calls return the existing document. Finance
   * gates GSTR-1 filing on the presence of these rows, so a failure
   * here must surface in the cron-retry queue (Phase 19 PDF retry path
   * picks up the PDF_PENDING rows; a missing tax_documents row is the
   * remaining gap the gap-audit cron will flag).
   */
  async generateInvoiceForPosSale(
    saleId: string,
  ): Promise<{ id: string; documentNumber: string; isNew: boolean } | null> {
    try {
      const result = await this.taxDocs.generateForPosSale(saleId);
      return {
        id: result.document.id,
        documentNumber: result.document.documentNumber,
        isNew: result.isNew,
      };
    } catch (err) {
      this.logger.warn(
        `Invoice generation failed for POS sale ${saleId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Phase 37 — ownership check for a CustomerTaxProfile.
   *
   * Used by the checkout module's place-order flow when the buyer
   * picks a non-default B2B GSTIN at checkout. The facade keeps the
   * tax module's `customer_tax_profiles` table inside the tax
   * boundary; checkout never has to reach into our schema.
   *
   * Returns:
   *   true  — profile exists and belongs to the customer
   *   false — profile doesn't exist or belongs to a different customer
   */
  async customerOwnsTaxProfile(
    customerId: string,
    profileId: string,
  ): Promise<boolean> {
    try {
      await this.customerProfiles.findOne(customerId, profileId);
      return true;
    } catch {
      return false;
    }
  }
}
