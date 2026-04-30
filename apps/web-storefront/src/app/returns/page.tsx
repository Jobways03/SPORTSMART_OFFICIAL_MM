'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  PackageOpen,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { returnsService, ListReturnsResponse, getReturnStatusLabel } from '@/services/returns.service';

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '',                  label: 'All' },
  { value: 'REQUESTED',         label: 'Pending review' },
  { value: 'APPROVED',          label: 'Approved' },
  { value: 'IN_TRANSIT',        label: 'In transit' },
  { value: 'RECEIVED',          label: 'Received' },
  { value: 'REFUNDED',          label: 'Refunded' },
  { value: 'COMPLETED',         label: 'Completed' },
  { value: 'REJECTED',          label: 'Rejected' },
  { value: 'CANCELLED',         label: 'Cancelled' },
];

type Tone = 'success' | 'progress' | 'pending' | 'cancelled';

const TONE_CHIP: Record<Tone, string> = {
  success:   'bg-green-50 text-success border border-green-200',
  progress:  'bg-accent-soft text-accent-dark border border-accent/30',
  pending:   'bg-ink-100 text-ink-700 border border-ink-200',
  cancelled: 'bg-red-50 text-danger border border-red-200',
};

function returnTone(status: string): Tone {
  if (['REJECTED', 'QC_REJECTED', 'CANCELLED'].includes(status)) return 'cancelled';
  if (['REFUNDED', 'COMPLETED', 'QC_APPROVED'].includes(status))  return 'success';
  if (['IN_TRANSIT', 'PICKUP_SCHEDULED', 'REFUND_PROCESSING', 'APPROVED', 'PARTIALLY_APPROVED', 'RECEIVED'].includes(status))
    return 'progress';
  return 'pending';
}

export default function ReturnsPage() {
  const router = useRouter();
  const [data, setData] = useState<ListReturnsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchReturns = (p: number, status: string) => {
    setLoading(true);
    returnsService
      .list(p, 20, status || undefined)
      .then((res) => {
        if (res.data) setData(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('accessToken')) {
        router.push('/login');
        return;
      }
    } catch {
      router.push('/login');
      return;
    }
    fetchReturns(page, statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter]);

  const formatPrice = (price: number | null) =>
    price == null ? '–' : `₹${Number(price).toLocaleString('en-IN')}`;
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  if (loading && !data) {
    return (
      <StorefrontShell>
        <div className="container-x py-12">
          <div className="h-8 w-44 bg-ink-100 animate-pulse mb-3" />
          <div className="h-4 w-64 bg-ink-100 animate-pulse mb-8" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-ink-100 animate-pulse" />
            ))}
          </div>
        </div>
      </StorefrontShell>
    );
  }

  const isEmpty = !data || data.returns.length === 0;

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12">
        {/* Breadcrumb */}
        <div className="text-caption uppercase tracking-wider text-ink-600 mb-3">
          <Link href="/" className="hover:text-ink-900">
            Home
          </Link>
          {' / '}
          <Link href="/orders" className="hover:text-ink-900">
            Orders
          </Link>
          {' / '}
          <span className="text-ink-900">Returns</span>
        </div>

        {/* Header */}
        <div className="flex items-end justify-between gap-4 flex-wrap mb-8">
          <div>
            <h1 className="font-display text-h1 text-ink-900 leading-none tracking-tight">
              My Returns
            </h1>
            <p className="mt-3 text-body text-ink-600">
              Track refunds and pickup requests for your orders.
            </p>
          </div>
          <Link
            href="/orders"
            className="inline-flex items-center gap-1.5 text-caption uppercase tracking-wider font-semibold text-accent-dark hover:text-ink-900 underline-offset-2 hover:underline"
          >
            <ArrowLeft className="size-3.5" />
            Back to orders
          </Link>
        </div>

        {/* Status filter pills */}
        <nav
          aria-label="Filter returns"
          className="flex flex-wrap items-center gap-2 mb-6 pb-6 border-b border-ink-200"
        >
          {STATUS_FILTERS.map((s) => {
            const active = statusFilter === s.value;
            return (
              <button
                key={s.value || 'all'}
                onClick={() => {
                  setStatusFilter(s.value);
                  setPage(1);
                }}
                aria-pressed={active}
                className={`inline-flex items-center h-9 px-3.5 text-body font-medium transition-colors ${
                  active
                    ? 'bg-ink-900 text-white border border-ink-900'
                    : 'bg-white text-ink-700 border border-ink-300 hover:border-ink-900 hover:text-ink-900'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </nav>

        {isEmpty ? (
          <div className="bg-white border border-ink-200 py-20 px-6 text-center rounded-2xl">
            <div className="size-20 mx-auto rounded-full bg-accent-soft grid place-items-center mb-5">
              <PackageOpen className="size-9 text-accent-dark" strokeWidth={1.5} />
            </div>
            <h2 className="font-display text-h2 text-ink-900">No returns found</h2>
            <p className="mt-3 max-w-sm mx-auto text-body text-ink-600">
              {statusFilter
                ? 'No returns match the selected status. Try clearing the filter.'
                : 'Your return requests will appear here once you initiate a return from an order.'}
            </p>
            <Link
              href="/orders"
              className="mt-6 inline-flex items-center h-11 px-5 bg-ink-900 text-white font-semibold hover:bg-ink-800 transition-colors rounded-full"
            >
              View orders
              <ArrowRight className="size-4 ml-2" />
            </Link>
          </div>
        ) : (
          <>
            <ul role="list" className="space-y-3">
              {data!.returns.map((ret) => {
                const tone = returnTone(ret.status);
                const label = getReturnStatusLabel(ret.status);
                const itemCount = ret.items.reduce((sum, it) => sum + it.quantity, 0);
                return (
                  <li key={ret.id}>
                    <Link
                      href={`/returns/${ret.id}`}
                      className="group block bg-white border border-ink-200 hover:border-ink-900 transition-colors p-5 rounded-2xl"
                    >
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div>
                          <div className="font-display text-body-lg text-ink-900 leading-none">
                            {ret.returnNumber}
                          </div>
                          <div className="mt-1.5 text-caption text-ink-600 tabular">
                            Order {ret.masterOrder?.orderNumber || '—'}
                            {' · '}
                            {formatDate(ret.createdAt)}
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1.5 h-6 px-2 text-[11px] font-semibold uppercase tracking-wider rounded-full ${TONE_CHIP[tone]}`}
                        >
                          <span
                            className={`size-1.5 rounded-full ${
                              tone === 'success'
                                ? 'bg-success'
                                : tone === 'progress'
                                  ? 'bg-accent-dark'
                                  : tone === 'cancelled'
                                    ? 'bg-danger'
                                    : 'bg-ink-500'
                            }`}
                            aria-hidden
                          />
                          {label}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-4 text-body">
                        <span className="text-ink-600">
                          {itemCount} item{itemCount !== 1 ? 's' : ''}
                        </span>
                        <span className="ml-auto flex items-center gap-3">
                          <span className="text-ink-900 font-semibold tabular">
                            {ret.refundAmount != null
                              ? `Refund: ${formatPrice(Number(ret.refundAmount))}`
                              : 'Refund: pending'}
                          </span>
                          <ChevronRight className="size-4 text-ink-400 group-hover:text-ink-900 transition-colors" />
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {data && data.pagination.totalPages > 1 && (
              <nav
                aria-label="Pagination"
                className="mt-10 flex items-center justify-center gap-3"
              >
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="inline-flex items-center gap-2 h-10 px-4 border border-ink-300 hover:border-ink-900 disabled:opacity-40 disabled:hover:border-ink-300 text-body font-medium rounded-full"
                >
                  <ArrowLeft className="size-4" />
                  Previous
                </button>
                <span className="text-caption text-ink-600 tabular">
                  Page {page} of {data.pagination.totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage(page + 1)}
                  className="inline-flex items-center gap-2 h-10 px-4 border border-ink-300 hover:border-ink-900 disabled:opacity-40 disabled:hover:border-ink-300 text-body font-medium rounded-full"
                >
                  Next
                  <ArrowRight className="size-4" />
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </StorefrontShell>
  );
}
