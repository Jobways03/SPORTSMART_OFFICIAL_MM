import { apiClient, ApiResponse, API_BASE } from '@/lib/api-client';

export type PayoutBatchStatus =
  | 'DRAFT'
  | 'EXPORTED'
  | 'PARTIALLY_PAID'
  | 'COMPLETED'
  | 'FAILED'
  // Phase 151 — batch aborted before payment (settlements released).
  | 'CANCELLED';

// Phase 151 — per-row status (no PARTIALLY_PAID; it's a batch-only rollup).
export type PayoutItemStatus =
  | 'DRAFT'
  | 'EXPORTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface PayoutItem {
  id: string;
  batchId: string;
  settlementId: string;
  sellerId: string;
  amount: string; // Decimal serialized as string by Prisma
  // Exact paise (BigInt → string). The amount the bank is expected to pay; the
  // ingest modal sends this as paidAmountInPaise on a PAID row.
  amountInPaise: string;
  status: PayoutItemStatus;
  utrReference: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface PayoutBatchSummary {
  id: string;
  status: PayoutBatchStatus;
  // Phase 151 — denorm fields for the queue + bank-file reference.
  batchNumber?: string | null;
  totalAmountInPaise?: string | null;
  settlementCount?: number | null;
  fileHash?: string | null;
  exportedAt: string | null;
  exportFileId: string | null;
  responseFileId: string | null;
  notes: string | null;
  createdByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { payouts: number };
}

export interface PayoutBatchDetail extends PayoutBatchSummary {
  payouts: PayoutItem[];
}

export interface IngestRow {
  settlementId: string;
  status: 'PAID' | 'FAILED';
  // Phase 152 — REQUIRED on PAID rows: the amount the bank actually disbursed,
  // checked against the settlement total (±1 paise) server-side. Omitting it
  // auto-demotes the row to FAILED (BANK_AMOUNT_MISSING).
  paidAmountInPaise?: string;
  utrReference?: string;
  failureReason?: string;
}

// Phase 152 — ingest now returns per-row mismatches + skipped rows so the
// operator sees exactly what landed (vs auto-demoted / not-in-batch).
export interface IngestMismatch {
  settlementId: string;
  expectedInPaise: string;
  actualInPaise: string;
}
export interface IngestSkipped {
  settlementId: string;
  reason: string;
}
export interface IngestResult {
  batch: PayoutBatchDetail;
  mismatches: IngestMismatch[];
  skipped?: IngestSkipped[];
}

// Phase 151 — a settlement skipped at batch creation (KYC / dispute / bank
// details / soft-delete), surfaced so ops can fix + retry.
export interface SkippedSettlement {
  settlementId: string;
  sellerId: string;
  reason: string;
}

// createBatch returns the batch + the skipped rows (was incorrectly typed as a
// bare batch — the API has always returned { batch, skipped }).
export interface CreateBatchResult {
  batch: PayoutBatchDetail;
  skipped: SkippedSettlement[];
}

export const adminPayoutsService = {
  listBatches(): Promise<ApiResponse<PayoutBatchSummary[]>> {
    return apiClient<PayoutBatchSummary[]>('/admin/payouts');
  },

  getBatch(id: string): Promise<ApiResponse<PayoutBatchDetail>> {
    return apiClient<PayoutBatchDetail>(`/admin/payouts/${id}`);
  },

  createBatch(cycleId: string): Promise<ApiResponse<CreateBatchResult>> {
    return apiClient<CreateBatchResult>(
      `/admin/payouts/cycles/${cycleId}/batches`,
      { method: 'POST' },
    );
  },

  // Phase 151 — abort a DRAFT/EXPORTED batch created in error.
  cancelBatch(
    batchId: string,
    reason: string,
  ): Promise<ApiResponse<PayoutBatchDetail>> {
    return apiClient<PayoutBatchDetail>(`/admin/payouts/${batchId}/cancel`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    });
  },

  ingestResponse(
    batchId: string,
    rows: IngestRow[],
  ): Promise<ApiResponse<IngestResult>> {
    return apiClient<IngestResult>(
      `/admin/payouts/${batchId}/ingest-response`,
      {
        method: 'POST',
        body: JSON.stringify({ rows }),
      },
    );
  },

  // Phase 152 — upload a bank response CSV (the exported file annotated by the
  // bank with status / paid_amount_in_paise / utr columns). Parsed + amount-
  // checked server-side; same hardening as the manual path.
  async ingestResponseFile(
    batchId: string,
    file: File,
  ): Promise<ApiResponse<IngestResult>> {
    const token = sessionStorage.getItem('adminAccessToken');
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(
      `${API_BASE}/api/v1/admin/payouts/${batchId}/ingest-response-file`,
      {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '' },
        body: form,
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.message || `Upload failed (HTTP ${res.status})`);
    }
    return json as ApiResponse<IngestResult>;
  },

  /**
   * The export endpoint streams a CSV with Content-Disposition; we kick off
   * a browser download by hitting it with a fetch + blob, since apiClient
   * expects JSON. Token is read from sessionStorage (same convention).
   */
  async downloadExportCsv(batchId: string): Promise<void> {
    const token = sessionStorage.getItem('adminAccessToken');
    const res = await fetch(
      `${API_BASE}/api/v1/admin/payouts/${batchId}/export.csv`,
      {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Export failed (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payout-batch-${batchId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export const PAYOUT_STATUS_COLOR: Record<PayoutBatchStatus, { bg: string; fg: string }> = {
  DRAFT:           { bg: '#f1f5f9', fg: '#475569' },
  EXPORTED:        { bg: '#dbeafe', fg: '#1d4ed8' },
  PARTIALLY_PAID:  { bg: '#fef3c7', fg: '#92400e' },
  COMPLETED:       { bg: '#dcfce7', fg: '#166534' },
  FAILED:          { bg: '#fee2e2', fg: '#991b1b' },
  CANCELLED:       { bg: '#f3f4f6', fg: '#6b7280' },
};
