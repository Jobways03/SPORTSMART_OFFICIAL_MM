'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiFetch, logout as apiLogout } from '../lib/api';

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
  // KYC temporarily disabled (commented out per product request).
  // Re-enable by uncommenting the line below + the matching route + the
  // KYC steps in dashboard/payouts checklists + the backend KYC routes.
  // { href: '/dashboard/kyc', label: 'KYC' },
  { href: '/dashboard/payouts', label: 'Payouts' },
  { href: '/dashboard/tds', label: 'TDS' },
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/support', label: 'Support' },
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

  const handleLogout = async () => {
    // Phase 22 (2026-05-20) — server-side revoke + cookie clear via
    // POST /affiliate/auth/logout, then drop local sessionStorage and
    // navigate. apiLogout() swallows transport errors so the UI still
    // lands at /login even if the access token expired mid-call.
    await apiLogout();
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

  const initials = `${profile.firstName?.[0] ?? ''}${profile.lastName?.[0] ?? ''}`.toUpperCase() || 'AP';

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Top Navbar */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 60,
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          zIndex: 200,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            href="/dashboard"
            style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/SportsMart_Web_Banner.avif"
              alt="SportsMart"
              style={{ height: 36, width: 'auto', display: 'block' }}
            />
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#fff',
                background: '#dc2626',
                padding: '2px 8px',
                borderRadius: 4,
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              AFFILIATE PORTAL
            </span>
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={statusPill(profile.status)}>{profile.status.replace(/_/g, ' ')}</span>
          {/* KYC pill hidden — see /dashboard/kyc disable note above */}
          {/* <span style={kycPill(profile.kycStatus)}>KYC: {profile.kycStatus.replace(/_/g, ' ')}</span> */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', lineHeight: 1.2 }}>
                {profile.firstName} {profile.lastName}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.2 }}>{profile.email}</div>
            </div>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: '#dc2626',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {initials}
            </div>
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
        </div>
      </header>

      <div style={{ display: 'flex', minHeight: '100vh', paddingTop: 60 }}>
        <aside
          style={{
            position: 'fixed',
            top: 60,
            left: 0,
            bottom: 0,
            width: 240,
            background: '#0f172a',
            color: '#cbd5e1',
            padding: '16px 0',
            overflowY: 'auto',
            zIndex: 90,
          }}
        >
          <nav style={{ padding: '4px 0' }}>
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

        <main style={{ flex: 1, minWidth: 0, marginLeft: 240, padding: 28, overflowX: 'auto', background: '#f6f6f7', minHeight: 'calc(100vh - 60px)' }}>
          {children}
        </main>
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
