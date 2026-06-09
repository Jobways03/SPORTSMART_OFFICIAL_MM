// Phase 25 — Seller-side tax document API wrapper.
// Phase 160 (§52 TCS lifecycle audit B2 / #2) — seller-side TCS surface.

import { apiClient, ApiResponse, API_BASE, SELLER_TYPE } from '@/lib/api-client';

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

// Phase 160 — the seller's own TCS ledger row (BigInt paise as strings).
export interface SellerTcsRow {
  id: string;
  filingPeriod: string;
  status: string;
  supplierGstin: string | null;
  grossTaxableSupplyInPaise: string;
  netTaxableSupplyInPaise: string;
  cgstTcsInPaise: string;
  sgstTcsInPaise: string;
  igstTcsInPaise: string;
  totalTcsInPaise: string;
  tcsRateBps: number;
  nicArn: string | null;
  certificateNumber: string | null;
  certificateIssuedAt?: string | null;
  computedAt: string;
  downloadUrl?: string;
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

  // ── Phase 160 — Section 52 TCS (seller surface) ────────────────────

  /** The seller's own TCS deductions, optionally for one filing period. */
  tcsSummary(
    filingPeriod?: string,
  ): Promise<ApiResponse<{ filingPeriod: string | null; items: SellerTcsRow[] }>> {
    const qs = filingPeriod ? `?filingPeriod=${encodeURIComponent(filingPeriod)}` : '';
    return apiClient<{ filingPeriod: string | null; items: SellerTcsRow[] }>(
      `/seller/tax/tcs/summary${qs}`,
    );
  }

  /** The seller's issued §52(5) certificates. */
  tcsCertificates(): Promise<ApiResponse<{ items: SellerTcsRow[] }>> {
    return apiClient<{ items: SellerTcsRow[] }>('/seller/tax/tcs/certificates');
  }

  /**
   * Open the §52(5) TCS certificate HTML in a new tab. The endpoint is
   * behind SellerAuthGuard so a plain <a href> wouldn't carry the bearer
   * token — we fetch it with auth and open the result as a blob URL.
   * The new window is opened synchronously (in the click gesture) to
   * dodge popup blockers, then its document is written once the HTML
   * arrives.
   */
  async openTcsCertificate(ledgerId: string): Promise<void> {
    const win = window.open('', '_blank');
    const token = sessionStorage.getItem('accessToken');
    const res = await fetch(
      `${API_BASE}/api/v1/seller/tax/tcs/certificates/${encodeURIComponent(ledgerId)}.html`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Seller-Type': SELLER_TYPE,
        },
      },
    );
    if (!res.ok) {
      if (win) win.close();
      throw new Error(
        res.status === 403
          ? 'You do not have access to this certificate.'
          : res.status === 404
            ? 'No certificate is available for this period yet.'
            : `Certificate download failed (${res.status}).`,
      );
    }
    const html = await res.text();
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
    } else {
      // Popup blocked — fall back to a blob download.
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tcs-certificate-${ledgerId.slice(0, 8)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  }
}

export const sellerTaxService = new SellerTaxService();
