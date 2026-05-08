import { apiClient, ApiResponse, API_BASE } from '@/lib/api-client';

export type PayoutBatchStatus =
  | 'DRAFT'
  | 'EXPORTED'
  | 'PARTIALLY_PAID'
  | 'COMPLETED'
  | 'FAILED';

export type PayoutItemStatus = PayoutBatchStatus;

export interface PayoutItem {
  id: string;
  batchId: string;
  settlementId: string;
  sellerId: string;
  amount: string; // Decimal serialized as string by Prisma
  status: PayoutItemStatus;
  utrReference: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface PayoutBatchSummary {
  id: string;
  status: PayoutBatchStatus;
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
  utrReference?: string;
  failureReason?: string;
}

export const adminPayoutsService = {
  listBatches(): Promise<ApiResponse<PayoutBatchSummary[]>> {
    return apiClient<PayoutBatchSummary[]>('/admin/payouts');
  },

  getBatch(id: string): Promise<ApiResponse<PayoutBatchDetail>> {
    return apiClient<PayoutBatchDetail>(`/admin/payouts/${id}`);
  },

  createBatch(cycleId: string): Promise<ApiResponse<PayoutBatchDetail>> {
    return apiClient<PayoutBatchDetail>(
      `/admin/payouts/cycles/${cycleId}/batches`,
      { method: 'POST' },
    );
  },

  ingestResponse(
    batchId: string,
    rows: IngestRow[],
  ): Promise<ApiResponse<PayoutBatchDetail>> {
    return apiClient<PayoutBatchDetail>(
      `/admin/payouts/${batchId}/ingest-response`,
      {
        method: 'POST',
        body: JSON.stringify({ rows }),
      },
    );
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
};
