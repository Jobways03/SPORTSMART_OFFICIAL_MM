'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  supportApi,
  Ticket,
  TicketListPage,
  TicketStatus,
  STATUS_LABEL,
  STATUS_COLOR,
} from '../../../lib/support';

const PAGE_SIZE = 20;
const STATUS_FILTERS: Array<{ value: TicketStatus | ''; label: string }> = [
  { value: '', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'WAITING_ON_CUSTOMER', label: 'Awaiting you' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

export default function AffiliateSupportPage() {
  const [data, setData] = useState<TicketListPage | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supportApi
      .listMyTickets(page, PAGE_SIZE, statusFilter || undefined)
      .then(setData)
      .finally(() => setLoading(false));
  }, [page, statusFilter]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0f172a' }}>Support</h1>
          <p style={{ marginTop: 4, fontSize: 14, color: '#64748b' }}>
            Reach the Sportsmart team about commissions, payouts, KYC, or anything else.
          </p>
        </div>
        <Link href="/dashboard/support/new" style={primaryBtn}>+ New ticket</Link>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || 'all'} type="button"
            onClick={() => { setStatusFilter(f.value); setPage(1); }}
            style={{
              height: 32, padding: '0 14px', borderRadius: 9999, border: '1px solid #cbd5e1',
              background: statusFilter === f.value ? '#0f172a' : '#fff',
              color: statusFilter === f.value ? '#fff' : '#475569',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
              <th style={th}>Ticket</th><th style={th}>Subject</th><th style={th}>Status</th><th style={th}>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#64748b', padding: 32 }}>Loading…</td></tr>
            ) : !data || data.items.length === 0 ? (
              <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: '#64748b', padding: 32 }}>
                No tickets yet. Click "New ticket" to start a conversation.
              </td></tr>
            ) : (
              data.items.map((t: Ticket) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#475569' }}>{t.ticketNumber}</td>
                  <td style={td}>
                    <Link href={`/dashboard/support/${t.id}`} style={{ color: '#0f172a', fontWeight: 600, textDecoration: 'none' }}>
                      {t.subject}
                    </Link>
                  </td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px',
                      borderRadius: 9999, background: STATUS_COLOR[t.status] + '22', color: STATUS_COLOR[t.status],
                      fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td style={{ ...td, color: '#475569', whiteSpace: 'nowrap' }}>
                    {new Date(t.lastMessageAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
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
          <span style={{ fontSize: 14, color: '#475569', padding: '0 8px' }}>{page} / {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={pgBtn(page >= totalPages)}>Next ›</button>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  height: 40, padding: '0 20px', background: '#0f172a', color: '#fff', borderRadius: 9999,
  fontWeight: 600, fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
};
const th: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b',
};
const td: React.CSSProperties = { padding: '14px 16px', fontSize: 14 };
const pgBtn = (disabled: boolean): React.CSSProperties => ({
  height: 36, padding: '0 14px', border: '1px solid #cbd5e1', background: '#fff',
  borderRadius: 9999, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
});
