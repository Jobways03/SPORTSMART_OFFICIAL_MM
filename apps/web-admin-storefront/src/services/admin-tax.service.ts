// Phase 25 GST — Admin tax service. Wraps the /api/v1/admin/tax/* endpoints.
//
// `apiClient` from `@/lib/api-client` is a function (not an object): call it
// directly as `apiClient<T>('/path', { method, body })`. Endpoints MUST start
// with '/' — the factory prepends `${API_BASE}/api/v1`.

import { apiClient, ApiResponse, API_BASE } from '@/lib/api-client';

export type TaxMode = 'OFF' | 'AUDIT' | 'STRICT';

// Phase 163 (Tax Audit Readiness audit #11 / #12).
export type BlockerSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type BlockerResourceType =
  | 'product'
  | 'seller'
  | 'taxDocument'
  | 'return'
  | 'tcsLedger'
  | 'tdsLedger'
  | 'ewayBill'
  | 'platformGstProfile';

export interface BlockerSummary {
  code: string;
  // Phase 163 (#11) — severity tier; #12 — what the sampleIds point at.
  severity: BlockerSeverity;
  resourceType: BlockerResourceType;
  count: number;
  sampleIds: string[];
  message: string;
}

export interface AuditReadinessReport {
  currentMode: TaxMode;
  ready: boolean;
  generatedAt: string;
  totalBlockers: number;
  // Phase 163 (#11) — rollup of CRITICAL-severity blocker counts.
  criticalBlockers: number;
  blockers: BlockerSummary[];
  filter?: { sellerId: string | null; filingPeriod: string | null; gstProfileId: string | null };
}

// Phase 163 (#16) — readiness trend snapshot.
export interface AuditReadinessSnapshot {
  id: string;
  currentMode: string;
  ready: boolean;
  totalBlockers: number;
  criticalBlockers: number;
  generatedAt: string;
}

// Phase 164 (#11) — a row in the admin credit-note register.
export interface CreditNoteRow {
  id: string;
  documentNumber: string;
  generatedAt: string | null;
  originalDocumentNumber: string | null;
  returnId: string | null;
  customerId: string | null;
  sellerId: string | null;
  buyerGstin: string | null;
  invoiceType: string | null;
  status: string;
  taxableAmountInPaise: string;
  totalTaxAmountInPaise: string;
  cessAmountInPaise: string;
  documentTotalInPaise: string;
  partialCoverageLineCount: number;
  customerNotifiedAt: string | null;
  reason: string | null;
}

// Phase 160 (§52 lifecycle audit B4 / #4) — a bulk transition's skipped
// straggler (id + the status it's actually in).
export interface TcsSkippedRow {
  ledgerId: string;
  currentStatus: string;
}

// Phase 160 (§52 lifecycle audit #9 / #10) — a per-row compute warning.
export interface TcsComputeWarning {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
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
  // Phase 160 (§52 lifecycle audit #13) — carry-forward visible per row.
  adjustmentCarriedForwardInPaise?: string;
  // Phase 159z (audit B1) — the seller relation is now included so the
  // admin UI can show the trade name alongside the GSTIN.
  seller?: {
    id: string;
    sellerName: string;
    sellerShopName: string;
  } | null;
  // Phase 159z (audit #6) — populated after the row flips to FILED.
  nicArn?: string | null;
  // Phase 160 (§52 lifecycle audit B1) — populated after CERTIFICATE_ISSUED.
  certificateNumber?: string | null;
  certificateIssuedAt?: string | null;
  // Phase 160 (§52 lifecycle audit #9 / #10) — non-fatal compute warnings.
  computeWarningsJson?: TcsComputeWarning[];
}

export interface Gstr8Summary {
  filingPeriod: string;
  sellerCount: number;
  // Phase 159z (audit #14) — paginated. The UI fetches one page at a
  // time; totals are computed across the whole period regardless of
  // page so the headline numbers stay honest.
  page: number;
  pageSize: number;
  totalPages: number;
  totalGrossInPaise: string;
  totalNetTaxableInPaise: string;
  totalTcsInPaise: string;
  // Phase 160 (§52 lifecycle audit #13) — period carry-forward total.
  totalAdjustmentCarriedForwardInPaise?: string;
  // Phase 160 (§52 lifecycle audit B1) — per-status counters.
  statusCounts?: Record<string, number>;
  // Phase 160 (§52 lifecycle audit #9 / #10) — period-level warnings.
  warnings?: {
    rateVariance: { distinctRatesBps: number[] } | null;
    carryForward: { rowCount: number; totalInPaise: string } | null;
  };
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

  getAuditReadiness(
    filter: { sellerId?: string; filingPeriod?: string; gstProfileId?: string; refresh?: boolean } = {},
  ): Promise<ApiResponse<AuditReadinessReport>> {
    const qs = new URLSearchParams();
    if (filter.sellerId) qs.set('sellerId', filter.sellerId);
    if (filter.filingPeriod) qs.set('filingPeriod', filter.filingPeriod);
    if (filter.gstProfileId) qs.set('gstProfileId', filter.gstProfileId);
    if (filter.refresh) qs.set('refresh', 'true');
    const q = qs.toString();
    return apiClient(`/admin/tax/audit-readiness${q ? `?${q}` : ''}`);
  }

  // Phase 163 (#16) — readiness trend history (snapshots from the cron).
  getAuditReadinessHistory(
    days = 30,
  ): Promise<ApiResponse<{ items: AuditReadinessSnapshot[] }>> {
    return apiClient(`/admin/tax/audit-readiness/history?days=${days}`);
  }

  // Phase 164 (#11) — admin credit-note register.
  listCreditNotes(
    filter: { filingPeriod?: string; sellerId?: string; returnId?: string; status?: string; limit?: number } = {},
  ): Promise<ApiResponse<{ items: CreditNoteRow[] }>> {
    const qs = new URLSearchParams();
    if (filter.filingPeriod) qs.set('filingPeriod', filter.filingPeriod);
    if (filter.sellerId) qs.set('sellerId', filter.sellerId);
    if (filter.returnId) qs.set('returnId', filter.returnId);
    if (filter.status) qs.set('status', filter.status);
    if (filter.limit) qs.set('limit', String(filter.limit));
    const q = qs.toString();
    return apiClient(`/admin/tax/credit-notes${q ? `?${q}` : ''}`);
  }

  getGstr8Summary(
    filingPeriod: string,
    opts: { page?: number; pageSize?: number } = {},
  ): Promise<ApiResponse<Gstr8Summary>> {
    const qs = new URLSearchParams({ filingPeriod });
    if (opts.page !== undefined) qs.set('page', String(opts.page));
    if (opts.pageSize !== undefined) qs.set('pageSize', String(opts.pageSize));
    return apiClient(`/admin/tax/reports/gstr8/summary?${qs.toString()}`);
  }

  // Phase 159z (audit #6) — ARN required on mark-filed.
  // Phase 160 (audit B4 / #4) — response now includes `skipped`.
  markFiled(
    ledgerIds: string[],
    nicArn: string,
  ): Promise<
    ApiResponse<{
      flipped: number;
      requested: number;
      nicArn: string;
      skipped: TcsSkippedRow[];
    }>
  > {
    return apiClient('/admin/tax/tcs/mark-filed', {
      method: 'POST',
      body: JSON.stringify({ ledgerIds, nicArn }),
    });
  }

  // Phase 160 (audit #11) — optional paymentProofFileId; (#4) skipped rows.
  markPaid(
    ledgerIds: string[],
    paymentReference: string,
    paymentProofFileId?: string,
  ): Promise<
    ApiResponse<{ flipped: number; requested: number; skipped: TcsSkippedRow[] }>
  > {
    return apiClient('/admin/tax/tcs/mark-paid', {
      method: 'POST',
      body: JSON.stringify({
        ledgerIds,
        paymentReference,
        ...(paymentProofFileId ? { paymentProofFileId } : {}),
      }),
    });
  }

  // Phase 160 (§52 lifecycle audit B1 / #12) — terminal stage: furnish
  // the §52(5) TCS certificates. Per-row certificate numbers returned.
  markCertificatesIssued(
    ledgerIds: string[],
    certificateNumberPrefix?: string,
  ): Promise<
    ApiResponse<{
      flipped: number;
      requested: number;
      certificateNumbers: Record<string, string>;
      skipped: TcsSkippedRow[];
    }>
  > {
    return apiClient('/admin/tax/tcs/mark-certificates-issued', {
      method: 'POST',
      body: JSON.stringify({
        ledgerIds,
        ...(certificateNumberPrefix ? { certificateNumberPrefix } : {}),
      }),
    });
  }

  // Phase 160 — §52(5) TCS certificate HTML per ledger row. The browser
  // opens this and the admin uses Print → Save as PDF. Per-ledger-row.
  tcsCertificateHtmlUrl(ledgerId: string): string {
    return `/api/v1/admin/tax/tcs/certificate/${encodeURIComponent(ledgerId)}.html`;
  }

  // Phase 159z (audit #10) — correction flow. UI surfaces a per-row
  // "Reverse" button gated on `tax.tcs.reverse` permission.
  reverseTcs(
    ledgerId: string,
    reason: string,
  ): Promise<
    ApiResponse<{
      ledgerId: string;
      previousStatus: string;
      wasAlreadyReversed: boolean;
    }>
  > {
    return apiClient(`/admin/tax/tcs/${encodeURIComponent(ledgerId)}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
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

  // Phase 159z (audit #9) — JSON download button. The server resolves
  // the operator GSTIN from PlatformGstProfile (B3), so the UI does
  // NOT pass it as a query param. The download triggers an `<a>`-style
  // file save with the deterministic `gstr8-<period>.json` name.
  async gstr8Json(filingPeriod: string): Promise<void> {
    const res = await apiClient<{
      gstin: string;
      ret_period: string;
      schema_version: string;
      tot_supp_in_paise: string;
      tot_tcs_in_paise: string;
      details: unknown[];
    }>(
      `/admin/tax/reports/gstr8.json?filingPeriod=${encodeURIComponent(filingPeriod)}`,
    );
    if (!res?.success || !res.data) {
      throw new Error(res?.message ?? 'GSTR-8 JSON download failed');
    }
    const blob = new Blob([JSON.stringify(res.data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gstr8-${filingPeriod}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

  // ── Phase 35 — GSTN portal verification ─────────────────────────

  listSellerGstins(
    verified?: 'true' | 'false',
  ): Promise<ApiResponse<{ items: SellerGstinItem[] }>> {
    const qs = verified ? `?verified=${verified}` : '';
    return apiClient<{ items: SellerGstinItem[] }>(
      `/admin/tax/seller-gstins${qs}`,
    );
  }

  verifySellerGstin(
    id: string,
  ): Promise<ApiResponse<GstnVerifyOutcome>> {
    return apiClient<GstnVerifyOutcome>(
      `/admin/tax/seller-gstins/${id}/verify`,
      { method: 'POST', body: JSON.stringify({}) },
    );
  }

  listCustomerTaxProfiles(
    verified?: 'true' | 'false',
  ): Promise<ApiResponse<{ items: CustomerTaxProfileItem[] }>> {
    const qs = verified ? `?verified=${verified}` : '';
    return apiClient<{ items: CustomerTaxProfileItem[] }>(
      `/admin/tax/customer-tax-profiles${qs}`,
    );
  }

  verifyCustomerTaxProfile(
    id: string,
  ): Promise<ApiResponse<GstnVerifyOutcome>> {
    return apiClient<GstnVerifyOutcome>(
      `/admin/tax/customer-tax-profiles/${id}/verify`,
      { method: 'POST', body: JSON.stringify({}) },
    );
  }

  // ── Phase 27 — Section 194-O Income-Tax TDS lifecycle ───────────

  listTds194O(
    filingPeriod: string,
  ): Promise<ApiResponse<{ items: Tds194OLedgerItem[] }>> {
    return apiClient<{ items: Tds194OLedgerItem[] }>(
      `/admin/tax/tds194o?filingPeriod=${encodeURIComponent(filingPeriod)}`,
    );
  }

  markTdsDeposited(ledgerIds: string[], challanReference: string) {
    return apiClient<{ flipped: number; requested: number }>(
      `/admin/tax/tds194o/mark-deposited`,
      { method: 'POST', body: JSON.stringify({ ledgerIds, challanReference }) },
    );
  }

  markTdsCertificateIssued(ledgerIds: string[], certificateNumber: string) {
    return apiClient<{ flipped: number; requested: number }>(
      `/admin/tax/tds194o/mark-certificate-issued`,
      {
        method: 'POST',
        body: JSON.stringify({ ledgerIds, certificateNumber }),
      },
    );
  }

  // Phase 27 — Form 26Q quarterly TDS return CSV. Admin imports into
  // NSDL's RPU (Return Preparation Utility) for upload to TIN-Protean.
  // Returns the URL fragment; the page renders an <a> with this href
  // so the browser handles the streaming download natively.
  form26qCsvUrl(filingPeriod: string): string {
    return `/api/v1/admin/tax/reports/form26q.csv?filingPeriod=${encodeURIComponent(filingPeriod)}`;
  }

  // Form 16A HTML certificate per (deductee, quarter). The browser
  // opens this and the admin uses Print → Save as PDF to produce the
  // shareable file. Per-ledger-row.
  form16aHtmlUrl(ledgerId: string): string {
    return `/api/v1/admin/tax/reports/form16a/${ledgerId}.html`;
  }

  // Phase 28+ — marketplace's OWN GSTR-1 commission section (SAC 9985).
  // Phase 159aa rewrite: per-invoice §4 B2B + §7 B2C bucket + §9B CDNR.
  // Server resolves the operator GSTIN from PlatformGstProfile; UI
  // never passes it as a query param.
  marketplaceCommissionGstr1CsvUrl(filingPeriod: string): string {
    return `/api/v1/admin/tax/reports/marketplace-commission-gstr1.csv?filingPeriod=${encodeURIComponent(filingPeriod)}`;
  }
  async marketplaceCommissionGstr1Json(filingPeriod: string): Promise<void> {
    const res = await apiClient<{
      gstin: string;
      ret_period: string;
      schema_version: string;
      b2b: unknown[];
      b2cs: unknown[];
      cdnr: unknown[];
      warnings: string[];
      totals: { total_taxable_in_paise: string; total_gst_in_paise: string };
    }>(
      `/admin/tax/reports/marketplace-commission-gstr1.json?filingPeriod=${encodeURIComponent(filingPeriod)}`,
    );
    if (!res?.success || !res.data) {
      throw new Error(res?.message ?? 'Marketplace GSTR-1 JSON download failed');
    }
    const blob = new Blob([JSON.stringify(res.data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marketplace-commission-gstr1-${filingPeriod}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  marketplaceCommissionGstr1Summary(filingPeriod: string) {
    return apiClient<MarketplaceCommissionGstr1Summary>(
      `/admin/tax/reports/marketplace-commission-gstr1/summary?filingPeriod=${encodeURIComponent(filingPeriod)}`,
    );
  }

  // Phase 161 — `reason` is now REQUIRED (≥8 chars) for BOTH grant and revoke
  // (CBIC attestation basis / revoke reason). effectiveFrom defaults to now
  // server-side; effectiveTo is optional (auto-expiry / annual revalidation).
  setSeller194oExemption(
    sellerId: string,
    exempt: boolean,
    reason: string,
    opts: { effectiveFrom?: string; effectiveTo?: string } = {},
  ) {
    return apiClient<{
      id: string;
      is194OExempt: boolean;
      exempt194OReason: string | null;
      exempt194OAttestedBy: string | null;
      exempt194OAttestedAt: string | null;
      exempt194OEffectiveFrom?: string | null;
      exempt194OEffectiveTo?: string | null;
      exempt194ORevokedBy?: string | null;
    }>(`/admin/tax/sellers/${sellerId}/194o-exempt`, {
      method: 'POST',
      body: JSON.stringify({ exempt, reason, ...opts }),
    });
  }

  // ── Phase 37 — HSN master CRUD (Phase 161: paginated + attribution) ──
  listHsn(opts: { search?: string; activeOnly?: boolean; page?: number; limit?: number } = {}) {
    const qs = new URLSearchParams();
    if (opts.search) qs.set('search', opts.search);
    if (opts.activeOnly) qs.set('activeOnly', 'true');
    if (opts.page) qs.set('page', String(opts.page));
    if (opts.limit) qs.set('limit', String(opts.limit));
    const q = qs.toString();
    // Phase 161 #9 — the endpoint now returns a paginated envelope.
    return apiClient<HsnMasterPage>(`/admin/tax/hsn${q ? `?${q}` : ''}`);
  }
  createHsn(input: {
    hsnCode: string;
    description: string;
    defaultGstRateBps: number;
    supplyTaxability?: string;
    defaultUqcCode?: string | null;
    categoryHint?: string | null;
    effectiveFrom?: string;
  }) {
    return apiClient<HsnMasterItem>('/admin/tax/hsn', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  updateHsn(
    id: string,
    input: {
      description?: string;
      defaultUqcCode?: string | null;
      categoryHint?: string | null;
      isActive?: boolean;
      // Phase 161 #11 — required by the API when deactivating.
      deactivationReason?: string;
      // Phase 161 #5 — override the live-reference guard.
      force?: boolean;
      // Phase 161 #12 — optimistic-concurrency token.
      expectedVersion?: number;
      // NB: effectiveTo is no longer accepted here (#10) — use closeHsnWindow.
    },
  ) {
    return apiClient<HsnMasterItem>(`/admin/tax/hsn/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
  // Phase 161 #10 — the only path that adjusts an effective window.
  closeHsnWindow(
    id: string,
    input: { effectiveTo: string | null; reason?: string; expectedVersion?: number },
  ) {
    return apiClient<HsnMasterItem>(`/admin/tax/hsn/${id}/close-window`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // ── Phase 37 — UQC master CRUD (Phase 161: paginated + attribution) ──
  listUqc(opts: { search?: string; activeOnly?: boolean; page?: number; limit?: number } = {}) {
    const qs = new URLSearchParams();
    if (opts.search) qs.set('search', opts.search);
    if (opts.activeOnly) qs.set('activeOnly', 'true');
    if (opts.page) qs.set('page', String(opts.page));
    if (opts.limit) qs.set('limit', String(opts.limit));
    const q = qs.toString();
    // Phase 161 #8 — the endpoint now returns a paginated envelope.
    return apiClient<UqcMasterPage>(`/admin/tax/uqc${q ? `?${q}` : ''}`);
  }
  createUqc(input: { code: string; description: string }) {
    return apiClient<UqcMasterItem>('/admin/tax/uqc', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  // Phase 161 #14 — bulk import.
  bulkCreateUqc(rows: Array<{ code: string; description: string }>) {
    return apiClient<{ requested: number; inserted: number; skipped: number }>(
      '/admin/tax/uqc/bulk',
      { method: 'POST', body: JSON.stringify({ rows }) },
    );
  }
  updateUqc(
    id: string,
    input: {
      description?: string;
      isActive?: boolean;
      // Phase 161 #11 — required by the API when deactivating.
      deactivationReason?: string;
      // Phase 161 #5 — override the reference guard.
      force?: boolean;
      // Phase 161 #9 — optimistic-concurrency token.
      expectedVersion?: number;
    },
  ) {
    return apiClient<UqcMasterItem>(`/admin/tax/uqc/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  // ── Phase 37 — TaxConfig key/value admin ──────────────────────
  listTaxConfig() {
    return apiClient<TaxConfigRow[]>('/admin/tax/config');
  }
  upsertTaxConfig(input: { key: string; value: unknown; description?: string | null }) {
    return apiClient<TaxConfigRow>('/admin/tax/config', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  // ── Phase 37 — Platform GST profile CRUD ───────────────────────
  listPlatformGst() {
    return apiClient<PlatformGstProfileItem[]>('/admin/tax/platform-gst');
  }
  createPlatformGst(input: {
    legalBusinessName: string;
    gstin: string;
    registeredAddressJson: unknown;
    registrationType?: string;
    panNumber?: string | null;
    isDefault?: boolean;
  }) {
    return apiClient<PlatformGstProfileItem>('/admin/tax/platform-gst', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  updatePlatformGst(
    id: string,
    input: {
      legalBusinessName?: string;
      registeredAddressJson?: unknown;
      registrationType?: string;
      panNumber?: string | null;
      isActive?: boolean;
      // Phase 161 #17 — promote to default in the same call (needs reason).
      isDefault?: boolean;
      // Phase 161 #10 — required by the API when deactivating.
      deactivationReason?: string;
      // Phase 161 #11 — required by the API when promoting to default.
      setDefaultReason?: string;
      // Phase 161 #12 — optimistic-concurrency token.
      expectedVersion?: number;
    },
  ) {
    return apiClient<PlatformGstProfileItem>(`/admin/tax/platform-gst/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
  // Phase 161 #11 — switching the default platform GSTIN requires a reason.
  setDefaultPlatformGst(id: string, reason: string) {
    return apiClient<PlatformGstProfileItem>(
      `/admin/tax/platform-gst/${id}/set-default`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
  }
}

// Phase 159aa — Marketplace commission GSTR-1 summary shape (B2B/B2C/CDNR
// counts + totals + drift warnings + first-25-row samples for preview).
export interface MarketplaceCommissionGstr1Summary {
  filingPeriod: string;
  supplierGstin: string;
  totals: {
    b2bInvoiceCount: number;
    b2cBucketCount: number;
    creditNoteCount: number;
    totalTaxableInPaise: string;
    totalGstInPaise: string;
  };
  warnings: string[];
  sample: {
    b2b: Array<{
      invoiceNumber: string;
      invoiceDate: string;
      recipientGstin: string;
      recipientLegalName: string;
      placeOfSupplyStateCode: string;
      commissionInPaise: string;
      totalGstInPaise: string;
      taxSplit: 'CGST_SGST' | 'IGST';
      irn: string | null;
    }>;
    b2cs: Array<{
      placeOfSupplyStateCode: string;
      rateBps: number;
      commissionInPaise: string;
      totalGstInPaise: string;
      taxSplit: 'CGST_SGST' | 'IGST';
      settlementCount: number;
    }>;
    cdnr: Array<{
      creditNoteNumber: string;
      originalInvoiceNumber: string;
      recipientGstin: string;
      commissionInPaise: string;
      totalGstInPaise: string;
    }>;
  };
}

export interface PlatformGstProfileItem {
  id: string;
  legalBusinessName: string;
  gstin: string;
  registeredAddressJson: unknown;
  gstStateCode: string;
  registrationType: string;
  // Phase 161 #7 — full PAN is no longer returned by the API; only the last 4.
  panLast4: string | null;
  panVerified: boolean;
  isDefault: boolean;
  isActive: boolean;
  // Phase 161 — attribution + OCC + reason trail.
  version?: number;
  createdBy?: string | null;
  updatedBy?: string | null;
  deactivationReason?: string | null;
  setDefaultReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaxConfigRow {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface UqcMasterItem {
  id: string;
  code: string;
  description: string;
  isActive: boolean;
  // Phase 161 — attribution + OCC + deactivation trail.
  version?: number;
  createdBy?: string | null;
  updatedBy?: string | null;
  deactivationReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Phase 161 #8 — paginated list envelope.
export interface UqcMasterPage {
  items: UqcMasterItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface HsnMasterItem {
  id: string;
  hsnCode: string;
  description: string;
  defaultGstRateBps: number;
  supplyTaxability: string;
  defaultUqcCode: string | null;
  categoryHint: string | null;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  // Phase 161 — attribution + OCC + deactivation trail.
  version?: number;
  createdBy?: string | null;
  updatedBy?: string | null;
  deactivationReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Phase 161 #9 — paginated list envelope.
export interface HsnMasterPage {
  items: HsnMasterItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
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

// Phase 27 — TDS ledger item shape (BigInt paise serialised as strings).
export interface Tds194OLedgerItem {
  id: string;
  sellerId: string;
  filingPeriod: string;
  sellerPanNumber: string | null;
  sellerPanLast4: string | null;
  sellerLegalName: string | null;
  hadVerifiedPan: boolean;
  grossSaleInPaise: string;
  refundReversalInPaise: string;
  netSaleInPaise: string;
  adjustmentCarriedForwardInPaise: string;
  tdsRateBps: number;
  tdsInPaise: string;
  status:
    | 'COMPUTED'
    | 'WITHHELD'
    | 'DEPOSITED'
    | 'CERTIFICATE_ISSUED'
    | 'REVERSED';
  computedAt: string;
  withheldAt: string | null;
  settlementId: string | null;
  depositedAt: string | null;
  depositedBy: string | null;
  challanReference: string | null;
  certificateIssuedAt: string | null;
  certificateIssuedBy: string | null;
  certificateNumber: string | null;
}

// Phase 35 — GSTN verification types.
export interface SellerGstinItem {
  id: string;
  sellerId: string;
  gstin: string;
  stateCode: string;
  legalName: string;
  isPrimary: boolean;
  registrationType: string;
  // Phase 161 — authoritative, persisted verification state (was derivable
  // only from verifiedAt, which used to be set even on a FAILED check).
  isVerified: boolean;
  legalNameMismatch: boolean;
  gstLegalName?: string | null;
  gstnPortalStatus?: string | null;
  lastCheckedAt?: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationNotes: string | null;
  createdAt: string;
  seller?: {
    id: string;
    sellerShopName: string | null;
    sellerName: string | null;
  };
}

export interface CustomerTaxProfileItem {
  id: string;
  customerId: string;
  gstin: string;
  legalName: string;
  stateCode: string;
  isDefault: boolean;
  isVerified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationNotes: string | null;
  createdAt: string;
  customer?: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  };
}

export interface GstnVerifyOutcome {
  verified: boolean;
  found: boolean;
  status: string;
  legalName: string | null;
  legalNameMismatch: boolean;
  notes: string;
}

export const adminTaxService = new AdminTaxService();
