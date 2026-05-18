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

export default function SettlementCycleDetailPage() {
  const params = useParams();
  const cycleId = params?.id as string;

  const [cycle, setCycle] = useState<CycleDetail | null>(null);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

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
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}

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
