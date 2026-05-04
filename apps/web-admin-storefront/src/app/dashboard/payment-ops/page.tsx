'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  adminPaymentOpsService,
  PaymentMismatchAlert,
  PaymentMismatchStatus,
  PaymentMismatchKind,
  PaymentOpsMetrics,
  STATUS_COLOR,
  KIND_LABEL,
  inrFromPaise,
} from '@/services/admin-payment-ops.service';
import { ApiError } from '@/lib/api-client';

const STATUS_OPTIONS: Array<{ value: PaymentMismatchStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'IGNORED', label: 'Ignored' },
];

const KIND_OPTIONS: Array<{ value: PaymentMismatchKind | ''; label: string }> = [
  { value: '', label: 'All kinds' },
  { value: 'AMOUNT_MISMATCH', label: 'Amount mismatch' },
  { value: 'CURRENCY_MISMATCH', label: 'Currency mismatch' },
  { value: 'DUPLICATE_PAYMENT', label: 'Duplicate payment' },
  { value: 'ORPHAN_PAYMENT', label: 'Orphan payment' },
  { value: 'SIGNATURE_INVALID', label: 'Invalid signature' },
];

export default function PaymentOpsAlertsPage() {
  const router = useRouter();
  const [items, setItems] = useState<PaymentMismatchAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<PaymentMismatchStatus | ''>('OPEN');
  const [kindFilter, setKindFilter] = useState<PaymentMismatchKind | ''>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<PaymentOpsMetrics | null>(null);

  // 300ms debounce for the free-text search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminPaymentOpsService.listAlerts({
        page, limit: 20,
        status: statusFilter || undefined,
        kind: kindFilter || undefined,
        search: debouncedSearch || undefined,
      });
      if (res.data) {
        setItems(res.data.items);
        setTotal(res.data.total);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, kindFilter, debouncedSearch, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Metrics summary refreshes when the alerts page does.
  useEffect(() => {
    void adminPaymentOpsService.metrics(7).then((res) => {
      if (res.data) setMetrics(res.data);
    }).catch(() => undefined);
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  // Roll up the per-day attempts/alerts into headline numbers.
  const summary = (() => {
    if (!metrics) return null;
    let total = 0, success = 0, failure = 0;
    for (const r of metrics.attempts) {
      total += r.count;
      if (r.status === 'SUCCESS') success += r.count;
      else failure += r.count;
    }
    const alertCount = metrics.alerts.reduce((sum, r) => sum + r.count, 0);
    const successRate = total > 0 ? Math.round((success / total) * 1000) / 10 : null;
    return { total, success, failure, alertCount, successRate };
  })();

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Payment ops</h1>
      <p style={{ marginTop: 4, marginBottom: 16, fontSize: 14, color: '#525A65' }}>
        Mismatches and signature failures detected on the gateway.
      </p>

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 20 }}>
          <Stat label="Attempts (7d)" value={summary.total.toLocaleString('en-IN')} />
          <Stat
            label="Success rate"
            value={summary.successRate == null ? '—' : `${summary.successRate}%`}
            tone={summary.successRate == null ? 'neutral' : summary.successRate >= 95 ? 'good' : 'bad'}
          />
          <Stat label="Failures (7d)" value={summary.failure.toLocaleString('en-IN')} tone={summary.failure > 0 ? 'bad' : 'neutral'} />
          <Stat label="Alerts created (7d)" value={summary.alertCount.toLocaleString('en-IN')} tone={summary.alertCount > 0 ? 'bad' : 'good'} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search order # / payment id / description"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ ...selectStyle, flex: '1 1 320px', minWidth: 240, paddingLeft: 16 }}
        />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }} style={selectStyle}>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={kindFilter} onChange={(e) => { setKindFilter(e.target.value as any); setPage(1); }} style={selectStyle}>
          {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              <th style={th}>Kind</th><th style={th}>Order / Payment</th>
              <th style={{ ...th, textAlign: 'right' }}>Expected</th>
              <th style={{ ...th, textAlign: 'right' }}>Actual</th>
              <th style={th}>Status</th><th style={th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>
                No alerts. Either everything's fine or no payments have flowed yet.
              </td></tr>
            ) : (
              items.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }} onClick={() => router.push(`/dashboard/payment-ops/${a.id}`)}>
                  <td style={td}>
                    <div style={{ fontWeight: 600, color: '#0F1115' }}>{KIND_LABEL[a.kind]}</div>
                    <div style={{ fontSize: 12, color: '#7A828F' }}>severity {a.severity}</div>
                  </td>
                  <td style={td}>
                    <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#0F1115', fontWeight: 600 }}>{a.orderNumber ?? '(orphan)'}</div>
                    <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F' }}>{a.providerPaymentId ?? '—'}</div>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inrFromPaise(a.expectedInPaise)}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#b91c1c', fontWeight: 600 }}>{inrFromPaise(a.actualInPaise)}</td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 9999,
                      background: STATUS_COLOR[a.status] + '22', color: STATUS_COLOR[a.status],
                      fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>{a.status.replace('_', ' ')}</span>
                  </td>
                  <td style={{ ...td, color: '#525A65', whiteSpace: 'nowrap' }}>
                    {new Date(a.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={pgBtn(page <= 1)}>‹ Prev</button>
          <span style={{ fontSize: 14, color: '#525A65', padding: '0 8px' }}>{page} / {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={pgBtn(page >= totalPages)}>Next ›</button>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#525A65' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: 14 };
const selectStyle: React.CSSProperties = { height: 40, padding: '0 14px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 14, outline: 'none' };
const pgBtn = (disabled: boolean): React.CSSProperties => ({
  height: 36, padding: '0 14px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
});

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'neutral';
}) {
  const accent =
    tone === 'good' ? '#15803d' : tone === 'bad' ? '#b91c1c' : '#0F1115';
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}
