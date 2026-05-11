'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { PermissionsProvider, usePermissions } from '@/lib/permissions';
import './dashboard.css';

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

const navItems: NavItem[] = [
  { label: 'Home', href: '/dashboard', icon: '🏠' }, // always visible — admin landing page
  { label: 'Orders', href: '/dashboard/orders', icon: '📋', hasPendingBadge: true, anyOf: ['orders.read'] },
  { label: 'Returns', href: '/dashboard/returns', icon: '↩️', anyOf: ['returns.read'] },
  { label: 'Disputes', href: '/dashboard/disputes', icon: '⚖️', anyOf: ['disputes.read'] },
  { label: 'Finance Approvals', href: '/dashboard/finance/refund-approvals', icon: '💸', anyOf: ['refunds.approve', 'refunds.read'] },
  // Hidden — replacement/exchange flow disabled in UI for now.
  // { label: 'Replacements', href: '/dashboard/replacements', icon: '🔁' },
  { label: 'Risk Review', href: '/dashboard/risk-review', icon: '⚠️', anyOf: ['risk.review'] },
  // Liability Ledger is finance ops — `refunds.approve` already gates the
  // backend list endpoint, mirror that here.
  { label: 'Liability Ledger', href: '/dashboard/liability-ledger', icon: '📒', anyOf: ['refunds.approve'] },
  { label: 'Products', href: '/dashboard/products', icon: '📦', anyOf: ['products.read', 'catalog.read'] },
  // Inventory has no dedicated permission key today — falls under products.
  { label: 'Inventory', href: '/dashboard/inventory', icon: '📊', anyOf: ['products.read'] },
  // NOVA Brand entry removed per product request — route still exists at
  // /dashboard/nova/* if needed directly.
  { label: 'Commission', href: '/dashboard/commission', icon: '💰', anyOf: ['settlements.read'] },
  { label: 'Customers', href: '/dashboard/customers', icon: '👥', anyOf: ['customers.read'] },
  { label: 'Wallets', href: '/dashboard/wallets', icon: '💳', anyOf: ['wallets.read'] },
  { label: 'Support', href: '/dashboard/support', icon: '💬', anyOf: ['support.read'] },
  { label: 'Payment Ops', href: '/dashboard/payment-ops', icon: '🛡️', anyOf: ['paymentOps.read'] },
  { label: 'Reconciliation', href: '/dashboard/reconciliation', icon: '⚖️', anyOf: ['recon.read'] },
  { label: 'Notifications', href: '/dashboard/notifications', icon: '🔔', anyOf: ['notifications.read'] },
  { label: 'Access Logs', href: '/dashboard/access-logs', icon: '🔐', anyOf: ['audit.read'] },
  { label: 'Marketing', href: '/dashboard/marketing', icon: '📣', anyOf: ['discounts.read'] },
  { label: 'Discounts', href: '/dashboard/discounts', icon: '🏷️', anyOf: ['discounts.read'] },
  { label: 'Shipping', href: '/dashboard/settings/shipping', icon: '🚚', anyOf: ['shipping.read'] },
  { label: 'Content', href: '/dashboard/content', icon: '📝', anyOf: ['content.read'] },
  { label: 'Navigation', href: '/dashboard/menus', icon: '🧭', anyOf: ['storefront.read'] },
  { label: 'Analytics', href: '/dashboard/analytics', icon: '📈', anyOf: ['analytics.read'] },
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
  const [pendingOrderCount, setPendingOrderCount] = useState(0);

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

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link href="/dashboard" className="sidebar-brand">
          <span
            style={{
              display: 'inline-flex',
              background: '#fff',
              padding: '8px 12px',
              borderRadius: 8,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/SportsMart_Web_Banner.avif"
              alt="SportsMart"
              className="sidebar-brand-name"
              style={{ height: 36, width: 'auto', display: 'block' }}
            />
          </span>
        </Link>

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
          {(visibleNavItems ?? []).map((item) => (
            <div key={item.href}>
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
          ))}

        </nav>

        <div className="sidebar-bottom">
          <Link
            href="/dashboard/settings"
            className={`sidebar-item${pathname.startsWith('/dashboard/settings') || pathname === '/dashboard/roles' || pathname === '/dashboard/users' ? ' active' : ''}`}
          >
            <span className="sidebar-item-icon">⚙️</span>
            Settings
          </Link>
          <button className="sidebar-item" onClick={handleLogout}>
            <span className="sidebar-item-icon">🚪</span>
            Logout
          </button>
        </div>
      </aside>

      <main className="admin-content">
        {children}
      </main>
    </div>
  );
}
