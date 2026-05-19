'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  adminWalletService,
  AdminWalletDetail,
  AdminWalletTransaction,
  WalletTransactionType,
  WalletTransactionStatus,
  formatPaise,
  signedAmount,
} from '@/services/admin-wallet.service';
import { ApiError } from '@/lib/api-client';

type Mode = 'credit' | 'debit';

export default function WalletDetailPage() {
  const router = useRouter();
  const { userId } = useParams<{ userId: string }>();
  const [data, setData] = useState<AdminWalletDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminWalletService.getDetail(userId);
      if (res.data) setData(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load wallet');
    } finally {
      setLoading(false);
    }
  }, [userId, router]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  if (loading && !data) {
    return (
      <div style={{ padding: 32, color: '#7A828F' }}>Loading wallet…</div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <div
          style={{
            padding: 16,
            border: '1px solid #fca5a5',
            background: '#fef2f2',
            color: '#b91c1c',
            borderRadius: 12,
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <Link
        href="/dashboard/wallets"
        style={{
          color: '#525A65',
          fontSize: 13,
          textDecoration: 'none',
          marginBottom: 12,
          display: 'inline-block',
        }}
      >
        ← Back to wallets
      </Link>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Wallet detail</h1>
        <span
          style={{
            fontSize: 12,
            color: '#7A828F',
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          user: {data.wallet.userId}
        </span>
      </div>

      <BalanceCard balanceInPaise={data.wallet.balanceInPaise} updatedAt={data.wallet.updatedAt} />

      <BlockControl
        userId={userId}
        isBlocked={!!data.wallet.isBlocked}
        blockedReason={data.wallet.blockedReason ?? null}
        blockedAt={data.wallet.blockedAt ?? null}
        onDone={fetchDetail}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <MutateForm mode="credit" userId={userId} onDone={fetchDetail} />
        <MutateForm mode="debit" userId={userId} onDone={fetchDetail} />
      </div>

      <h2 style={{ fontSize: 20, fontWeight: 600, color: '#0F1115', marginBottom: 12 }}>Recent transactions</h2>
      <TransactionsTable transactions={data.transactions} />
    </div>
  );
}

function BalanceCard({
  balanceInPaise,
  updatedAt,
}: {
  balanceInPaise: number;
  updatedAt: string;
}) {
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #0F1115 0%, #1F232A 100%)',
        color: '#fff',
        padding: 28,
        borderRadius: 16,
        marginBottom: 24,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.7 }}>
        Available balance
      </div>
      <div
        style={{
          fontSize: 56,
          fontWeight: 700,
          marginTop: 8,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
        }}
      >
        {formatPaise(balanceInPaise)}
      </div>
      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
        Last activity {new Date(updatedAt).toLocaleString('en-IN')}
      </div>
    </div>
  );
}

function MutateForm({
  mode,
  userId,
  onDone,
}: {
  mode: Mode;
  userId: string;
  onDone: () => void;
}) {
  const [amountInRupees, setAmountInRupees] = useState('');
  const [description, setDescription] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const rupees = Number(amountInRupees);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setError('Enter a positive amount');
      return;
    }
    if (!description.trim()) {
      setError('Description is required');
      return;
    }
    const amountInPaise = Math.round(rupees * 100);

    setSubmitting(true);
    try {
      const fn = mode === 'credit' ? adminWalletService.credit : adminWalletService.debit;
      const res = await fn(userId, {
        amountInPaise,
        description: description.trim(),
        internalNotes: internalNotes.trim() || undefined,
      });
      if (res.data) {
        setSuccess(
          `${mode === 'credit' ? 'Credited' : 'Debited'} — new balance ${formatPaise(res.data.balanceInPaise)}`,
        );
        setAmountInRupees('');
        setDescription('');
        setInternalNotes('');
        onDone();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply');
    } finally {
      setSubmitting(false);
    }
  };

  const isCredit = mode === 'credit';
  const accent = isCredit ? '#15803d' : '#b91c1c';
  const accentBg = isCredit ? '#dcfce7' : '#fee2e2';

  return (
    <form
      onSubmit={submit}
      style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: 16,
        padding: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 9999,
            background: accentBg,
            color: accent,
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          {isCredit ? '+' : '−'}
        </span>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0F1115' }}>
          {isCredit ? 'Credit wallet' : 'Debit wallet'}
        </h3>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Amount (₹)</label>
        <input
          type="text"
          inputMode="decimal"
          value={amountInRupees}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '' || /^\d{0,7}(\.\d{0,2})?$/.test(v)) setAmountInRupees(v);
          }}
          disabled={submitting}
          placeholder="0"
          style={input}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Description (customer-visible)</label>
        <input
          type="text"
          value={description}
          maxLength={140}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
          placeholder={isCredit ? 'Goodwill credit for delayed delivery' : 'Chargeback reversal'}
          style={input}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>Internal notes (optional)</label>
        <textarea
          value={internalNotes}
          maxLength={500}
          onChange={(e) => setInternalNotes(e.target.value)}
          disabled={submitting}
          rows={2}
          placeholder="Reason / reference / approver"
          style={{ ...input, height: 56, resize: 'vertical' }}
        />
      </div>

      {error && (
        <div style={{ ...alertBox, borderColor: '#fca5a5', background: '#fef2f2', color: '#b91c1c' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ ...alertBox, borderColor: '#86efac', background: '#dcfce7', color: '#15803d' }}>
          {success}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          width: '100%',
          height: 40,
          marginTop: 4,
          background: isCredit ? '#0F1115' : '#b91c1c',
          color: '#fff',
          border: 'none',
          borderRadius: 9999,
          fontSize: 14,
          fontWeight: 600,
          cursor: submitting ? 'not-allowed' : 'pointer',
          opacity: submitting ? 0.5 : 1,
        }}
      >
        {submitting ? 'Applying…' : isCredit ? 'Credit wallet' : 'Debit wallet'}
      </button>
    </form>
  );
}

const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#525A65',
  marginBottom: 6,
};

const input: React.CSSProperties = {
  width: '100%',
  height: 40,
  padding: '0 12px',
  border: '1px solid #D2D6DC',
  background: '#fff',
  borderRadius: 9999,
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};

const alertBox: React.CSSProperties = {
  padding: 8,
  border: '1px solid',
  borderRadius: 12,
  fontSize: 13,
  marginBottom: 10,
};

const TYPE_LABEL: Record<WalletTransactionType, string> = {
  TOPUP: 'Top-up',
  REFUND: 'Refund',
  CREDIT_ADJUSTMENT: 'Credit',
  DEBIT: 'Spent',
  DEBIT_ADJUSTMENT: 'Debit',
};

const STATUS_COLOR: Record<WalletTransactionStatus, string> = {
  COMPLETED: '#15803d',
  PENDING: '#d97706',
  FAILED: '#b91c1c',
  REVERSED: '#7A828F',
};

function TransactionsTable({ transactions }: { transactions: AdminWalletTransaction[] }) {
  if (transactions.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          background: '#fff',
          border: '1px solid #E5E7EB',
          borderRadius: 16,
          textAlign: 'center',
          color: '#7A828F',
        }}
      >
        No transactions yet.
      </div>
    );
  }
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
            <th style={th}>When</th>
            <th style={th}>Type</th>
            <th style={th}>Description</th>
            <th style={{ ...th, textAlign: 'right' }}>Amount</th>
            <th style={{ ...th, textAlign: 'right' }}>Balance after</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
              <td style={{ ...td, color: '#525A65', whiteSpace: 'nowrap' }}>
                {new Date(tx.createdAt).toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </td>
              <td style={td}>
                <span style={{ fontWeight: 600 }}>{TYPE_LABEL[tx.type]}</span>
              </td>
              <td style={{ ...td, color: '#525A65' }}>
                <div>{tx.description}</div>
                {tx.internalNotes && (
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 11,
                      color: '#7A828F',
                      fontStyle: 'italic',
                    }}
                  >
                    Internal: {tx.internalNotes}
                  </div>
                )}
              </td>
              <td
                style={{
                  ...td,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                  // Compare via BigInt so the sign check works for
                  // both number and string (BigInt-serialised) amounts.
                  color: BigInt(tx.amountInPaise) >= 0n ? '#15803d' : '#b91c1c',
                }}
              >
                {signedAmount(tx)}
              </td>
              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#525A65' }}>
                {formatPaise(tx.balanceAfterInPaise)}
              </td>
              <td style={{ ...td, color: STATUS_COLOR[tx.status], fontSize: 12, fontWeight: 600 }}>
                {tx.status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  padding: '12px 16px',
  fontSize: 14,
};

function BlockControl({
  userId,
  isBlocked,
  blockedReason,
  blockedAt,
  onDone,
}: {
  userId: string;
  isBlocked: boolean;
  blockedReason: string | null;
  blockedAt: string | null;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function block() {
    setBusy(true);
    setErr('');
    try {
      await adminWalletService.block(userId, reason.trim() || undefined);
      setReason('');
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to block wallet');
    } finally {
      setBusy(false);
    }
  }

  async function unblock() {
    setBusy(true);
    setErr('');
    try {
      await adminWalletService.unblock(userId);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to unblock wallet');
    } finally {
      setBusy(false);
    }
  }

  if (isBlocked) {
    return (
      <div
        style={{
          background: '#FEF2F2',
          border: '1px solid #FCA5A5',
          borderRadius: 12,
          padding: 16,
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#B91C1C', marginBottom: 4 }}>
            ⚠ Wallet blocked
          </div>
          <div style={{ fontSize: 13, color: '#7F1D1D' }}>
            {blockedReason || 'No reason recorded.'}
            {blockedAt && (
              <span style={{ color: '#9CA3AF', marginLeft: 8 }}>
                · since {new Date(blockedAt).toLocaleString('en-IN')}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={unblock}
          disabled={busy}
          style={{
            background: '#fff',
            color: '#B91C1C',
            border: '1px solid #FCA5A5',
            padding: '8px 14px',
            borderRadius: 8,
            cursor: busy ? 'default' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {busy ? 'Unblocking…' : 'Unblock wallet'}
        </button>
      </div>
    );
  }

  return (
    <details
      style={{
        border: '1px solid #E5E7EB',
        borderRadius: 12,
        padding: 12,
        marginBottom: 24,
        background: '#fff',
      }}
    >
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#525A65' }}>
        Block this wallet
      </summary>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (visible to other admins)"
          style={{
            flex: 1,
            padding: '8px 10px',
            border: '1px solid #D2D6DC',
            borderRadius: 8,
            fontSize: 13,
          }}
        />
        <button
          onClick={block}
          disabled={busy || !reason.trim()}
          style={{
            background: '#B91C1C',
            color: '#fff',
            border: 'none',
            padding: '8px 14px',
            borderRadius: 8,
            cursor: busy || !reason.trim() ? 'default' : 'pointer',
            opacity: busy || !reason.trim() ? 0.6 : 1,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {busy ? 'Blocking…' : 'Block wallet'}
        </button>
      </div>
      {err && (
        <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 8 }}>{err}</div>
      )}
    </details>
  );
}
