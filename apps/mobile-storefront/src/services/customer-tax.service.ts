import {apiClient, ApiResponse} from '../lib/api-client';

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

export interface CustomerTaxDocumentListResponse {
  items: CustomerTaxDocument[];
  pagination: {page: number; limit: number; total: number; totalPages: number};
}

export const customerTaxService = {
  list(opts: {
    orderId?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<ApiResponse<CustomerTaxDocumentListResponse>> {
    const params = new URLSearchParams();
    if (opts.orderId) params.set('orderId', opts.orderId);
    if (opts.page) params.set('page', String(opts.page));
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return apiClient<CustomerTaxDocumentListResponse>(
      `/customer/tax-documents${qs ? `?${qs}` : ''}`,
    );
  },

  /**
   * Returns a short-lived signed URL — the caller hands it to
   * Linking.openURL() so the system browser renders the PDF and the
   * user can save/share from there. URL expires in expiresInSeconds.
   */
  getDownloadUrl(
    documentId: string,
  ): Promise<
    ApiResponse<{url: string; documentNumber: string; expiresInSeconds: number}>
  > {
    return apiClient<{
      url: string;
      documentNumber: string;
      expiresInSeconds: number;
    }>(`/customer/tax-documents/${documentId}/download`);
  },
};

export function taxDocTypeLabel(t: string): string {
  switch (t) {
    case 'TAX_INVOICE':
      return 'Tax invoice';
    case 'BILL_OF_SUPPLY':
      return 'Bill of supply';
    case 'INVOICE_CUM_BILL_OF_SUPPLY':
      return 'Invoice-cum-bill of supply';
    case 'CREDIT_NOTE':
      return 'Credit note';
    case 'DEBIT_NOTE':
      return 'Debit note';
    case 'LEGACY_RECEIPT':
      return 'Order receipt';
    default:
      return t;
  }
}

/** BigInt-safe paise → "₹X.YY" — invoices ship paise as JSON strings. */
export function paiseStringToINR(paiseString: string): string {
  if (!paiseString) return '₹0';
  try {
    const n = BigInt(paiseString);
    const neg = n < 0n;
    const abs = neg ? -n : n;
    const whole = abs / 100n;
    const cents = abs % 100n;
    const fracPart =
      cents === 0n ? '' : '.' + cents.toString().padStart(2, '0');
    return (neg ? '-₹' : '₹') + whole.toString() + fracPart;
  } catch {
    return paiseString;
  }
}
