'use client';

// Phase 13 completion — admin browser for the three liability-ledger
// tables (SellerDebit, LogisticsClaim, PlatformExpense). Filters by
// source so finance can trace every cost attribution back to the
// dispute or return that triggered it.

import { useCallback, useEffect, useState } from 'react';
import {
  adminLiabilityLedgerService,
  LedgerType,
  LedgerRow,
  SellerDebitRow,
  LogisticsClaimRow,
  PlatformExpenseRow,
} from '@/services/admin-liability-ledger.service';

const TABS: { key: LedgerType; label: string }[] = [
  { key: 'seller_debit', label: 'Seller debits' },
  { key: 'logistics_claim', label: 'Logistics claims' },
  { key: 'platform_expense', label: 'Platform expenses' },
];

export default function LiabilityLedgerPage() {
  const [tab, setTab] = useState<LedgerType>('seller_debit');
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters.
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('');
  const [sourceIdFilter, setSourceIdFilter] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminLiabilityLedgerService.list(tab, {
        sourceType: sourceTypeFilter || undefined,
        sourceId: sourceIdFilter.trim() || undefined,
        page: 1,
        limit: 50,
      });
      if (res.data) {
        setRows(res.data.items);
        setTotal(res.data.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [tab, sourceTypeFilter, sourceIdFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
        Liability ledger
      </h1>
      <p style={{ marginTop: 6, fontSize: 13, color: '#525A65' }}>
        Append-only cost-attribution records. Every dispute decision
        and QC-approved return that costs the platform money writes
        exactly one row here. Recovery happens via settlement
        adjustments (seller debits), courier claims, or stays as a
        platform expense.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '20px 0 12px' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 9999,
              border: tab === t.key ? '1px solid #0F1115' : '1px solid #D2D6DC',
              background: tab === t.key ? '#0F1115' : '#fff',
              color: tab === t.key ? '#fff' : '#0F1115',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={sourceTypeFilter}
          onChange={(e) => setSourceTypeFilter(e.target.value)}
          style={{
            height: 32, padding: '0 10px', border: '1px solid #D2D6DC',
            borderRadius: 6, fontSize: 13, background: '#fff',
          }}
        >
          <option value="">All sources</option>
          <option value="DISPUTE">Disputes only</option>
          <option value="RETURN">Returns only</option>
          <option value="GOODWILL">Goodwill only</option>
        </select>
        <input
          type="text"
          value={sourceIdFilter}
          onChange={(e) => setSourceIdFilter(e.target.value)}
          placeholder="Source ID (exact match)"
          style={{
            height: 32, padding: '0 10px', border: '1px solid #D2D6DC',
            borderRadius: 6, fontSize: 13, minWidth: 280,
          }}
        />
      </div>

      {error && (
        <div style={{ padding: 10, marginBottom: 12, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        {loading && rows.length === 0 ? (
          <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>
            No rows match these filters.
          </div>
        ) : tab === 'seller_debit' ? (
          <SellerDebitTable rows={rows as SellerDebitRow[]} />
        ) : tab === 'logistics_claim' ? (
          <LogisticsClaimTable rows={rows as LogisticsClaimRow[]} />
        ) : (
          <PlatformExpenseTable rows={rows as PlatformExpenseRow[]} />
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        {total} total · showing up to 50
      </p>
    </div>
  );
}

function fmtPaise(amountInPaise: string): string {
  const rupees = Number(amountInPaise) / 100;
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function SellerDebitTable({ rows }: { rows: SellerDebitRow[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>
          <Th>Source</Th><Th>Seller</Th><Th>Amount</Th><Th>Status</Th><Th>Reason</Th><Th>Created</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
            <Td><strong>{r.sourceType}</strong> — {r.sourceId.slice(0, 8)}…</Td>
            <Td style={{ fontFamily: 'ui-monospace, monospace' }}>{r.sellerId.slice(0, 8)}…</Td>
            <Td><strong>{fmtPaise(r.amountInPaise)}</strong></Td>
            <Td>{r.status}</Td>
            <Td style={{ maxWidth: 360 }}>{r.reason}</Td>
            <Td style={{ color: '#525A65' }}>{fmtDate(r.createdAt)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LogisticsClaimTable({ rows }: { rows: LogisticsClaimRow[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>
          <Th>Source</Th><Th>Courier</Th><Th>AWB</Th><Th>Amount</Th><Th>Status</Th><Th>Created</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
            <Td><strong>{r.sourceType}</strong> — {r.sourceId.slice(0, 8)}…</Td>
            <Td>{r.courierName ?? '—'}</Td>
            <Td style={{ fontFamily: 'ui-monospace, monospace' }}>{r.awbNumber ?? '—'}</Td>
            <Td><strong>{fmtPaise(r.amountInPaise)}</strong></Td>
            <Td>{r.status}</Td>
            <Td style={{ color: '#525A65' }}>{fmtDate(r.createdAt)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlatformExpenseTable({ rows }: { rows: PlatformExpenseRow[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>
          <Th>Source</Th><Th>Type</Th><Th>Amount</Th><Th>Reason</Th><Th>Created</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
            <Td><strong>{r.sourceType}</strong> — {r.sourceId.slice(0, 8)}…</Td>
            <Td>{r.expenseType}</Td>
            <Td><strong>{fmtPaise(r.amountInPaise)}</strong></Td>
            <Td style={{ maxWidth: 360 }}>{r.reason}</Td>
            <Td style={{ color: '#525A65' }}>{fmtDate(r.createdAt)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '12px 14px', verticalAlign: 'top', ...style }}>{children}</td>;
}
