'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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

interface SearchSuggestion {
  type: 'product' | 'category' | 'brand';
  text: string;
  slug?: string;
  id?: string;
}

export default function Navbar() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [user, setUser] = useState<UserInfo | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Search suggestions state
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
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

  // Fetch search suggestions
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setSuggestionsLoading(true);
    try {
      const res = await apiClient<{ suggestions: SearchSuggestion[] }>(
        `/storefront/products/search-suggestions?q=${encodeURIComponent(query.trim())}`
      );
      if (res.data?.suggestions) {
        setSuggestions(res.data.suggestions);
        setShowSuggestions(true);
      }
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, []);

  const handleSearchInput = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    if (search.trim()) {
      router.push(`/?search=${encodeURIComponent(search.trim())}`);
    } else {
      router.push('/');
    }
  };

  const handleSuggestionClick = (suggestion: SearchSuggestion) => {
    setShowSuggestions(false);
    if (suggestion.type === 'product' && suggestion.slug) {
      setSearch('');
      router.push(`/products/${suggestion.slug}`);
    } else if (suggestion.type === 'category' && suggestion.id) {
      setSearch(suggestion.text);
      router.push(`/?categoryId=${suggestion.id}`);
    } else if (suggestion.type === 'brand' && suggestion.id) {
      setSearch(suggestion.text);
      router.push(`/?brandId=${suggestion.id}`);
    } else {
      setSearch(suggestion.text);
      router.push(`/?search=${encodeURIComponent(suggestion.text)}`);
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

      <div className="navbar-search-wrapper" ref={suggestionsRef}>
        <form onSubmit={handleSearch} className="navbar-search">
          <span className="navbar-search-icon">&#128269;</span>
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => handleSearchInput(e.target.value)}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
          />
          {search && (
            <button
              type="button"
              className="navbar-search-clear"
              onClick={() => {
                setSearch('');
                setSuggestions([]);
                setShowSuggestions(false);
              }}
            >
              &times;
            </button>
          )}
        </form>

        {showSuggestions && suggestions.length > 0 && (
          <div className="search-suggestions">
            {suggestions.map((s, idx) => (
              <button
                key={idx}
                className="search-suggestion-item"
                onClick={() => handleSuggestionClick(s)}
              >
                <span className="search-suggestion-icon">
                  {s.type === 'product' ? '\u{1F3C0}' : s.type === 'category' ? '\u{1F4C2}' : '\u{1F3F7}\uFE0F'}
                </span>
                <span className="search-suggestion-text">{s.text}</span>
                <span className="search-suggestion-type">{s.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>

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
                  <Link
                    href="/returns"
                    onClick={() => setDropdownOpen(false)}
                    style={{ display: 'block', padding: '10px 14px', fontSize: 14, color: '#111', textDecoration: 'none', borderTop: '1px solid #f3f4f6' }}
                  >
                    My Returns
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
