'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Wallet as WalletIcon,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCcw,
  CheckCircle2,
  Clock,
  XCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  walletService,
  WalletBalance,
  WalletTransaction,
  WalletTransactionType,
  WalletTransactionStatus,
  WalletTransactionPage,
  formatPaise,
  formatTransactionAmount,
} from '@/services/wallet.service';

const PAGE_SIZE = 20;

export default function WalletPage() {
  const authStatus = useAuthGuard();
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [txPage, setTxPage] = useState<WalletTransactionPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    setLoading(true);
    Promise.all([
      walletService.getWallet(),
      walletService.listTransactions(page, PAGE_SIZE),
    ])
      .then(([balRes, txRes]) => {
        if (balRes.data) setBalance(balRes.data);
        if (txRes.data) setTxPage(txRes.data);
      })
      .finally(() => setLoading(false));
  }, [authStatus, page]);

  if (authStatus === 'checking' || loading) {
    return (
      <StorefrontShell>
        <div className="container-x py-16 text-center text-ink-600">
          Loading wallet…
        </div>
      </StorefrontShell>
    );
  }

  const totalPages = txPage ? Math.max(1, Math.ceil(txPage.total / PAGE_SIZE)) : 1;
  const balancePaise = balance?.balanceInPaise ?? 0;

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12">
        <nav className="text-caption text-ink-600 mb-4">
          <Link href="/account" className="hover:text-ink-900">My Account</Link>
          <span className="mx-2">›</span>
          <span className="text-ink-900 font-medium">Wallet</span>
        </nav>

        <h1 className="font-display text-h1 text-ink-900 mb-6">My Wallet</h1>

        {/* Balance card */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-ink-900 via-ink-800 to-ink-900 p-6 sm:p-8 mb-8 text-white">
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.06] pointer-events-none"
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,255,255,1) 0, rgba(255,255,255,1) 1px, transparent 1px, transparent 24px)',
            }}
          />
          <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 text-caption uppercase tracking-[0.18em] font-semibold text-white/70">
                <WalletIcon className="size-3.5" strokeWidth={2} />
                Available balance
              </div>
              <div className="mt-3 font-display text-[clamp(40px,5vw,72px)] leading-none tabular">
                {formatPaise(balancePaise)}
              </div>
              <div className="mt-2 text-caption text-white/60">
                {balance?.currency ?? 'INR'} · usable at checkout & for refunds
              </div>
            </div>

            <Link
              href="/account/wallet/topup"
              className="inline-flex items-center gap-2 h-12 px-6 bg-white text-ink-900 font-bold rounded-full hover:bg-ink-100 transition-colors self-start sm:self-end"
            >
              <Plus className="size-4" strokeWidth={2.5} />
              Add money
            </Link>
          </div>
        </section>

        {/* Transactions */}
        <section>
          <div className="flex items-end justify-between mb-4">
            <h2 className="font-display text-h2 text-ink-900">Transactions</h2>
            {txPage && (
              <div className="text-caption text-ink-600">
                {txPage.total} total
              </div>
            )}
          </div>

          {!txPage || txPage.items.length === 0 ? (
            <EmptyTransactions />
          ) : (
            <>
              <ul className="bg-white border border-ink-200 divide-y divide-ink-100 rounded-2xl overflow-hidden">
                {txPage.items.map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} />
                ))}
              </ul>

              {totalPages > 1 && (
                <div className="mt-5 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    aria-label="Previous page"
                    className="size-10 grid place-items-center border border-ink-300 hover:border-ink-900 disabled:opacity-40 disabled:hover:border-ink-300 rounded-full transition-colors"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <span className="text-body text-ink-700 tabular px-2">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    aria-label="Next page"
                    className="size-10 grid place-items-center border border-ink-300 hover:border-ink-900 disabled:opacity-40 disabled:hover:border-ink-300 rounded-full transition-colors"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </StorefrontShell>
  );
}

function EmptyTransactions() {
  return (
    <div className="bg-white border border-ink-200 rounded-2xl py-16 text-center">
      <div className="size-16 mx-auto rounded-full bg-accent-soft grid place-items-center mb-4">
        <WalletIcon className="size-7 text-accent-dark" strokeWidth={1.5} />
      </div>
      <h3 className="font-display text-h3 text-ink-900">No transactions yet</h3>
      <p className="mt-2 max-w-sm mx-auto text-body text-ink-600">
        Top up your wallet to get started — or wait for a refund credit on your
        next return.
      </p>
      <Link
        href="/account/wallet/topup"
        className="mt-5 inline-flex items-center gap-2 h-11 px-5 bg-ink-900 text-white font-semibold hover:bg-ink-800 rounded-full transition-colors"
      >
        <Plus className="size-4" strokeWidth={2.5} />
        Add money
      </Link>
    </div>
  );
}

const TYPE_META: Record<
  WalletTransactionType,
  { label: string; iconClass: string; Icon: typeof Plus }
> = {
  TOPUP: { label: 'Top-up', iconClass: 'bg-accent-soft text-accent-dark', Icon: Plus },
  REFUND: { label: 'Refund', iconClass: 'bg-accent-soft text-accent-dark', Icon: RefreshCcw },
  CREDIT_ADJUSTMENT: { label: 'Credit', iconClass: 'bg-accent-soft text-accent-dark', Icon: ArrowDownLeft },
  DEBIT: { label: 'Spent', iconClass: 'bg-sale-soft text-sale-dark', Icon: ArrowUpRight },
  DEBIT_ADJUSTMENT: { label: 'Debit', iconClass: 'bg-sale-soft text-sale-dark', Icon: ArrowUpRight },
};

function StatusBadge({ status }: { status: WalletTransactionStatus }) {
  if (status === 'COMPLETED') {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-success">
        <CheckCircle2 className="size-3" strokeWidth={2.5} />
        Completed
      </span>
    );
  }
  if (status === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-warning">
        <Clock className="size-3" strokeWidth={2.5} />
        Pending
      </span>
    );
  }
  if (status === 'FAILED') {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-danger">
        <XCircle className="size-3" strokeWidth={2.5} />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-caption text-ink-600">
      <RefreshCcw className="size-3" strokeWidth={2.5} />
      Reversed
    </span>
  );
}

function TransactionRow({ tx }: { tx: WalletTransaction }) {
  const meta = TYPE_META[tx.type];
  const isCredit = tx.amountInPaise >= 0;
  return (
    <li className="flex items-center gap-4 px-4 sm:px-5 py-4">
      <div className={`shrink-0 size-10 grid place-items-center rounded-full ${meta.iconClass}`}>
        <meta.Icon className="size-4" strokeWidth={2} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-body font-semibold text-ink-900 truncate">
            {meta.label}
          </span>
          <StatusBadge status={tx.status} />
        </div>
        <p className="mt-0.5 text-caption text-ink-600 truncate">
          {tx.description}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-500 tabular">
          {new Date(tx.createdAt).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <div
          className={`font-display text-lg tabular ${isCredit ? 'text-success' : 'text-sale'}`}
        >
          {formatTransactionAmount(tx)}
        </div>
        <div className="text-caption text-ink-500 tabular">
          Bal {formatPaise(tx.balanceAfterInPaise)}
        </div>
      </div>
    </li>
  );
}
