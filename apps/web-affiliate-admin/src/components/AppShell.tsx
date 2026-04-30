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
            Affiliate Admin
          </div>
        </div>
        <nav style={{ padding: '12px 0' }}>
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
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                    }}
                  >
                    {item.section}
                  </div>
                )}
                <Link
                  href={item.href}
                  style={{
                    display: 'block',
                    padding: '9px 20px',
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
          <div style={{ fontSize: 13, color: '#475569' }}>
            <strong style={{ color: '#0f172a' }}>{identity?.email ?? '—'}</strong>{' '}
            <span style={{ marginLeft: 6, padding: '3px 9px', fontSize: 11, fontWeight: 600, borderRadius: 999, background: '#e0e7ff', color: '#3730a3' }}>
              {identity?.role.replace(/_/g, ' ')}
            </span>
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
        </header>

        <main style={{ flex: 1, padding: 28, overflowX: 'auto' }}>{children}</main>
      </div>
    </div>
  );
}
