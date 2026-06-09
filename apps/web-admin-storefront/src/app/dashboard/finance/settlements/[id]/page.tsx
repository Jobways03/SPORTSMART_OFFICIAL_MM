'use client';

/**
 * Settlement cycle detail.
 *
 * Per-seller margin breakdown, opening/closing balance, and a Tally
 * CSV export button for the bookkeeper.
 *
 * Backend endpoints:
 *   GET /admin/settlements/cycles/:id             — cycle + sellerSettlements
 *   GET /admin/settlements/cycles/:id/balances    — opening/closing per seller
 *   GET /admin/settlements/cycles/:id/export.csv  — Tally CSV (attachment)
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { usePermissions } from '@/lib/permissions';
import { paiseToRupeesString } from '@sportsmart/shared-utils';

interface SellerSettlementRow {
  id: string;
  sellerId: string;
  sellerName?: string;
  totalOrders: number;
  totalItems: number;
  totalPlatformAmount: string | number;
  totalSettlementAmount: string | number;
  totalSettlementAmountInPaise: string | number;
  totalPlatformMargin: string | number;
  totalPlatformMarginInPaise: string | number;
  status: string;
  paidAt?: string | null;
  utrReference?: string | null;
  paymentFailureReason?: string | null;
  paidByAdmin?: { name: string } | null;
  // Phase 153 — a settlement locked into an active payout batch can't be
  // adjusted until the batch is cancelled (mirrors the backend guard).
  payoutBatchId?: string | null;
}

interface CycleDetail {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: string | number;
  totalAmountInPaise: string | number;
  totalMargin: string | number;
  totalMarginInPaise: string | number;
  sellerSettlements: SellerSettlementRow[];
  approvedAt?: string | null;
  approvalNotes?: string | null;
  approvedByAdmin?: { name: string; email: string } | null;
}

interface BalanceRow {
  sellerId: string;
  sellerName: string;
  openingBalanceInPaise: string;
  cycleAmountInPaise: string;
  closingBalanceInPaise: string;
  // Phase 149 — outstanding-balance breakdown.
  settlementType?: 'SELLER' | 'FRANCHISE';
  paymentStatus?: string;
  cycleEarningsInPaise?: string;
  cycleAdjustmentsInPaise?: string;
  cyclePaidInPaise?: string;
}

interface Adjustment {
  id: string;
  settlementId: string;
  amount: string | number;
  amountInPaise: string | number;
  reason: string;
  notes: string | null;
  adminId: string;
  createdAt: string;
  adjustmentType?: string;
  status?: string;
  referenceDocumentUrl?: string | null;
  voidReason?: string | null;
}

const ADJUSTMENT_TYPES = [
  'COURIER_PENALTY',
  'SLA_FINE',
  'GOODWILL',
  'MANUAL_CORRECTION',
  'OTHER',
] as const;

// Phase 150 — a PENDING post-settlement claw-back (return / RTO / dispute /
// manual) that the next settlement cycle will net off this seller's payout.
interface ClawbackDebit {
  id: string;
  amountInPaise: string;
  reason: string;
  sourceType: string;
  sourceId: string;
  status: string;
  createdAt: string;
}

export default function SettlementCycleDetailPage() {
  const params = useParams();
  const cycleId = params?.id as string;

  const [cycle, setCycle] = useState<CycleDetail | null>(null);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [balancesWarn, setBalancesWarn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('settlements.approve');
  const canMarkPaid = hasPermission('settlements.markPaid');
  const canCancelClawback = hasPermission('liability_ledger.cancel');

  // Phase 150 — pending post-settlement claw-backs per seller (what the next
  // cycle will deduct) + the per-seller cancel modal.
  const [clawbacks, setClawbacks] = useState<
    Record<string, { totalPendingInPaise: string; count: number }>
  >({});
  const [cbFor, setCbFor] = useState<SellerSettlementRow | null>(null);
  const [cbList, setCbList] = useState<ClawbackDebit[]>([]);
  const [cbLoading, setCbLoading] = useState(false);
  const [cbError, setCbError] = useState<string | null>(null);
  const [cbBusy, setCbBusy] = useState<string | null>(null);

  // Mark-paid modal state.
  const [payFor, setPayFor] = useState<SellerSettlementRow | null>(null);
  const [payUtr, setPayUtr] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payProof, setPayProof] = useState('');
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Batch mark-paid state (select multiple seller rows → one submit).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchRefs, setBatchRefs] = useState<Record<string, string>>({});
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchResults, setBatchResults] =
    useState<Array<{ id: string; success: boolean; error?: string }> | null>(null);

  // Approve-cycle modal state.
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveNotes, setApproveNotes] = useState('');
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // Adjustments modal state.
  const [adjFor, setAdjFor] = useState<SellerSettlementRow | null>(null);
  const [adjList, setAdjList] = useState<Adjustment[]>([]);
  const [adjLoading, setAdjLoading] = useState(false);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjNotes, setAdjNotes] = useState('');
  const [adjType, setAdjType] = useState<string>('OTHER');
  const [adjRefDoc, setAdjRefDoc] = useState('');
  const [adjSaving, setAdjSaving] = useState(false);
  const [adjError, setAdjError] = useState<string | null>(null);

  const loadAdjustments = useCallback(async (settlementId: string) => {
    setAdjLoading(true);
    setAdjError(null);
    try {
      const res = await apiClient<Adjustment[]>(
        `/admin/settlements/${settlementId}/adjustments`,
      );
      setAdjList(res.data ?? []);
    } catch (err) {
      setAdjError((err as Error).message || 'Failed to load adjustments');
    } finally {
      setAdjLoading(false);
    }
  }, []);

  const openAdjustments = (s: SellerSettlementRow) => {
    setAdjFor(s);
    setAdjAmount('');
    setAdjReason('');
    setAdjNotes('');
    setAdjType('OTHER');
    setAdjRefDoc('');
    setAdjError(null);
    loadAdjustments(s.id);
  };

  const submitAdjustment = async () => {
    if (!adjFor) return;
    const parsed = Number(adjAmount);
    if (!parsed || isNaN(parsed)) {
      setAdjError('Amount must be a non-zero number (rupees, +/-)');
      return;
    }
    if (adjReason.trim().length < 3) {
      setAdjError('Reason (min 3 chars) is required');
      return;
    }
    setAdjSaving(true);
    setAdjError(null);
    try {
      await apiClient(`/admin/settlements/${adjFor.id}/adjustments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: parsed,
          reason: adjReason.trim(),
          notes: adjNotes.trim() || undefined,
          adjustmentType: adjType,
          referenceDocumentUrl: adjRefDoc.trim() || undefined,
        }),
      });
      setAdjAmount('');
      setAdjReason('');
      setAdjNotes('');
      setAdjRefDoc('');
      await loadAdjustments(adjFor.id);
      await load();
    } catch (err) {
      setAdjError((err as Error).message || 'Save failed');
    } finally {
      setAdjSaving(false);
    }
  };

  const voidAdjustment = async (adj: Adjustment) => {
    if (!adjFor) return;
    const reason = window.prompt('Void this adjustment? It reverses the effect on the settlement + cycle totals. Enter a reason:');
    if (!reason || reason.trim().length < 3) return;
    setAdjSaving(true);
    setAdjError(null);
    try {
      await apiClient(`/admin/settlements/${adjFor.id}/adjustments/${adj.id}/void`, {
        method: 'PATCH',
        body: JSON.stringify({ voidReason: reason.trim() }),
      });
      await loadAdjustments(adjFor.id);
      await load();
    } catch (err) {
      setAdjError((err as Error).message || 'Void failed');
    } finally {
      setAdjSaving(false);
    }
  };

  const doApprove = async () => {
    setApproving(true);
    setApproveError(null);
    try {
      await apiClient(`/admin/settlements/cycles/${cycleId}/approve`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: approveNotes.trim() || undefined }),
      });
      setApproveOpen(false);
      setApproveNotes('');
      await load();
    } catch (err) {
      setApproveError((err as Error).message || 'Approval failed');
    } finally {
      setApproving(false);
    }
  };

  const openMarkPaid = (s: SellerSettlementRow) => {
    setPayFor(s);
    setPayUtr('');
    setPayMethod('');
    setPayProof('');
    setPayError(null);
  };

  const doMarkPaid = async () => {
    if (!payFor) return;
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(payUtr.trim())) {
      setPayError('UTR must be 8-40 chars (letters, digits, _ or -).');
      return;
    }
    setPaySaving(true);
    setPayError(null);
    try {
      await apiClient(`/admin/settlements/${payFor.id}/mark-paid`, {
        method: 'PATCH',
        body: JSON.stringify({
          utrReference: payUtr.trim(),
          paymentMethod: payMethod.trim() || undefined,
          paymentProofUrl: payProof.trim() || undefined,
        }),
      });
      setPayFor(null);
      await load();
    } catch (err) {
      setPayError((err as Error).message || 'Mark-paid failed');
    } finally {
      setPaySaving(false);
    }
  };

  const doMarkFailed = async (s: SellerSettlementRow) => {
    const reason = window.prompt(
      `Mark settlement for ${s.sellerName ?? s.sellerId} as FAILED (bank rejected/reversed)? Enter a reason:`,
    );
    if (!reason || reason.trim().length < 3) return;
    try {
      await apiClient(`/admin/settlements/${s.id}/mark-failed`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await load();
    } catch (err) {
      setError((err as Error).message || 'Mark-failed failed');
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openBatch = () => {
    setBatchRefs({});
    setBatchError(null);
    setBatchResults(null);
    setBatchOpen(true);
  };

  const doBatch = async () => {
    const ids = [...selected];
    const missing = ids.filter((id) => !/^[A-Za-z0-9_-]{8,40}$/.test((batchRefs[id] ?? '').trim()));
    if (missing.length > 0) {
      setBatchError(`Enter a valid UTR (8-40 chars) for every selected settlement (${missing.length} missing).`);
      return;
    }
    setBatchSaving(true);
    setBatchError(null);
    try {
      const res = await apiClient<{
        results: Array<{ id: string; success: boolean; error?: string }>;
      }>('/admin/accounts/settlements/mark-paid', {
        method: 'POST',
        body: JSON.stringify({
          settlements: ids.map((id) => ({
            id,
            type: 'seller',
            reference: batchRefs[id]!.trim(),
          })),
        }),
      });
      const results =
        (res?.data?.results as never) ??
        ((res as unknown as { results: never[] })?.results ?? []);
      setBatchResults(results);
      // Drop successfully-paid rows from the selection; keep failures visible.
      const failed = new Set(
        (results as Array<{ id: string; success: boolean }>)
          .filter((r) => !r.success)
          .map((r) => r.id),
      );
      setSelected(failed);
      await load();
    } catch (err) {
      setBatchError((err as Error).message || 'Batch mark-paid failed');
    } finally {
      setBatchSaving(false);
    }
  };

  // Phase 150 — open the claw-back cancel modal for a seller; lists their
  // PENDING seller-debits (each cancellable).
  const openClawbacks = useCallback(async (s: SellerSettlementRow) => {
    setCbFor(s);
    setCbList([]);
    setCbError(null);
    setCbLoading(true);
    try {
      const res = await apiClient<{ items: ClawbackDebit[] }>(
        `/admin/liability-ledger/seller_debit?sellerId=${encodeURIComponent(
          s.sellerId,
        )}&status=PENDING&limit=100`,
      );
      setCbList((res?.data?.items as ClawbackDebit[]) ?? []);
    } catch (err) {
      setCbError((err as Error).message || 'Failed to load claw-backs');
    } finally {
      setCbLoading(false);
    }
  }, []);

  const cancelClawback = async (debitId: string) => {
    const reason = window.prompt(
      'Cancel this pending claw-back? (the seller successfully contested it) Enter a reason:',
    );
    if (!reason || reason.trim().length < 3) return;
    setCbBusy(debitId);
    setCbError(null);
    try {
      await apiClient(`/admin/liability-ledger/debits/${debitId}/cancel`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (cbFor) await openClawbacks(cbFor);
      await load();
    } catch (err) {
      setCbError((err as Error).message || 'Cancel failed');
    } finally {
      setCbBusy(null);
    }
  };

  const load = useCallback(async () => {
    if (!cycleId) return;
    setLoading(true);
    setError(null);
    setBalancesWarn(false);
    try {
      const [cycleRes, balancesRes] = await Promise.all([
        apiClient<CycleDetail>(`/admin/settlements/cycles/${cycleId}`),
        // Phase 149 — surface a balance-load failure as a soft warning instead
        // of silently showing empty balances (the page itself still loads).
        apiClient<BalanceRow[]>(
          `/admin/settlements/cycles/${cycleId}/balances`,
        ).catch(() => {
          setBalancesWarn(true);
          return { data: [] as BalanceRow[] };
        }),
      ]);
      const cycleData =
        (cycleRes?.data as CycleDetail) ?? (cycleRes as unknown as CycleDetail);
      setCycle(cycleData);
      const balanceData =
        (balancesRes?.data as BalanceRow[]) ??
        ((balancesRes as unknown as BalanceRow[]) || []);
      setBalances(Array.isArray(balanceData) ? balanceData : []);

      // Phase 150 — per-seller pending claw-back totals (best-effort; never
      // blocks the page). Signals "next cycle will deduct ₹X from seller Y".
      const sellerIds = (cycleData?.sellerSettlements ?? []).map(
        (s) => s.sellerId,
      );
      if (sellerIds.length) {
        apiClient<{
          items: Array<{
            sellerId: string;
            totalPendingInPaise: string;
            count: number;
          }>;
        }>(
          `/admin/liability-ledger/seller-debits/pending-summary?sellerIds=${encodeURIComponent(
            sellerIds.join(','),
          )}`,
        )
          .then((res) => {
            const map: Record<
              string,
              { totalPendingInPaise: string; count: number }
            > = {};
            for (const it of res?.data?.items ?? []) {
              map[it.sellerId] = {
                totalPendingInPaise: it.totalPendingInPaise,
                count: it.count,
              };
            }
            setClawbacks(map);
          })
          .catch(() => undefined);
      } else {
        setClawbacks({});
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to load cycle');
    } finally {
      setLoading(false);
    }
  }, [cycleId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTallyExport = async () => {
    setExporting(true);
    try {
      const token = sessionStorage.getItem('adminAccessToken');
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const res = await fetch(
        `${apiBase}/api/v1/admin/settlements/cycles/${cycleId}/export.csv`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `settlement-cycle-${cycleId.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <main style={{ padding: 32 }}>Loading…</main>;
  if (error)
    return (
      <main style={{ padding: 32, color: '#c62828' }}>
        {error}{' '}
        <Link href="/dashboard/finance/settlements" style={{ color: '#1565c0' }}>
          ← Back
        </Link>
      </main>
    );
  if (!cycle) return null;

  const balanceBySellerId = new Map(balances.map((b) => [b.sellerId, b]));

  // Why the adjustments modal may be read-only. The backend rejects a NEW
  // adjustment once the settlement OR its cycle is PAID, or once the settlement
  // is locked into an active payout batch; it rejects a VOID once the settlement
  // OR cycle is PAID (settlement.service.ts recordAdjustment / voidAdjustment).
  // Mirror that here so we never present a form whose submit is guaranteed to 400.
  const adjLockReason: 'paid' | 'batched' | null = adjFor
    ? adjFor.status === 'PAID' || cycle.status === 'PAID'
      ? 'paid'
      : adjFor.payoutBatchId
        ? 'batched'
        : null
    : null;
  const adjLocked = adjLockReason !== null;

  return (
    <main style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <Link
        href="/dashboard/finance/settlements"
        style={{ fontSize: 13, color: '#1565c0', textDecoration: 'underline' }}
      >
        ← All cycles
      </Link>

      <header style={{
        marginTop: 12, marginBottom: 18, display: 'flex',
        justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
            Settlement cycle — <code>{cycle.id.slice(0, 8)}</code>
          </h1>
          <p style={{ color: '#5b6066', fontSize: 13, marginTop: 6 }}>
            Period{' '}
            <strong>{new Date(cycle.periodStart).toLocaleDateString('en-IN')}</strong>{' '}
            →{' '}
            <strong>{new Date(cycle.periodEnd).toLocaleDateString('en-IN')}</strong>
            {' · '}
            Status: <strong>{cycle.status}</strong>
          </p>
          {/* Phase 144 — approval provenance once approved. */}
          {cycle.status === 'APPROVED' && cycle.approvedAt && (
            <p style={{ color: '#15803d', fontSize: 12, marginTop: 4 }}>
              Approved by <strong>{cycle.approvedByAdmin?.name ?? '—'}</strong>{' '}
              on {new Date(cycle.approvedAt).toLocaleString('en-IN')}
              {cycle.approvalNotes ? ` · "${cycle.approvalNotes}"` : ''}
            </p>
          )}
        </div>
        {canApprove && (cycle.status === 'DRAFT' || cycle.status === 'PREVIEWED') && (
          <button
            onClick={() => { setApproveOpen(true); setApproveNotes(''); setApproveError(null); }}
            style={{
              height: 36, padding: '0 16px', borderRadius: 9999, cursor: 'pointer',
              background: '#15803d', color: '#fff', border: '1px solid #15803d',
              fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >
            Approve cycle
          </button>
        )}
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 18,
        }}
      >
        <Stat label="Sellers in cycle" value={String(cycle.sellerSettlements.length)} />
        <Stat
          label="Settlement total"
          value={paiseToRupeesString(cycle.totalAmountInPaise)}
        />
        <Stat
          label="Platform margin"
          value={paiseToRupeesString(cycle.totalMarginInPaise)}
          accent
        />
        <button
          type="button"
          onClick={handleTallyExport}
          disabled={exporting}
          style={{
            padding: '12px 18px',
            background: '#1565c0',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {exporting ? 'Building CSV…' : 'Export to Tally (.csv)'}
        </button>
      </section>

      <section
        style={{
          background: '#fff',
          border: '1px solid #d0d7de',
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: 18,
        }}
      >
        <header
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #eee',
            background: '#fafbfc',
            fontWeight: 600,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>Per-seller margin breakdown</span>
          {canMarkPaid && cycle.status === 'APPROVED' && selected.size > 0 && (
            <button
              onClick={openBatch}
              style={{
                marginLeft: 'auto', height: 28, padding: '0 12px',
                background: '#15803d', color: '#fff', border: '1px solid #15803d',
                borderRadius: 9999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Mark {selected.size} selected paid
            </button>
          )}
        </header>
        {balancesWarn && (
          <div style={{
            padding: '8px 16px', fontSize: 12, color: '#92400e',
            background: '#fffbeb', borderBottom: '1px solid #fcd34d',
          }}>
            ⚠ Opening / closing balances couldn&apos;t be loaded — the figures below
            omit the carried-forward balance. Reload to retry.
          </div>
        )}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#fafbfc' }}>
            <tr>
              <th style={th}>Seller</th>
              <th style={th}>Orders</th>
              <th style={th}>Items</th>
              <th style={{ ...th, textAlign: 'right' }}>Platform total</th>
              <th style={{ ...th, textAlign: 'right' }}>Seller settlement</th>
              <th style={{ ...th, textAlign: 'right' }}>Platform margin</th>
              <th style={{ ...th, textAlign: 'right' }}>Opening</th>
              <th style={{ ...th, textAlign: 'right' }}>Closing</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Adjustments</th>
            </tr>
          </thead>
          <tbody>
            {cycle.sellerSettlements.map((s) => {
              const bal = balanceBySellerId.get(s.sellerId);
              const cb = clawbacks[s.sellerId];
              return (
                <tr key={s.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={td}>
                    <strong>{s.sellerName ?? 'Unknown seller'}</strong>
                    <br />
                    <small style={{ color: '#888' }}>
                      <code>{s.sellerId.slice(0, 8)}</code>
                    </small>
                    {cb && cb.count > 0 ? (
                      <div style={{ marginTop: 4 }}>
                        <span
                          title="Pending post-settlement claw-backs — the next cycle will deduct this from the seller's payout"
                          style={{
                            padding: '1px 6px',
                            background: '#fff7ed',
                            color: '#c2410c',
                            borderRadius: 999,
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        >
                          ⤵ claw-back {paiseToRupeesString(cb.totalPendingInPaise)} ({cb.count})
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td style={td}>{s.totalOrders}</td>
                  <td style={td}>{s.totalItems}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {paiseToRupeesString(s.totalSettlementAmountInPaise as never)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                    {paiseToRupeesString(s.totalSettlementAmountInPaise as never)}
                  </td>
                  <td
                    style={{ ...td, textAlign: 'right', color: '#2e7d32' }}
                  >
                    {paiseToRupeesString(s.totalPlatformMarginInPaise as never)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: '#5b6066' }}>
                    {bal ? paiseToRupeesString(bal.openingBalanceInPaise) : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                    {bal ? paiseToRupeesString(bal.closingBalanceInPaise) : '—'}
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        padding: '2px 8px',
                        background: s.status === 'PAID' ? '#dcfce7' : s.status === 'FAILED' ? '#fef2f2' : '#f3f4f6',
                        color: s.status === 'PAID' ? '#15803d' : s.status === 'FAILED' ? '#b91c1c' : '#0F1115',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {s.status}
                    </span>
                    {s.status === 'PAID' && (s.utrReference || s.paidByAdmin) && (
                      <div style={{ fontSize: 10, color: '#5b6066', marginTop: 3 }}>
                        {s.utrReference ? `UTR ${s.utrReference}` : ''}
                        {s.paidByAdmin ? ` · by ${s.paidByAdmin.name}` : ''}
                      </div>
                    )}
                    {s.status === 'FAILED' && s.paymentFailureReason && (
                      <div style={{ fontSize: 10, color: '#b91c1c', marginTop: 3 }}>
                        {s.paymentFailureReason}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                      {canMarkPaid &&
                        cycle.status === 'APPROVED' &&
                        (s.status === 'APPROVED' || s.status === 'FAILED') && (
                          <input
                            type="checkbox"
                            checked={selected.has(s.id)}
                            onChange={() => toggleSelect(s.id)}
                            title="Select for batch mark-paid"
                            style={{ cursor: 'pointer' }}
                          />
                        )}
                      <button
                        type="button"
                        onClick={() => openAdjustments(s)}
                        style={rowBtn}
                      >
                        View / Add
                      </button>
                      {canCancelClawback && cb && cb.count > 0 && (
                        <button
                          type="button"
                          onClick={() => openClawbacks(s)}
                          style={{ ...rowBtn, borderColor: '#c2410c', color: '#c2410c' }}
                        >
                          Claw-backs ({cb.count})
                        </button>
                      )}
                      {canMarkPaid &&
                        cycle.status === 'APPROVED' &&
                        (s.status === 'APPROVED' || s.status === 'FAILED') && (
                          <button
                            type="button"
                            onClick={() => openMarkPaid(s)}
                            style={{ ...rowBtn, borderColor: '#15803d', color: '#15803d' }}
                          >
                            {s.status === 'FAILED' ? 'Retry payout' : 'Mark paid'}
                          </button>
                        )}
                      {canMarkPaid &&
                        cycle.status === 'APPROVED' &&
                        s.status === 'APPROVED' && (
                          <button
                            type="button"
                            onClick={() => doMarkFailed(s)}
                            style={{ ...rowBtn, borderColor: '#b91c1c', color: '#b91c1c' }}
                          >
                            Mark failed
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {approveOpen && (
        <div
          onClick={() => !approving && setApproveOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, padding: 24, width: 460, maxWidth: '100%' }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F1115' }}>
              Approve settlement cycle
            </h3>
            <p style={{ fontSize: 13, color: '#525A65', marginTop: 8, lineHeight: 1.5 }}>
              You&apos;re about to approve{' '}
              <strong>₹{paiseToRupeesString(cycle.totalAmountInPaise)}</strong> across{' '}
              <strong>{cycle.sellerSettlements.length}</strong> seller(s). This commits the
              payouts and runs GST TCS/TDS. Totals are re-validated against live commission
              state on submit — if a return arrived since creation, approval is rejected.
            </p>
            <textarea
              value={approveNotes}
              onChange={(e) => setApproveNotes(e.target.value)}
              placeholder="Approval notes (optional)…"
              rows={3}
              style={{
                width: '100%', marginTop: 8, padding: 10, borderRadius: 10,
                border: '1px solid #E5E7EB', fontSize: 13, resize: 'vertical',
              }}
            />
            {approveError && (
              <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>{approveError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setApproveOpen(false)}
                disabled={approving}
                style={{
                  height: 34, padding: '0 14px', borderRadius: 9999, cursor: 'pointer',
                  background: '#fff', color: '#0F1115', border: '1px solid #E5E7EB',
                  fontSize: 12, fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={doApprove}
                disabled={approving}
                style={{
                  height: 34, padding: '0 16px', borderRadius: 9999, cursor: 'pointer',
                  background: '#15803d', color: '#fff', border: '1px solid #15803d',
                  fontSize: 12, fontWeight: 600,
                }}
              >
                {approving ? 'Approving…' : 'Confirm & approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {payFor && (
        <div
          onClick={() => !paySaving && setPayFor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, padding: 24, width: 460, maxWidth: '100%' }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F1115' }}>
              Mark payout as paid
            </h3>
            <p style={{ fontSize: 13, color: '#525A65', marginTop: 8, lineHeight: 1.5 }}>
              <strong>{payFor.sellerName ?? payFor.sellerId}</strong> · settlement amount{' '}
              <strong>₹{paiseToRupeesString(payFor.totalSettlementAmountInPaise as never)}</strong>{' '}
              (gross; net of TCS/TDS/GST is wired). This is final — enter the bank UTR.
            </p>
            <input
              value={payUtr}
              onChange={(e) => setPayUtr(e.target.value)}
              placeholder="Bank UTR / payout reference"
              style={modalInput}
            />
            <input
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
              placeholder="Payment method (NEFT / RAZORPAYX / IMPS…) — optional"
              style={modalInput}
            />
            <input
              value={payProof}
              onChange={(e) => setPayProof(e.target.value)}
              placeholder="Payment-proof URL (optional)"
              style={modalInput}
            />
            {payError && (
              <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>{payError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setPayFor(null)} disabled={paySaving} style={rowBtn}>
                Cancel
              </button>
              <button
                onClick={doMarkPaid}
                disabled={paySaving}
                style={{ ...rowBtn, background: '#15803d', color: '#fff', borderColor: '#15803d', height: 32, padding: '0 14px' }}
              >
                {paySaving ? 'Marking…' : 'Confirm paid'}
              </button>
            </div>
          </div>
        </div>
      )}

      {batchOpen && (
        <div
          onClick={() => !batchSaving && setBatchOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, padding: 24, width: 560, maxWidth: '100%', maxHeight: '80vh', overflowY: 'auto' }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F1115' }}>
              Batch mark {selected.size} settlement(s) paid
            </h3>
            <p style={{ fontSize: 13, color: '#525A65', marginTop: 8, lineHeight: 1.5 }}>
              Enter the bank UTR for each. UTRs must be unique (a duplicate is rejected per item).
              Each is processed independently — failures don&apos;t block the rest.
            </p>
            <div style={{ marginTop: 8 }}>
              {[...selected].map((id) => {
                const s = cycle.sellerSettlements.find((x) => x.id === id);
                const r = batchResults?.find((x) => x.id === id);
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ flex: '0 0 160px', fontSize: 12, color: '#0F1115', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s?.sellerName ?? id.slice(0, 8)}
                    </span>
                    <input
                      value={batchRefs[id] ?? ''}
                      onChange={(e) => setBatchRefs((p) => ({ ...p, [id]: e.target.value }))}
                      placeholder="UTR…"
                      style={{ ...modalInput, marginTop: 0, flex: 1 }}
                    />
                    {r && (
                      <span style={{ fontSize: 11, color: r.success ? '#15803d' : '#b91c1c', flex: '0 0 auto' }}>
                        {r.success ? '✓' : `✗ ${r.error ?? ''}`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {batchError && (
              <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>{batchError}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setBatchOpen(false)} disabled={batchSaving} style={rowBtn}>
                Close
              </button>
              <button
                onClick={doBatch}
                disabled={batchSaving || selected.size === 0}
                style={{ ...rowBtn, background: '#15803d', color: '#fff', borderColor: '#15803d', height: 32, padding: '0 14px' }}
              >
                {batchSaving ? 'Processing…' : 'Confirm batch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {adjFor && (
        <div
          onClick={() => !adjSaving && setAdjFor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 16, padding: 24,
              width: '100%', maxWidth: 640, maxHeight: '90vh',
              overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              Adjustments
            </h2>
            <p style={{ margin: '6px 0 14px', fontSize: 12, color: '#525A65' }}>
              {adjFor.sellerName} · settlement{' '}
              <code style={{ fontFamily: 'ui-monospace, monospace' }}>
                {adjFor.id.slice(0, 8)}
              </code>
            </p>

            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
              Recorded
            </h3>
            {adjLoading && (
              <div style={{ fontSize: 13, color: '#64748b', padding: 8 }}>Loading…</div>
            )}
            {!adjLoading && adjList.length === 0 && (
              <div style={{ fontSize: 12, color: '#94a3b8', padding: 8 }}>
                No adjustments yet.
              </div>
            )}
            {!adjLoading && adjList.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 14 }}>
                <thead>
                  <tr style={{ background: '#fafafa', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px', fontWeight: 700, color: '#64748b' }}>Date</th>
                    <th style={{ padding: '6px 8px', fontWeight: 700, color: '#64748b', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '6px 8px', fontWeight: 700, color: '#64748b' }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {adjList.map((a) => {
                    const voided = a.status === 'VOIDED';
                    return (
                    <tr key={a.id} style={{ borderTop: '1px solid #f1f5f9', opacity: voided ? 0.55 : 1 }}>
                      <td style={{ padding: '6px 8px', color: '#475569' }}>
                        {new Date(a.createdAt).toLocaleDateString()}
                      </td>
                      <td
                        style={{
                          padding: '6px 8px',
                          textAlign: 'right',
                          fontFamily: 'ui-monospace, monospace',
                          color: Number(a.amount) >= 0 ? '#15803d' : '#dc2626',
                          textDecoration: voided ? 'line-through' : 'none',
                        }}
                      >
                        {Number(a.amount).toFixed(2)}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ fontWeight: 600 }}>
                          {a.adjustmentType && a.adjustmentType !== 'OTHER' && (
                            <span style={{ fontSize: 10, color: '#7c3aed', marginRight: 6 }}>
                              [{a.adjustmentType.replace(/_/g, ' ')}]
                            </span>
                          )}
                          {a.reason}
                          {voided && <span style={{ fontSize: 10, color: '#dc2626', marginLeft: 6 }}>VOIDED</span>}
                        </div>
                        {a.notes && (
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{a.notes}</div>
                        )}
                        {voided && a.voidReason && (
                          <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2 }}>Void: {a.voidReason}</div>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        {!voided && canApprove && !adjLocked && (
                          <button
                            type="button"
                            onClick={() => voidAdjustment(a)}
                            disabled={adjSaving}
                            style={{ ...rowBtn, height: 24, borderColor: '#dc2626', color: '#dc2626' }}
                          >
                            Void
                          </button>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {!adjLocked && (
            <>
            <h3 style={{ margin: '14px 0 8px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              Record new adjustment
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600, marginBottom: 4 }}>
                  Amount (₹, signed)
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  placeholder="-100 or 50"
                  style={inpAdj}
                />
              </label>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600, marginBottom: 4 }}>
                  Reason
                </span>
                <input
                  type="text"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="e.g. courier penalty, missed SLA"
                  style={inpAdj}
                />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginTop: 8 }}>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600, marginBottom: 4 }}>
                  Type
                </span>
                <select value={adjType} onChange={(e) => setAdjType(e.target.value)} style={inpAdj}>
                  {ADJUSTMENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'block' }}>
                <span style={{ display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600, marginBottom: 4 }}>
                  Reference document URL (optional)
                </span>
                <input
                  type="url"
                  value={adjRefDoc}
                  onChange={(e) => setAdjRefDoc(e.target.value)}
                  placeholder="https://… courier invoice / SLA report"
                  style={inpAdj}
                />
              </label>
            </div>
            <label style={{ display: 'block', marginTop: 8 }}>
              <span style={{ display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600, marginBottom: 4 }}>
                Notes (optional)
              </span>
              <textarea
                value={adjNotes}
                onChange={(e) => setAdjNotes(e.target.value)}
                rows={2}
                style={{ ...inpAdj, resize: 'vertical' }}
              />
            </label>

            {/* Phase 147 — before/after net payable preview. */}
            {adjAmount && Number.isFinite(Number(adjAmount)) && Number(adjAmount) !== 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
                Net payable: <strong>₹{Number(adjFor.totalSettlementAmount).toFixed(2)}</strong>
                {' → '}
                <strong style={{ color: '#0F1115' }}>
                  ₹{(Number(adjFor.totalSettlementAmount) + Number(adjAmount)).toFixed(2)}
                </strong>
              </div>
            )}
            </>
            )}

            {adjLocked && (
              <div
                style={{
                  marginTop: 14,
                  padding: '12px 14px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
                  {adjLockReason === 'paid'
                    ? 'This settlement is already paid — adjustments are locked'
                    : 'This settlement is in an active payout batch — adjustments are locked'}
                </div>
                <p style={{ margin: 0, fontSize: 12, color: '#475569', lineHeight: 1.55 }}>
                  {adjLockReason === 'paid' ? (
                    <>
                      The money has already been wired, so this settlement can&apos;t be
                      edited. Post-payment corrections carry into the seller&apos;s{' '}
                      <strong>next</strong> settlement cycle — automatically for
                      returns / RTO / dispute losses (they show up here as a claw-back),
                      or manually as a debit/credit in the{' '}
                      <strong>Liability Ledger</strong>.
                    </>
                  ) : (
                    <>
                      This settlement is locked into payout batch{' '}
                      <code style={{ fontFamily: 'ui-monospace, monospace' }}>
                        {adjFor.payoutBatchId?.slice(0, 8)}
                      </code>
                      . Cancel that batch to release it, or record the correction in
                      the next cycle.
                    </>
                  )}
                </p>
              </div>
            )}

            {adjError && (
              <div style={{
                marginTop: 10, padding: '8px 12px',
                background: '#fef2f2', border: '1px solid #fecaca',
                color: '#991b1b', borderRadius: 8, fontSize: 13,
              }}>
                {adjError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setAdjFor(null)}
                disabled={adjSaving}
                style={{
                  height: 36, padding: '0 16px',
                  border: '1px solid #D2D6DC', background: '#fff', color: '#0F1115',
                  borderRadius: 9999, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                }}
              >
                Close
              </button>
              {!adjLocked && (
                <button
                  type="button"
                  onClick={submitAdjustment}
                  disabled={adjSaving}
                  style={{
                    height: 36, padding: '0 16px',
                    border: 'none', background: '#0F1115', color: '#fff',
                    borderRadius: 9999, fontWeight: 700, fontSize: 13,
                    cursor: adjSaving ? 'wait' : 'pointer',
                    opacity: adjSaving ? 0.6 : 1,
                  }}
                >
                  {adjSaving ? 'Saving…' : 'Add adjustment'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Phase 150 — pending claw-back cancel modal. */}
      {cbFor && (
        <div
          onClick={() => !cbBusy && setCbFor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 16, padding: 24,
              width: '100%', maxWidth: 640, maxHeight: '90vh',
              overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              Pending claw-backs
            </h2>
            <p style={{ margin: '6px 0 14px', fontSize: 12, color: '#525A65' }}>
              {cbFor.sellerName ?? cbFor.sellerId} · these will be deducted from
              the seller&apos;s next settlement cycle. Cancel one only if the
              seller successfully contested it.
            </p>

            {cbError && (
              <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
                {cbError}
              </div>
            )}
            {cbLoading ? (
              <p style={{ fontSize: 13, color: '#525A65' }}>Loading…</p>
            ) : cbList.length === 0 ? (
              <p style={{ fontSize: 13, color: '#525A65' }}>
                No pending claw-backs.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#64748b' }}>
                    <th style={{ padding: '6px 8px' }}>Source</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '6px 8px' }}>Reason</th>
                    <th style={{ padding: '6px 8px' }} />
                  </tr>
                </thead>
                <tbody>
                  {cbList.map((d) => (
                    <tr key={d.id} style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: '6px 8px', color: '#475569' }}>
                        <code>{d.sourceType}</code>
                        <br />
                        <small style={{ color: '#94a3b8' }}>
                          {d.sourceId.slice(0, 8)}
                        </small>
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#c2410c' }}>
                        −{paiseToRupeesString(d.amountInPaise)}
                      </td>
                      <td style={{ padding: '6px 8px', color: '#475569' }}>
                        {d.reason}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        <button
                          type="button"
                          disabled={cbBusy === d.id}
                          onClick={() => cancelClawback(d.id)}
                          style={{ ...rowBtn, borderColor: '#b91c1c', color: '#b91c1c', opacity: cbBusy === d.id ? 0.5 : 1 }}
                        >
                          {cbBusy === d.id ? 'Cancelling…' : 'Cancel'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setCbFor(null)}
                disabled={!!cbBusy}
                style={rowBtn}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const inpAdj: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  fontSize: 13,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

// Phase 145 — per-row action button + the mark-paid modal inputs.
const rowBtn: React.CSSProperties = {
  height: 26,
  padding: '0 10px',
  border: '1px solid #d0d7de',
  background: '#fff',
  color: '#0F1115',
  borderRadius: 9999,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};
const modalInput: React.CSSProperties = {
  width: '100%',
  marginTop: 8,
  padding: '9px 10px',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  fontSize: 13,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #d0d7de',
        borderRadius: 8,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: '#5b6066',
          fontWeight: 600,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 18,
          fontWeight: 700,
          color: accent ? '#2e7d32' : '#0F1115',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: '#5b6066',
  textTransform: 'uppercase',
};

const td: React.CSSProperties = {
  padding: '12px',
  verticalAlign: 'top',
};
