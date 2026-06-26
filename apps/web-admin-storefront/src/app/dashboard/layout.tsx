'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { PermissionsProvider, usePermissions } from '@/lib/permissions';
import './dashboard.css';

function getInitials(name?: string | null): string {
  return ((name ?? '').trim() || '?')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

type IconName =
  | 'home' | 'orders' | 'package' | 'inventory' | 'alert-triangle'
  | 'inbox' | 'returns' | 'scale' | 'message' | 'users'
  | 'banknote' | 'percent' | 'wallet' | 'shield' | 'recon'
  | 'book' | 'receipt' | 'alert-octagon' | 'tag' | 'megaphone' | 'chart' | 'settings';

interface NavItem {
  label: string;
  href: string;
  icon: IconName;
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
  /**
   * Permission-GROUP gate. The item is shown if the admin holds ANY
   * permission whose key equals one of these prefixes or starts with
   * `<prefix>.`. This is what makes a granular custom role (e.g. one built
   * from just `inventory.alerts.read` or `cod.write`) actually light up the
   * matching page — without it, a role assembled from the granular
   * permission picker reveals nothing and the dashboard looks empty.
   * `anyOf` and `anyPrefix` are OR'd together.
   */
  anyPrefix?: string[];
}

// Sidebar groups, ordered by how often an admin uses them during a
// typical day. Operations is what touches money and customers right
// now (highest priority); Growth is reporting / campaigns (lowest).
// Section headers render automatically when `section` changes between
// adjacent visible items.
type NavSection = 'operations' | 'care' | 'finance' | 'risk' | 'growth' | 'system';

const SECTION_LABELS: Record<NavSection, string> = {
  operations: 'Operations',
  care: 'Customer Care',
  finance: 'Finance',
  risk: 'Risk',
  growth: 'Growth',
  system: 'System',
};

const navItems: (NavItem & { section?: NavSection })[] = [
  // Home stands alone at the top — no section header above it.
  { label: 'Home', href: '/dashboard', icon: 'home' },

  // Operations — day-to-day order/catalog work, highest priority.
  // anyPrefix opens each page to ANY granular permission in its group, so a
  // custom role built from e.g. orders.verify or inventory.alerts.read still
  // reveals the right page instead of an empty sidebar.
  { label: 'Orders', href: '/dashboard/orders', icon: 'orders', hasPendingBadge: true, anyOf: ['orders.read'], anyPrefix: ['orders'], section: 'operations' },
  { label: 'Verification', href: '/dashboard/verification', icon: 'shield', anyOf: ['orders.verify', 'orders.verify.bulk'], section: 'operations' },
  { label: 'Products', href: '/dashboard/products', icon: 'package', anyOf: ['products.read', 'catalog.read'], anyPrefix: ['products', 'catalog'], section: 'operations' },
  { label: 'Seller Mappings', href: '/dashboard/products/seller-mappings', icon: 'users', anyOf: ['products.read', 'catalog.read'], section: 'operations' },
  // Seller + Franchise ONBOARDING/MANAGEMENT was removed from the Super Admin
  // portal (2026-06-26). It is delegated to the dedicated, type-scoped admins:
  //   • D2C sellers      → web-d2c-seller-admin    (D2C_ADMIN, sellers.scope.d2c)
  //   • RETAIL sellers   → web-retail-seller-admin (RETAILER_ADMIN, sellers.scope.retail)
  //   • Franchises       → web-franchise-admin     (FRANCHISE_ADMIN)
  // SUPER_ADMIN no longer holds sellers.approve/suspend/penalize or
  // franchise.approve/suspend (see SUPER_ADMIN_DELEGATED_PERMISSIONS), so these
  // nav entries are gone. Its read/finance visibility of sellers/franchises is
  // retained via the Products / Seller Mappings / Accounts / Franchise finances
  // pages.
  { label: 'Inventory', href: '/dashboard/inventory', icon: 'inventory', anyOf: ['products.read'], anyPrefix: ['inventory'], section: 'operations' },
  { label: 'Low-stock alerts', href: '/dashboard/inventory/alerts', icon: 'alert-triangle', anyOf: ['products.read'], anyPrefix: ['inventory.alerts'], section: 'operations' },
  // Delhivery Tools console hidden (2026-06-02, product decision) — Delhivery
  // actions live contextually (order Shipping panel), not a standalone console.
  // Page kept at /dashboard/delhivery-tools; re-enable by uncommenting.
  // { label: 'Delhivery Tools', href: '/dashboard/delhivery-tools', icon: 'package', anyOf: ['orders.read'], section: 'operations' },

  // Customer Care — escalations and people-facing queues.
  { label: 'Queues', href: '/dashboard/queues', icon: 'inbox', anyOf: ['audit.read'], section: 'care' },
  // Returns also hosts the shipment-evidence viewer (packing photos / POD),
  // so a shipment.evidence.* role lands here.
  { label: 'Returns', href: '/dashboard/returns', icon: 'returns', anyOf: ['returns.read'], anyPrefix: ['returns', 'shipment.evidence'], section: 'care' },
  { label: 'Seller Reversals', href: '/dashboard/seller-reversals', icon: 'returns', anyOf: ['sellerReversals.read'], anyPrefix: ['sellerReversals'], section: 'care' },
  { label: 'Disputes', href: '/dashboard/disputes', icon: 'scale', anyOf: ['disputes.read'], anyPrefix: ['disputes'], section: 'care' },
  { label: 'Support', href: '/dashboard/support', icon: 'message', anyOf: ['support.read'], anyPrefix: ['support'], section: 'care' },
  { label: 'Customers', href: '/dashboard/customers', icon: 'users', anyOf: ['customers.read'], anyPrefix: ['customers'], section: 'care' },

  // Finance — money flow. Approvals first because they block payouts.
  { label: 'Finance Approvals', href: '/dashboard/finance/refund-approvals', icon: 'banknote', anyOf: ['refunds.approve', 'refunds.read'], anyPrefix: ['refunds'], section: 'finance' },
  { label: 'Commission', href: '/dashboard/commission', icon: 'percent', anyOf: ['settlements.read'], section: 'finance' },
  { label: 'Settlements', href: '/dashboard/finance/settlements', icon: 'banknote', anyOf: ['settlements.read'], anyPrefix: ['settlements'], section: 'finance' },
  { label: 'Settlement Charge Rules', href: '/dashboard/finance/settlement-charge-rules', icon: 'percent', anyOf: ['settlements.charges.read', 'settlements.read'], section: 'finance' },
  { label: 'Wallets', href: '/dashboard/wallets', icon: 'wallet', anyOf: ['wallets.read'], anyPrefix: ['wallets'], section: 'finance' },
  { label: 'Wallet Adjustments', href: '/dashboard/tax/wallet-adjustments', icon: 'wallet', anyPrefix: ['wallet.adjustment', 'wallet.goodwill'], section: 'finance' },
  { label: 'Payment Ops', href: '/dashboard/payment-ops', icon: 'shield', anyOf: ['paymentOps.read'], anyPrefix: ['paymentOps', 'payments'], section: 'finance' },
  // COD Rules — money/payment ops decide when COD is offered. Backend lives at
  // /admin/cod/rules; cod.read views, cod.write edits.
  { label: 'COD Rules', href: '/dashboard/cod', icon: 'banknote', anyPrefix: ['cod'], section: 'finance' },
  { label: 'Payouts', href: '/dashboard/payouts', icon: 'banknote', anyPrefix: ['payouts'], section: 'finance' },
  { label: 'Reconciliation', href: '/dashboard/reconciliation', icon: 'recon', anyOf: ['recon.read'], anyPrefix: ['recon'], section: 'finance' },
  // Phase 175/177 — accounts overview + per-franchise finance dashboards.
  { label: 'Accounts', href: '/dashboard/accounts', icon: 'banknote', anyOf: ['accounts.read'], anyPrefix: ['accounts'], section: 'finance' },
  { label: 'Payables aging', href: '/dashboard/accounts/payables', icon: 'recon', anyOf: ['accounts.read', 'accounts.payable.hold', 'accounts.payable.recordPayment'], section: 'finance' },
  { label: 'Top performers', href: '/dashboard/accounts/top-performers', icon: 'percent', anyOf: ['accounts.read'], section: 'finance' },
  { label: 'Finance reports', href: '/dashboard/accounts/reports', icon: 'recon', anyOf: ['settlements.read'], section: 'finance' },
  { label: 'Penalty approvals', href: '/dashboard/accounts/penalty-approvals', icon: 'percent', anyOf: ['franchise.finance', 'franchise.penalty.approve'], section: 'finance' },
  { label: 'Franchise finances', href: '/dashboard/accounts/franchises', icon: 'percent', anyOf: ['accounts.read', 'accounts.franchise.adjust', 'franchise.finance.read'], section: 'finance' },
  // Refund Saga Console — observability into the refund-execution state machine.
  { label: 'Refund Sagas', href: '/dashboard/finance/refund-sagas', icon: 'recon', anyOf: ['paymentOps.read', 'refunds.read'], section: 'finance' },
  // Liability Ledger — seller-debit claw-back queue.
  { label: 'Liability Ledger', href: '/dashboard/liability-ledger', icon: 'book', anyOf: ['liability_ledger.read', 'refunds.approve'], anyPrefix: ['liability_ledger'], section: 'finance' },
  // Phase 25 GST — admin tax dashboard. Opened to any tax.* permission.
  { label: 'Tax / GST', href: '/dashboard/tax', icon: 'receipt', anyOf: ['tax.reports.read', 'tax.tcs.read'], anyPrefix: ['tax'], section: 'finance' },

  // Risk — fraud / abuse review, occasional but high-stakes.
  { label: 'Risk Review', href: '/dashboard/risk-review', icon: 'alert-octagon', anyOf: ['risk.review', 'returns.read'], anyPrefix: ['risk'], section: 'risk' },

  // Growth — campaigns and reporting, used less frequently.
  { label: 'Discounts', href: '/dashboard/discounts', icon: 'tag', anyOf: ['discounts.read'], anyPrefix: ['discounts'], section: 'growth' },
  { label: 'Marketing', href: '/dashboard/marketing', icon: 'megaphone', anyOf: ['discounts.read'], section: 'growth' },
  { label: 'Analytics', href: '/dashboard/analytics', icon: 'chart', anyOf: ['analytics.read'], anyPrefix: ['analytics'], section: 'growth' },

  // System — integrity / observability tools used by admins, not customer-facing.
  { label: 'Data Validation', href: '/dashboard/system/data-validation', icon: 'shield', anyOf: ['audit.read'], section: 'system' },
  { label: 'Notifications', href: '/dashboard/notifications', icon: 'message', anyPrefix: ['notifications'], section: 'system' },
  { label: 'Content', href: '/dashboard/content', icon: 'book', anyPrefix: ['content'], section: 'system' },
  { label: 'Audit Logs', href: '/dashboard/audit-logs', icon: 'book', anyOf: ['audit.read'], anyPrefix: ['audit'], section: 'system' },
  { label: 'Sessions', href: '/dashboard/sessions', icon: 'shield', anyPrefix: ['sessions'], section: 'system' },
  { label: 'Access Logs', href: '/dashboard/access-logs', icon: 'shield', anyPrefix: ['security'], section: 'system' },
  { label: 'Admin Activity', href: '/dashboard/admin-activity', icon: 'book', anyPrefix: ['admin.activity'], section: 'system' },
  { label: 'Affiliates', href: '/dashboard/affiliates/applications', icon: 'users', anyPrefix: ['affiliates'], section: 'system' },

  // Post-MVP1 features — parked behind env flags. The pages themselves
  // also guard with notFound() so direct-URL access is blocked when the
  // flag is off. To enable in an environment, set the corresponding
  // NEXT_PUBLIC_FEATURE_* var to "true" (see .env.example).
  ...(process.env.NEXT_PUBLIC_FEATURE_REPLACEMENTS === 'true'
    ? [{ label: 'Replacements', href: '/dashboard/replacements', icon: 'returns' as IconName, anyOf: ['returns.read'], section: 'care' as NavSection }]
    : []),
  ...(process.env.NEXT_PUBLIC_FEATURE_NOVA === 'true'
    ? [{ label: 'NOVA Brand', href: '/dashboard/nova/procurement', icon: 'package' as IconName, anyOf: ['products.read', 'catalog.read'], section: 'operations' as NavSection }]
    : []),

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
  // Follow-up #H41 — sidebar overlay state for mobile. Below 768px the
  // sidebar slides off-screen by default and the hamburger button in
  // the navbar toggles it back in. Pre-Follow-up-H41 the sidebar just
  // `display: none`d below 768px, leaving the admin with no way to
  // navigate from a phone.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // PR 4.6 — sidebar items filtered by the admin's effective permissions.
  // Hides "NOVA Brand" from finance-only admins, "Wallets" from catalog-only
  // admins, etc. SUPER_ADMIN sees everything because hasAnyPermission
  // short-circuits on isSuperAdmin. Filtering only runs once `me` is loaded
  // so we don't briefly flash items the admin doesn't actually have access to.
  const { loading: permsLoading, hasAnyPermission, me } = usePermissions();
  const ROLE_LABELS: Record<string, string> = {
    SUPER_ADMIN: 'Super Admin',
    STAFF: 'Staff',
    SELLER_ADMIN: 'Seller Admin',
    SELLER_OPERATIONS: 'Seller Operations',
    SELLER_OPS: 'Seller Ops',
    SELLER_SUPPORT: 'Seller Support',
    AFFILIATE_ADMIN: 'Affiliate Admin',
    D2C_ADMIN: 'D2C Admin',
    RETAILER_ADMIN: 'Retailer Admin',
    FRANCHISE_ADMIN: 'Franchise Admin',
  };
  const roleLabel = me?.role ? ROLE_LABELS[me.role] ?? me.role : 'Admin';
  const visibleNavItems = useMemo(() => {
    if (permsLoading) return null;
    const perms = me?.permissions ?? [];
    const isSuper = me?.isSuperAdmin ?? false;
    // Group-prefix match: the admin holds a permission that equals `pre` or
    // starts with `pre.` (so `cod` matches cod.read/cod.write, `inventory`
    // matches inventory.alerts.read, etc.). SUPER_ADMIN sees everything.
    const hasAnyGroup = (prefixes?: string[]) =>
      !!prefixes &&
      (isSuper ||
        perms.some((p) =>
          prefixes.some((pre) => p === pre || p.startsWith(pre + '.')),
        ));
    return navItems.filter((item) => {
      // Ungated items (Home) are always visible.
      if (!item.anyOf && !item.anyPrefix) return true;
      return (
        (item.anyOf ? hasAnyPermission(item.anyOf) : false) ||
        hasAnyGroup(item.anyPrefix)
      );
    });
  }, [permsLoading, hasAnyPermission, me]);

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

  // Follow-up #H41 — close the sidebar drawer whenever the route
  // changes so the user doesn't have to tap a backdrop after landing
  // on the new page. Desktop is unaffected (CSS only shows the
  // overlay below 768px).
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <div className="admin-shell">
      {/* Top Navbar */}
      <nav className="admin-navbar">
        <div className="navbar-left">
          <button
            className="navbar-hamburger"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle sidebar"
            aria-expanded={sidebarOpen}
          >
            ☰
          </button>
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
                <div className="navbar-user-name">{adminName || 'Admin'}</div>
                <div className="navbar-user-role">{roleLabel}</div>
              </div>
              <div className="navbar-avatar">{initials}</div>
              <span className={`navbar-dropdown-arrow${dropdownOpen ? ' open' : ''}`} aria-hidden>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </button>

            {dropdownOpen && (
              <div className="navbar-dropdown">
                <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', marginBottom: 4 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
                    {adminName || 'Admin'}
                  </div>
                  {adminEmail && (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{adminEmail}</div>
                  )}
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    {roleLabel}
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

      {/* Follow-up #H41 — Sidebar overlay (mobile only via CSS) */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`admin-sidebar${sidebarOpen ? ' mobile-open' : ''}`}>
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
                <span className="sidebar-item-icon"><NavIcon name={item.icon} /></span>
                {item.label}
                {'hasPendingBadge' in item && item.hasPendingBadge && pendingOrderCount > 0 && (
                  <span className="sidebar-item-badge" style={{ background: '#ef4444', color: '#fff' }}>
                    {pendingOrderCount > 99 ? '99+' : pendingOrderCount}
                  </span>
                )}
              </Link>
              {item.label === 'Products' && pathname.startsWith('/dashboard/products') && (
                <>
                  {/* Phase 32 (2026-05-21) — dedicated approval-queue
                      route. Forwards to the canonical list with
                      moderationStatus=PENDING pre-applied. */}
                  <Link
                    href="/dashboard/products/approval-queue"
                    className={`sidebar-item${pathname.includes('/approval-queue') || (pathname === '/dashboard/products' && typeof window !== 'undefined' && window.location.search.includes('moderationStatus=PENDING')) ? ' active' : ''}`}
                    style={{ paddingLeft: 44, fontSize: 13 }}
                  >
                    Approval Queue
                  </Link>
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
            <span className="sidebar-item-icon"><NavIcon name="settings" /></span>
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

// ── Nav icons ────────────────────────────────────────────────────
//
// Note: `.sidebar-item-icon` is `display:none` in dashboard.css today
// (intentional, "clean text-only nav"). These SVGs sit in the markup
// ready for when that style is flipped — no emoji in source.

function NavIcon({ name }: { name: IconName }) {
  const props = {
    width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.75,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'home':           return (<svg {...props}><path d="m3 11 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z" /></svg>);
    case 'orders':         return (<svg {...props}><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 7h6M9 11h6M9 15h4" /></svg>);
    case 'package':        return (<svg {...props}><path d="m21 8-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v10" /></svg>);
    case 'inventory':      return (<svg {...props}><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7" /><path d="M3 7h18M7 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M10 11h4" /></svg>);
    case 'alert-triangle': return (<svg {...props}><path d="M12 3 2 21h20L12 3z" /><path d="M12 9v5M12 17v.01" /></svg>);
    case 'inbox':          return (<svg {...props}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5 4h14l3 8v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" /></svg>);
    case 'returns':        return (<svg {...props}><path d="M9 14 4 9l5-5" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>);
    case 'scale':          return (<svg {...props}><path d="M12 3v18M5 21h14" /><path d="m6 7 13-2M3 14l3-7 3 7a3 3 0 1 1-6 0zM15 14l3-7 3 7a3 3 0 1 1-6 0z" /></svg>);
    case 'message':        return (<svg {...props}><path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12z" /></svg>);
    case 'users':          return (<svg {...props}><circle cx="9" cy="8" r="4" /><path d="M2 21c.8-4 3.7-6 7-6s6.2 2 7 6" /><circle cx="17" cy="6" r="3" /><path d="M22 18c-.4-2-1.8-3.5-4-4" /></svg>);
    case 'banknote':       return (<svg {...props}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 10v.01M18 14v.01" /></svg>);
    case 'percent':        return (<svg {...props}><circle cx="7" cy="7" r="2" /><circle cx="17" cy="17" r="2" /><path d="M19 5 5 19" /></svg>);
    case 'wallet':         return (<svg {...props}><path d="M3 7a2 2 0 0 1 2-2h13v4" /><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" /><path d="M16 13h5v-3h-5a1.5 1.5 0 0 0 0 3z" /></svg>);
    case 'shield':         return (<svg {...props}><path d="M12 3 4 6v6c0 5 4 8 8 9 4-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>);
    case 'recon':          return (<svg {...props}><path d="M3 7h13l-3-3M21 17H8l3 3" /></svg>);
    case 'book':           return (<svg {...props}><path d="M3 19V5a2 2 0 0 1 2-2h13v18H5a2 2 0 0 1-2-2z" /><path d="M3 19a2 2 0 0 1 2-2h13" /></svg>);
    case 'receipt':        return (<svg {...props}><path d="M5 3v18l3-2 3 2 3-2 3 2V3z" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>);
    case 'alert-octagon':  return (<svg {...props}><path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z" /><path d="M12 8v4M12 16v.01" /></svg>);
    case 'tag':            return (<svg {...props}><path d="M3 12 12 3h7v7l-9 9z" /><circle cx="15.5" cy="8.5" r="1" /></svg>);
    case 'megaphone':      return (<svg {...props}><path d="M3 11v3a1 1 0 0 0 1 1h3l8 5V5L7 10H4a1 1 0 0 0-1 1z" /><path d="M19 8v8" /></svg>);
    case 'chart':          return (<svg {...props}><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-5" /></svg>);
    case 'settings':       return (<svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>);
    default:               return null;
  }
}
