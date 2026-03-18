'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import './dashboard.css';

const navItems = [
  { label: 'Home', href: '/dashboard', icon: '🏠' },
  { label: 'Orders', href: '/dashboard/orders', icon: '📋', badge: '0' },
  { label: 'Products', href: '/dashboard/products', icon: '📦' },
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
  }, [router]);

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
                {item.badge && <span className="sidebar-item-badge">{item.badge}</span>}
              </Link>
              {item.label === 'Products' && isActive('/dashboard/products') && (
                <Link
                  href="/dashboard/products/collections"
                  className={`sidebar-item${pathname.includes('/collections') ? ' active' : ''}`}
                  style={{ paddingLeft: 44, fontSize: 13 }}
                >
                  Collections
                </Link>
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
