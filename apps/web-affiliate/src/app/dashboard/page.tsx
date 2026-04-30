'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch, formatDate, formatINR } from '../../lib/api';

interface Balances {
  pending: string;
  confirmed: string;
  paid: string;
  hold: string;
  counts: {
    pending: number;
    confirmed: number;
    paid: number;
    hold: number;
  };
}

interface Profile {
  firstName: string;
  status: string;
  kycStatus: string;
  couponCodes?: Array<{ code: string; isPrimary: boolean }>;
}

interface Commission {
  id: string;
  orderId: string;
  status: string;
  source: 'LINK' | 'COUPON';
  code?: string | null;
  adjustedAmount: string;
  createdAt: string;
}

interface PayoutMethod {
  id: string;
  type: 'BANK' | 'UPI';
  isPrimary: boolean;
}

const STOREFRONT = process.env.NEXT_PUBLIC_STOREFRONT_URL || 'http://localhost:4005';

export default function DashboardPage() {
  const [balances, setBalances] = useState<Balances | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recent, setRecent] = useState<Commission[]>([]);
  const [methods, setMethods] = useState<PayoutMethod[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiFetch<Profile>('/affiliate/me'),
      apiFetch<Balances>('/affiliate/me/balances'),
      apiFetch<{ commissions: Commission[] }>('/affiliate/me/commissions?limit=5'),
      apiFetch<PayoutMethod[]>('/affiliate/me/payout-methods'),
    ])
      .then(([p, b, c, m]) => {
        setProfile(p);
        setBalances(b);
        setRecent(c.commissions ?? []);
        setMethods(m);
      })
      .catch((e) => setError(e?.message ?? 'Could not load dashboard.'));
  }, []);

  if (error) return <p style={{ color: '#b91c1c', fontSize: 13 }}>{error}</p>;
  if (!profile || !balances) return <DashboardSkeleton />;

  const primaryCoupon = profile.couponCodes?.find((c) => c.isPrimary)?.code ?? profile.couponCodes?.[0]?.code;
  const referralLink = primaryCoupon ? `${STOREFRONT}/?ref=${encodeURIComponent(primaryCoupon)}` : null;

  const accountActive = profile.status === 'ACTIVE';
  const kycVerified = profile.kycStatus === 'VERIFIED';
  const hasMethod = methods.length > 0;
  const hasCoupon = !!primaryCoupon;
  const allDone = accountActive && kycVerified && hasMethod && hasCoupon;

  const totalEarned = Number(balances.pending) + Number(balances.confirmed) + Number(balances.paid);
  const totalCount = balances.counts.pending + balances.counts.confirmed + balances.counts.paid + balances.counts.hold;

  return (
    <div style={{ maxWidth: 1080 }}>
      {/* Hero */}
      <section style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>
          Welcome back, {profile.firstName}
        </h1>
        <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
          {totalCount > 0
            ? `You've earned ${formatINR(totalEarned)} across ${totalCount} order${totalCount === 1 ? '' : 's'}.`
            : 'Share your code to start earning commissions on every sale.'}
        </p>
      </section>

      {/* Onboarding checklist (only while incomplete) */}
      {!allDone && (
        <section
          style={{
            background: 'linear-gradient(135deg, #eff6ff 0%, #faf5ff 100%)',
            border: '1px solid #dbeafe',
            borderRadius: 14,
            padding: 22,
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <ProgressRing
              value={[accountActive, kycVerified, hasMethod, hasCoupon].filter(Boolean).length}
              max={4}
            />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Get set up to earn</div>
              <div style={{ fontSize: 12, color: '#475569' }}>
                Finish these steps to unlock commissions and payouts.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Step
              done={accountActive}
              title="Account approved"
              body="Once an admin approves your application your status flips to ACTIVE."
            />
            <Step
              done={hasCoupon}
              href="/dashboard/coupons"
              title="Share your code"
              body="Your primary code earns commission on every order that uses it."
            />
            <Step
              done={kycVerified}
              href="/dashboard/kyc"
              title="Complete KYC"
              body="Required by Section 194H — submit PAN and (optional) Aadhaar."
            />
            <Step
              done={hasMethod}
              href="/dashboard/payouts"
              title="Add a payout method"
              body="Bank or UPI — needed before you can request a payout."
            />
          </div>
        </section>
      )}

      {/* Stats grid */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Stat label="Pending" value={formatINR(balances.pending)} sub={`${balances.counts.pending} commission${balances.counts.pending === 1 ? '' : 's'}`} tone="warning" hint="Awaiting return-window close" />
        <Stat label="Confirmed" value={formatINR(balances.confirmed)} sub={`${balances.counts.confirmed} ready for payout`} tone="info" hint="Eligible for your next payout request" />
        <Stat label="Paid" value={formatINR(balances.paid)} sub={`${balances.counts.paid} settled`} tone="success" hint="Already transferred to your account" />
        <Stat label="On hold" value={formatINR(balances.hold)} sub={`${balances.counts.hold} paused`} tone="neutral" hint="Exchange or manual review in progress" />
      </section>

      {/* Coupon + share kit */}
      {primaryCoupon && (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              padding: 20,
              background: '#0f172a',
              color: '#fff',
              borderRadius: 14,
              backgroundImage: 'radial-gradient(at 90% 0%, #1d4ed8 0%, #0f172a 60%)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Your primary code
                </div>
                <div
                  style={{
                    fontSize: 30,
                    fontWeight: 700,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    marginTop: 4,
                    letterSpacing: '2px',
                  }}
                >
                  {primaryCoupon}
                </div>
                {referralLink && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#cbd5e1', wordBreak: 'break-all' }}>
                    {referralLink}
                  </div>
                )}
              </div>
              <Link
                href="/dashboard/coupons"
                style={{
                  padding: '10px 18px',
                  background: '#fff',
                  color: '#0f172a',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  alignSelf: 'flex-start',
                }}
              >
                Get share kit →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Two-column: Recent activity + Quick actions */}
      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Recent commissions</h2>
            <Link href="/dashboard/earnings" style={{ fontSize: 12, color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}>
              See all →
            </Link>
          </div>
          {recent.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🎯</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>No commissions yet</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                The first sale through your code will land here.
              </div>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {recent.map((c, i) => (
                <li
                  key={c.id}
                  style={{
                    padding: '12px 18px',
                    borderBottom: i === recent.length - 1 ? 'none' : '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                      {c.orderId.slice(0, 8)}…
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                      {c.source === 'COUPON' ? `Coupon · ${c.code}` : 'Link click'} · {formatDate(c.createdAt)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {formatINR(c.adjustedAmount)}
                    </div>
                    <div style={{ marginTop: 3 }}>
                      <CommissionBadge status={c.status} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <QuickAction
            href="/dashboard/coupons"
            title="Share your code"
            sub="Get the link, code, and copy-ready text."
            tone="primary"
          />
          <QuickAction
            href="/dashboard/payouts"
            title="Request payout"
            sub={
              Number(balances.confirmed) >= 500
                ? `${formatINR(balances.confirmed)} ready to withdraw`
                : 'Below ₹500 minimum'
            }
            tone={Number(balances.confirmed) >= 500 ? 'success' : 'muted'}
          />
          <QuickAction
            href="/dashboard/earnings"
            title="Earnings history"
            sub="Drill into every commission's lifecycle."
            tone="ghost"
          />
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  hint,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'success' | 'warning' | 'info' | 'neutral';
  hint?: string;
}) {
  const fg =
    tone === 'success' ? '#16a34a' :
    tone === 'warning' ? '#b45309' :
    tone === 'info' ? '#1d4ed8' :
    '#64748b';
  return (
    <div
      title={hint}
      style={{
        padding: 18,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 3,
          height: '100%',
          background: fg,
          opacity: 0.6,
        }}
      />
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: fg, marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function Step({
  done,
  href,
  title,
  body,
}: {
  done: boolean;
  href?: string;
  title: string;
  body: string;
}) {
  const inner = (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '10px 12px',
        background: done ? 'rgba(22, 163, 74, 0.06)' : '#fff',
        border: '1px solid ' + (done ? '#bbf7d0' : '#e2e8f0'),
        borderRadius: 10,
        cursor: !done && href ? 'pointer' : 'default',
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: done ? '#16a34a' : '#fff',
          border: '2px solid ' + (done ? '#16a34a' : '#cbd5e1'),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {done ? '✓' : ''}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: done ? '#15803d' : '#0f172a', textDecoration: done ? 'line-through' : 'none' }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
          {body}
        </div>
      </div>
      {!done && href && (
        <div style={{ fontSize: 13, color: '#1d4ed8', fontWeight: 600, alignSelf: 'center' }}>→</div>
      )}
    </div>
  );
  if (!done && href) {
    return (
      <Link href={href} style={{ textDecoration: 'none' }}>
        {inner}
      </Link>
    );
  }
  return inner;
}

function ProgressRing({ value, max }: { value: number; max: number }) {
  const pct = (value / max) * 100;
  const r = 18;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r={r} stroke="#dbeafe" strokeWidth="4" fill="none" />
      <circle
        cx="24"
        cy="24"
        r={r}
        stroke="#2563eb"
        strokeWidth="4"
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 24 24)"
      />
      <text
        x="24"
        y="28"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fill="#1e3a8a"
      >
        {value}/{max}
      </text>
    </svg>
  );
}

function QuickAction({
  href,
  title,
  sub,
  tone,
}: {
  href: string;
  title: string;
  sub: string;
  tone: 'primary' | 'success' | 'muted' | 'ghost';
}) {
  const palette = {
    primary: { bg: '#2563eb', fg: '#fff', subFg: '#bfdbfe' },
    success: { bg: '#16a34a', fg: '#fff', subFg: '#bbf7d0' },
    muted: { bg: '#fff', fg: '#475569', subFg: '#94a3b8' },
    ghost: { bg: '#fff', fg: '#0f172a', subFg: '#64748b' },
  }[tone];
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: 16,
        background: palette.bg,
        color: palette.fg,
        borderRadius: 12,
        border: tone === 'muted' || tone === 'ghost' ? '1px solid #e2e8f0' : 'none',
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 14 }}>→</div>
      </div>
      <div style={{ fontSize: 11, color: palette.subFg, marginTop: 4 }}>{sub}</div>
    </Link>
  );
}

function CommissionBadge({ status }: { status: string }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    PENDING: { bg: '#fef3c7', fg: '#92400e' },
    HOLD: { bg: '#fef2f2', fg: '#b91c1c' },
    CONFIRMED: { bg: '#dbeafe', fg: '#1e40af' },
    PAID: { bg: '#dcfce7', fg: '#15803d' },
    CANCELLED: { bg: '#f1f5f9', fg: '#475569' },
    REVERSED: { bg: '#fee2e2', fg: '#991b1b' },
  };
  const p = palette[status] ?? { bg: '#f1f5f9', fg: '#475569' };
  return (
    <span style={{ padding: '2px 7px', fontSize: 10, fontWeight: 700, borderRadius: 4, background: p.bg, color: p.fg, letterSpacing: '0.5px' }}>
      {status}
    </span>
  );
}

function DashboardSkeleton() {
  return (
    <div style={{ maxWidth: 1080 }}>
      <SkeletonBlock height={32} width={280} />
      <SkeletonBlock height={14} width={420} style={{ marginTop: 8, marginBottom: 24 }} />
      <SkeletonBlock height={140} style={{ marginBottom: 24 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 24 }}>
        <SkeletonBlock height={86} />
        <SkeletonBlock height={86} />
        <SkeletonBlock height={86} />
        <SkeletonBlock height={86} />
      </div>
      <SkeletonBlock height={300} />
    </div>
  );
}

function SkeletonBlock({ width, height, style }: { width?: number | string; height?: number; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        width: width ?? '100%',
        height: height ?? 16,
        background: 'linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 50%, #f1f5f9 100%)',
        borderRadius: 8,
        ...style,
      }}
    />
  );
}
