'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import './dashboard.css';

const navItems = [
  { label: 'Home', href: '/dashboard', icon: '🏠' },
  { label: 'Orders', href: '/dashboard/orders', icon: '📋', hasPendingBadge: true },
  { label: 'Products', href: '/dashboard/products', icon: '📦' },
  { label: 'Inventory', href: '/dashboard/inventory', icon: '📊' },
  { label: 'Commission', href: '/dashboard/commission', icon: '💰' },
  { label: 'Customers', href: '/dashboard/customers', icon: '👥' },
  { label: 'Marketing', href: '/dashboard/marketing', icon: '📣' },
  { label: 'Discounts', href: '/dashboard/discounts', icon: '🏷️' },
  { label: 'Content', href: '/dashboard/content', icon: '📝' },
  { label: 'Analytics', href: '/dashboard/analytics', icon: '📊' },
];

const salesChannels = [
  { label: 'Online Store', href: '#', icon: '🏪' },
  { label: 'Point of Sale', href: '#', icon: '💳' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [adminName, setAdminName] = useState('');
  const [pendingOrderCount, setPendingOrderCount] = useState(0);

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
          <div className="sidebar-brand-icon">S</div>
          <span className="sidebar-brand-name">SportSmart</span>
        </Link>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
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

          <div className="sidebar-section-label">
            Sales channels <span className="chevron">›</span>
          </div>
          {salesChannels.map((item) => (
            <Link key={item.label} href={item.href} className="sidebar-item">
              <span className="sidebar-item-icon">{item.icon}</span>
              {item.label}
            </Link>
          ))}

          <div className="sidebar-section-label">
            Apps <span className="chevron">›</span>
          </div>
          <Link href="#" className="sidebar-item">
            <span className="sidebar-item-icon">🔍</span>
            Search & Discovery
          </Link>
        </nav>

        <div className="sidebar-bottom">
          <Link href="#" className="sidebar-item">
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
