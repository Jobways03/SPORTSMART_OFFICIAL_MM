'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { profileService, CustomerProfile } from '@/services/profile.service';
import { walletService, formatPaise } from '@/services/wallet.service';
import { wishlistService } from '@/services/wishlist.service';
import { apiClient } from '@/lib/api-client';
import { useAuthGuard } from '@/lib/useAuthGuard';

type IconTint = 'blue' | 'emerald' | 'amber' | 'violet' | 'green' | 'rose' | 'orange';

interface AccountCardConfig {
  href: string;
  title: string;
  desc: string;
  tint: IconTint;
  icon: React.ReactNode;
}

interface AccountSection {
  label: string;
  cards: AccountCardConfig[];
}

// Lucide-style stroked icons. Inline so we don't pull in a 50kb icon
// package just for seven glyphs on this page.
const ICONS = {
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  mapPin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  ),
  package: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16.5 9.4-9-5.19" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  rotate: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  ),
  support: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 9 9c0 1.5-.4 2.9-1 4.1l1 5.9-6-1c-1 .5-2 .8-3 .8a9 9 0 0 1-9-9z" />
    </svg>
  ),
  receipt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V2l-2 2-2-2-2 2-2-2-2 2-2-2-2 2-2-2z" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
      <path d="M8 15h5" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  heart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  fileText: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
};

const SECTIONS: AccountSection[] = [
  {
    label: 'Profile & Settings',
    cards: [
      { href: '/account/profile', title: 'My Profile', desc: 'Manage personal details and password', tint: 'blue', icon: ICONS.user },
      { href: '/account/addresses', title: 'My Addresses', desc: 'Add and edit shipping addresses', tint: 'emerald', icon: ICONS.mapPin },
      // Commented out per request:
      // { href: '/account/tax-profiles', title: 'GST Tax Profiles', desc: 'Save GSTINs for business invoices at checkout', tint: 'violet', icon: ICONS.receipt },
      // { href: '/account/notifications', title: 'Notifications', desc: 'Choose what we contact you about', tint: 'orange', icon: ICONS.bell },
    ],
  },
  {
    label: 'Orders & Activity',
    cards: [
      { href: '/orders', title: 'My Orders', desc: 'Track orders and view history', tint: 'amber', icon: ICONS.package },
      { href: '/returns', title: 'My Returns', desc: 'View and manage return requests', tint: 'violet', icon: ICONS.rotate },
      { href: '/account/wishlist', title: 'My Wishlist', desc: 'Products you saved to buy later', tint: 'rose', icon: ICONS.heart },
      // Commented out per request:
      // { href: '/account/invoices', title: 'My Invoices', desc: 'Download GST invoices and tax documents', tint: 'blue', icon: ICONS.fileText },
    ],
  },
  {
    label: 'Money & Support',
    cards: [
      { href: '/account/wallet', title: 'My Wallet', desc: 'Balance, top-ups, refund history', tint: 'green', icon: ICONS.wallet },
      { href: '/account/support', title: 'Help & Support', desc: 'Open and track support tickets', tint: 'rose', icon: ICONS.support },
    ],
  },
  // Privacy & Security section — commented out per request
  /*
  {
    label: 'Privacy & Security',
    cards: [
      { href: '/account/privacy', title: 'Privacy & Consent', desc: 'Control marketing and data-processing consent', tint: 'violet', icon: ICONS.shield },
      { href: '/account/data-export', title: 'Download My Data', desc: 'Export a copy of your account data (DPDP)', tint: 'emerald', icon: ICONS.download },
      { href: '/account/access-history', title: 'Sign-in Activity', desc: 'See recent logins and devices on your account', tint: 'amber', icon: ICONS.clock },
    ],
  },
  */
];

function formatMemberSince(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export default function AccountHubPage() {
  const router = useRouter();
  const authStatus = useAuthGuard();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{
    orders: number | null;
    wishlist: number | null;
    walletPaise: number | null;
  }>({ orders: null, wishlist: null, walletPaise: null });

  useEffect(() => {
    if (authStatus !== 'authed') return;
    profileService
      .getProfile()
      .then((res) => {
        if (res.data) setProfile(res.data);
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [authStatus, router]);

  // At-a-glance counts. Supplementary + independent: each endpoint is
  // fault-tolerant so one slow/failing call never blocks or breaks the hub.
  useEffect(() => {
    if (authStatus !== 'authed') return;
    apiClient<{ pagination: { total: number } }>('/customer/orders?page=1&limit=1')
      .then((r) => setStats((s) => ({ ...s, orders: r.data?.pagination?.total ?? 0 })))
      .catch(() => undefined);
    wishlistService
      .list(1, 1)
      .then((r) => setStats((s) => ({ ...s, wishlist: r.data?.total ?? 0 })))
      .catch(() => undefined);
    walletService
      .getWallet()
      .then((r) => setStats((s) => ({ ...s, walletPaise: r.data?.balanceInPaise ?? 0 })))
      .catch(() => undefined);
  }, [authStatus]);

  if (loading) {
    return (
      <StorefrontShell>
        <div className="products-loading">
          <div className="loading-spinner"></div>
          <span>Loading account...</span>
        </div>
      </StorefrontShell>
    );
  }

  const memberSince = formatMemberSince(profile?.createdAt);

  return (
    <StorefrontShell>
      <div className="account-page">
        <div className="account-page-header">
          <h1 className="account-page-title">My Account</h1>
          <p className="account-page-subtitle">
            Manage your profile, orders, and preferences
          </p>
        </div>

        {profile && (
          <div className="account-hero">
            <div className="account-hero-avatar">
              {profile.firstName.charAt(0).toUpperCase()}
              {profile.lastName.charAt(0).toUpperCase()}
            </div>
            <div className="account-hero-info">
              <div className="account-hero-name">
                {profile.firstName} {profile.lastName}
              </div>
              <div className="account-hero-meta">
                <span className="account-hero-email">{profile.email}</span>
                {profile.emailVerified && (
                  <span className="account-hero-badge account-hero-badge-verified">
                    <span className="account-hero-badge-icon">{ICONS.check}</span>
                    Verified
                  </span>
                )}
              </div>
              {(profile.phone || memberSince) && (
                <div className="account-hero-secondary">
                  {profile.phone && <span>{profile.phone}</span>}
                  {profile.phone && memberSince && (
                    <span className="account-hero-dot">•</span>
                  )}
                  {memberSince && <span>Member since {memberSince}</span>}
                </div>
              )}
            </div>
            <Link href="/account/profile" className="account-hero-edit">
              Edit profile
            </Link>
          </div>
        )}

        {profile && (
          <div className="account-stats">
            <Link href="/orders" className="account-stat">
              <span className="account-stat-value tabular">{stats.orders ?? '—'}</span>
              <span className="account-stat-label">Orders</span>
            </Link>
            <Link href="/account/wishlist" className="account-stat">
              <span className="account-stat-value tabular">{stats.wishlist ?? '—'}</span>
              <span className="account-stat-label">Wishlist</span>
            </Link>
            <Link href="/account/wallet" className="account-stat">
              <span className="account-stat-value tabular">
                {stats.walletPaise === null ? '—' : formatPaise(stats.walletPaise)}
              </span>
              <span className="account-stat-label">Wallet</span>
            </Link>
          </div>
        )}

        {SECTIONS.map((section) => (
          <section key={section.label} className="account-section">
            <h2 className="account-section-label">{section.label}</h2>
            <div className="account-hub-grid">
              {section.cards.map((card) => (
                <Link key={card.href} href={card.href} className="account-card">
                  <div className={`account-card-icon account-card-icon-${card.tint}`}>
                    {card.icon}
                  </div>
                  <div className="account-card-content">
                    <div className="account-card-title">{card.title}</div>
                    <div className="account-card-desc">{card.desc}</div>
                  </div>
                  <span className="account-card-arrow">{ICONS.chevron}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </StorefrontShell>
  );
}
