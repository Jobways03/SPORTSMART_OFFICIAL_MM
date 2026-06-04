'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePermissions } from '@/lib/permissions';

/* ── Icon set ────────────────────────────────────────────────
   One file, one stroke weight (1.6px), 18×18. Drop-in replacement
   for the emoji icons that used to mark each tile. */

type IconName =
  | 'shield-check'
  | 'shield'
  | 'user'
  | 'activity'
  | 'truck'
  | 'bell'
  | 'document'
  | 'pencil'
  | 'menu'
  | 'logs'
  | 'clipboard'
  | 'sessions';

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'shield-check':
      return (
        <svg {...common}>
          <path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z" />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0116 0" />
        </svg>
      );
    case 'activity':
      return (
        <svg {...common}>
          <path d="M3 12h4l3-8 4 16 3-8h4" />
        </svg>
      );
    case 'truck':
      return (
        <svg {...common}>
          <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7" />
          <circle cx="7" cy="18" r="1.6" />
          <circle cx="17" cy="18" r="1.6" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...common}>
          <path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16zM10 20a2 2 0 004 0" />
        </svg>
      );
    case 'document':
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6zM15 3v5h4" />
          <path d="M9 13h6M9 17h6" />
        </svg>
      );
    case 'pencil':
      return (
        <svg {...common}>
          <path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      );
    case 'logs':
      return (
        <svg {...common}>
          <path d="M5 4h11l3 3v13H5zM9 9h6M9 13h6M9 17h4" />
        </svg>
      );
    case 'clipboard':
      return (
        <svg {...common}>
          <path d="M9 4h6v3H9zM6 6h12v15H6z" />
          <path d="M9 12h6M9 16h4" />
        </svg>
      );
    case 'sessions':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3.5" />
          <path d="M3 19a6 6 0 0112 0" />
          <circle cx="17" cy="11" r="2.5" />
          <path d="M14 20a4 4 0 017 0" />
        </svg>
      );
  }
}

/* ── Catalog ────────────────────────────────────────────────── */

type Permission = 'superAdmin' | { anyOf: string[] };

interface SettingItem {
  title: string;
  description: string;
  href: string;
  icon: IconName;
  requires?: Permission;
}

interface SettingGroup {
  key: string;
  label: string;
  items: SettingItem[];
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    key: 'security',
    label: 'Security & Access',
    items: [
      {
        title: 'Two-factor authentication',
        description: 'Enrol TOTP, save backup codes, confirm enrolment.',
        href: '/dashboard/settings/mfa',
        icon: 'shield-check',
      },
      {
        title: 'Roles & Permissions',
        description: 'Define what each admin role can do. Custom roles supported.',
        href: '/dashboard/roles',
        icon: 'shield',
        requires: 'superAdmin',
      },
      {
        title: 'Authorization Readiness',
        description: 'Operator dashboard for the authz stack — strict / soak, coverage, warnings.',
        href: '/dashboard/settings/authz-readiness',
        icon: 'activity',
        requires: { anyOf: ['roles.read'] },
      },
    ],
  },
  {
    key: 'team',
    label: 'Team',
    items: [
      {
        title: 'Admin Users',
        description: 'Create, suspend, or reassign internal admin accounts.',
        href: '/dashboard/users',
        icon: 'user',
        requires: 'superAdmin',
      },
    ],
  },
  {
    key: 'storefront',
    label: 'Storefront',
    items: [
      {
        title: 'Storefront Content',
        description: 'Static pages, banners, and merchandising blocks.',
        href: '/dashboard/content',
        icon: 'document',
        requires: { anyOf: ['content.read'] },
      },
      {
        title: 'Storefront Navigation',
        description: 'Category trees and menu structure visible to customers.',
        href: '/dashboard/menus',
        icon: 'menu',
        requires: { anyOf: ['storefront.read'] },
      },
      {
        title: 'Blog posts',
        description: 'News, reviews, and articles for /blogs and the homepage strip.',
        href: '/dashboard/blog-posts',
        icon: 'pencil',
        requires: { anyOf: ['content.read'] },
      },
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    items: [
      {
        title: 'Shipping',
        description: 'Zones, rates, and surcharges. Applies to every checkout.',
        href: '/dashboard/settings/shipping',
        icon: 'truck',
        requires: { anyOf: ['shipping.read', 'shipping.write'] },
      },
      {
        title: 'Notifications',
        description: 'Email / SMS / WhatsApp templates and customer preferences.',
        href: '/dashboard/notifications',
        icon: 'bell',
        requires: { anyOf: ['notifications.read'] },
      },
    ],
  },
  {
    key: 'finance',
    label: 'Finance & Risk',
    items: [
      {
        title: 'Tax & GST',
        description: 'GST reports, TCS filings, e-invoicing, and tax readiness.',
        href: '/dashboard/tax',
        icon: 'document',
        requires: { anyOf: ['tax.reports.read', 'tax.tcs.read'] },
      },
      {
        title: 'Reconciliation',
        description: 'Settlement, payout, and ledger reconciliation runs.',
        href: '/dashboard/reconciliation',
        icon: 'activity',
        requires: { anyOf: ['recon.read'] },
      },
      {
        title: 'Risk Review',
        description: 'Risk-scored returns and disputes queued for manual review.',
        href: '/dashboard/risk-review',
        icon: 'shield',
        requires: { anyOf: ['risk.review', 'returns.read'] },
      },
    ],
  },
  {
    key: 'audit',
    label: 'Audit & Monitoring',
    items: [
      {
        title: 'Access Logs',
        description: 'Cross-actor sign-in trail and brute-force detection.',
        href: '/dashboard/access-logs',
        icon: 'logs',
        requires: { anyOf: ['audit.read'] },
      },
      {
        title: 'Admin Activity',
        description: 'Timeline merging admin auth, RBAC mutations, and admin actions.',
        href: '/dashboard/admin-activity',
        icon: 'activity',
        requires: { anyOf: ['roles.read'] },
      },
      {
        title: 'Audit Logs',
        description: 'Hash-chained audit trail of business-critical mutations. CSV export.',
        href: '/dashboard/audit-logs',
        icon: 'clipboard',
        requires: { anyOf: ['audit.read'] },
      },
      {
        title: 'Active Sessions',
        description: 'Refresh-token sessions across admins, users, sellers, franchises.',
        href: '/dashboard/sessions',
        icon: 'sessions',
        requires: { anyOf: ['sessions.read'] },
      },
      {
        title: 'Cron & Queues',
        description: 'SLA / risk work queues and background-job health.',
        href: '/dashboard/queues',
        icon: 'logs',
        requires: { anyOf: ['audit.read'] },
      },
      {
        title: 'Data Validation',
        description: 'Cross-table integrity checks and money / ledger drift scans.',
        href: '/dashboard/system/data-validation',
        icon: 'clipboard',
        requires: { anyOf: ['audit.read'] },
      },
    ],
  },
];

/* ── Page ───────────────────────────────────────────────────── */

export default function SettingsHubPage() {
  const { loading, me, isSuperAdmin, hasAnyPermission } = usePermissions();
  const [query, setQuery] = useState('');

  const canAccess = (item: SettingItem): boolean => {
    if (loading || !me) return false;
    if (!item.requires) return true;
    if (item.requires === 'superAdmin') return isSuperAdmin;
    return hasAnyPermission(item.requires.anyOf);
  };

  // Build the (filtered) groups + flat list of items the user can't
  // touch. The filter matches against title + description.
  const { visibleGroups, lockedItems, totalVisible } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (item: SettingItem) =>
      !q ||
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q);

    const groups: SettingGroup[] = [];
    const locked: SettingItem[] = [];
    let totalVis = 0;

    for (const g of SETTING_GROUPS) {
      const groupItems: SettingItem[] = [];
      for (const item of g.items) {
        if (!matchesQuery(item)) continue;
        if (canAccess(item)) {
          groupItems.push(item);
          totalVis++;
        } else if (!q) {
          // Only show "locked" when there's no active search; search
          // is for accessible items only so it doesn't surface stuff
          // the user can't open.
          locked.push(item);
        }
      }
      if (groupItems.length > 0) {
        groups.push({ ...g, items: groupItems });
      }
    }

    return { visibleGroups: groups, lockedItems: locked, totalVisible: totalVis };
  }, [loading, me, isSuperAdmin, hasAnyPermission, query]);

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={{ minWidth: 0 }}>
          <h1 style={styles.h1}>Settings</h1>
          <p style={styles.headerSub}>
            Platform-wide controls. Some sections require Super Admin or specific permissions.
          </p>
        </div>
      </header>

      {/* Search */}
      <div style={styles.searchWrap}>
        <svg
          viewBox="0 0 20 20"
          style={styles.searchIcon}
          aria-hidden="true"
        >
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            d="M9 3a6 6 0 104.472 10.03L17 17M9 15A6 6 0 109 3a6 6 0 000 12z"
          />
        </svg>
        <input
          type="search"
          placeholder="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={styles.searchInput}
          aria-label="Search settings"
        />
      </div>

      {/* Body */}
      {loading ? (
        <div style={styles.loading}>Loading…</div>
      ) : totalVisible === 0 && lockedItems.length === 0 && !query ? (
        <div style={styles.noAccess}>
          You don&apos;t have access to any settings sections. Contact a Super
          Admin if you think this is wrong.
        </div>
      ) : totalVisible === 0 && query ? (
        <div style={styles.empty}>
          No settings match &ldquo;<strong>{query}</strong>&rdquo;.
        </div>
      ) : (
        <div style={styles.groupStack}>
          {visibleGroups.map((g) => (
            <section key={g.key}>
              <div style={styles.groupHeader}>
                <h2 style={styles.groupLabel}>{g.label}</h2>
                <span style={styles.groupCount}>
                  {g.items.length} {g.items.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              <div style={styles.list}>
                {g.items.map((item, idx) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{
                      ...styles.row,
                      borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                    }}
                  >
                    <span style={styles.iconWrap}>
                      <Icon name={item.icon} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={styles.rowTitle}>{item.title}</span>
                      <span style={styles.rowDesc}>{item.description}</span>
                    </span>
                    <svg
                      viewBox="0 0 16 16"
                      width="14"
                      height="14"
                      aria-hidden="true"
                      style={styles.chevron}
                    >
                      <path
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 3l5 5-5 5"
                      />
                    </svg>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Locked tile disclosure — collapsed by default. Hidden when
          the user is actively searching, since search should only show
          things they can actually open. */}
      {!loading && lockedItems.length > 0 && !query && (
        <details style={styles.lockedDetails}>
          <summary style={styles.lockedSummary}>
            {lockedItems.length} section
            {lockedItems.length === 1 ? '' : 's'} hidden — you don&apos;t have permission
          </summary>
          <ul style={styles.lockedList}>
            {lockedItems.map((item) => (
              <li key={item.href} style={styles.lockedRow}>
                <span style={styles.lockedIcon}>
                  <Icon name={item.icon} />
                </span>
                <span style={{ color: '#475569', fontSize: 13 }}>{item.title}</span>
                <span style={styles.lockedRequires}>
                  requires{' '}
                  {item.requires === 'superAdmin'
                    ? 'Super Admin'
                    : item.requires?.anyOf.join(' or ')}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  page: {
    color: '#0f172a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },

  header: {
    marginBottom: 20,
  },
  h1: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: '#0f172a',
  },
  headerSub: {
    margin: '4px 0 0',
    fontSize: 13,
    color: '#64748b',
  },

  /* Search */
  searchWrap: {
    position: 'relative',
    marginBottom: 20,
    maxWidth: 360,
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 16,
    height: 16,
    color: '#94a3b8',
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    height: 38,
    padding: '0 12px 0 36px',
    fontSize: 13.5,
    color: '#0f172a',
    background: '#fff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.12s',
    fontFamily: 'inherit',
  },

  /* Group sections */
  groupStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 22,
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 8,
    paddingLeft: 4,
  },
  groupLabel: {
    margin: 0,
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  groupCount: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: 500,
  },

  /* List */
  list: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '12px 16px',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'background-color 0.08s',
  },
  iconWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    background: '#f8fafc',
    color: '#475569',
    flexShrink: 0,
  },
  rowTitle: {
    display: 'block',
    fontSize: 13.5,
    fontWeight: 600,
    color: '#0f172a',
    lineHeight: 1.3,
  },
  rowDesc: {
    display: 'block',
    fontSize: 12.5,
    color: '#64748b',
    marginTop: 3,
    lineHeight: 1.4,
  },
  chevron: {
    color: '#cbd5e1',
    flexShrink: 0,
    marginLeft: 4,
  },

  /* States */
  loading: {
    padding: '40px 0',
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
  noAccess: {
    padding: '16px 18px',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 8,
    fontSize: 13,
    color: '#92400e',
    lineHeight: 1.5,
  },
  empty: {
    padding: '40px 24px',
    textAlign: 'center',
    fontSize: 13,
    color: '#64748b',
  },

  /* Locked disclosure */
  lockedDetails: {
    marginTop: 28,
  },
  lockedSummary: {
    cursor: 'pointer',
    fontSize: 12.5,
    color: '#94a3b8',
    userSelect: 'none',
    paddingLeft: 4,
  },
  lockedList: {
    listStyle: 'none',
    margin: '10px 0 0',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  lockedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
  },
  lockedIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    color: '#94a3b8',
    flexShrink: 0,
  },
  lockedRequires: {
    marginLeft: 'auto',
    fontSize: 11,
    color: '#94a3b8',
  },
};
