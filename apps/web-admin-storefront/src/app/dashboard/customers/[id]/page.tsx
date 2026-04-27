'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

/* ── Types ──────────────────────────────────────────────────── */

interface Address {
  id: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
  addresses: Address[];
}

interface OrderItem {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
}

interface SubOrder {
  id: string;
  fulfillmentStatus: string;
  paymentStatus: string;
  items: OrderItem[];
  seller: { sellerShopName: string } | null;
}

interface Order {
  id: string;
  orderNumber: string;
  totalAmount: number;
  paymentStatus: string;
  verified: boolean;
  itemCount: number;
  createdAt: string;
  subOrders: SubOrder[];
}

interface Stats {
  totalOrders: number;
  totalSpent: number;
  customerSinceDays: number;
}

interface CustomerDetailResponse {
  customer: Customer;
  stats: Stats;
  lastOrder: Order | null;
  orders: Order[];
}

type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/* ── Formatting ─────────────────────────────────────────────── */

const inr = (n: number) =>
  `₹${Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const fmtTime = (d: string) =>
  new Date(d).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

const fmtDateTime = (d: string) => `${fmtDate(d)} at ${fmtTime(d)}`;

const pluralDays = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

const initials = (first: string, last: string) =>
  `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?';

function avatarColor(seed: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue}, 42%, 94%)`,
    fg: `hsl(${hue}, 48%, 30%)`,
  };
}

function paymentPill(status: string): { label: string; tone: PillTone } {
  switch (status) {
    case 'PAID':
      return { label: 'Paid', tone: 'success' };
    case 'PENDING':
      return { label: 'Payment pending', tone: 'warning' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'danger' };
    case 'REFUNDED':
      return { label: 'Refunded', tone: 'info' };
    default:
      return { label: status.toLowerCase(), tone: 'neutral' };
  }
}

function customerStatusPill(status: string): {
  label: string;
  tone: PillTone;
} {
  switch (status) {
    case 'ACTIVE':
      return { label: 'Active', tone: 'success' };
    case 'SUSPENDED':
      return { label: 'Suspended', tone: 'danger' };
    case 'BANNED':
      return { label: 'Banned', tone: 'danger' };
    case 'INACTIVE':
      return { label: 'Inactive', tone: 'neutral' };
    default:
      return { label: status.toLowerCase(), tone: 'neutral' };
  }
}

function fulfillmentPill(subOrders: SubOrder[]): {
  label: string;
  tone: PillTone;
} {
  const statuses = Array.from(
    new Set(subOrders.map((s) => s.fulfillmentStatus)),
  );
  if (statuses.includes('DELIVERED')) return { label: 'Delivered', tone: 'success' };
  if (statuses.includes('FULFILLED')) return { label: 'Fulfilled', tone: 'info' };
  if (statuses.includes('SHIPPED')) return { label: 'Shipped', tone: 'info' };
  if (statuses.includes('PACKED')) return { label: 'Packed', tone: 'warning' };
  return { label: 'Unfulfilled', tone: 'warning' };
}

/* ── Page ───────────────────────────────────────────────────── */

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<CustomerDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllOrders, setShowAllOrders] = useState(false);

  const fetchData = useCallback(() => {
    apiClient<CustomerDetailResponse>(`/admin/customers/${id}`)
      .then((res) => {
        if (res.data) setData(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const timelineGroups = useMemo(() => {
    if (!data) return [];
    type Event = { when: Date; text: string };
    const events: Event[] = [];

    for (const o of data.orders) {
      events.push({
        when: new Date(o.createdAt),
        text:
          o.paymentStatus === 'CANCELLED'
            ? `Order #${o.orderNumber} was cancelled.`
            : `Placed order #${o.orderNumber} via Online Store.`,
      });
    }
    events.push({
      when: new Date(data.customer.createdAt),
      text: 'Created a customer account.',
    });

    events.sort((a, b) => b.when.getTime() - a.when.getTime());

    const groups: { key: string; label: string; items: Event[] }[] = [];
    for (const ev of events) {
      const key = fmtDate(ev.when.toISOString());
      const existing = groups.find((g) => g.key === key);
      if (existing) existing.items.push(ev);
      else groups.push({ key, label: key, items: [ev] });
    }
    return groups;
  }, [data]);

  if (loading) {
    return <LoadingState />;
  }

  if (!data) {
    return (
      <div style={styles.notFound}>
        <h3 style={styles.notFoundTitle}>Customer not found</h3>
        <p style={styles.notFoundBody}>
          This customer may have been removed or the link is invalid.
        </p>
        <Link href="/dashboard/customers" style={styles.notFoundLink}>
          ← Back to Customers
        </Link>
      </div>
    );
  }

  const { customer, stats, lastOrder, orders } = data;
  const defaultAddr =
    customer.addresses.find((a) => a.isDefault) || customer.addresses[0] || null;
  const fullName = `${customer.firstName} ${customer.lastName}`.trim();
  const statusChip = customerStatusPill(customer.status);
  const color = avatarColor(`${customer.firstName}${customer.lastName}${customer.id}`);

  return (
    <div style={styles.page}>
      {/* ── Breadcrumb + identity ─────────────────────────── */}
      <div style={styles.breadcrumb}>
        <Link href="/dashboard/customers" style={styles.breadcrumbLink}>
          Customers
        </Link>
        <span style={styles.breadcrumbSep} aria-hidden="true">
          /
        </span>
        <span style={styles.breadcrumbCurrent}>{fullName}</span>
      </div>

      <header style={styles.identityRow}>
        <div
          style={{ ...styles.identityAvatar, background: color.bg, color: color.fg }}
          aria-hidden="true"
        >
          {initials(customer.firstName, customer.lastName)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={styles.identityTitleRow}>
            <h1 style={styles.h1}>{fullName}</h1>
            <Pill label={statusChip.label} tone={statusChip.tone} />
          </div>
          <div style={styles.identityMeta}>
            <span style={styles.identityMetaItem} title={customer.email}>
              {customer.email}
            </span>
            {customer.phone && (
              <>
                <span style={styles.metaDot} aria-hidden="true">
                  •
                </span>
                <span style={styles.identityMetaItem}>{customer.phone}</span>
              </>
            )}
            <span style={styles.metaDot} aria-hidden="true">
              •
            </span>
            <span style={styles.identityMetaItem}>
              Joined {fmtDate(customer.createdAt)}
            </span>
          </div>
        </div>
      </header>

      {/* ── Stats ───────────────────────────────────────────── */}
      <div style={styles.statsRow}>
        <StatCard
          label="Amount spent"
          value={inr(stats.totalSpent)}
          emphasis
        />
        <StatCard label="Orders" value={String(stats.totalOrders)} />
        <StatCard
          label="Customer since"
          value={pluralDays(stats.customerSinceDays)}
        />
        <StatCard
          label="Last order"
          value={lastOrder ? fmtDate(lastOrder.createdAt) : '—'}
          muted={!lastOrder}
        />
      </div>

      {/* ── Two-column content ──────────────────────────────── */}
      <div style={styles.grid}>
        {/* ── LEFT ── */}
        <div style={styles.main}>
          {lastOrder ? (
            <Section title="Last order placed">
              <LastOrderCard order={lastOrder} />
            </Section>
          ) : (
            <Section title="Last order placed">
              <div style={styles.muted}>
                This customer hasn't placed an order yet.
              </div>
            </Section>
          )}

          <Section title="Timeline">
            {timelineGroups.length === 0 ? (
              <div style={styles.muted}>No activity recorded.</div>
            ) : (
              <div style={styles.timeline}>
                {timelineGroups.map((g) => (
                  <div key={g.key} style={styles.timelineGroup}>
                    <div style={styles.timelineDate}>{g.label}</div>
                    <div style={styles.timelineRail}>
                      {g.items.map((ev, i) => (
                        <div key={i} style={styles.timelineItem}>
                          <span style={styles.timelineDot} aria-hidden="true" />
                          <div style={styles.timelineBody}>
                            <div style={styles.timelineText}>{ev.text}</div>
                            <div style={styles.timelineTime}>
                              {fmtTime(ev.when.toISOString())}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* ── RIGHT sidebar ── */}
        <aside style={styles.sidebar}>
          <SectionCard title="Contact">
            <SideRow label="Email" value={customer.email} mono />
            {customer.phone && (
              <SideRow label="Phone" value={customer.phone} mono />
            )}
          </SectionCard>

          {defaultAddr ? (
            <SectionCard title="Default address">
              <div style={styles.address}>
                <div style={styles.addressName}>{defaultAddr.fullName}</div>
                <div>{defaultAddr.addressLine1}</div>
                {defaultAddr.addressLine2 && <div>{defaultAddr.addressLine2}</div>}
                <div>
                  {defaultAddr.city}, {defaultAddr.state} {defaultAddr.postalCode}
                </div>
                <div>{defaultAddr.country}</div>
                {defaultAddr.phone && (
                  <div style={styles.addressPhone}>{defaultAddr.phone}</div>
                )}
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="Default address">
              <div style={styles.muted}>No address on file.</div>
            </SectionCard>
          )}

          <SectionCard title="Verification">
            <VerificationRow
              label="Email"
              verified={customer.emailVerified}
            />
            <VerificationRow
              label="Phone"
              verified={customer.phoneVerified}
            />
          </SectionCard>

          <SectionCard title="Notes">
            <div style={styles.notesEmpty}>
              Leave notes for this customer — visible to your team only.
            </div>
          </SectionCard>

          {orders.length > 0 && (
            <SectionCard title={`Order history (${orders.length})`}>
              <div style={styles.orderList}>
                {(showAllOrders ? orders : orders.slice(0, 10)).map((o) => {
                  const pay = paymentPill(o.paymentStatus);
                  return (
                    <Link
                      key={o.id}
                      href={`/dashboard/orders/${o.id}`}
                      style={styles.orderItem}
                    >
                      <div style={styles.orderLeft}>
                        <div style={styles.orderNumber}>#{o.orderNumber}</div>
                        <div style={styles.orderDate}>
                          {fmtDate(o.createdAt)}
                        </div>
                      </div>
                      <div style={styles.orderRight}>
                        <div style={styles.orderAmount}>
                          {inr(Number(o.totalAmount))}
                        </div>
                        <div style={{ marginTop: 3 }}>
                          <Pill
                            label={pay.label}
                            tone={pay.tone}
                            size="xs"
                          />
                        </div>
                      </div>
                    </Link>
                  );
                })}
                {orders.length > 10 && (
                  <button
                    type="button"
                    onClick={() => setShowAllOrders((v) => !v)}
                    aria-expanded={showAllOrders}
                    style={styles.orderListToggle}
                  >
                    {showAllOrders
                      ? 'Show less'
                      : `Show ${orders.length - 10} more`}
                    <svg
                      viewBox="0 0 20 20"
                      style={{
                        ...styles.orderListToggleChevron,
                        transform: showAllOrders
                          ? 'rotate(180deg)'
                          : 'rotate(0deg)',
                      }}
                      aria-hidden="true"
                    >
                      <path
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 8l5 5 5-5"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </SectionCard>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHead}>
        <h2 style={styles.sectionTitle}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={styles.sideCard}>
      <h3 style={styles.sideCardTitle}>{title}</h3>
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  emphasis,
  muted,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div
        style={{
          ...styles.statValue,
          ...(emphasis ? styles.statValueEmphasis : {}),
          ...(muted ? styles.statValueMuted : {}),
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Pill({
  label,
  tone,
  size = 'sm',
}: {
  label: string;
  tone: PillTone;
  size?: 'xs' | 'sm';
}) {
  const toneStyles = pillTones[tone];
  return (
    <span
      style={{
        ...styles.pill,
        ...(size === 'xs' ? styles.pillXs : {}),
        ...toneStyles.wrap,
      }}
    >
      <span style={{ ...styles.pillDot, background: toneStyles.dot }} />
      {label}
    </span>
  );
}

function SideRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div style={styles.sideRow}>
      <div style={styles.sideRowLabel}>{label}</div>
      <div style={{ ...styles.sideRowValue, ...(mono ? styles.sideRowMono : {}) }}>
        {value}
      </div>
    </div>
  );
}

function VerificationRow({
  label,
  verified,
}: {
  label: string;
  verified: boolean;
}) {
  return (
    <div style={styles.verifyRow}>
      <span style={styles.verifyLabel}>{label}</span>
      {verified ? (
        <Pill label="Verified" tone="success" size="xs" />
      ) : (
        <Pill label="Not verified" tone="neutral" size="xs" />
      )}
    </div>
  );
}

function LastOrderCard({ order }: { order: Order }) {
  const pay = paymentPill(order.paymentStatus);
  const ful = fulfillmentPill(order.subOrders);
  const items = order.subOrders.flatMap((s) => s.items);
  return (
    <div style={styles.orderCard}>
      <div style={styles.orderCardHead}>
        <div style={styles.orderCardHeadLeft}>
          <Link href={`/dashboard/orders/${order.id}`} style={styles.orderCardNumber}>
            #{order.orderNumber}
          </Link>
          <Pill label={pay.label} tone={pay.tone} size="xs" />
          <Pill label={ful.label} tone={ful.tone} size="xs" />
        </div>
        <div style={styles.orderCardTotal}>{inr(Number(order.totalAmount))}</div>
      </div>
      <div style={styles.orderCardMeta}>
        {fmtDateTime(order.createdAt)} · Online Store
      </div>

      <div style={styles.orderItems}>
        {items.map((item) => (
          <div key={item.id} style={styles.orderItemRow}>
            <div style={styles.itemThumb}>
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <svg viewBox="0 0 24 24" style={styles.itemThumbIcon} aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 7l2-3h14l2 3M3 7v12a1 1 0 001 1h16a1 1 0 001-1V7M3 7h18M8 11a4 4 0 008 0"
                  />
                </svg>
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={styles.itemTitle}>{item.productTitle}</div>
              {item.variantTitle && (
                <div style={styles.itemVariant}>{item.variantTitle}</div>
              )}
            </div>
            <div style={styles.itemQty}>× {item.quantity}</div>
            <div style={styles.itemPrice}>{inr(Number(item.totalPrice))}</div>
          </div>
        ))}
      </div>

      <div style={styles.orderCardFoot}>
        <Link href="/dashboard/orders" style={styles.ghostBtn}>
          View all orders
        </Link>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={styles.loading}>
      <div style={styles.spinner} aria-hidden="true" />
      <div style={styles.loadingText}>Loading customer…</div>
      <style>{spinKeyframes}</style>
    </div>
  );
}

/* ── Pill tones ─────────────────────────────────────────────── */

const pillTones: Record<
  PillTone,
  { wrap: React.CSSProperties; dot: string }
> = {
  success: {
    wrap: {
      background: 'rgba(22, 163, 74, 0.08)',
      color: '#15803d',
      borderColor: 'rgba(22, 163, 74, 0.2)',
    },
    dot: '#16a34a',
  },
  warning: {
    wrap: {
      background: 'rgba(245, 158, 11, 0.1)',
      color: '#b45309',
      borderColor: 'rgba(245, 158, 11, 0.25)',
    },
    dot: '#f59e0b',
  },
  danger: {
    wrap: {
      background: 'rgba(220, 38, 38, 0.08)',
      color: '#b91c1c',
      borderColor: 'rgba(220, 38, 38, 0.2)',
    },
    dot: '#dc2626',
  },
  info: {
    wrap: {
      background: 'rgba(14, 116, 144, 0.08)',
      color: '#0e7490',
      borderColor: 'rgba(14, 116, 144, 0.2)',
    },
    dot: '#0891b2',
  },
  neutral: {
    wrap: {
      background: '#f1f5f9',
      color: '#475569',
      borderColor: '#e2e8f0',
    },
    dot: '#94a3b8',
  },
};

/* ── Styles ─────────────────────────────────────────────────── */

const spinKeyframes = `
@keyframes customer-spin {
  to { transform: rotate(360deg); }
}
`;

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 1120,
    margin: '0 auto',
    color: '#0f172a',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },

  /* Breadcrumb */
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  breadcrumbLink: {
    color: '#64748b',
    textDecoration: 'none',
    fontWeight: 500,
  },
  breadcrumbSep: {
    color: '#cbd5e1',
  },
  breadcrumbCurrent: {
    color: '#0f172a',
    fontWeight: 500,
  },

  /* Identity header */
  identityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
  },
  identityAvatar: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    fontSize: 18,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    letterSpacing: '0.02em',
  },
  identityTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  h1: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: '#0f172a',
  },
  identityMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
    flexWrap: 'wrap',
  },
  identityMetaItem: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  metaDot: {
    color: '#cbd5e1',
  },

  /* Stats */
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '16px 18px',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 6,
  },
  statValue: {
    fontSize: 22,
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.01em',
    fontVariantNumeric: 'tabular-nums',
  },
  statValueEmphasis: {
    fontSize: 24,
  },
  statValueMuted: {
    color: '#94a3b8',
    fontWeight: 600,
  },

  /* Grid */
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 320px',
    gap: 24,
    alignItems: 'flex-start',
  },
  main: {
    minWidth: 0,
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },

  /* Section */
  section: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: 20,
    marginBottom: 16,
  },
  sectionHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: '#0f172a',
    letterSpacing: '-0.01em',
  },
  muted: {
    fontSize: 13,
    color: '#94a3b8',
  },

  /* Last order card */
  orderCard: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
  },
  orderCardHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  orderCardHeadLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  orderCardNumber: {
    fontWeight: 600,
    fontSize: 14,
    color: '#0f172a',
    textDecoration: 'none',
    fontVariantNumeric: 'tabular-nums',
  },
  orderCardTotal: {
    fontWeight: 700,
    fontSize: 16,
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
  },
  orderCardMeta: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 12,
  },
  orderItems: {
    borderTop: '1px solid #f1f5f9',
  },
  orderItemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 0',
    borderBottom: '1px solid #f1f5f9',
  },
  itemThumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    color: '#94a3b8',
  },
  itemThumbIcon: {
    width: 18,
    height: 18,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: '#0f172a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemVariant: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  itemQty: {
    fontSize: 13,
    color: '#64748b',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  itemPrice: {
    fontSize: 13,
    fontWeight: 600,
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    minWidth: 72,
    textAlign: 'right',
  },
  orderCardFoot: {
    marginTop: 12,
    display: 'flex',
    justifyContent: 'flex-end',
  },
  ghostBtn: {
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    textDecoration: 'none',
    transition: 'background-color 0.12s, border-color 0.12s',
  },

  /* Timeline */
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  timelineGroup: {},
  timelineDate: {
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 10,
  },
  timelineRail: {
    position: 'relative',
    paddingLeft: 20,
  },
  timelineItem: {
    position: 'relative',
    paddingBottom: 12,
    paddingLeft: 0,
  },
  timelineDot: {
    position: 'absolute',
    left: -17,
    top: 6,
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#cbd5e1',
    boxShadow: '0 0 0 3px #ffffff',
  },
  timelineBody: {
    position: 'relative',
    borderLeft: '2px solid #e2e8f0',
    marginLeft: -14,
    paddingLeft: 14,
    paddingBottom: 2,
  },
  timelineText: {
    fontSize: 13,
    color: '#0f172a',
    lineHeight: 1.5,
  },
  timelineTime: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },

  /* Sidebar cards */
  sideCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: 16,
  },
  sideCardTitle: {
    margin: '0 0 10px',
    fontSize: 13,
    fontWeight: 600,
    color: '#0f172a',
    letterSpacing: '-0.005em',
  },
  sideRow: {
    marginBottom: 10,
  },
  sideRowLabel: {
    fontSize: 11,
    fontWeight: 500,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 2,
  },
  sideRowValue: {
    fontSize: 13,
    color: '#0f172a',
    wordBreak: 'break-word',
  },
  sideRowMono: {
    fontFamily: '"SF Mono", Menlo, Consolas, monospace',
    fontSize: 12,
  },

  address: {
    fontSize: 13,
    color: '#0f172a',
    lineHeight: 1.55,
  },
  addressName: {
    fontWeight: 600,
    marginBottom: 2,
  },
  addressPhone: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },

  verifyRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: '1px solid #f1f5f9',
  },
  verifyLabel: {
    fontSize: 13,
    color: '#0f172a',
  },

  notesEmpty: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 1.5,
  },

  orderList: {
    display: 'flex',
    flexDirection: 'column',
  },
  orderItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '10px 0',
    borderBottom: '1px solid #f1f5f9',
    textDecoration: 'none',
    color: 'inherit',
  },
  orderLeft: {
    minWidth: 0,
  },
  orderNumber: {
    fontSize: 13,
    fontWeight: 600,
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
  },
  orderDate: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  orderRight: {
    textAlign: 'right',
    flexShrink: 0,
  },
  orderAmount: {
    fontSize: 13,
    fontWeight: 600,
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
  },
  orderListMore: {
    fontSize: 12,
    color: '#64748b',
    padding: '10px 0 2px',
    textAlign: 'center',
  },
  orderListToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    alignSelf: 'center',
    marginTop: 10,
    padding: '7px 12px',
    fontSize: 12,
    fontWeight: 500,
    color: '#334155',
    background: 'transparent',
    border: '1px solid #e2e8f0',
    borderRadius: 999,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background-color 0.12s, border-color 0.12s, color 0.12s',
  },
  orderListToggleChevron: {
    width: 14,
    height: 14,
    transition: 'transform 0.18s ease',
  },

  /* Pills */
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 10px 3px 8px',
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 999,
    border: '1px solid',
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
  },
  pillXs: {
    fontSize: 11,
    padding: '2px 8px 2px 6px',
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },

  /* Loading */
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: '80px 20px',
  },
  spinner: {
    width: 24,
    height: 24,
    border: '2px solid #e2e8f0',
    borderTopColor: '#0f172a',
    borderRadius: '50%',
    animation: 'customer-spin 0.8s linear infinite',
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
  },

  /* Not found */
  notFound: {
    maxWidth: 420,
    margin: '60px auto 0',
    textAlign: 'center',
    padding: '40px 24px',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
  },
  notFoundTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: '#0f172a',
  },
  notFoundBody: {
    margin: '6px 0 20px',
    fontSize: 13,
    color: '#64748b',
  },
  notFoundLink: {
    fontSize: 13,
    fontWeight: 500,
    color: '#00805f',
    textDecoration: 'none',
  },
};
