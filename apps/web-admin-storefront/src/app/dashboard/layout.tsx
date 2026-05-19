'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { PermissionsProvider, usePermissions } from '@/lib/permissions';
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
  label: string;
  href: string;
  icon: string;
  hasPendingBadge?: boolean;
  /**
   * Permission gate for this nav item. Empty / missing = always visible
   * (only used for Home today). When set, the item is rendered only if
   * the current admin has at least one of these permission keys. SUPER_ADMIN
   * short-circuits to true inside hasAnyPermission, so this is safe to apply
   * even to platform-only sections.
   *
   * Keep keys aligned with permission-registry.ts. If a section is opened
   * up to a new role, change the registry's SYSTEM_ROLE_PERMISSIONS rather
   * than loosening the anyOf here — that way backend + UI stay in sync.
   */
  anyOf?: string[];
}

// Sidebar groups, ordered by how often an admin uses them during a
// typical day. Operations is what touches money and customers right
// now (highest priority); Growth is reporting / campaigns (lowest).
// Section headers render automatically when `section` changes between
// adjacent visible items.
type NavSection = 'operations' | 'care' | 'finance' | 'risk' | 'growth';

const SECTION_LABELS: Record<NavSection, string> = {
  operations: 'Operations',
  care: 'Customer Care',
  finance: 'Finance',
  risk: 'Risk',
  growth: 'Growth',
};

const navItems: (NavItem & { section?: NavSection })[] = [
  // Home stands alone at the top — no section header above it.
  { label: 'Home', href: '/dashboard', icon: '🏠' },

  // Operations — day-to-day order/catalog work, highest priority.
  { label: 'Orders', href: '/dashboard/orders', icon: '📋', hasPendingBadge: true, anyOf: ['orders.read'], section: 'operations' },
  { label: 'Products', href: '/dashboard/products', icon: '📦', anyOf: ['products.read', 'catalog.read'], section: 'operations' },
  // Inventory has no dedicated permission key today — falls under products.
  { label: 'Inventory', href: '/dashboard/inventory', icon: '📊', anyOf: ['products.read'], section: 'operations' },
  { label: 'Low-stock alerts', href: '/dashboard/inventory/alerts', icon: '🚨', anyOf: ['products.read'], section: 'operations' },

  // Customer Care — escalations and people-facing queues.
  { label: 'Queues', href: '/dashboard/queues', icon: '🗂️', anyOf: ['audit.read'], section: 'care' },
  { label: 'Returns', href: '/dashboard/returns', icon: '↩️', anyOf: ['returns.read'], section: 'care' },
  { label: 'Disputes', href: '/dashboard/disputes', icon: '⚖️', anyOf: ['disputes.read'], section: 'care' },
  { label: 'Support', href: '/dashboard/support', icon: '💬', anyOf: ['support.read'], section: 'care' },
  { label: 'Customers', href: '/dashboard/customers', icon: '👥', anyOf: ['customers.read'], section: 'care' },

  // Finance — money flow. Approvals first because they block payouts.
  { label: 'Finance Approvals', href: '/dashboard/finance/refund-approvals', icon: '💸', anyOf: ['refunds.approve', 'refunds.read'], section: 'finance' },
  { label: 'Commission', href: '/dashboard/commission', icon: '💰', anyOf: ['settlements.read'], section: 'finance' },
  { label: 'Wallets', href: '/dashboard/wallets', icon: '💳', anyOf: ['wallets.read'], section: 'finance' },
  { label: 'Payment Ops', href: '/dashboard/payment-ops', icon: '🛡️', anyOf: ['paymentOps.read'], section: 'finance' },
  { label: 'Reconciliation', href: '/dashboard/reconciliation', icon: '⚖️', anyOf: ['recon.read'], section: 'finance' },
  // Liability Ledger is finance ops — `refunds.approve` already gates the
  // backend list endpoint, mirror that here.
  { label: 'Liability Ledger', href: '/dashboard/liability-ledger', icon: '📒', anyOf: ['refunds.approve'], section: 'finance' },
  // Phase 25 GST — admin tax dashboard (mode badge + audit readiness +
  // GSTR-1/3B/8 exports + TCS lifecycle transitions). Gated on the
  // broadest tax.* read key so any finance / tax-ops admin can land
  // on it; per-endpoint gating happens at the backend.
  { label: 'Tax / GST', href: '/dashboard/tax', icon: '🧾', anyOf: ['tax.reports.read', 'tax.tcs.read'], section: 'finance' },

  // Risk — fraud / abuse review, occasional but high-stakes.
  { label: 'Risk Review', href: '/dashboard/risk-review', icon: '⚠️', anyOf: ['risk.review'], section: 'risk' },

  // Growth — campaigns and reporting, used less frequently.
  { label: 'Discounts', href: '/dashboard/discounts', icon: '🏷️', anyOf: ['discounts.read'], section: 'growth' },
  { label: 'Marketing', href: '/dashboard/marketing', icon: '📣', anyOf: ['discounts.read'], section: 'growth' },
  { label: 'Analytics', href: '/dashboard/analytics', icon: '📈', anyOf: ['analytics.read'], section: 'growth' },

  // Hidden — replacement/exchange flow disabled in UI for now.
  // { label: 'Replacements', href: '/dashboard/replacements', icon: '🔁' },
  // NOVA Brand entry removed per product request — route still exists at
  // /dashboard/nova/* if needed directly.
  // Moved into Settings (still reachable at the same URLs via the Settings hub):
  //   Notifications, Storefront Content, Storefront Navigation,
  //   Shipping, Access Logs, Admin Activity.
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Mount the permissions context once for the whole admin shell so any
  // page can call usePermissions / RequirePermission. Without this the
  // hooks throw "must be used inside <PermissionsProvider>" — and Roles /
  // Users pages crash on first render.
  return (
    <PermissionsProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </PermissionsProvider>
  );
}

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [pendingOrderCount, setPendingOrderCount] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // PR 4.6 — sidebar items filtered by the admin's effective permissions.
  // Hides "NOVA Brand" from finance-only admins, "Wallets" from catalog-only
  // admins, etc. SUPER_ADMIN sees everything because hasAnyPermission
  // short-circuits on isSuperAdmin. Filtering only runs once `me` is loaded
  // so we don't briefly flash items the admin doesn't actually have access to.
  const { loading: permsLoading, hasAnyPermission } = usePermissions();
  const visibleNavItems = useMemo(() => {
    if (permsLoading) return null;
    return navItems.filter((item) => !item.anyOf || hasAnyPermission(item.anyOf));
  }, [permsLoading, hasAnyPermission]);

  const fetchPendingOrderCount = useCallback(async () => {
    try {
      const res = await apiClient<{ orders: any[]; pagination: { total: number } }>(
        '/admin/orders?orderStatus=PLACED&limit=1'
      );
      if (res.data?.pagination?.total !== undefined) {
        setPendingOrderCount(res.data.pagination.total);
      }
    } catch {
      // Silently fail — badge just won't show
    }
  }, []);

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
    const token = sessionStorage.getItem('adminAccessToken');
    if (!token) {
      router.replace('/login');
      return;
    }
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) {
        const admin = JSON.parse(adminData);
        setAdminName(admin.name || 'Admin');
        setAdminEmail(admin.email || '');
      }
    } catch {}

    // Fetch pending order count for sidebar badge
    fetchPendingOrderCount();
    // Refresh every 60 seconds
    const interval = setInterval(fetchPendingOrderCount, 60000);
    return () => clearInterval(interval);
  }, [router, fetchPendingOrderCount]);

  const handleLogout = () => {
    sessionStorage.clear();
    router.replace('/login');
  };

  // Longest-match wins so that a nested route like /dashboard/inventory/alerts
  // highlights only "Low-stock alerts", not also the parent "Inventory".
  const activeHref = useMemo(() => {
    let best: string | null = null;
    for (const item of navItems) {
      if (item.href === '/dashboard') {
        if (pathname === '/dashboard') return '/dashboard';
        continue;
      }
      if (pathname === item.href || pathname.startsWith(item.href + '/')) {
        if (!best || item.href.length > best.length) best = item.href;
      }
    }
    return best;
  }, [pathname]);

  const isActive = (href: string) => activeHref === href;

  const initials = getInitials(adminName || 'Super Admin');

  return (
    <div className="admin-shell">
      {/* Top Navbar */}
      <nav className="admin-navbar">
        <div className="navbar-left">
          <Link href="/dashboard" className="navbar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/SportsMart_Web_Banner.avif"
              alt="SportsMart"
              className="navbar-brand-name"
              style={{ height: 36, width: 'auto', display: 'block' }}
            />
            <span className="navbar-brand-tag">SUPER ADMIN</span>
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
                <div className="navbar-user-name">{adminName || 'Super Admin'}</div>
                <div className="navbar-user-role">Super Admin</div>
              </div>
              <div className="navbar-avatar">{initials}</div>
              <span className={`navbar-dropdown-arrow${dropdownOpen ? ' open' : ''}`}>
                ▼
              </span>
            </button>

            {dropdownOpen && (
              <div className="navbar-dropdown">
                <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', marginBottom: 4 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
                    {adminName || 'Super Admin'}
                  </div>
                  {adminEmail && (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{adminEmail}</div>
                  )}
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    Super Admin
                  </div>
                </div>
                <div className="navbar-dropdown-divider" />
                <Link
                  href="/dashboard/settings"
                  className="navbar-dropdown-item"
                  onClick={() => setDropdownOpen(false)}
                >
                  Settings
                </Link>
                <button
                  className="navbar-dropdown-item danger"
                  onClick={handleLogout}
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <aside className="admin-sidebar">
        <nav className="sidebar-nav">
          {visibleNavItems === null && (
            <div style={{ padding: '8px 16px', color: '#94a3b8', fontSize: 12 }}>
              Loading…
            </div>
          )}
          {visibleNavItems !== null && visibleNavItems.length === 0 && (
            <div style={{ padding: '8px 16px', color: '#94a3b8', fontSize: 12 }}>
              Your account has no sections to display. Contact a Super Admin.
            </div>
          )}
          {(visibleNavItems ?? []).map((item, idx) => {
            const prev = idx > 0 ? visibleNavItems![idx - 1] : null;
            // Show a section label whenever the section changes between
            // adjacent visible items. Items without a section (Home) are
            // treated as their own no-header group.
            const showSectionLabel =
              item.section && (!prev || prev.section !== item.section);
            return (
            <div key={item.href}>
              {showSectionLabel && item.section && (
                <div className="sidebar-section-label">
                  {SECTION_LABELS[item.section]}
                </div>
              )}
              <Link
                href={item.href}
                className={`sidebar-item${isActive(item.href) ? ' active' : ''}`}
              >
                <span className="sidebar-item-icon">{item.icon}</span>
                {item.label}
                {'hasPendingBadge' in item && item.hasPendingBadge && pendingOrderCount > 0 && (
                  <span className="sidebar-item-badge" style={{ background: '#ef4444', color: '#fff' }}>
                    {pendingOrderCount > 99 ? '99+' : pendingOrderCount}
                  </span>
                )}
              </Link>
              {item.label === 'Products' && pathname.startsWith('/dashboard/products') && (
                <>
                  <Link
                    href="/dashboard/products/collections"
                    className={`sidebar-item${pathname.includes('/collections') ? ' active' : ''}`}
                    style={{ paddingLeft: 44, fontSize: 13 }}
                  >
                    Collections
                  </Link>
                  <Link
                    href="/dashboard/products/brands"
                    className={`sidebar-item${pathname === '/dashboard/products/brands' || pathname.startsWith('/dashboard/products/brands/') ? ' active' : ''}`}
                    style={{ paddingLeft: 44, fontSize: 13 }}
                  >
                    Brands
                  </Link>
                  <Link
                    href="/dashboard/products/categories"
                    className={`sidebar-item${pathname === '/dashboard/products/categories' ? ' active' : ''}`}
                    style={{ paddingLeft: 44, fontSize: 13 }}
                  >
                    Categories
                  </Link>
                  <Link
                    href="/dashboard/products/category-attributes"
                    className={`sidebar-item${pathname.includes('/category-attributes') ? ' active' : ''}`}
                    style={{ paddingLeft: 44, fontSize: 13 }}
                  >
                    Category Attributes
                  </Link>
                  <Link
                    href="/dashboard/products/storefront-filters"
                    className={`sidebar-item${pathname.includes('/storefront-filters') ? ' active' : ''}`}
                    style={{ paddingLeft: 44, fontSize: 13 }}
                  >
                    Storefront Filters
                  </Link>
                </>
              )}
            </div>
            );
          })}

        </nav>

        <div className="sidebar-bottom">
          <Link
            href="/dashboard/settings"
            className={`sidebar-item${pathname.startsWith('/dashboard/settings') || pathname === '/dashboard/roles' || pathname === '/dashboard/users' ? ' active' : ''}`}
          >
            <span className="sidebar-item-icon">⚙️</span>
            Settings
          </Link>
        </div>
      </aside>

      <main className="admin-content">
        {children}
      </main>
    </div>
  );
}
