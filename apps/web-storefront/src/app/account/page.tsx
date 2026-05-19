'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { profileService, CustomerProfile } from '@/services/profile.service';
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
};

const SECTIONS: AccountSection[] = [
  {
    label: 'Profile & Settings',
    cards: [
      { href: '/account/profile', title: 'My Profile', desc: 'Manage personal details and password', tint: 'blue', icon: ICONS.user },
      { href: '/account/addresses', title: 'My Addresses', desc: 'Add and edit shipping addresses', tint: 'emerald', icon: ICONS.mapPin },
      { href: '/account/tax-profiles', title: 'GST Tax Profiles', desc: 'Save GSTINs for business invoices at checkout', tint: 'violet', icon: ICONS.receipt },
      { href: '/account/notifications', title: 'Notifications', desc: 'Choose what we contact you about', tint: 'orange', icon: ICONS.bell },
    ],
  },
  {
    label: 'Orders & Activity',
    cards: [
      { href: '/orders', title: 'My Orders', desc: 'Track orders and view history', tint: 'amber', icon: ICONS.package },
      { href: '/returns', title: 'My Returns', desc: 'View and manage return requests', tint: 'violet', icon: ICONS.rotate },
    ],
  },
  {
    label: 'Money & Support',
    cards: [
      { href: '/account/wallet', title: 'My Wallet', desc: 'Balance, top-ups, refund history', tint: 'green', icon: ICONS.wallet },
      { href: '/account/support', title: 'Help & Support', desc: 'Open and track support tickets', tint: 'rose', icon: ICONS.support },
    ],
  },
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

        {SECTIONS.map((section) => (
          <div key={section.label} className="account-section">
            <div className="account-section-label">{section.label}</div>
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
          </div>
        ))}
      </div>
    </StorefrontShell>
  );
}
