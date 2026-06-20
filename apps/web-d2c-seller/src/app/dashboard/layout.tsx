'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { type SellerProfileData } from '@/services/profile.service';
import { sellerAuthService } from '@/services/auth.service';
import './dashboard.css';

interface SellerInfo {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
  status?: string;
  isEmailVerified?: boolean;
  verificationStatus?: SellerProfileData['verificationStatus'];
}

function getInitials(name?: string | null): string {
  return ((name ?? '').trim() || '?')
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Phase 19 (2026-05-20) — seller dashboard layout.
 *
 * Three audit-driven changes:
 *
 *   1. Onboarding redirect. After the profile fetch resolves, any
 *      seller whose account is not fully verified (email-verified +
 *      status=ACTIVE + verificationStatus=VERIFIED) is redirected to
 *      /dashboard/onboarding. Public routes within the dashboard
 *      that the seller is allowed to access pre-approval —
 *      /dashboard/onboarding itself and /dashboard/profile — are
 *      exempted from the redirect.
 *
 *   2. The "pending approval" banner is now a clickable Link to
 *      /dashboard/onboarding.
 *
 *   3. Sign-out calls the server (`sellerAuthService.logout()`)
 *      before clearing local state, so the SellerSession row is
 *      actually revoked and cookies cleared. Best-effort: a 401
 *      here still clears the UI state.
 *
 * Cross-tab profile-refresh: a 'seller-profile-updated' event
 * triggers a refetch of /seller/profile. The onboarding wizard
 * dispatches this after submit/verify so the layout's banner +
 * sidebar state update without a hard reload.
 */
const ONBOARDING_EXEMPT_PATHS = [
  '/dashboard/onboarding',
  '/dashboard/profile',
  '/dashboard/support',
];

function isExemptFromGate(pathname: string): boolean {
  return ONBOARDING_EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [seller, setSeller] = useState<SellerInfo | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const refreshProfile = useCallback(async () => {
    try {
      // Phase 21 — the access token lives in an httpOnly cookie, not
      // sessionStorage. Validate the session via the cookie-authenticated
      // /seller/auth/me endpoint; bounce to /login only if it fails.
      const res = await sellerAuthService.me().catch(() => null);
      if (!res?.data) {
        router.replace('/login');
        return;
      }
      const me = res.data;
      // Portal-type guard. Seller-session cookies are scoped to the host
      // (`localhost`), NOT the port — so a session created in the Retail portal
      // (:4009) leaks into this D2C portal (:4003) in the same browser. Without
      // this check the D2C portal would render a RETAIL seller's account. If the
      // validated session isn't a D2C seller, bounce to login (don't clear the
      // cookie — that would also kill the other portal's session).
      if (me.sellerType && me.sellerType !== 'D2C') {
        router.replace('/login?wrongPortal=' + encodeURIComponent(me.sellerType));
        return;
      }
      setSeller({
        sellerId: me.sellerId,
        sellerName: me.sellerName,
        sellerShopName: me.sellerShopName,
        email: me.email,
        phoneNumber: me.phoneNumber,
        status: me.status,
        isEmailVerified: me.isEmailVerified,
        verificationStatus:
          me.verificationStatus as SellerProfileData['verificationStatus'],
      });
    } catch {
      router.replace('/login');
    }
  }, [router]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  // Phase 19 (2026-05-20) — listen for cross-tab + intra-app
  // 'seller-profile-updated' events so the onboarding wizard can
  // poke the layout to re-fetch after a status change. Without this,
  // the banner + sidebar stay stale until the user navigates.
  useEffect(() => {
    const handler = () => {
      void refreshProfile();
    };
    window.addEventListener('seller-profile-updated', handler);
    return () => window.removeEventListener('seller-profile-updated', handler);
  }, [refreshProfile]);

  // Outside-click for the user dropdown.
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Phase 19 (2026-05-20) — onboarding redirect gate. Skip while the
  // profile is still loading (seller=null) and skip on exempt paths
  // so the seller can actually reach /dashboard/onboarding etc.
  useEffect(() => {
    if (!seller) return;
    if (isExemptFromGate(pathname)) return;
    const fullyApproved =
      seller.isEmailVerified === true &&
      seller.status === 'ACTIVE' &&
      seller.verificationStatus === 'VERIFIED';
    if (!fullyApproved) {
      router.replace('/dashboard/onboarding');
    }
  }, [seller, pathname, router]);

  const handleLogout = useCallback(async () => {
    setDropdownOpen(false);
    try {
      // Server-side revoke first, then clear local. A 401 here
      // (token already expired) is fine — local clear still runs.
      await sellerAuthService.logout();
    } catch {
      // Best-effort.
    }
    try {
      sessionStorage.removeItem('accessToken');
      sessionStorage.removeItem('refreshToken');
      sessionStorage.removeItem('seller');
    } catch {
      // Storage unavailable
    }
    router.replace('/login');
  }, [router]);

  if (!seller) return null;

  const initials = getInitials(seller.sellerName);

  const isPending = seller.status === 'PENDING_APPROVAL';
  const isEmailUnverified = seller.isEmailVerified === false;
  const isUnderReview = seller.verificationStatus === 'UNDER_REVIEW';
  const isRejected = seller.verificationStatus === 'REJECTED';
  const isActive =
    seller.status === 'ACTIVE' &&
    seller.verificationStatus === 'VERIFIED' &&
    seller.isEmailVerified === true;

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: '&#9776;' },
    { href: '/dashboard/profile', label: 'My Profile', icon: '&#128100;' },
    { href: '/dashboard/catalog', label: 'Browse Catalog', icon: '&#128270;', disabled: !isActive, description: 'Find and map existing products' },
    { href: '/dashboard/catalog/my-products', label: 'My Products', icon: '&#128230;', disabled: !isActive, description: 'View all your mapped products' },
    { href: '/dashboard/products', label: 'Submit Product', icon: '&#128221;', disabled: !isActive, description: 'Create your own product listing' },
    { href: '/dashboard/inventory', label: 'Inventory', icon: '&#128200;', disabled: !isActive, description: 'Stock levels, low-stock, out-of-stock' },
    { href: '/dashboard/orders', label: 'Orders', icon: '&#128195;', disabled: !isActive },
    { href: '/dashboard/returns', label: 'Returns', icon: '&#8617;', disabled: !isActive },
    { href: '/dashboard/reversals', label: 'Reversals', icon: '&#128257;', disabled: !isActive, description: 'B2B / off-platform reversal requests' },
    { href: '/dashboard/disputes', label: 'Disputes', icon: '&#9888;', disabled: !isActive, description: 'Respond to customer disputes; 72h SLA' },
    { href: '/dashboard/commission', label: 'Commission', icon: '&#128176;', disabled: !isActive },
    { href: '/dashboard/accounts', label: 'My Finances', icon: '&#128202;', disabled: !isActive, description: 'Revenue, payables, TDS/TCS, settlements — one view' },
    { href: '/dashboard/tax/invoices', label: 'Tax Invoices', icon: '&#129534;', disabled: !isActive, description: 'GST invoices, credit notes — download for filing' },
    { href: '/dashboard/tax/tcs', label: 'TCS (Sec 52)', icon: '&#128179;', disabled: !isActive, description: 'TCS collected at source — status & §52(5) certificates' },
    { href: '/dashboard/support', label: 'Support', icon: '&#128172;' },
    { href: '/dashboard/analytics', label: 'Analytics', icon: '&#128200;' },
  ];

  // Banner content depends on the seller's current state. The
  // banner is wrapped in a Link to /dashboard/onboarding so a
  // click goes straight to the wizard.
  const banner = (() => {
    // On the onboarding page itself every banner would just self-link back
    // here, so hide it — the page already shows the relevant step inline.
    if (pathname === '/dashboard/onboarding') return null;
    if (isEmailUnverified) {
      return {
        href: '/dashboard/onboarding',
        bg: '#fee2e2',
        border: '#ef4444',
        color: '#991b1b',
        text: 'Verify your email to continue. Click here to open the verification step.',
      };
    }
    if (isRejected) {
      return {
        href: '/dashboard/onboarding',
        bg: '#fee2e2',
        border: '#ef4444',
        color: '#991b1b',
        text: 'Your onboarding was rejected. Click here to view the reason and resubmit.',
      };
    }
    if (isUnderReview) {
      return {
        href: '/dashboard/onboarding',
        bg: '#fef3c7',
        border: '#f59e0b',
        color: '#92400e',
        text: 'Your onboarding is under admin review. Click here to check status.',
      };
    }
    if (isPending) {
      return {
        href: '/dashboard/onboarding',
        bg: '#fef3c7',
        border: '#f59e0b',
        color: '#92400e',
        text: 'Complete onboarding to activate your seller account. Click here to start.',
      };
    }
    return null;
  })();

  return (
    <div className="dashboard-shell">
      {/* Top Navbar */}
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
            <span className="navbar-brand-tag">D2C Seller</span>
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
                <div className="navbar-user-name">{seller.sellerName}</div>
                <div className="navbar-user-shop">{seller.sellerShopName}</div>
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
                    {seller.sellerName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {seller.email}
                  </div>
                </div>
                <Link
                  href="/dashboard/profile"
                  className="navbar-dropdown-item"
                  onClick={() => setDropdownOpen(false)}
                >
                  <span className="dropdown-icon">&#128100;</span>
                  My Profile
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
          {navItems.map(item => (
            <Link
              key={item.href + item.label}
              href={item.disabled ? '#' : item.href}
              className={`sidebar-nav-item${
                !item.disabled && (
                  item.href === '/dashboard'
                    ? pathname === '/dashboard'
                    : item.href === '/dashboard/catalog'
                      ? pathname === '/dashboard/catalog'
                      : pathname.startsWith(item.href)
                ) ? ' active' : ''
              }`}
              style={item.disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
              onClick={e => {
                if (item.disabled) e.preventDefault();
              }}
            >
              <span
                className="nav-icon"
                dangerouslySetInnerHTML={{ __html: item.icon }}
              />
              {item.label}
              {item.disabled && (
                <span style={{
                  fontSize: 9,
                  background: '#e5e7eb',
                  color: '#6b7280',
                  padding: '1px 6px',
                  borderRadius: 4,
                  fontWeight: 600,
                  marginLeft: 'auto',
                }}>
                  {item.label === 'Analytics' ? 'SOON' : 'LOCKED'}
                </span>
              )}
            </Link>
          ))}
        </div>

        <div className="sidebar-section" style={{ marginTop: 16 }}>
          <div className="sidebar-section-label">Settings</div>
          <Link
            href="/dashboard/profile"
            className={`sidebar-nav-item${pathname === '/dashboard/profile' ? ' active' : ''}`}
          >
            <span className="nav-icon">&#9881;</span>
            Account Settings
          </Link>
        </div>
      </aside>

      <main className="dashboard-content">
        {banner && (
          <Link
            href={banner.href}
            style={{
              display: 'block',
              background: banner.bg,
              border: `1px solid ${banner.border}`,
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 16,
              color: banner.color,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            {banner.text}
          </Link>
        )}
        {children}
      </main>
    </div>
  );
}
