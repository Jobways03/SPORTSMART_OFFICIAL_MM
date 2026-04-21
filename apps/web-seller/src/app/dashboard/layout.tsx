'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { sellerProfileService } from '@/services/profile.service';
import './dashboard.css';

interface SellerInfo {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
  status?: string;
  isEmailVerified?: boolean;
}

function getInitials(name: string): string {
  return name
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
  const [seller, setSeller] = useState<SellerInfo | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const token = sessionStorage.getItem('accessToken');
      const sellerData = sessionStorage.getItem('seller');
      if (!token || !sellerData) {
        router.replace('/login');
        return;
      }
      const cached = JSON.parse(sellerData);
      setSeller(cached);

      // Fetch fresh status from API to keep sessionStorage in sync
      sellerProfileService.getProfile(token).then(res => {
        if (res.data) {
          const updated = {
            ...cached,
            status: res.data.status,
            isEmailVerified: res.data.isEmailVerified,
          };
          setSeller(updated);
          sessionStorage.setItem('seller', JSON.stringify(updated));
        }
      }).catch(() => {
        // ignore — use cached data
      });
    } catch {
      router.replace('/login');
    }
  }, [router]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const handleLogout = useCallback(() => {
    try {
      sessionStorage.removeItem('accessToken');
      sessionStorage.removeItem('refreshToken');
      sessionStorage.removeItem('seller');
    } catch {
      // Storage unavailable
    }
    router.push('/login');
  }, [router]);

  if (!seller) return null;

  const initials = getInitials(seller.sellerName);

  const isPending = seller.status === 'PENDING_APPROVAL';
  const isEmailUnverified = seller.isEmailVerified === false;
  const canAccessProducts = seller.status === 'ACTIVE' && seller.isEmailVerified === true;

  const isActive = seller.status === 'ACTIVE';

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: '&#9776;' },
    { href: '/dashboard/profile', label: 'My Profile', icon: '&#128100;' },
    { href: '/dashboard/catalog', label: 'Browse Catalog', icon: '&#128270;', disabled: !isActive, description: 'Find and map existing products' },
    { href: '/dashboard/catalog/my-products', label: 'My Products', icon: '&#128230;', disabled: !isActive, description: 'View all your mapped products' },
    { href: '/dashboard/products', label: 'Submit Product', icon: '&#128221;', disabled: !isActive, description: 'Create your own product listing' },
    { href: '/dashboard/orders', label: 'Orders', icon: '&#128195;', disabled: !isActive },
    { href: '/dashboard/returns', label: 'Returns', icon: '&#8617;', disabled: !isActive },
    { href: '/dashboard/commission', label: 'Commission', icon: '&#128176;', disabled: !isActive },
    { href: '#', label: 'Analytics', icon: '&#128200;', disabled: true },
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
            <span className="navbar-brand-name">SPORTSMART</span>
            <span className="navbar-brand-tag">Seller</span>
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

      {/* Sidebar Overlay (mobile) */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
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
                  SOON
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

      {/* Main Content */}
      <main className="dashboard-content">
        {isPending && (
          <div style={{
            background: '#fef3c7',
            border: '1px solid #f59e0b',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            color: '#92400e',
            fontSize: 14,
            fontWeight: 500,
          }}>
            Your account is pending admin approval. Please complete your profile details to proceed with account review.
          </div>
        )}
        {!isPending && isEmailUnverified && (
          <div style={{
            background: '#fee2e2',
            border: '1px solid #ef4444',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            color: '#991b1b',
            fontSize: 14,
            fontWeight: 500,
          }}>
            Please verify your email before you can manage products.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
