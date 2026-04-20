'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { adminAuthService } from '@/services/admin-auth.service';
import './dashboard.css';

interface AdminInfo {
  adminId: string;
  name: string;
  email: string;
  role: string;
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

function formatRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
    { href: '/dashboard/franchises', label: 'Franchises', icon: '&#127970;' },
    { href: '/dashboard/catalog', label: 'Catalog', icon: '&#128230;' },
    { href: '/dashboard/procurement', label: 'Procurement', icon: '&#128188;' },
    { href: '/dashboard/orders', label: 'Orders', icon: '&#128195;' },
    { href: '/dashboard/inventory', label: 'Inventory', icon: '&#128230;' },
    { href: '/dashboard/settlements', label: 'Settlements', icon: '&#128202;' },
    { href: '/dashboard/commission', label: 'Commission', icon: '&#128176;' },
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
            <span className="navbar-brand-tag">FRANCHISE ADMIN</span>
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
                <div className="navbar-user-name">{admin.name}</div>
                <div className="navbar-user-role">{formatRole(admin.role)}</div>
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
                    {admin.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {admin.email}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {formatRole(admin.role)}
                  </div>
                </div>
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
