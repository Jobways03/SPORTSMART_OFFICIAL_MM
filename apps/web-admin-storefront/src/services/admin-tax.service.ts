// Phase 25 GST — Admin tax service. Wraps the /api/v1/admin/tax/* endpoints.
//
// `apiClient` from `@/lib/api-client` is a function (not an object): call it
// directly as `apiClient<T>('/path', { method, body })`. Endpoints MUST start
// with '/' — the factory prepends `${API_BASE}/api/v1`.

import { apiClient, ApiResponse, API_BASE } from '@/lib/api-client';

export type TaxMode = 'OFF' | 'AUDIT' | 'STRICT';

export interface BlockerSummary {
  code: string;
  count: number;
  sampleIds: string[];
  message: string;
}

export interface AuditReadinessReport {
  currentMode: TaxMode;
  ready: boolean;
  generatedAt: string;
  totalBlockers: number;
  blockers: BlockerSummary[];
}

export interface Gstr8SummaryRow {
  id: string;
  sellerId: string | null;
  filingPeriod: string;
  status: string;
  supplierGstin: string | null;
  grossTaxableSupplyInPaise: string;
  netTaxableSupplyInPaise: string;
  totalTcsInPaise: string;
}

export interface Gstr8Summary {
  filingPeriod: string;
  sellerCount: number;
  totalGrossInPaise: string;
  totalNetTaxableInPaise: string;
  totalTcsInPaise: string;
  rows: Gstr8SummaryRow[];
}

class AdminTaxService {
  getMode(): Promise<ApiResponse<{ mode: TaxMode }>> {
    return apiClient('/admin/tax/mode');
  }

  setMode(mode: TaxMode): Promise<ApiResponse<{ mode: TaxMode }>> {
    return apiClient('/admin/tax/mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
  }

  getAuditReadiness(): Promise<ApiResponse<AuditReadinessReport>> {
    return apiClient('/admin/tax/audit-readiness');
  }

  getGstr8Summary(filingPeriod: string): Promise<ApiResponse<Gstr8Summary>> {
    return apiClient(`/admin/tax/reports/gstr8/summary?filingPeriod=${filingPeriod}`);
  }

  markFiled(ledgerIds: string[]): Promise<ApiResponse<{ flipped: number; requested: number }>> {
    return apiClient('/admin/tax/tcs/mark-filed', {
      method: 'POST',
      body: JSON.stringify({ ledgerIds }),
    });
  }

  markPaid(ledgerIds: string[], paymentReference: string): Promise<ApiResponse<{ flipped: number; requested: number }>> {
    return apiClient('/admin/tax/tcs/mark-paid', {
      method: 'POST',
      body: JSON.stringify({ ledgerIds, paymentReference }),
    });
  }

  // CSV endpoints bypass apiClient because the response is a binary stream,
  // not the JSON envelope apiClient expects.
  async downloadCsv(url: string, suggestedFilename: string): Promise<void> {
    const token = sessionStorage.getItem('adminAccessToken');
    const res = await fetch(`${API_BASE}/api/v1${url}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`CSV download failed: ${res.status} ${res.statusText}`);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = suggestedFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  }

  gstr1Csv(sellerId: string, filingPeriod: string): Promise<void> {
    return this.downloadCsv(
      `/admin/tax/reports/gstr1.csv?sellerId=${sellerId}&filingPeriod=${filingPeriod}`,
      `gstr1-b2b-${sellerId}-${filingPeriod}.csv`,
    );
  }

  gstr1SectionCsv(section: string, sellerId: string, filingPeriod: string): Promise<void> {
    return this.downloadCsv(
      `/admin/tax/reports/gstr1/${section}.csv?sellerId=${sellerId}&filingPeriod=${filingPeriod}`,
      `gstr1-${section}-${sellerId}-${filingPeriod}.csv`,
    );
  }

  gstr3bCsv(sellerId: string, filingPeriod: string): Promise<void> {
    return this.downloadCsv(
      `/admin/tax/reports/gstr3b.csv?sellerId=${sellerId}&filingPeriod=${filingPeriod}`,
      `gstr3b-${sellerId}-${filingPeriod}.csv`,
    );
  }

  gstr8Csv(filingPeriod: string): Promise<void> {
    return this.downloadCsv(
      `/admin/tax/reports/gstr8.csv?filingPeriod=${filingPeriod}`,
      `gstr8-${filingPeriod}.csv`,
    );
  }

  // ── Phase 12 — Time-bar review queue ────────────────────────────

  listTimebarReview(status?: string): Promise<ApiResponse<{ items: TimebarReviewItem[] }>> {
    const qs = status ? `?status=${status}` : '';
    return apiClient<{ items: TimebarReviewItem[] }>(`/admin/tax/timebar-review${qs}`);
  }

  routeReturnToWallet(returnId: string, reason?: string) {
    return apiClient<{ adjustmentId: string; status: string; amountInPaise: string }>(
      `/admin/tax/timebar-review/${returnId}/route-to-wallet`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  }

  issueCreditNoteOverride(returnId: string, reason?: string) {
    return apiClient<{ creditNoteId: string; documentNumber: string; totalInPaise: string }>(
      `/admin/tax/timebar-review/${returnId}/issue-credit-note`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  }

  // ── Phase 13 — Wallet adjustments queue ─────────────────────────

  listWalletAdjustments(status?: string): Promise<ApiResponse<{ items: WalletAdjustmentItem[] }>> {
    const qs = status ? `?status=${status}` : '';
    return apiClient<{ items: WalletAdjustmentItem[] }>(`/admin/tax/wallet-adjustments${qs}`);
  }

  approveWalletAdjustment(id: string) {
    return apiClient<{
      id: string;
      status: 'PENDING_APPROVAL' | 'FIRST_APPROVED' | 'APPROVED';
      firstApprovedByAdminId: string | null;
      firstApprovedAt: string | null;
      walletTransactionId: string | null;
    }>(
      `/admin/tax/wallet-adjustments/${id}/approve`,
      { method: 'POST', body: JSON.stringify({}) },
    );
  }

  rejectWalletAdjustment(id: string, reason: string) {
    return apiClient<{ id: string; status: string }>(
      `/admin/tax/wallet-adjustments/${id}/reject`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  }

  // ── Phase 15 — E-way bills ──────────────────────────────────────

  listEwayBills(status?: string): Promise<ApiResponse<{ items: EWayBillItem[] }>> {
    const qs = status ? `?status=${status}` : '';
    return apiClient<{ items: EWayBillItem[] }>(`/admin/tax/eway-bills${qs}`);
  }

  generateEwayBill(subOrderId: string, payload: GenerateEwayBillInput) {
    return apiClient<{ id: string; ewbNumber: string; status: string; validUntil: string; provider: string }>(
      `/admin/tax/eway-bills/sub-order/${subOrderId}/generate`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
  }

  cancelEwayBill(id: string, reason: string) {
    return apiClient<{ id: string; status: string }>(
      `/admin/tax/eway-bills/${id}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  }

  overrideEwayBill(id: string, reason: string) {
    return apiClient<{ id: string; overrideAdminId: string; overrideAt: string }>(
      `/admin/tax/eway-bills/${id}/override`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  }

  // ── Phase 22 — E-invoices / IRN ─────────────────────────────────

  listEinvoices(status?: string): Promise<ApiResponse<{ items: EInvoiceItem[] }>> {
    const qs = status ? `?status=${status}` : '';
    return apiClient<{ items: EInvoiceItem[] }>(`/admin/tax/einvoices${qs}`);
  }

  generateEinvoice(documentId: string) {
    return apiClient<{ id: string; irn: string; ackNo: string; einvoiceStatus: string }>(
      `/admin/tax/einvoices/${documentId}/generate`,
      { method: 'POST', body: JSON.stringify({}) },
    );
  }

  cancelEinvoice(documentId: string, cancellationCode: number, reason: string) {
    return apiClient<{ id: string; einvoiceStatus: string }>(
      `/admin/tax/einvoices/${documentId}/cancel`,
      { method: 'POST', body: JSON.stringify({ cancellationCode, reason }) },
    );
  }
}

export interface TimebarReviewItem {
  id: string;
  returnNumber: string;
  customerId: string;
  subOrderId: string;
  refundAmountInPaise: string;
  creditNoteEligibilityStatus: 'ELIGIBLE' | 'TIME_BARRED' | 'REQUIRES_FINANCE_REVIEW' | null;
  creditNoteEligibilityCheckedAt: string | null;
  creditNoteTimeBarReason: string | null;
  financeReviewedBy: string | null;
  financeReviewedAt: string | null;
  qcCompletedAt: string | null;
}

export interface WalletAdjustmentItem {
  id: string;
  customerId: string;
  kind: 'TIME_BARRED_CREDIT_NOTE' | 'GOODWILL' | 'MANUAL_DEBIT' | 'MANUAL_OTHER';
  status: 'PENDING_APPROVAL' | 'FIRST_APPROVED' | 'APPROVED' | 'REJECTED' | 'REVERSED';
  amountInPaise: string;
  wouldHaveBeenTaxableInPaise: string | null;
  wouldHaveBeenCgstInPaise: string | null;
  wouldHaveBeenSgstInPaise: string | null;
  wouldHaveBeenIgstInPaise: string | null;
  reason: string;
  returnId: string | null;
  sourceTaxDocumentId: string | null;
  requestedByAdminId: string | null;
  requestedAt: string;
  firstApprovedByAdminId: string | null;
  firstApprovedAt: string | null;
  approvedByAdminId: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  requiresDualApproval: boolean;
  walletTransactionId: string | null;
}

export interface EWayBillItem {
  id: string;
  subOrderId: string;
  taxDocumentId: string | null;
  status: 'NOT_REQUIRED' | 'REQUIRED' | 'PENDING' | 'GENERATED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
  ewbNumber: string | null;
  ewbDate: string | null;
  validUntil: string | null;
  provider: string;
  transportMode: string;
  vehicleNumber: string | null;
  transporterId: string | null;
  fromPincode: string | null;
  toPincode: string | null;
  distanceKm: number | null;
  consignmentValueInPaise: string;
  retryCount: number;
  failureReason: string | null;
  overrideAdminId: string | null;
  overrideAt: string | null;
  overrideReason: string | null;
  createdAt: string;
}

export interface GenerateEwayBillInput {
  vehicleNumber?: string;
  transporterId?: string;
  transporterName?: string;
  distanceKm?: number;
  transportMode?: 'ROAD' | 'RAIL' | 'AIR' | 'SHIP';
}

export interface EInvoiceItem {
  id: string;
  documentNumber: string;
  documentType: string;
  documentTotalInPaise: string;
  einvoiceStatus: 'NOT_APPLICABLE' | 'PENDING' | 'GENERATED' | 'FAILED';
  einvoiceProvider: string | null;
  einvoiceRetryCount: number;
  einvoiceLastAttemptedAt: string | null;
  einvoiceFailureReason: string | null;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  supplierGstin: string | null;
  buyerGstin: string | null;
  generatedAt: string | null;
}

export const adminTaxService = new AdminTaxService();
