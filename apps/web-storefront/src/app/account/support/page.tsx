'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  LifeBuoy,
  Loader2,
  AlertCircle,
  Plus,
  ChevronRight,
} from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  supportService,
  Ticket,
  TicketStatus,
  STATUS_LABEL,
} from '@/services/support.service';

const STATUS_COLORS: Record<TicketStatus, string> = {
  OPEN: '#0ea5e9',
  IN_PROGRESS: '#f59e0b',
  WAITING_ON_CUSTOMER: '#dc2626',
  RESOLVED: '#16a34a',
  CLOSED: '#6b7280',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SupportListPage() {
  const authStatus = useAuthGuard();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TicketStatus | 'ALL'>('ALL');

  useEffect(() => {
    if (authStatus !== 'authed') return;
    setLoading(true);
    supportService
      .listMyTickets(1, 50, filter === 'ALL' ? undefined : filter)
      .then((res) => {
        if (res.data) setTickets(res.data.items);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [authStatus, filter]);

  if (authStatus === 'checking') {
    return (
      <StorefrontShell>
        <div className="container-x py-16 text-center text-ink-600">Loading…</div>
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12">
        <nav className="text-caption text-ink-600 mb-4">
          <Link href="/account" className="hover:text-ink-900">My Account</Link>
          <span className="mx-2">›</span>
          <span className="text-ink-900 font-medium">Support</span>
        </nav>

        <div className="flex items-baseline justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-h1 text-ink-900">Support</h1>
            <p className="text-body text-ink-600 mt-1">
              We usually reply within a few hours.
            </p>
          </div>
          <Link
            href="/account/support/new"
            className="inline-flex items-center gap-2 bg-ink-900 text-white px-4 py-2.5 rounded-full text-body font-medium hover:bg-ink-800 transition-colors"
          >
            <Plus className="size-4" />
            New ticket
          </Link>
        </div>

        {/* Status pill filter */}
        <div className="flex flex-wrap gap-2 mb-6">
          {(['ALL', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-full text-caption font-medium border transition-colors ${
                filter === s
                  ? 'bg-ink-900 text-white border-ink-900'
                  : 'bg-white text-ink-700 border-ink-200 hover:border-ink-400'
              }`}
            >
              {s === 'ALL' ? 'All' : STATUS_LABEL[s as TicketStatus]}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-ink-500">
            <Loader2 className="size-5 animate-spin" />
            <span className="ml-2 text-body">Loading tickets…</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-body text-red-800">
            <AlertCircle className="size-5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && tickets.length === 0 && (
          <div className="rounded-2xl border border-dashed border-ink-300 bg-ink-50 p-10 text-center">
            <LifeBuoy className="mx-auto size-10 text-ink-400" />
            <h3 className="mt-4 font-display text-h3 text-ink-900">
              {filter === 'ALL' ? 'No tickets yet' : `No ${STATUS_LABEL[filter as TicketStatus].toLowerCase()} tickets`}
            </h3>
            <p className="mt-2 text-body text-ink-600">
              Need help with an order, payment, or your account? We're here.
            </p>
            <Link
              href="/account/support/new"
              className="inline-flex items-center gap-2 mt-5 bg-ink-900 text-white px-5 py-2.5 rounded-full text-body font-medium hover:bg-ink-800"
            >
              <Plus className="size-4" />
              Open your first ticket
            </Link>
          </div>
        )}

        {!loading && !error && tickets.length > 0 && (
          <ul className="bg-white rounded-2xl border border-ink-200 overflow-hidden divide-y divide-ink-100">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/account/support/${t.id}`}
                  className="flex items-center gap-4 p-4 hover:bg-ink-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                        style={{
                          background: STATUS_COLORS[t.status] + '15',
                          color: STATUS_COLORS[t.status],
                        }}
                      >
                        {STATUS_LABEL[t.status]}
                      </span>
                      <code className="text-caption text-ink-500">{t.ticketNumber}</code>
                    </div>
                    <div className="text-body font-medium text-ink-900 truncate">{t.subject}</div>
                    <div className="text-caption text-ink-500 mt-1">
                      Updated {timeAgo(t.lastMessageAt)}
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-ink-400 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </StorefrontShell>
  );
}
