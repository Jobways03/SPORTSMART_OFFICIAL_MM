'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  adminSupportService,
  AdminTicket,
  AdminTicketFilters,
  STATUS_LABEL,
  STATUS_COLOR,
  PRIORITY_COLOR,
  TicketStatus,
  TicketPriority,
} from '@/services/admin-support.service';
import { ApiError } from '@/lib/api-client';

interface Pagination {
  page: number;
  limit: number;
  total: number;
}

const STATUS_OPTIONS: Array<{ value: TicketStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'WAITING_ON_CUSTOMER', label: 'Awaiting customer' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

const PRIORITY_OPTIONS: Array<{ value: TicketPriority | ''; label: string }> = [
  { value: '', label: 'All priorities' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'HIGH', label: 'High' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'LOW', label: 'Low' },
];

export default function SupportQueuePage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<AdminTicketFilters>({
    page: 1,
    status: '',
    priority: '',
    assignedAdminId: '',
    search: '',
  });
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTickets = useCallback(
    async (override: AdminTicketFilters = {}) => {
      setLoading(true);
      setError('');
      try {
        const merged: AdminTicketFilters = { ...filters, ...override };
        const res = await adminSupportService.listTickets(merged);
        if (res.data) {
          setTickets(res.data.items);
          setPagination({
            page: res.data.page,
            limit: res.data.limit,
            total: res.data.total,
          });
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load tickets');
      } finally {
        setLoading(false);
      }
    },
    [filters, router],
  );

  useEffect(() => {
    fetchTickets({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateFilter = (patch: Partial<AdminTicketFilters>) => {
    const next = { ...filters, ...patch, page: 1 };
    setFilters(next);
    fetchTickets(next);
  };

  const onSearchChange = (v: string) => {
    setFilters((f) => ({ ...f, search: v }));
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchTickets({ search: v, page: 1 });
    }, 300);
  };

  const goToPage = (p: number) => {
    fetchTickets({ page: p });
    setFilters((f) => ({ ...f, page: p }));
  };

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit));

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>
            Support Queue
          </h1>
          <p style={{ marginTop: 4, fontSize: 14, color: '#525A65' }}>
            {pagination.total.toLocaleString('en-IN')} ticket{pagination.total === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <select
          value={filters.status || ''}
          onChange={(e) => updateFilter({ status: e.target.value as any })}
          style={selectStyle}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={filters.priority || ''}
          onChange={(e) => updateFilter({ priority: e.target.value as any })}
          style={selectStyle}
        >
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={filters.assignedAdminId || ''}
          onChange={(e) => updateFilter({ assignedAdminId: e.target.value as any })}
          style={selectStyle}
        >
          <option value="">All assignees</option>
          <option value="unassigned">Unassigned only</option>
        </select>
        <input
          type="text"
          value={filters.search || ''}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search ticket #, subject, email…"
          style={{ ...selectStyle, flex: 1, minWidth: 260 }}
        />
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            border: '1px solid #fca5a5',
            background: '#fef2f2',
            color: '#b91c1c',
            borderRadius: 12,
            fontSize: 14,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              <th style={th}>Ticket</th>
              <th style={th}>Subject</th>
              <th style={th}>From</th>
              <th style={th}>Priority</th>
              <th style={th}>Status</th>
              <th style={th}>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {loading && tickets.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>
                  Loading tickets…
                </td>
              </tr>
            ) : tickets.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>
                  No tickets match your filters.
                </td>
              </tr>
            ) : (
              tickets.map((t) => (
                <tr
                  key={t.id}
                  style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }}
                  onClick={() => router.push(`/dashboard/support/${t.id}`)}
                >
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#525A65' }}>
                    {t.ticketNumber}
                  </td>
                  <td style={td}>
                    <Link
                      href={`/dashboard/support/${t.id}`}
                      style={{ color: '#0F1115', fontWeight: 600, textDecoration: 'none' }}
                    >
                      {t.subject}
                    </Link>
                  </td>
                  <td style={td}>
                    <div style={{ color: '#0F1115', fontWeight: 500 }}>{t.creatorName}</div>
                    <div style={{ color: '#7A828F', fontSize: 12 }}>
                      {t.creatorType.charAt(0) + t.creatorType.slice(1).toLowerCase()} ·{' '}
                      {t.creatorEmail}
                    </div>
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        height: 22,
                        padding: '0 8px',
                        borderRadius: 9999,
                        background: PRIORITY_COLOR[t.priority] + '22',
                        color: PRIORITY_COLOR[t.priority],
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {t.priority}
                    </span>
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        height: 22,
                        padding: '0 8px',
                        borderRadius: 9999,
                        background: STATUS_COLOR[t.status] + '22',
                        color: STATUS_COLOR[t.status],
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td style={{ ...td, color: '#525A65', whiteSpace: 'nowrap' }}>
                    {new Date(t.lastMessageAt).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={() => goToPage(Math.max(1, pagination.page - 1))}
            disabled={pagination.page <= 1 || loading}
            style={paginationBtn(pagination.page <= 1)}
          >
            ‹ Prev
          </button>
          <span style={{ fontSize: 14, color: '#525A65', padding: '0 8px', fontVariantNumeric: 'tabular-nums' }}>
            {pagination.page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => goToPage(Math.min(totalPages, pagination.page + 1))}
            disabled={pagination.page >= totalPages || loading}
            style={paginationBtn(pagination.page >= totalPages)}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#525A65',
};

const td: React.CSSProperties = {
  padding: '14px 16px',
  fontSize: 14,
};

const selectStyle: React.CSSProperties = {
  height: 40,
  padding: '0 14px',
  border: '1px solid #D2D6DC',
  background: '#fff',
  borderRadius: 9999,
  fontSize: 14,
  outline: 'none',
};

const paginationBtn = (disabled: boolean): React.CSSProperties => ({
  height: 36,
  padding: '0 14px',
  border: '1px solid #D2D6DC',
  background: '#fff',
  borderRadius: 9999,
  fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.4 : 1,
});
