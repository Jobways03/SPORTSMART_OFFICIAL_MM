'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface UserInfo {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface CartData {
  itemCount: number;
}

export default function Navbar() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [user, setUser] = useState<UserInfo | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const userData = sessionStorage.getItem('user');
      const token = sessionStorage.getItem('accessToken');
      if (userData && token) {
        setUser(JSON.parse(userData));
        // Fetch cart count
        apiClient<CartData>('/customer/cart')
          .then((res) => {
            if (res.data) setCartCount(res.data.itemCount);
          })
          .catch(() => {});
      }
    } catch {
      // Storage unavailable
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

  // Listen for cart updates
  useEffect(() => {
    const handler = () => {
      apiClient<CartData>('/customer/cart')
        .then((res) => {
          if (res.data) setCartCount(res.data.itemCount);
        })
        .catch(() => {});
    };
    window.addEventListener('cart-updated', handler);
    return () => window.removeEventListener('cart-updated', handler);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      router.push(`/?search=${encodeURIComponent(search.trim())}`);
    }
  };

  const handleLogout = () => {
    try {
      sessionStorage.removeItem('accessToken');
      sessionStorage.removeItem('refreshToken');
      sessionStorage.removeItem('user');
    } catch {
      // Storage unavailable
    }
    setUser(null);
    setCartCount(0);
    router.push('/');
  };

  return (
    <nav className="navbar">
      <Link href="/" className="navbar-brand">SPORTSMART</Link>

      <form onSubmit={handleSearch} className="navbar-search">
        <span className="navbar-search-icon">&#128269;</span>
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>

      <div className="navbar-links">
        <Link href="/">Shop</Link>
        {user ? (
          <>
            <Link href="/cart" style={{ position: 'relative' }}>
              <span>&#128722;</span>
              {cartCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: -8,
                  right: -10,
                  background: '#dc2626',
                  color: '#fff',
                  borderRadius: '50%',
                  width: 18,
                  height: 18,
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                }}>{cartCount}</span>
              )}
            </Link>
            <div ref={dropdownRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                  fontSize: 14,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {user.firstName}
                <span style={{ fontSize: 10 }}>&#9660;</span>
              </button>
              {dropdownOpen && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  minWidth: 160,
                  zIndex: 100,
                  marginTop: 6,
                }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#6b7280' }}>
                    {user.email}
                  </div>
                  <Link
                    href="/orders"
                    onClick={() => setDropdownOpen(false)}
                    style={{ display: 'block', padding: '10px 14px', fontSize: 14, color: '#111', textDecoration: 'none' }}
                  >
                    My Orders
                  </Link>
                  <button
                    onClick={handleLogout}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 14px',
                      fontSize: 14,
                      color: '#dc2626',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      borderTop: '1px solid #f3f4f6',
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <Link href="/login">Sign In</Link>
        )}
      </div>
    </nav>
  );
}
