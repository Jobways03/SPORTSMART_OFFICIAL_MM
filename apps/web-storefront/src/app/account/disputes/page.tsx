'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Scale, ChevronRight } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  disputesService,
  Dispute,
  DisputeListPage,
  STATUS_LABEL,
} from '@/services/disputes.service';

const PAGE_SIZE = 20;

export default function MyDisputesPage() {
  const authStatus = useAuthGuard();
  const [data, setData] = useState<DisputeListPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    setLoading(true);
    disputesService.list(page, PAGE_SIZE)
      .then((res) => res.data && setData(res.data))
      .finally(() => setLoading(false));
  }, [authStatus, page]);

  if (authStatus === 'checking') {
    return <StorefrontShell><div className="container-x py-16 text-center text-ink-600">Loading…</div></StorefrontShell>;
  }

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12 max-w-3xl">
        <nav className="text-caption text-ink-600 mb-4">
          <Link href="/account" className="hover:text-ink-900">My Account</Link>
          <span className="mx-2">›</span>
          <span className="text-ink-900 font-medium">Disputes</span>
        </nav>

        <div className="flex items-center gap-3 mb-6">
          <div className="size-10 grid place-items-center bg-sale-soft text-sale-dark rounded-2xl">
            <Scale className="size-5" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="font-display text-h1 text-ink-900">Disputes</h1>
            <p className="mt-1 text-body-lg text-ink-600">
              Formal escalations on rejected returns or order issues.
            </p>
          </div>
        </div>

        {loading && !data ? (
          <div className="text-center py-16 text-ink-600">Loading…</div>
        ) : !data || data.items.length === 0 ? (
          <div className="bg-white border border-ink-200 rounded-2xl py-16 text-center">
            <Scale className="size-12 mx-auto text-ink-400 mb-3" strokeWidth={1.5} />
            <h3 className="font-display text-h3 text-ink-900">No disputes</h3>
            <p className="mt-2 max-w-sm mx-auto text-body text-ink-600">
              If a return is rejected or an order arrives wrong, you can escalate from
              the order/return detail page.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {data.items.map((d) => <DisputeRow key={d.id} dispute={d} />)}
          </ul>
        )}
      </div>
    </StorefrontShell>
  );
}

function DisputeRow({ dispute }: { dispute: Dispute }) {
  return (
    <li>
      <Link href={`/account/disputes/${dispute.id}`}
        className="group block bg-white border border-ink-200 hover:border-ink-900 transition-colors rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-caption text-ink-500 font-mono uppercase tracking-wider">{dispute.disputeNumber}</span>
              <span className="inline-flex items-center h-5 px-2 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-accent-soft text-accent-dark">
                {STATUS_LABEL[dispute.status]}
              </span>
            </div>
            <p className="text-body text-ink-900 line-clamp-2">{dispute.summary}</p>
            <p className="mt-2 text-caption text-ink-600">
              Filed {new Date(dispute.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <ChevronRight className="size-5 text-ink-400 mt-1 shrink-0 group-hover:text-ink-900 transition-all" />
        </div>
      </Link>
    </li>
  );
}
