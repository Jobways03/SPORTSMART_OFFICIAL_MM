// Phase 181 (Franchise Ledger audit #9) — a franchise's self-view of its OWN
// running-balance ledger. Backed by /franchise/me/ledger* (FranchiseAuthGuard +
// req.franchiseId server-side, so it only ever returns THIS franchise's rows).
// Money arrives as paise STRINGS; format with `paiseToINR`, never parse to math.

import { apiClient, ApiResponse } from '@/lib/api-client';

export interface LedgerBalance {
  balanceInPaise: string;
  balance: string;
  currency: string;
  asOf: string | null;
}
export interface LedgerEntry {
  id: string;
  createdAt: string;
  sourceType: string;
  description: string | null;
  status: string;
  debitInPaise: string;
  creditInPaise: string;
  balanceAfterInPaise: string;
}
export interface LedgerPage {
  entries: LedgerEntry[];
  total: number;
}

export const ledgerService = {
  getBalance(): Promise<ApiResponse<LedgerBalance>> {
    return apiClient<LedgerBalance>('/franchise/me/ledger/balance');
  },
  getLedger(opts: { page?: number; limit?: number; sourceType?: string; status?: string } = {}): Promise<ApiResponse<LedgerPage>> {
    const q = new URLSearchParams();
    q.set('page', String(opts.page ?? 1));
    q.set('limit', String(opts.limit ?? 25));
    if (opts.sourceType) q.set('sourceType', opts.sourceType);
    if (opts.status) q.set('status', opts.status);
    return apiClient<LedgerPage>(`/franchise/me/ledger?${q.toString()}`);
  },
};

// String-based (frontend target predates BigInt literals) — exact at any size.
export function paiseToINR(paise: string | null | undefined): string {
  if (paise == null || paise === '') return '₹0.00';
  let s = String(paise).trim();
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (!/^\d+$/.test(s)) return `₹${paise}`;
  s = s.padStart(3, '0');
  const paisePart = s.slice(-2);
  const rupees = (s.slice(0, -2).replace(/^0+(?=\d)/, '') || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}₹${rupees}.${paisePart}`;
}
