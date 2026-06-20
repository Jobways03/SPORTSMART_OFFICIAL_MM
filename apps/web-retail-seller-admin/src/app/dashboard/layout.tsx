'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { adminAuthService } from '@/services/admin-auth.service';
import { adminProductsService } from '@/services/admin-products.service';
import { apiClient } from '@/lib/api-client';
import './dashboard.css';

interface AdminInfo {
  adminId: string;
  name: string;
  email: string;
  role: string;
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

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingMappingsCount, setPendingMappingsCount] = useState(0);
  const [ordersCount, setOrdersCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const token = sessionStorage.getItem('adminAccessToken');
      const adminData = sessionStorage.getItem('admin');
      if (!token || !adminData) {
        router.replace('/login');
        return;
      }
      setAdmin(JSON.parse(adminData));
    } catch {
      router.replace('/login');
    }
  }, [router]);

  // Fetch pending mappings count for badge
  useEffect(() => {
    if (!admin) return;
    adminProductsService.getPendingMappings({ limit: 0 })
      .then(res => {
        if (res.data?.pagination?.total !== undefined) {
          setPendingMappingsCount(res.data.pagination.total);
        } else if (res.data?.total !== undefined) {
          setPendingMappingsCount(res.data.total);
        }
      })
      // Intentional silent fail: nav-bar badge poll. Surfacing an error
      // toast here on every 500 would yell at the seller for a backend
      // blip they can't act on. The badge just stays at its prior value
      // until the next 60s tick succeeds.
      .catch(() => {});

    // Refresh every 60 seconds
    const interval = setInterval(() => {
      adminProductsService.getPendingMappings({ limit: 0 })
        .then(res => {
          if (res.data?.pagination?.total !== undefined) {
            setPendingMappingsCount(res.data.pagination.total);
          } else if (res.data?.total !== undefined) {
            setPendingMappingsCount(res.data.total);
          }
        })
        // Intentional silent fail: see comment on the initial fetch above.
        .catch(() => {});
    }, 60000);

    return () => clearInterval(interval);
  }, [admin]);

  // New-order count for the Orders sidebar badge (orders placed but not yet
  // routed/verified). Polls every 60s; silent-fail like the mappings badge.
  useEffect(() => {
    if (!admin) return;
    const fetchOrders = () => {
      apiClient<{ pagination?: { total?: number } }>('/admin/orders?orderStatus=PLACED&limit=1')
        .then((res) => {
          const total = res.data?.pagination?.total;
          if (typeof total === 'number') setOrdersCount(total);
        })
        .catch(() => {});
    };
    fetchOrders();
    const interval = setInterval(fetchOrders, 60000);
    return () => clearInterval(interval);
  }, [admin]);

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
    try {
      await adminAuthService.logout();
    } catch {
      // Ignore logout API errors
    }
    try {
      sessionStorage.removeItem('adminAccessToken');
      sessionStorage.removeItem('adminRefreshToken');
      sessionStorage.removeItem('admin');
    } catch {
      // Storage unavailable
    }
    router.push('/login');
  }, [router]);

  if (!admin) return null;

  const initials = getInitials(admin.name);

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: '&#9776;' },
    { href: '/dashboard/sellers', label: 'Sellers', icon: '&#128101;' },
    { href: '/dashboard/products', label: 'Products', icon: '&#128230;' },
    { href: '/dashboard/orders', label: 'Orders', icon: '&#128195;' },
    // Delhivery Tools console hidden (2026-06-02) — page kept; re-enable by uncommenting.
    // { href: '/dashboard/delhivery-tools', label: 'Delhivery Tools', icon: '&#128666;' },
    { href: '/dashboard/verification', label: 'Verification', icon: '&#10003;' },
    { href: '/dashboard/routing', label: 'Routing', icon: '&#128640;' },
    { href: '/dashboard/returns', label: 'Returns', icon: '&#8634;' },
    { href: '/dashboard/commission', label: 'Commission', icon: '&#128176;' },
    { href: '/dashboard/accounts', label: 'Accounts', icon: '&#128202;' },
    { href: '/dashboard/inventory', label: 'Inventory', icon: '&#128230;' },
    { href: '/dashboard/storefront', label: 'Storefront', icon: '&#128722;' },
    { href: '/dashboard/settings', label: 'Settings', icon: '&#9881;' },
  ];

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
            <span className="navbar-brand-tag">RETAIL SELLER ADMIN</span>
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
                <div className="navbar-user-name">Retail Seller Admin</div>
                <div className="navbar-user-role">Retail Seller Admin</div>
              </div>
              <div className="navbar-avatar">SA</div>
              <span className={`navbar-dropdown-arrow${dropdownOpen ? ' open' : ''}`}>
                &#9660;
              </span>
            </button>

            {dropdownOpen && (
              <div className="navbar-dropdown">
                <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', marginBottom: 4 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                    {admin.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {admin.email}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    Retail Seller Admin
                  </div>
                </div>
                <Link
                  href="/dashboard/settings/mfa"
                  className="navbar-dropdown-item"
                  onClick={() => setDropdownOpen(false)}
                >
                  <span className="dropdown-icon">&#128274;</span>
                  Two-factor auth
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

      {/* Sidebar Overlay (mobile) */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`dashboard-sidebar${sidebarOpen ? ' mobile-open' : ''}`}>
        <div className="sidebar-section">
          <div className="sidebar-section-label">Management</div>
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-nav-item${
                item.href === '/dashboard'
                  ? pathname === '/dashboard' ? ' active' : ''
                  : pathname.startsWith(item.href) ? ' active' : ''
              }`}
            >
              <span
                className="nav-icon"
                dangerouslySetInnerHTML={{ __html: item.icon }}
              />
              {item.label}
              {item.href === '/dashboard/products' && pendingMappingsCount > 0 && (
                <span style={{
                  marginLeft: 'auto',
                  background: '#f59e0b',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 10,
                  minWidth: 18,
                  textAlign: 'center',
                  lineHeight: '16px',
                }}>
                  {pendingMappingsCount > 99 ? '99+' : pendingMappingsCount}
                </span>
              )}
              {item.href === '/dashboard/orders' && ordersCount > 0 && (
                <span style={{
                  marginLeft: 'auto',
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 10,
                  minWidth: 18,
                  textAlign: 'center',
                  lineHeight: '16px',
                }}>
                  {ordersCount > 99 ? '99+' : ordersCount}
                </span>
              )}
            </Link>
          ))}
        </div>
      </aside>

      {/* Main Content */}
      <main className="dashboard-content">
        {children}
      </main>
    </div>
  );
}
