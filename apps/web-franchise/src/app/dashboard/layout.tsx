'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { franchiseAuthService } from '@/services/auth.service';
import { franchiseProfileService, FranchiseProfile } from '@/services/profile.service';
import { ApiError } from '@/lib/api-client';
import { deriveBanner } from '@/lib/dashboard-banner';
import './dashboard.css';

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
  comingSoon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '&#9776;' },
  { href: '/dashboard/profile', label: 'Profile', icon: '&#128100;' },
  { href: '/dashboard/catalog', label: 'Catalog', icon: '&#128230;' },
  { href: '/dashboard/inventory', label: 'Inventory', icon: '&#128722;' },
  { href: '/dashboard/orders', label: 'Orders', icon: '&#128195;' },
  { href: '/dashboard/procurement', label: 'Procurement', icon: '&#128179;' },
  { href: '/dashboard/pos', label: 'POS', icon: '&#128273;' },
  { href: '/dashboard/commission', label: 'Commission', icon: '&#128202;' },
  { href: '/dashboard/earnings', label: 'Earnings', icon: '&#128176;' },
  { href: '/dashboard/tax/invoices', label: 'Tax Invoices', icon: '&#129534;' },
  { href: '/dashboard/staff', label: 'Staff', icon: '&#128101;' },
  { href: '/dashboard/support', label: 'Support', icon: '&#128172;' },
];


export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<FranchiseProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Phase 20 (2026-05-20) — refetch profile from /franchise/profile on
  // mount so banners reflect the latest server state (status,
  // verificationStatus, isEmailVerified) rather than the stale
  // sessionStorage snapshot captured at login.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = sessionStorage.getItem('accessToken');
        if (!token) {
          router.replace('/login');
          return;
        }
        const res = await franchiseProfileService.getProfile();
        if (cancelled) return;
        if (res.data) {
          setProfile(res.data);
          try {
            sessionStorage.setItem(
              'franchise',
              JSON.stringify({
                franchiseId: res.data.franchiseId,
                franchiseCode: res.data.franchiseCode,
                ownerName: res.data.ownerName,
                businessName: res.data.businessName,
                email: res.data.email,
                phoneNumber: res.data.phoneNumber,
                status: res.data.status,
                isEmailVerified: res.data.isEmailVerified,
              }),
            );
          } catch {
            // Storage unavailable
          }
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          try {
            sessionStorage.clear();
          } catch {
            // Storage unavailable
          }
          router.replace('/login');
          return;
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const handleLogout = useCallback(async () => {
    await franchiseAuthService.logout();
    router.push('/login');
  }, [router]);

  if (loading || !profile) return null;

  const initials = getInitials(profile.ownerName);
  const banner = deriveBanner(profile);

  return (
    <div className="dashboard-shell">
      <nav className="dashboard-navbar">
        <div className="navbar-left">
          <button
            className="navbar-hamburger"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
          >
            &#9776;
          </button>
          <Link href="/dashboard" className="navbar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/SportsMart_Web_Banner.avif"
              alt="SportsMart"
              className="navbar-brand-name"
              style={{ height: 36, width: 'auto', display: 'block' }}
            />
            <span className="navbar-brand-tag">Franchise</span>
          </Link>
        </div>

        <div className="navbar-right">
          <div className="navbar-user" ref={dropdownRef}>
            <button
              className="navbar-dropdown-toggle"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              aria-expanded={dropdownOpen}
              aria-haspopup="true"
            >
              <div className="navbar-user-info">
                <div className="navbar-user-name">{profile.ownerName}</div>
                <div className="navbar-user-shop">{profile.businessName}</div>
              </div>
              <div className="navbar-avatar">{initials}</div>
              <span className={`navbar-dropdown-arrow${dropdownOpen ? ' open' : ''}`}>
                &#9660;
              </span>
            </button>

            {dropdownOpen && (
              <div className="navbar-dropdown">
                <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', marginBottom: 4 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                    {profile.ownerName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {profile.email}
                  </div>
                  {profile.franchiseCode && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                      Code: {profile.franchiseCode}
                    </div>
                  )}
                </div>
                <Link
                  href="/dashboard/profile"
                  className="navbar-dropdown-item"
                  onClick={() => setDropdownOpen(false)}
                >
                  <span className="dropdown-icon">&#128100;</span>
                  Profile
                </Link>
                <div className="navbar-dropdown-divider" />
                <button
                  className="navbar-dropdown-item danger"
                  onClick={handleLogout}
                >
                  <span className="dropdown-icon">&#10140;</span>
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <div
        className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`dashboard-sidebar${sidebarOpen ? ' mobile-open' : ''}`}>
        <div className="sidebar-section">
          <div className="sidebar-section-label">Menu</div>
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-nav-item${isActive ? ' active' : ''}`}
              >
                <span className="nav-icon" dangerouslySetInnerHTML={{ __html: item.icon }} />
                {item.label}
                {item.comingSoon && <span className="sidebar-badge">SOON</span>}
              </Link>
            );
          })}
        </div>
      </aside>

      <main className="dashboard-content">
        {banner && (
          <div
            role={banner.kind === 'error' || banner.kind === 'warning' ? 'alert' : 'status'}
            style={{
              padding: '12px 16px',
              marginBottom: 16,
              borderRadius: 8,
              border: '1px solid',
              borderColor:
                banner.kind === 'error'
                  ? '#fca5a5'
                  : banner.kind === 'warning'
                    ? '#fcd34d'
                    : banner.kind === 'success'
                      ? '#86efac'
                      : '#93c5fd',
              backgroundColor:
                banner.kind === 'error'
                  ? '#fef2f2'
                  : banner.kind === 'warning'
                    ? '#fffbeb'
                    : banner.kind === 'success'
                      ? '#f0fdf4'
                      : '#eff6ff',
              color:
                banner.kind === 'error'
                  ? '#991b1b'
                  : banner.kind === 'warning'
                    ? '#92400e'
                    : banner.kind === 'success'
                      ? '#166534'
                      : '#1e40af',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
              fontSize: 14,
            }}
          >
            <span>{banner.text}</span>
            {banner.ctaHref && banner.ctaLabel && (
              <Link
                href={banner.ctaHref}
                style={{
                  color: 'inherit',
                  fontWeight: 600,
                  textDecoration: 'underline',
                  whiteSpace: 'nowrap',
                }}
              >
                {banner.ctaLabel}
              </Link>
            )}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
