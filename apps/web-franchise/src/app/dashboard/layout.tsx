'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import './dashboard.css';

interface FranchiseInfo {
  franchiseId: string;
  franchiseCode: string;
  ownerName: string;
  businessName: string;
  email: string;
  phoneNumber: string;
  status?: string;
  isEmailVerified?: boolean;
  roles?: string[];
}

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
  { href: '/dashboard/staff', label: 'Staff', icon: '&#128101;' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [franchise, setFranchise] = useState<FranchiseInfo | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const token = sessionStorage.getItem('accessToken');
      const data = sessionStorage.getItem('franchise');
      if (!token || !data) {
        router.replace('/login');
        return;
      }
      setFranchise(JSON.parse(data));
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
      sessionStorage.removeItem('franchise');
    } catch {
      // Storage unavailable
    }
    router.push('/login');
  }, [router]);

  if (!franchise) return null;

  const initials = getInitials(franchise.ownerName);

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
                <div className="navbar-user-name">{franchise.ownerName}</div>
                <div className="navbar-user-shop">{franchise.businessName}</div>
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
                    {franchise.ownerName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {franchise.email}
                  </div>
                  {franchise.franchiseCode && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                      Code: {franchise.franchiseCode}
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

      {/* Sidebar Overlay (mobile) */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
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

      {/* Main Content */}
      <main className="dashboard-content">{children}</main>
    </div>
  );
}
