'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch, formatINR } from '../../../lib/api';

interface Counts {
  ALL: number;
  PENDING_APPROVAL: number;
  ACTIVE: number;
  SUSPENDED: number;
  REJECTED: number;
  KYC_PENDING: number;
  PAYOUT_REQUESTED: number;
  COMMISSION_PENDING: number;
  COMMISSION_CONFIRMED: number;
  COMMISSION_PAID: number;
}

interface Totals {
  PENDING: { sum: string; count: number };
  HOLD: { sum: string; count: number };
  CONFIRMED: { sum: string; count: number };
  PAID: { sum: string; count: number };
  CANCELLED: { sum: string; count: number };
  REVERSED: { sum: string; count: number };
}

interface TopEarner {
  rank: number;
  affiliateId: string;
  totalEarned: string;
  commissionCount: number;
  affiliate: { id: string; firstName: string; lastName: string; email: string; status: string } | null;
}

export default function OverviewPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [top, setTop] = useState<TopEarner[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [
          all,
          pendingApp,
          active,
          suspended,
          rejected,
          kycPending,
          payouts,
          totalsRes,
          topRes,
        ] = await Promise.all([
          apiFetch<{ pagination: { total: number } }>('/admin/affiliates?limit=1'),
          apiFetch<{ pagination: { total: number } }>('/admin/affiliates?status=PENDING_APPROVAL&limit=1'),
          apiFetch<{ pagination: { total: number } }>('/admin/affiliates?status=ACTIVE&limit=1'),
          apiFetch<{ pagination: { total: number } }>('/admin/affiliates?status=SUSPENDED&limit=1'),
          apiFetch<{ pagination: { total: number } }>('/admin/affiliates?status=REJECTED&limit=1'),
          apiFetch<{ pagination: { total: number } }>('/admin/affiliates?kycStatus=PENDING&limit=1'),
          apiFetch<{ pagination: { total: number } }>('/admin/affiliates/payouts?status=REQUESTED&limit=1'),
          apiFetch<Totals>('/admin/affiliates/commissions/totals'),
          apiFetch<{ rows: TopEarner[] }>('/admin/affiliates/reports/top-earners?limit=5'),
        ]);
        setCounts({
          ALL: all.pagination.total,
          PENDING_APPROVAL: pendingApp.pagination.total,
          ACTIVE: active.pagination.total,
          SUSPENDED: suspended.pagination.total,
          REJECTED: rejected.pagination.total,
          KYC_PENDING: kycPending.pagination.total,
          PAYOUT_REQUESTED: payouts.pagination.total,
          COMMISSION_PENDING: totalsRes.PENDING.count,
          COMMISSION_CONFIRMED: totalsRes.CONFIRMED.count,
          COMMISSION_PAID: totalsRes.PAID.count,
        });
        setTotals(totalsRes);
        setTop(topRes.rows ?? []);
      } catch (e: any) {
        setError(e?.message ?? 'Could not load overview.');
      }
    };
    load();
  }, []);

  if (error) return <p style={{ color: '#b91c1c' }}>{error}</p>;
  if (!counts || !totals) return <OverviewSkeleton />;

  const actionItems = [
    {
      n: counts.PENDING_APPROVAL,
      label: 'applications to review',
      href: '/dashboard',
      tone: 'warning' as const,
    },
    {
      n: counts.KYC_PENDING,
      label: 'KYC submissions to verify',
      href: '/dashboard/kyc',
      tone: 'warning' as const,
    },
    {
      n: counts.PAYOUT_REQUESTED,
      label: 'payouts to approve',
      href: '/dashboard/payouts',
      tone: 'warning' as const,
    },
  ];
  const inboxZero = actionItems.every((a) => a.n === 0);

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Hero */}
      <header
        style={{
          position: 'relative',
          padding: '24px 28px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #312e81 100%)',
          color: '#fff',
          borderRadius: 14,
          marginBottom: 22,
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', right: -60, top: -60, width: 240, height: 240, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99, 102, 241, 0.4) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 4 }}>
            Affiliate Admin
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
            Overview
          </h1>
          <p style={{ fontSize: 13, color: '#cbd5e1', margin: '6px 0 0', maxWidth: 560 }}>
            Platform-wide health check. Action items first, then revenue, then performers.
          </p>
        </div>
      </header>

      {/* Action items */}
      <section style={{ marginBottom: 24 }}>
        <SectionHeader>Needs your attention</SectionHeader>
        {inboxZero ? (
          <div
            style={{
              padding: 22,
              background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfeff 100%)',
              border: '1px solid #bbf7d0',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div style={{ fontSize: 28 }}>✨</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#15803d' }}>Inbox zero</div>
              <div style={{ fontSize: 12, color: '#15803d' }}>
                No applications, KYC submissions, or payouts waiting on you.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {actionItems.map((a) =>
              a.n > 0 ? (
                <Link key={a.href} href={a.href} style={{ textDecoration: 'none' }}>
                  <div
                    style={{
                      padding: 16,
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      cursor: 'pointer',
                      transition: 'transform 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 6px 14px rgba(180, 83, 9, 0.12)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        background: '#fef3c7',
                        color: '#92400e',
                        fontSize: 22,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {a.n}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                        {a.label}
                      </div>
                      <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>Tap to review →</div>
                    </div>
                  </div>
                </Link>
              ) : null,
            )}
          </div>
        )}
      </section>

      {/* Affiliate counts */}
      <section style={{ marginBottom: 24 }}>
        <SectionHeader>Affiliate base</SectionHeader>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <Tile label="Total" value={counts.ALL} tone="neutral" />
          <Tile label="Active" value={counts.ACTIVE} tone="success" />
          <Tile label="Pending" value={counts.PENDING_APPROVAL} tone="warning" />
          <Tile label="Suspended" value={counts.SUSPENDED} tone="danger" />
          <Tile label="Rejected" value={counts.REJECTED} tone="muted" />
        </div>
      </section>

      {/* Money */}
      <section style={{ marginBottom: 24 }}>
        <SectionHeader>Commissions across the platform</SectionHeader>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <MoneyTile label="Pending" sum={totals.PENDING.sum} count={totals.PENDING.count} tone="warning" />
          <MoneyTile label="Confirmed" sum={totals.CONFIRMED.sum} count={totals.CONFIRMED.count} tone="info" />
          <MoneyTile label="Paid" sum={totals.PAID.sum} count={totals.PAID.count} tone="success" />
          <MoneyTile label="Reversed" sum={totals.REVERSED.sum} count={totals.REVERSED.count} tone="danger" />
        </div>
      </section>

      {/* Top earners + quick links */}
      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Top earners</h3>
            <Link href="/dashboard/reports" style={{ fontSize: 12, color: '#1d4ed8', fontWeight: 600, textDecoration: 'none' }}>
              See full report →
            </Link>
          </div>
          {top.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              No earnings yet — first sales will surface here.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {top.map((t, i) => (
                <li
                  key={t.affiliateId}
                  style={{
                    padding: '12px 18px',
                    borderBottom: i === top.length - 1 ? 'none' : '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: t.rank === 1 ? '#fef3c7' : '#f1f5f9',
                      color: t.rank === 1 ? '#92400e' : '#475569',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 12,
                      flexShrink: 0,
                    }}
                  >
                    #{t.rank}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {t.affiliate ? `${t.affiliate.firstName} ${t.affiliate.lastName}` : 'Unknown'}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                      {t.affiliate?.email ?? ''}
                      {' · '}
                      {t.commissionCount} commission{t.commissionCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#16a34a', fontVariantNumeric: 'tabular-nums' }}>
                    {formatINR(t.totalEarned)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <QuickLink href="/dashboard/commissions" title="Commission ledger" sub="Search and filter every commission" />
          <QuickLink href="/dashboard/tds" title="TDS records" sub="Per-FY tax aggregations for filing" />
          <QuickLink href="/dashboard/reports" title="Reports" sub="Top earners + program analytics" />
          <QuickLink href="/dashboard/settings" title="Settings" sub="Defaults & TDS thresholds" />
        </div>
      </section>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 13, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 10px' }}>
      {children}
    </h2>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'muted' }) {
  const fg =
    tone === 'success' ? '#16a34a' :
    tone === 'warning' ? '#b45309' :
    tone === 'danger' ? '#b91c1c' :
    tone === 'neutral' ? '#0f172a' :
    '#64748b';
  return (
    <div style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: fg, marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
        {value}
      </div>
    </div>
  );
}

function MoneyTile({ label, sum, count, tone }: { label: string; sum: string; count: number; tone: 'success' | 'warning' | 'info' | 'danger' }) {
  const fg =
    tone === 'success' ? '#16a34a' :
    tone === 'warning' ? '#b45309' :
    tone === 'info' ? '#1d4ed8' :
    '#b91c1c';
  return (
    <div style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: fg, marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
        {formatINR(sum)}
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
        {count} commission{count === 1 ? '' : 's'}
      </div>
    </div>
  );
}

function QuickLink({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: 14,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{title}</div>
        <div style={{ color: '#94a3b8' }}>→</div>
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{sub}</div>
    </Link>
  );
}

function OverviewSkeleton() {
  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ height: 110, background: '#f1f5f9', borderRadius: 14, marginBottom: 22 }} />
      <div style={{ height: 100, background: '#f1f5f9', borderRadius: 12, marginBottom: 22 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 22 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ height: 80, background: '#f1f5f9', borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}
