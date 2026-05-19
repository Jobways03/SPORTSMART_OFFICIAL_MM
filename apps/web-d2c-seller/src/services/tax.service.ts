// Phase 25 — Seller-side tax document API wrapper.

import { apiClient, ApiResponse } from '@/lib/api-client';

export interface SellerTaxDocument {
  id: string;
  documentNumber: string;
  documentType: string;
  financialYear: string;
  generatedAt: string | null;
  status: string;
  einvoiceStatus: string;
  irn: string | null;
  documentTotalInPaise: string;
  taxableAmountInPaise: string;
  totalTaxAmountInPaise: string;
  buyerGstin: string | null;
  buyerLegalName: string | null;
}

class SellerTaxService {
  list(opts: {
    orderId?: string;
    subOrderId?: string;
    documentType?: string;
    financialYear?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<ApiResponse<{ items: SellerTaxDocument[]; pagination: any }>> {
    const params = new URLSearchParams();
    if (opts.orderId) params.set('orderId', opts.orderId);
    if (opts.subOrderId) params.set('subOrderId', opts.subOrderId);
    if (opts.documentType) params.set('documentType', opts.documentType);
    if (opts.financialYear) params.set('financialYear', opts.financialYear);
    if (opts.page) params.set('page', String(opts.page));
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return apiClient<{ items: SellerTaxDocument[]; pagination: any }>(
      `/seller/tax-documents${qs ? `?${qs}` : ''}`,
    );
  }

  getDownloadUrl(
    documentId: string,
  ): Promise<ApiResponse<{ url: string; documentNumber: string; expiresInSeconds: number }>> {
    return apiClient<{ url: string; documentNumber: string; expiresInSeconds: number }>(
      `/seller/tax-documents/${documentId}/download`,
    );
  }
}

export const sellerTaxService = new SellerTaxService();
