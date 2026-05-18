// Phase 25 — Customer-side tax document API wrapper.

import { apiClient, ApiResponse } from '@/lib/api-client';

export interface CustomerTaxDocument {
  id: string;
  documentNumber: string;
  documentType: string;
  financialYear: string;
  generatedAt: string | null;
  status: string;
  einvoiceStatus: string;
  documentTotalInPaise: string;
}

class CustomerTaxService {
  /**
   * List the authenticated customer's tax documents. Optional
   * `orderId` filter for "show me invoices for this order".
   */
  list(opts: {
    orderId?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<ApiResponse<{ items: CustomerTaxDocument[]; pagination: any }>> {
    const params = new URLSearchParams();
    if (opts.orderId) params.set('orderId', opts.orderId);
    if (opts.page) params.set('page', String(opts.page));
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return apiClient<{ items: CustomerTaxDocument[]; pagination: any }>(
      `/customer/tax-documents${qs ? `?${qs}` : ''}`,
    );
  }

  /**
   * Issue a signed download URL. The response carries the URL; the
   * caller decides whether to open in a new tab or pipe through fetch.
   */
  getDownloadUrl(
    documentId: string,
  ): Promise<ApiResponse<{ url: string; documentNumber: string; expiresInSeconds: number }>> {
    return apiClient<{ url: string; documentNumber: string; expiresInSeconds: number }>(
      `/customer/tax-documents/${documentId}/download`,
    );
  }
}

export const customerTaxService = new CustomerTaxService();
