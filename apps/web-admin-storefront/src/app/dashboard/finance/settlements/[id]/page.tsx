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
}

interface BalanceRow {
  sellerId: string;
  sellerName: string;
  openingBalanceInPaise: string;
  cycleAmountInPaise: string;
  closingBalanceInPaise: string;
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
}

export default function SettlementCycleDetailPage() {
  const params = useParams();
  const cycleId = params?.id as string;

  const [cycle, setCycle] = useState<CycleDetail | null>(null);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Adjustments modal state.
  const [adjFor, setAdjFor] = useState<SellerSettlementRow | null>(null);
  const [adjList, setAdjList] = useState<Adjustment[]>([]);
  const [adjLoading, setAdjLoading] = useState(false);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjNotes, setAdjNotes] = useState('');
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
    if (!adjReason.trim()) {
      setAdjError('Reason is required');
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
        }),
      });
      setAdjAmount('');
      setAdjReason('');
      setAdjNotes('');
      await loadAdjustments(adjFor.id);
      await load();
    } catch (err) {
      setAdjError((err as Error).message || 'Save failed');
    } finally {
      setAdjSaving(false);
    }
  };

  const load = useCallback(async () => {
    if (!cycleId) return;
    setLoading(true);
    setError(null);
    try {
      const [cycleRes, balancesRes] = await Promise.all([
        apiClient<CycleDetail>(`/admin/settlements/cycles/${cycleId}`),
        apiClient<BalanceRow[]>(
          `/admin/settlements/cycles/${cycleId}/balances`,
        ).catch(() => ({ data: [] as BalanceRow[] })),
      ]);
      setCycle(
        (cycleRes?.data as CycleDetail) ?? (cycleRes as unknown as CycleDetail),
      );
      const balanceData =
        (balancesRes?.data as BalanceRow[]) ??
        ((balancesRes as unknown as BalanceRow[]) || []);
      setBalances(Array.isArray(balanceData) ? balanceData : []);
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

  return (
    <main style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <Link
        href="/dashboard/finance/settlements"
        style={{ fontSize: 13, color: '#1565c0', textDecoration: 'underline' }}
      >
        ← All cycles
      </Link>

      <header style={{ marginTop: 12, marginBottom: 18 }}>
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
          }}
        >
          Per-seller margin breakdown
        </header>
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
              return (
                <tr key={s.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={td}>
                    <strong>{s.sellerName ?? 'Unknown seller'}</strong>
                    <br />
                    <small style={{ color: '#888' }}>
                      <code>{s.sellerId.slice(0, 8)}</code>
                    </small>
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
                        background: '#f3f4f6',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => openAdjustments(s)}
                      style={{
                        height: 26, padding: '0 10px',
                        border: '1px solid #d0d7de', background: '#fff',
                        color: '#0F1115', borderRadius: 9999,
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      View / Add
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

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
                  {adjList.map((a) => (
                    <tr key={a.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 8px', color: '#475569' }}>
                        {new Date(a.createdAt).toLocaleDateString()}
                      </td>
                      <td
                        style={{
                          padding: '6px 8px',
                          textAlign: 'right',
                          fontFamily: 'ui-monospace, monospace',
                          color: Number(a.amount) >= 0 ? '#15803d' : '#dc2626',
                        }}
                      >
                        {Number(a.amount).toFixed(2)}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ fontWeight: 600 }}>{a.reason}</div>
                        {a.notes && (
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            {a.notes}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

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
