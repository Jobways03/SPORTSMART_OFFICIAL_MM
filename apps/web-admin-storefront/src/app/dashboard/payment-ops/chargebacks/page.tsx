'use client';

// Phase 169 (Payment Ops audit #1/#2) — chargebacks (Razorpay disputes) surface.
// Pre-169 dispute webhooks were silently dropped; this lists the ingested
// disputes, highlights evidence deadlines, and links to a contest action.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  adminPaymentOpsService,
  Chargeback,
  ChargebackStatus,
  CHARGEBACK_STATUS_COLOR,
  CHARGEBACK_STATUS_LABEL,
  inrFromPaise,
  maskPaymentId,
} from '@/services/admin-payment-ops.service';
import { ApiError } from '@/lib/api-client';

const TABS = [
  { href: '/dashboard/payment-ops', label: 'Mismatches' },
  { href: '/dashboard/payment-ops/failed-payments', label: 'Failed payments' },
  { href: '/dashboard/payment-ops/chargebacks', label: 'Chargebacks', active: true },
];

const STATUS_OPTIONS: Array<{ value: ChargebackStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'OPEN', label: 'Open' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'WON', label: 'Won' },
  { value: 'LOST', label: 'Lost' },
  { value: 'CLOSED', label: 'Closed' },
];

function dueLabel(due: string | null): { text: string; tone: string } {
  if (!due) return { text: '—', tone: '#7A828F' };
  const ms = new Date(due).getTime() - Date.now();
  if (ms < 0) return { text: 'Overdue', tone: '#b91c1c' };
  const hours = Math.round(ms / 3_600_000);
  if (hours < 72) return { text: `${hours}h left`, tone: '#d97706' };
  return { text: `${Math.round(hours / 24)}d left`, tone: '#15803d' };
}

export default function ChargebacksPage() {
  const router = useRouter();
  const [items, setItems] = useState<Chargeback[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<ChargebackStatus | ''>('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminPaymentOpsService.listChargebacks({ page, status: statusFilter || undefined, search: debounced || undefined });
      if (res.data) { setItems(res.data.items); setTotal(res.data.total); }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, debounced, router]);

  useEffect(() => { fetchData(); }, [fetchData]);
  const totalPages = Math.max(1, Math.ceil(total / 20));

  const submitEvidence = async (id: string) => {
    setBusyId(id);
    try {
      await adminPaymentOpsService.submitChargebackEvidence(id, {});
      fetchData();
    } catch {
      /* surfaced via row refresh */
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Payment ops</h1>
      <p style={{ marginTop: 4, marginBottom: 16, fontSize: 14, color: '#525A65' }}>
        Razorpay disputes (chargebacks). Submit contest evidence before the deadline.
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
          placeholder="Search order # / payment id / dispute id / reason"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ height: 40, padding: '0 16px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 14, flex: '1 1 320px' }}
        />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }} style={{ height: 40, padding: '0 14px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 14 }}>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              <th style={th}>Order / Payment</th><th style={th}>Reason</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th>
              <th style={th}>Status</th><th style={th}>Evidence due</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>No chargebacks.</td></tr>
            ) : (
              items.map((c) => {
                const due = dueLabel(c.dueDate);
                const canContest = (c.status === 'OPEN' || c.status === 'UNDER_REVIEW') && c.evidenceStatus === 'PENDING';
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={td}>
                      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600 }}>{c.orderNumber ?? '(unlinked)'}</div>
                      <div
                        style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F', cursor: c.providerPaymentId ? 'copy' : 'default' }}
                        title={c.providerPaymentId ? 'Click to copy full payment id' : undefined}
                        onClick={() => c.providerPaymentId && navigator.clipboard?.writeText(c.providerPaymentId)}
                      >{maskPaymentId(c.providerPaymentId)}</div>
                    </td>
                    <td style={td}>{c.reasonCode ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{inrFromPaise(c.amountInPaise)}</td>
                    <td style={td}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 9999,
                        background: CHARGEBACK_STATUS_COLOR[c.status] + '22', color: CHARGEBACK_STATUS_COLOR[c.status],
                        fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                      }}>{CHARGEBACK_STATUS_LABEL[c.status]}</span>
                      <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}>{c.evidenceStatus.replace('_', ' ').toLowerCase()}</div>
                    </td>
                    <td style={{ ...td, color: due.tone, fontWeight: 600 }}>{due.text}</td>
                    <td style={td}>
                      {canContest && (
                        <button
                          type="button"
                          onClick={() => submitEvidence(c.id)}
                          disabled={busyId === c.id}
                          style={{ height: 32, padding: '0 12px', border: 'none', background: '#0F1115', color: '#fff', borderRadius: 9999, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: busyId === c.id ? 0.5 : 1 }}
                        >{busyId === c.id ? '…' : 'Mark evidence submitted'}</button>
                      )}
                    </td>
                  </tr>
                );
              })
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
