'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { adminAccountsService, formatINR, OutstandingPayables } from '@/services/admin-accounts.service';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api/v1';

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#b91c1c', HIGH: '#c2410c', MEDIUM: '#b45309', LOW: '#15803d',
};
const BUCKET_LABEL: Record<string, string> = {
  not_due: 'Not yet due', '0-7': '0–7 days overdue', '8-15': '8–15 days', '16-30': '16–30 days', '30+': '30+ days',
};

export default function PayablesAgingPage() {
  const [asOfDate, setAsOfDate] = useState('');
  const [data, setData] = useState<OutstandingPayables | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminAccountsService.getOutstanding(asOfDate || undefined);
      if (res.data) setData(res.data);
      else setErr(res.message || 'Failed to load payables');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load outstanding payables');
    } finally {
      setLoading(false);
    }
  }, [asOfDate]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: '24px 32px' }}>
      <Link href="/dashboard/accounts" style={{ fontSize: 13, color: '#525A65', textDecoration: 'none' }}>← Accounts overview</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Outstanding payables — aging</h1>
          <p style={{ marginTop: 4, marginBottom: 0, fontSize: 14, color: '#525A65' }}>
            Net of TCS / TDS / commission-GST. Overdue is measured against each settlement&apos;s payout-due date.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#525A65', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>As of</label>
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #D2D6DC', borderRadius: 8, fontSize: 13 }} />
          </div>
          <a href={`${API_BASE}${adminAccountsService.payablesAgingCsvUrl(asOfDate || undefined)}`} download style={downloadBtn}>⬇ Aging CSV</a>
        </div>
      </div>

      {err && <div style={{ marginTop: 16, color: '#dc2626', fontSize: 13 }}>{err}</div>}

      {loading && !data ? (
        <div style={{ padding: 32, color: '#7A828F' }}>Loading…</div>
      ) : data ? (
        <>
          {/* Top KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 20 }}>
            <Kpi label="Total outstanding (net)" value={formatINR(data.totalOutstanding)} />
            <Kpi label="Overdue" value={formatINR(data.aging.overdue.amount)} tone="bad" sub={`${data.aging.overdue.count} settlements`} />
            <Kpi label="To sellers" value={formatINR(data.sellerOutstanding.amount)} sub={`${data.sellerOutstanding.count}`} />
            <Kpi label="To franchises" value={formatINR(data.franchiseOutstanding.amount)} sub={`${data.franchiseOutstanding.count}`} />
          </div>

          {/* Aging buckets */}
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0F1115', margin: '24px 0 12px' }}>Aging buckets</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            {data.aging.buckets.map((b) => {
              const color = b.severity ? SEVERITY_COLOR[b.severity] ?? '#0F1115' : '#525A65';
              return (
                <div key={b.bucket} style={{ background: '#fff', border: `1px solid ${b.severity ? color + '55' : '#E5E7EB'}`, borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, color: '#7A828F', fontWeight: 600 }}>{BUCKET_LABEL[b.bucket] ?? b.bucket}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{formatINR(b.amount)}</div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{b.count} settlement(s)</span>
                    {b.severity && <span style={{ color, fontWeight: 700 }}>{b.severity}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Frozen / failed */}
          <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '12px 16px' }}>
              <span style={{ fontSize: 12, color: '#525A65', fontWeight: 600 }}>Frozen (ON_HOLD): </span>
              <strong style={{ color: '#b45309' }}>{data.frozen.count}</strong>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}> — excluded from overdue</span>
            </div>
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '12px 16px' }}>
              <span style={{ fontSize: 12, color: '#525A65', fontWeight: 600 }}>Failed payouts: </span>
              <strong style={{ color: '#b91c1c' }}>{data.failed.count}</strong>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}> — need retry</span>
            </div>
            {data.oldestUnpaidDate && (
              <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '12px 16px' }}>
                <span style={{ fontSize: 12, color: '#525A65', fontWeight: 600 }}>Oldest overdue due-date: </span>
                <strong>{new Date(data.oldestUnpaidDate).toLocaleDateString('en-IN')}</strong>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const accent = tone === 'good' ? '#15803d' : tone === 'bad' ? '#b91c1c' : '#0F1115';
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const downloadBtn: React.CSSProperties = { fontSize: 13, color: '#0F1115', border: '1px solid #D2D6DC', borderRadius: 6, padding: '8px 14px', textDecoration: 'none', background: '#fff' };
