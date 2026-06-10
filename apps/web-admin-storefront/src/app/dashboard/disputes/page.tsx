'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  adminDisputesService,
  Dispute,
  DisputeKind,
  DisputeStatus,
  STATUS_COLOR,
  KIND_LABEL,
} from '@/services/admin-disputes.service';
import { ApiError } from '@/lib/api-client';

const STATUS_OPTIONS: Array<{ value: DisputeStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'OPEN', label: 'Open' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'AWAITING_INFO', label: 'Awaiting info' },
  { value: 'RESOLVED_BUYER', label: 'Resolved (buyer)' },
  { value: 'RESOLVED_SELLER', label: 'Resolved (seller)' },
  { value: 'RESOLVED_SPLIT', label: 'Resolved (split)' },
  { value: 'CLOSED', label: 'Closed' },
];

export default function DisputeQueuePage() {
  const router = useRouter();
  const [items, setItems] = useState<Dispute[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<DisputeStatus | ''>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (override?: { search?: string; page?: number }) => {
    setLoading(true);
    try {
      const res = await adminDisputesService.list({
        page: override?.page ?? page, limit: 20,
        status: statusFilter || undefined,
        search: override?.search ?? search,
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
  }, [page, statusFilter, search, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onSearch = (v: string) => {
    setSearch(v);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => { setPage(1); fetchData({ search: v, page: 1 }); }, 300);
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Disputes</h1>
      <p style={{ marginTop: 4, marginBottom: 16, fontSize: 14, color: '#525A65' }}>
        Formal escalations from buyers and sellers requiring an admin decision.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }} style={selectStyle}>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input type="text" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search dispute #, summary, filer…"
          style={{ ...selectStyle, flex: 1, minWidth: 260 }} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              <th style={th}>Dispute</th><th style={th}>Kind</th><th style={th}>Filed by</th>
              <th style={th}>Status</th><th style={{ ...th, textAlign: 'right' }}>Severity</th><th style={th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>No disputes match these filters.</td></tr>
            ) : (
              items.map((d) => (
                <DisputeRow key={d.id} d={d} onOpen={() => router.push(`/dashboard/disputes/${d.id}`)} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={() => { setPage((p) => Math.max(1, p - 1)); fetchData({ page: Math.max(1, page - 1) }); }} disabled={page <= 1} style={pgBtn(page <= 1)}>‹ Prev</button>
          <span style={{ fontSize: 14, color: '#525A65', padding: '0 8px' }}>{page} / {totalPages}</span>
          <button type="button" onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); fetchData({ page: Math.min(totalPages, page + 1) }); }} disabled={page >= totalPages} style={pgBtn(page >= totalPages)}>Next ›</button>
        </div>
      )}
    </div>
  );
}

// One dispute row. The whole row is clickable (router.push to the detail
// page); a hover highlight + the link-styled dispute number + the trailing
// chevron make it obvious the row drills in. The inner dispute-number <Link>
// stops propagation so a direct click on it (or right-click → open in new
// tab) doesn't also fire the row's onOpen.
function DisputeRow({ d, onOpen }: { d: Dispute; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <tr
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderBottom: '1px solid #F3F4F6',
        cursor: 'pointer',
        background: hover ? '#F6F8FA' : 'transparent',
        transition: 'background 120ms',
      }}
    >
      <td style={td}>
        <Link
          href={`/dashboard/disputes/${d.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600,
            color: '#2563EB', textDecoration: hover ? 'underline' : 'none',
          }}
        >
          {d.disputeNumber}
        </Link>
        <div style={{ color: '#0F1115', fontWeight: 600, marginTop: 2 }}>
          {d.summary.length > 60 ? d.summary.slice(0, 57) + '…' : d.summary}
        </div>
      </td>
      <td style={td}>{KIND_LABEL[d.kind]}</td>
      <td style={td}>
        <div style={{ fontWeight: 600, color: '#0F1115' }}>{d.filedByName}</div>
        <div style={{ fontSize: 11, color: '#7A828F' }}>{d.filedByType.toLowerCase()}</div>
      </td>
      <td style={td}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 9999,
          background: STATUS_COLOR[d.status] + '22', color: STATUS_COLOR[d.status],
          fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>{d.status.replace('_', ' ').toLowerCase()}</span>
      </td>
      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: d.severity >= 80 ? '#b91c1c' : '#0F1115' }}>{d.severity}</td>
      <td style={{ ...td, color: '#525A65', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          {new Date(d.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          <span aria-hidden style={{ fontSize: 16, fontWeight: 700, color: hover ? '#2563EB' : '#C2C8D0', transition: 'color 120ms' }}>›</span>
        </span>
      </td>
    </tr>
  );
}

const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#525A65' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: 14 };
const selectStyle: React.CSSProperties = { height: 40, padding: '0 14px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 14, outline: 'none' };
const pgBtn = (disabled: boolean): React.CSSProperties => ({
  height: 36, padding: '0 14px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
});
