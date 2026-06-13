// Phase 25 — Customer-side tax document API wrapper.

import { apiClient, API_BASE, ApiResponse } from '@/lib/api-client';

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

  /**
   * Download ALL of an order's tax invoices as ONE PDF file. Hits the binary
   * `/customer/tax-documents/combined` endpoint (auth via httpOnly cookie +
   * Bearer fallback, same as apiClient), then triggers a browser download from
   * the returned blob. Resolves once the download has been kicked off.
   */
  async downloadCombined(orderId: string): Promise<void> {
    const token =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('accessToken')
        : null;
    const res = await fetch(
      `${API_BASE}/api/v1/customer/tax-documents/combined?orderId=${encodeURIComponent(orderId)}`,
      {
        method: 'GET',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (!res.ok) {
      let message = 'Failed to download invoices';
      try {
        const j = await res.json();
        message = j?.message ?? message;
      } catch {
        /* non-JSON error body — keep the default message */
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    // Filename from Content-Disposition (the API exposes that header via CORS).
    const cd = res.headers.get('Content-Disposition') ?? '';
    const m = cd.match(/filename="?([^"]+)"?/i);
    const filename = m ? m[1]! : `${orderId}-tax-invoices.pdf`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export const customerTaxService = new CustomerTaxService();
