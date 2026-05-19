'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearSession } from '../lib/api';

const NAV: Array<{ href: string; label: string; section?: string }> = [
  { href: '/dashboard/overview', label: 'Overview', section: 'Home' },
  { href: '/dashboard', label: 'Applications', section: 'Affiliates' },
  { href: '/dashboard/kyc', label: 'KYC review', section: 'Affiliates' },
  { href: '/dashboard/commissions', label: 'Commissions', section: 'Money' },
  { href: '/dashboard/payouts', label: 'Payouts', section: 'Money' },
  { href: '/dashboard/tds', label: 'TDS records', section: 'Money' },
  { href: '/dashboard/reports', label: 'Reports', section: 'Insights' },
  { href: '/dashboard/settings', label: 'Settings', section: 'Insights' },
];

/**
 * Admin shell. Reads the admin profile (email + role) from
 * sessionStorage where login.tsx stashed it, so we don't need
 * an extra round trip for the topbar identity. Auth check is a
 * cheap "do we have a token at all" — the server is the real
 * gate via 401 handling on every API call.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [identity, setIdentity] = useState<{ email: string; role: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setHydrated(true);
    const token = sessionStorage.getItem('adminToken');
    if (!token) {
      router.replace('/login');
      return;
    }
    const profileRaw = sessionStorage.getItem('adminProfile');
    if (profileRaw) {
      try {
        const p = JSON.parse(profileRaw);
        setIdentity({ email: p.email ?? 'admin', role: p.role ?? 'ADMIN' });
      } catch {
        setIdentity({ email: 'admin', role: 'ADMIN' });
      }
    } else {
      setIdentity({ email: 'admin', role: 'ADMIN' });
    }
  }, [router]);

  const handleLogout = () => {
    clearSession();
    router.replace('/login');
  };

  if (!hydrated) return null;

  const initials = (identity?.email ?? 'AA')
    .split('@')[0]
    .split(/[._-]/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'AA';

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
              AFFILIATE ADMIN
            </span>
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', lineHeight: 1.2 }}>
                {identity?.email ?? 'Admin'}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.2 }}>
                {identity?.role.replace(/_/g, ' ') ?? 'ADMIN'}
              </div>
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
            {NAV.map((item, i) => {
              const active =
                pathname === item.href ||
                (item.href !== '/dashboard' && pathname?.startsWith(item.href));
              const prevSection = i > 0 ? NAV[i - 1].section : null;
              const showHeader = item.section && item.section !== prevSection;
              return (
                <div key={item.href}>
                  {showHeader && (
                    <div
                      style={{
                        padding: '14px 20px 6px',
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: 1.5,
                      }}
                    >
                      {item.section}
                    </div>
                  )}
                  <Link
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
                </div>
              );
            })}
          </nav>
        </aside>

        <main style={{ flex: 1, marginLeft: 240, padding: 28, overflowX: 'auto', background: '#f6f6f7', minHeight: 'calc(100vh - 60px)' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
