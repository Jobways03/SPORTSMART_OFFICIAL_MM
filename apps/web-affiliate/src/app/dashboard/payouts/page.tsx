'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, formatDate, formatINR } from '../../../lib/api';

interface PayoutMethod {
  id: string;
  type: 'BANK' | 'UPI';
  accountLast4?: string | null;
  ifscCode?: string | null;
  accountHolderName?: string | null;
  bankName?: string | null;
  upiId?: string | null;
  isPrimary: boolean;
  isVerified: boolean;
}

interface PayoutRequest {
  id: string;
  grossAmount: string;
  reversalDebit: string;
  tdsAmount: string;
  netAmount: string;
  financialYear: string;
  status: 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';
  requestedAt: string;
  paidAt?: string | null;
  failedAt?: string | null;
  failureReason?: string | null;
  transactionRef?: string | null;
}

interface Balances {
  confirmed: string;
  counts: { confirmed: number };
}

interface ProfileLite {
  status: string;
  kycStatus: string;
}

const MIN_PAYOUT = 500;

export default function PayoutsPage() {
  const [methods, setMethods] = useState<PayoutMethod[]>([]);
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [profile, setProfile] = useState<ProfileLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [m, r, b, p] = await Promise.all([
        apiFetch<PayoutMethod[]>('/affiliate/me/payout-methods'),
        apiFetch<PayoutRequest[]>('/affiliate/me/payouts'),
        apiFetch<Balances>('/affiliate/me/balances'),
        apiFetch<ProfileLite>('/affiliate/me'),
      ]);
      setMethods(m);
      setRequests(r);
      setBalances(b);
      setProfile(p);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load payouts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSetPrimary = async (id: string) => {
    try {
      await apiFetch(`/affiliate/me/payout-methods/${id}/primary`, { method: 'POST' });
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'Failed to update primary.');
    }
  };

  const handleRequestPayout = async () => {
    setRequestError('');
    setRequesting(true);
    try {
      await apiFetch('/affiliate/me/payouts', { method: 'POST', body: JSON.stringify({}) });
      await load();
    } catch (e: any) {
      setRequestError(e?.message ?? 'Payout request failed.');
    } finally {
      setRequesting(false);
    }
  };

  if (loading) return <PayoutsSkeleton />;
  if (error) return <p style={{ color: '#b91c1c' }}>{error}</p>;

  const primaryMethod = methods.find((m) => m.isPrimary);
  const eligibleAmount = Number(balances?.confirmed ?? 0);
  const eligibleCount = balances?.counts.confirmed ?? 0;

  const checks = [
    { label: 'Account is ACTIVE', done: profile?.status === 'ACTIVE', body: profile?.status !== 'ACTIVE' ? 'Wait for admin approval.' : null },
    { label: 'KYC verified', done: profile?.kycStatus === 'VERIFIED', body: profile?.kycStatus !== 'VERIFIED' ? 'Complete it on the KYC page.' : null, href: '/dashboard/kyc' },
    { label: 'Primary payout method added', done: !!primaryMethod, body: !primaryMethod ? 'Add a bank account or UPI below.' : null },
    { label: `Balance ≥ ${formatINR(MIN_PAYOUT)}`, done: eligibleAmount >= MIN_PAYOUT, body: eligibleAmount < MIN_PAYOUT ? `You have ${formatINR(eligibleAmount)} eligible.` : null },
  ];
  const canRequest = checks.every((c) => c.done);

  return (
    <div style={{ maxWidth: 980 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>Payouts</h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          Withdraw confirmed commissions to your bank account or UPI.
        </p>
      </header>

      {/* Hero withdrawal card */}
      <section
        style={{
          padding: 24,
          background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%)',
          border: '1px solid #bbf7d0',
          borderRadius: 14,
          marginBottom: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Available to withdraw
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#14532d', marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
              {formatINR(eligibleAmount)}
            </div>
            <div style={{ fontSize: 13, color: '#15803d', marginTop: 4 }}>
              {eligibleCount} confirmed commission{eligibleCount === 1 ? '' : 's'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <button
              onClick={handleRequestPayout}
              disabled={!canRequest || requesting}
              style={{
                ...btnPrimary,
                padding: '12px 26px',
                fontSize: 14,
                opacity: !canRequest || requesting ? 0.5 : 1,
                cursor: !canRequest || requesting ? 'not-allowed' : 'pointer',
              }}
            >
              {requesting ? 'Requesting…' : 'Request payout'}
            </button>
            {primaryMethod && (
              <span style={{ fontSize: 11, color: '#15803d' }}>
                Will go to {primaryMethod.type === 'BANK' ? `${primaryMethod.bankName ?? 'bank'} •••• ${primaryMethod.accountLast4}` : primaryMethod.upiId}
              </span>
            )}
          </div>
        </div>
        {requestError && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
            {requestError}
          </div>
        )}
      </section>

      {/* Eligibility checklist */}
      <section
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 12px' }}>
          Eligibility for next payout
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {checks.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: c.done ? '#16a34a' : '#fff',
                  border: '2px solid ' + (c.done ? '#16a34a' : '#cbd5e1'),
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {c.done ? '✓' : ''}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.done ? '#15803d' : '#0f172a' }}>
                  {c.label}
                </div>
                {c.body && (
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {c.body}
                    {c.href && (
                      <> <Link href={c.href} style={{ color: '#1d4ed8', fontWeight: 600 }}>Fix →</Link></>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Methods */}
      <section style={{ marginBottom: 24 }}>
        <SectionHeader
          title="Payout methods"
          actionLabel={showAddForm ? 'Cancel' : '+ Add method'}
          onAction={() => setShowAddForm((v) => !v)}
        />
        {showAddForm && (
          <AddMethodForm
            onSaved={async () => {
              setShowAddForm(false);
              await load();
            }}
            existingCount={methods.length}
          />
        )}
        {methods.length === 0 ? (
          <div style={emptyStyle}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>🏦</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>No payout methods yet</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              Add a bank account or UPI to receive your commissions.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            {methods.map((m) => (
              <MethodCard key={m.id} method={m} onSetPrimary={() => handleSetPrimary(m.id)} />
            ))}
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <SectionHeader title="Payout history" />
        {requests.length === 0 ? (
          <div style={emptyStyle}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>📜</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>No payout requests yet</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              Once you request a withdrawal, it&rsquo;ll appear here with status updates.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {requests.map((r) => (
              <PayoutHistoryCard key={r.id} request={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MethodCard({ method, onSetPrimary }: { method: PayoutMethod; onSetPrimary: () => void }) {
  const isBank = method.type === 'BANK';
  return (
    <div
      style={{
        padding: 18,
        background: method.isPrimary ? 'linear-gradient(135deg, #eff6ff 0%, #fff 100%)' : '#fff',
        border: '1px solid ' + (method.isPrimary ? '#bfdbfe' : '#e2e8f0'),
        borderRadius: 12,
        position: 'relative',
      }}
    >
      {method.isPrimary && (
        <span style={{ position: 'absolute', top: 12, right: 12, padding: '3px 9px', fontSize: 10, fontWeight: 700, borderRadius: 999, background: '#1d4ed8', color: '#fff', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
          Primary
        </span>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: isBank ? '#dbeafe' : '#fce7f3',
            color: isBank ? '#1d4ed8' : '#be185d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '0.5px',
          }}
        >
          {method.type}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {isBank ? `${method.bankName ?? 'Bank'} •••• ${method.accountLast4 ?? '????'}` : method.upiId}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            {isBank ? `${method.accountHolderName ?? ''} · ${method.ifscCode ?? ''}` : 'UPI ID'}
          </div>
        </div>
      </div>
      {!method.isPrimary && (
        <button onClick={onSetPrimary} style={{ ...btnGhost, width: '100%' }}>
          Set as primary
        </button>
      )}
    </div>
  );
}

function PayoutHistoryCard({ request: r }: { request: PayoutRequest }) {
  return (
    <div style={{ padding: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PayoutStatusPill status={r.status} />
            <span style={{ fontSize: 11, color: '#94a3b8' }}>FY {r.financialYear}</span>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            Requested {formatDate(r.requestedAt)}
            {r.paidAt && <> · Paid {formatDate(r.paidAt)}</>}
            {r.failedAt && <> · Failed {formatDate(r.failedAt)}</>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Net</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a', fontVariantNumeric: 'tabular-nums' }}>
            {formatINR(r.netAmount)}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12, padding: '10px 12px', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 8, fontSize: 12, color: '#475569', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        <Breakdown label="Gross" value={formatINR(r.grossAmount)} />
        <Breakdown label="Reversal" value={Number(r.reversalDebit) > 0 ? `-${formatINR(r.reversalDebit)}` : '—'} tone={Number(r.reversalDebit) > 0 ? 'danger' : undefined} />
        <Breakdown label="TDS" value={Number(r.tdsAmount) > 0 ? `-${formatINR(r.tdsAmount)}` : '—'} tone={Number(r.tdsAmount) > 0 ? 'danger' : undefined} />
        <Breakdown label="Reference" value={r.transactionRef ?? '—'} mono />
      </div>
      {r.failureReason && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
          {r.failureReason}
        </div>
      )}
    </div>
  );
}

function Breakdown({ label, value, tone, mono }: { label: string; value: string; tone?: 'danger'; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{
        fontSize: 13,
        fontWeight: 600,
        color: tone === 'danger' ? '#b91c1c' : '#0f172a',
        fontFamily: mono ? 'ui-monospace, Menlo, monospace' : 'inherit',
        fontVariantNumeric: !mono ? 'tabular-nums' : 'normal',
        marginTop: 2,
      }}>
        {value}
      </div>
    </div>
  );
}

function AddMethodForm({ onSaved, existingCount }: { onSaved: () => void; existingCount: number }) {
  const [type, setType] = useState<'BANK' | 'UPI'>('BANK');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [holder, setHolder] = useState('');
  const [bankName, setBankName] = useState('');
  const [upiId, setUpiId] = useState('');
  const [setPrimary, setSetPrimary] = useState(existingCount === 0);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setSubmitting(true);
    try {
      const body: any = { type, setPrimary };
      if (type === 'BANK') {
        body.accountNumber = accountNumber.trim();
        body.ifscCode = ifsc.trim().toUpperCase();
        body.accountHolderName = holder.trim();
        if (bankName.trim()) body.bankName = bankName.trim();
      } else {
        body.upiId = upiId.trim();
      }
      await apiFetch('/affiliate/me/payout-methods', { method: 'POST', body: JSON.stringify(body) });
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to add method.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {(['BANK', 'UPI'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            style={{
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 999,
              border: '1px solid ' + (type === t ? '#2563eb' : '#cbd5e1'),
              background: type === t ? '#2563eb' : '#fff',
              color: type === t ? '#fff' : '#475569',
              cursor: 'pointer',
            }}
          >
            {t === 'BANK' ? 'Bank account' : 'UPI'}
          </button>
        ))}
      </div>

      {type === 'BANK' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormField label="Account number" required>
            <input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
              required
              style={inputStyle}
              placeholder="1234567890"
            />
          </FormField>
          <FormField label="IFSC" required>
            <input
              value={ifsc}
              onChange={(e) => setIfsc(e.target.value.toUpperCase())}
              required
              maxLength={11}
              style={inputStyle}
              placeholder="HDFC0001234"
            />
          </FormField>
          <FormField label="Account holder name" required>
            <input
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              required
              style={inputStyle}
            />
          </FormField>
          <FormField label="Bank name" optional>
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              style={inputStyle}
              placeholder="HDFC Bank"
            />
          </FormField>
        </div>
      ) : (
        <FormField label="UPI ID" required>
          <input
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
            required
            style={inputStyle}
            placeholder="name@upi"
          />
        </FormField>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, color: '#475569' }}>
        <input
          type="checkbox"
          checked={setPrimary}
          onChange={(e) => setSetPrimary(e.target.checked)}
          disabled={existingCount === 0}
        />
        Set as primary {existingCount === 0 && <span style={{ color: '#94a3b8' }}>(first method is primary by default)</span>}
      </label>

      {err && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
          {err}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <button type="submit" disabled={submitting} style={btnPrimary}>
          {submitting ? 'Saving…' : 'Save method'}
        </button>
      </div>
    </form>
  );
}

function PayoutStatusPill({ status }: { status: PayoutRequest['status'] }) {
  const palette: Record<PayoutRequest['status'], { bg: string; fg: string }> = {
    REQUESTED: { bg: '#fef3c7', fg: '#92400e' },
    APPROVED: { bg: '#dbeafe', fg: '#1e40af' },
    PROCESSING: { bg: '#e0e7ff', fg: '#3730a3' },
    PAID: { bg: '#dcfce7', fg: '#15803d' },
    FAILED: { bg: '#fee2e2', fg: '#991b1b' },
    CANCELLED: { bg: '#f1f5f9', fg: '#475569' },
  };
  const p = palette[status];
  return (
    <span style={{ padding: '3px 9px', fontSize: 10, fontWeight: 700, borderRadius: 999, background: p.bg, color: p.fg, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {status}
    </span>
  );
}

function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h2>
      {actionLabel && (
        <button onClick={onAction} style={btnGhost}>{actionLabel}</button>
      )}
    </div>
  );
}

function FormField({ label, required, optional, children }: { label: string; required?: boolean; optional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: '#dc2626' }}> *</span>}
        {optional && <span style={{ color: '#94a3b8', fontWeight: 500 }}> (optional)</span>}
      </label>
      {children}
    </div>
  );
}

function PayoutsSkeleton() {
  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ height: 32, width: 200, background: '#f1f5f9', borderRadius: 8, marginBottom: 8 }} />
      <div style={{ height: 14, width: 360, background: '#f1f5f9', borderRadius: 6, marginBottom: 24 }} />
      <div style={{ height: 130, background: '#f1f5f9', borderRadius: 14, marginBottom: 18 }} />
      <div style={{ height: 110, background: '#f1f5f9', borderRadius: 12, marginBottom: 24 }} />
      <div style={{ height: 200, background: '#f1f5f9', borderRadius: 12 }} />
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: 32,
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  textAlign: 'center',
  color: '#64748b',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 18px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  padding: '7px 14px',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
