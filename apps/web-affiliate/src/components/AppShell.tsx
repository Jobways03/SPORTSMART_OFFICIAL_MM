'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch, clearSession } from '../lib/api';

interface Profile {
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  kycStatus: string;
}

const NAV: Array<{ href: string; label: string }> = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/earnings', label: 'Earnings' },
  { href: '/dashboard/coupons', label: 'Coupons & Links' },
  { href: '/dashboard/kyc', label: 'KYC' },
  { href: '/dashboard/payouts', label: 'Payouts' },
  { href: '/dashboard/profile', label: 'Profile' },
];

/**
 * Authenticated shell for every /dashboard/* page. Reads the
 * affiliate's profile once and exposes it via context-less prop —
 * each page does its own data fetching. The shell is responsible
 * for: redirect-if-not-logged-in, sidebar nav, top bar with status
 * pill + sign-out.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = sessionStorage.getItem('affiliateToken');
    if (!token) {
      router.replace('/login');
      return;
    }
    apiFetch<Profile>('/affiliate/me')
      .then(setProfile)
      .catch(() => setAuthError(true));
  }, [router]);

  const handleLogout = () => {
    clearSession();
    router.replace('/login');
  };

  if (authError) {
    return (
      <main style={{ padding: 40, textAlign: 'center', color: '#b91c1c' }}>
        Session expired. <Link href="/login">Sign in again</Link>.
      </main>
    );
  }
  if (!profile) {
    return <main style={{ padding: 40, color: '#64748b' }}>Loading…</main>;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 240,
          background: '#0f172a',
          color: '#e2e8f0',
          padding: '20px 0',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '0 20px 20px', borderBottom: '1px solid #1e293b' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            SportsMart
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginTop: 2 }}>
            Affiliate Portal
          </div>
        </div>
        <nav style={{ padding: '12px 0' }}>
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'block',
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: active ? 600 : 500,
                  color: active ? '#fff' : '#cbd5e1',
                  background: active ? '#1e293b' : 'transparent',
                  borderLeft: '3px solid ' + (active ? '#3b82f6' : 'transparent'),
                  textDecoration: 'none',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 28px',
            background: '#fff',
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: '#dbeafe',
                color: '#1d4ed8',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
              }}
            >
              {profile.firstName?.[0]}{profile.lastName?.[0]}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {profile.firstName} {profile.lastName}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{profile.email}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={statusPill(profile.status)}>{profile.status.replace(/_/g, ' ')}</span>
            <span style={kycPill(profile.kycStatus)}>KYC: {profile.kycStatus.replace(/_/g, ' ')}</span>
            <button
              onClick={handleLogout}
              style={{
                padding: '7px 14px',
                background: '#fff',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        <main style={{ flex: 1, padding: 28, overflowX: 'auto' }}>{children}</main>
      </div>
    </div>
  );
}

function statusPill(status: string): React.CSSProperties {
  const palette: Record<string, { bg: string; fg: string }> = {
    PENDING_APPROVAL: { bg: '#fef3c7', fg: '#92400e' },
    ACTIVE: { bg: '#dcfce7', fg: '#15803d' },
    REJECTED: { bg: '#fee2e2', fg: '#991b1b' },
    SUSPENDED: { bg: '#fef2f2', fg: '#b91c1c' },
    INACTIVE: { bg: '#e2e8f0', fg: '#475569' },
  };
  const p = palette[status] ?? { bg: '#f1f5f9', fg: '#475569' };
  return {
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 999,
    background: p.bg,
    color: p.fg,
  };
}

function kycPill(status: string): React.CSSProperties {
  const palette: Record<string, { bg: string; fg: string }> = {
    NOT_STARTED: { bg: '#f1f5f9', fg: '#475569' },
    PENDING: { bg: '#fef3c7', fg: '#92400e' },
    VERIFIED: { bg: '#dcfce7', fg: '#15803d' },
    REJECTED: { bg: '#fee2e2', fg: '#991b1b' },
  };
  const p = palette[status] ?? { bg: '#f1f5f9', fg: '#475569' };
  return {
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 999,
    background: p.bg,
    color: p.fg,
  };
}
