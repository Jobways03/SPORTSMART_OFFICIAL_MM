'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  LifeBuoy,
  Plus,
  ChevronRight,
  ChevronLeft,
  MessageSquare,
} from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  supportService,
  Ticket,
  TicketListPage,
  TicketStatus,
  STATUS_LABEL,
} from '@/services/support.service';

const PAGE_SIZE = 20;

const STATUS_FILTERS: Array<{ value: TicketStatus | ''; label: string }> = [
  { value: '', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'WAITING_ON_CUSTOMER', label: 'Awaiting you' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

const STATUS_TONE: Record<TicketStatus, { fg: string; bg: string }> = {
  OPEN: { fg: 'text-warning', bg: 'bg-gold-soft' },
  IN_PROGRESS: { fg: 'text-accent-dark', bg: 'bg-accent-soft' },
  WAITING_ON_CUSTOMER: { fg: 'text-sale-dark', bg: 'bg-sale-soft' },
  RESOLVED: { fg: 'text-success', bg: 'bg-green-50' },
  CLOSED: { fg: 'text-ink-600', bg: 'bg-ink-100' },
};

export default function MyTicketsPage() {
  const authStatus = useAuthGuard();
  const [data, setData] = useState<TicketListPage | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    setLoading(true);
    supportService
      .listMyTickets(page, PAGE_SIZE, statusFilter || undefined)
      .then((res) => res.data && setData(res.data))
      .finally(() => setLoading(false));
  }, [authStatus, page, statusFilter]);

  if (authStatus === 'checking') {
    return (
      <StorefrontShell>
        <div className="container-x py-16 text-center text-ink-600">Loading…</div>
      </StorefrontShell>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12">
        <nav className="text-caption text-ink-600 mb-4">
          <Link href="/account" className="hover:text-ink-900">My Account</Link>
          <span className="mx-2">›</span>
          <span className="text-ink-900 font-medium">Help & Support</span>
        </nav>

        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-h1 text-ink-900">Help & Support</h1>
            <p className="mt-2 text-body-lg text-ink-600">
              Track your support tickets and start a new conversation with our team.
            </p>
          </div>
          <Link
            href="/help/tickets/new"
            className="hidden sm:inline-flex items-center gap-2 h-12 px-6 bg-ink-900 text-white font-semibold hover:bg-ink-800 rounded-full transition-colors"
          >
            <Plus className="size-4" strokeWidth={2.5} />
            New ticket
          </Link>
        </div>

        {/* Status filter chips */}
        <div className="flex flex-wrap gap-2 mb-6">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => {
                setStatusFilter(f.value);
                setPage(1);
              }}
              className={`inline-flex items-center h-9 px-4 text-body font-medium rounded-full border transition-colors ${
                statusFilter === f.value
                  ? 'bg-ink-900 text-white border-ink-900'
                  : 'bg-white text-ink-700 border-ink-300 hover:border-ink-900'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && !data ? (
          <div className="text-center py-16 text-ink-600">Loading…</div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <ul className="space-y-3">
              {data.items.map((t) => (
                <TicketRow key={t.id} ticket={t} />
              ))}
            </ul>

            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  type="button"
                  aria-label="Previous page"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="size-10 grid place-items-center border border-ink-300 hover:border-ink-900 disabled:opacity-40 rounded-full transition-colors"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-body text-ink-700 tabular px-2">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  aria-label="Next page"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="size-10 grid place-items-center border border-ink-300 hover:border-ink-900 disabled:opacity-40 rounded-full transition-colors"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </>
        )}

        {/* Mobile floating new-ticket button */}
        <Link
          href="/help/tickets/new"
          aria-label="New ticket"
          className="sm:hidden fixed bottom-6 right-6 size-14 grid place-items-center bg-ink-900 text-white rounded-full shadow-lg hover:bg-ink-800"
        >
          <Plus className="size-6" strokeWidth={2.5} />
        </Link>
      </div>
    </StorefrontShell>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-ink-200 rounded-2xl py-16 text-center">
      <div className="size-16 mx-auto rounded-full bg-accent-soft grid place-items-center mb-4">
        <LifeBuoy className="size-7 text-accent-dark" strokeWidth={1.5} />
      </div>
      <h3 className="font-display text-h3 text-ink-900">No tickets yet</h3>
      <p className="mt-2 max-w-sm mx-auto text-body text-ink-600">
        Have a question or an issue with an order? Open a ticket and we'll get back
        to you within one business day.
      </p>
      <Link
        href="/help/tickets/new"
        className="mt-5 inline-flex items-center gap-2 h-11 px-5 bg-ink-900 text-white font-semibold hover:bg-ink-800 rounded-full transition-colors"
      >
        <Plus className="size-4" strokeWidth={2.5} />
        Open a ticket
      </Link>
    </div>
  );
}

function TicketRow({ ticket }: { ticket: Ticket }) {
  const tone = STATUS_TONE[ticket.status];
  return (
    <li>
      <Link
        href={`/help/tickets/${ticket.id}`}
        className="group block bg-white border border-ink-200 hover:border-ink-900 transition-colors rounded-2xl p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-caption text-ink-500 font-mono uppercase tracking-wider">
                {ticket.ticketNumber}
              </span>
              <span
                className={`inline-flex items-center h-5 px-2 text-[10px] font-semibold uppercase tracking-wider rounded-full ${tone.bg} ${tone.fg}`}
              >
                {STATUS_LABEL[ticket.status]}
              </span>
              {ticket.priority === 'HIGH' || ticket.priority === 'URGENT' ? (
                <span className="inline-flex items-center h-5 px-2 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-sale text-white">
                  {ticket.priority}
                </span>
              ) : null}
            </div>
            <h3 className="text-body-lg font-semibold text-ink-900 truncate">
              {ticket.subject}
            </h3>
            <p className="mt-1 text-caption text-ink-600">
              Last updated{' '}
              {new Date(ticket.lastMessageAt).toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
          <ChevronRight className="size-5 text-ink-400 mt-1 shrink-0 group-hover:text-ink-900 group-hover:translate-x-0.5 transition-all" />
        </div>
      </Link>
    </li>
  );
}
