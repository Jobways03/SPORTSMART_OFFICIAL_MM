'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  ShoppingBag,
  User,
  ChevronDown,
  X,
  LogOut,
  Package,
  RotateCcw,
  Menu as MenuIcon,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { fetchMenuClient } from '@/lib/menu';
import { type MenuNode, type MenuTree, nodeHref } from '@/data/menuTypes';
import { MegaMenu } from './MegaMenu';

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

export function Navbar() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [cartCount, setCartCount] = useState(0);

  const [menu, setMenu] = useState<MenuTree | null>(null);

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch menu from the storefront API. Renders empty until loaded.
  useEffect(() => {
    let cancelled = false;
    fetchMenuClient('main-menu').then((m) => {
      if (!cancelled) setMenu(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auth + cart
  useEffect(() => {
    try {
      const userData = sessionStorage.getItem('user');
      const token = sessionStorage.getItem('accessToken');
      if (userData && token) {
        setUser(JSON.parse(userData));
        apiClient<CartData>('/customer/cart')
          .then((res) => res.data && setCartCount(res.data.itemCount))
          .catch(() => {});
      }
    } catch {}
  }, []);

  useEffect(() => {
    const handler = () => {
      apiClient<CartData>('/customer/cart')
        .then((res) => res.data && setCartCount(res.data.itemCount))
        .catch(() => {});
    };
    window.addEventListener('cart-updated', handler);
    return () => window.removeEventListener('cart-updated', handler);
  }, []);

  // Outside click for user dropdown
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Esc closes everything
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        setSearchOpen(false);
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Mega-menu hover handlers — small delay on close so cursor can travel
  // diagonally from the trigger to the panel without flicker.
  const handleEnter = (label: string) => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setOpenMenu(label);
  };
  const handleLeave = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpenMenu(null), 120);
  };

  // Search
  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await apiClient<{ suggestions: SearchSuggestion[] }>(
        `/storefront/products/search-suggestions?q=${encodeURIComponent(q.trim())}`,
      );
      setSuggestions(res.data?.suggestions ?? []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  const onSearchInput = (v: string) => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 300);
  };

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchOpen(false);
    if (search.trim()) {
      router.push(`/products?search=${encodeURIComponent(search.trim())}`);
    }
  };

  const onSuggestionClick = (s: SearchSuggestion) => {
    setSearchOpen(false);
    setSearch('');
    if (s.type === 'product' && s.slug) router.push(`/products/${s.slug}`);
    else if (s.type === 'category' && s.id) router.push(`/products?categoryId=${s.id}`);
    else if (s.type === 'brand' && s.id) router.push(`/products?brandId=${s.id}`);
    else router.push(`/products?search=${encodeURIComponent(s.text)}`);
  };

  const onLogout = () => {
    try {
      sessionStorage.removeItem('accessToken');
      sessionStorage.removeItem('refreshToken');
      sessionStorage.removeItem('user');
    } catch {}
    setUser(null);
    setCartCount(0);
    setUserMenuOpen(false);
    router.push('/');
  };

  const topItems: MenuNode[] = menu?.items ?? [];
  const activeNav = topItems.find((n) => n.id === openMenu);

  return (
    <>
      <header
        className="sticky top-0 z-40 bg-white border-b border-ink-200"
        onMouseLeave={handleLeave}
      >
        <div className="w-full px-4 sm:px-6 lg:px-10 flex items-center gap-8 h-20">
          {/* Logo + tagline */}
          <Link
            href="/"
            aria-label="Sportsmart home"
            className="shrink-0 flex flex-col items-start leading-none"
          >
            <span className="font-display text-3xl tracking-wide leading-none italic">
              <span className="text-sale">SPORTSMART</span>
              <span className="text-ink-900">.com</span>
            </span>
            <span className="font-brush text-[11px] tracking-wide text-accent-dark mt-1 lowercase italic">
              play happy &middot; stay healthy
            </span>
          </Link>

          {/* Top-level nav — rendered from the dynamic menu tree */}
          <nav className="hidden lg:flex items-stretch h-full">
            {topItems.map((item) => {
              const isOpen = openMenu === item.id;
              const hasMenu = item.children.length > 0;
              return (
                <div
                  key={item.id}
                  className="relative h-full"
                  onMouseEnter={() => hasMenu && handleEnter(item.id)}
                >
                  {hasMenu ? (
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      className={[
                        'inline-flex items-center gap-1 h-full px-4 text-body font-medium tracking-wide uppercase transition-colors',
                        isOpen ? 'text-accent-dark' : 'text-ink-900 hover:text-accent-dark',
                      ].join(' ')}
                    >
                      {item.label}
                      <ChevronDown
                        className={`size-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                  ) : (
                    <Link
                      href={nodeHref(item)}
                      className="inline-flex items-center h-full px-4 text-body font-medium tracking-wide uppercase text-ink-900 hover:text-accent-dark"
                    >
                      {item.label}
                    </Link>
                  )}
                  {isOpen && (
                    <span
                      aria-hidden
                      className="absolute left-4 right-4 bottom-0 h-[2px] bg-accent-dark"
                    />
                  )}
                </div>
              );
            })}
          </nav>

          <div className="flex-1" />

          {/* Right cluster */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Search"
              onClick={() => setSearchOpen(true)}
              className="size-10 grid place-items-center hover:bg-ink-100 rounded-full transition-colors"
            >
              <Search className="size-5" strokeWidth={1.75} />
            </button>

            {user ? (
              <div ref={userMenuRef} className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  aria-label="Account menu"
                  className="size-10 grid place-items-center hover:bg-ink-100 rounded-full transition-colors"
                >
                  <User className="size-5" strokeWidth={1.75} />
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 min-w-56 bg-white border border-ink-200 shadow-md py-1 z-50 rounded-2xl overflow-hidden">
                    <div className="px-4 py-2 border-b border-ink-100">
                      <div className="text-body font-medium text-ink-900 truncate">
                        {user.firstName} {user.lastName}
                      </div>
                      <div className="text-caption text-ink-600 truncate">{user.email}</div>
                    </div>
                    <Link
                      href="/account"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-body text-ink-900 hover:bg-ink-50"
                    >
                      <User className="size-4" />
                      My account
                    </Link>
                    <Link
                      href="/orders"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-body text-ink-900 hover:bg-ink-50"
                    >
                      <Package className="size-4" />
                      My orders
                    </Link>
                    <Link
                      href="/returns"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-body text-ink-900 hover:bg-ink-50"
                    >
                      <RotateCcw className="size-4" />
                      My returns
                    </Link>
                    <button
                      onClick={onLogout}
                      className="w-full flex items-center gap-2 px-4 py-2 text-body text-danger hover:bg-ink-50 border-t border-ink-100"
                    >
                      <LogOut className="size-4" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                aria-label="Sign in"
                className="size-10 grid place-items-center hover:bg-ink-100 rounded-full transition-colors"
              >
                <User className="size-5" strokeWidth={1.75} />
              </Link>
            )}

            <Link
              href="/cart"
              aria-label={`Cart with ${cartCount} items`}
              className="relative size-10 grid place-items-center hover:bg-ink-100 rounded-full transition-colors"
            >
              <ShoppingBag className="size-5" strokeWidth={1.75} />
              {cartCount > 0 && (
                <span className="absolute top-1 right-1 min-w-4 h-4 px-1 grid place-items-center bg-sale text-white text-[10px] font-semibold rounded-full tabular leading-none">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
            </Link>

            <button
              type="button"
              aria-label="Open menu"
              className="lg:hidden size-10 grid place-items-center hover:bg-ink-100 rounded-full"
            >
              <MenuIcon className="size-5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Mega-menu panel */}
        {openMenu && activeNav && (
          <div
            onMouseEnter={() => handleEnter(openMenu)}
            onMouseLeave={handleLeave}
            className="absolute left-0 right-0 top-full bg-white border-t border-ink-200 shadow-lg animate-fade-up rounded-b-3xl overflow-hidden"
          >
            <div className="w-full max-w-[1440px] mx-auto">
              <MegaMenu node={activeNav} onClose={() => setOpenMenu(null)} />
            </div>
          </div>
        )}
      </header>

      {/* Search overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 animate-fade-up" onClick={() => setSearchOpen(false)}>
          <div
            className="bg-white border-b border-ink-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full px-4 sm:px-6 lg:px-10 py-6 flex items-center gap-4">
              <form onSubmit={onSearchSubmit} className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-ink-500 pointer-events-none" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Search for shoes, jerseys, brands…"
                  value={search}
                  onChange={(e) => onSearchInput(e.target.value)}
                  className="w-full h-12 pl-11 pr-4 bg-ink-50 border border-ink-300 text-body-lg placeholder:text-ink-500 focus:bg-white focus:border-ink-900 focus:outline-none rounded-full"
                />
              </form>
              <button
                type="button"
                aria-label="Close search"
                onClick={() => setSearchOpen(false)}
                className="size-10 grid place-items-center hover:bg-ink-100 rounded-full"
              >
                <X className="size-5" />
              </button>
            </div>
            {suggestions.length > 0 && (
              <div className="w-full px-4 sm:px-6 lg:px-10 pb-6 max-h-80 overflow-y-auto">
                <div className="text-caption uppercase tracking-wider text-ink-500 font-semibold mb-2">
                  Suggestions
                </div>
                <ul className="divide-y divide-ink-100">
                  {suggestions.map((s, idx) => (
                    <li key={idx}>
                      <button
                        onClick={() => onSuggestionClick(s)}
                        className="w-full flex items-center gap-3 py-2.5 hover:text-accent-dark text-left"
                      >
                        <Search className="size-3.5 text-ink-500 shrink-0" />
                        <span className="text-body text-ink-900 flex-1 truncate">{s.text}</span>
                        <span className="text-caption uppercase tracking-wider text-ink-500">
                          {s.type}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
