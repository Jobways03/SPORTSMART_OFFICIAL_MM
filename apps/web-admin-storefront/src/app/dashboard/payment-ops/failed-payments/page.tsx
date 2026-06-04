'use client';

// Phase 169 (Payment Ops audit #3) — the failed-payments surface. Pre-169
// failed PaymentAttempt rows were only reachable by drill-down on a known
// order; this lists the gateway-failure attempts directly.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  adminPaymentOpsService,
  PaymentAttempt,
  inrFromPaise,
  maskPaymentId,
} from '@/services/admin-payment-ops.service';
import { ApiError } from '@/lib/api-client';

const TABS = [
  { href: '/dashboard/payment-ops', label: 'Mismatches' },
  { href: '/dashboard/payment-ops/failed-payments', label: 'Failed payments', active: true },
  { href: '/dashboard/payment-ops/chargebacks', label: 'Chargebacks' },
];

export default function FailedPaymentsPage() {
  const router = useRouter();
  const [items, setItems] = useState<PaymentAttempt[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminPaymentOpsService.listFailedPayments({ page, search: debounced || undefined });
      if (res.data) { setItems(res.data.items); setTotal(res.data.total); }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
    } finally {
      setLoading(false);
    }
  }, [page, debounced, router]);

  useEffect(() => { fetchData(); }, [fetchData]);
  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Payment ops</h1>
      <p style={{ marginTop: 4, marginBottom: 16, fontSize: 14, color: '#525A65' }}>
        Gateway payment attempts that failed (create-order / capture / verify).
      </p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #E5E7EB' }}>
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} style={{
            padding: '8px 16px', fontSize: 14, fontWeight: 600, textDecoration: 'none',
            color: t.active ? '#0F1115' : '#7A828F',
            borderBottom: t.active ? '2px solid #0F1115' : '2px solid transparent',
          }}>{t.label}</Link>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search order # / payment id / failure reason"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ height: 40, padding: '0 16px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 14, flex: '1 1 320px' }}
        />
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              <th style={th}>Kind</th><th style={th}>Order / Payment</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th>
              <th style={th}>Failure reason</th><th style={th}>When</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>No failed payments.</td></tr>
            ) : (
              items.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={td}><span style={{ fontWeight: 600 }}>{a.kind.replace('_', ' ')}</span><div style={{ fontSize: 11, color: '#7A828F' }}>attempt #{a.attemptNumber}</div></td>
                  <td style={td}>
                    <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600 }}>{a.orderNumber ?? '(orphan)'}</div>
                    <div
                      style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', cursor: a.providerPaymentId ? 'copy' : 'default' }}
                      title={a.providerPaymentId ? 'Click to copy full payment id' : undefined}
                      onClick={() => a.providerPaymentId && navigator.clipboard?.writeText(a.providerPaymentId)}
                    >{maskPaymentId(a.providerPaymentId)}</div>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inrFromPaise(a.amountInPaise)}</td>
                  <td style={{ ...td, color: '#b91c1c', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.failureReason ?? ''}>{a.failureReason ?? '—'}</td>
                  <td style={{ ...td, color: '#525A65', whiteSpace: 'nowrap' }}>{new Date(a.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
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
const pgBtn = (disabled: boolean): React.CSSProperties => ({
  height: 36, padding: '0 14px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
});
