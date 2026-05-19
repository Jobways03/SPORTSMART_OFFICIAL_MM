'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

// ── Types ─────────────────────────────────────────────────────────

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

// ── Formatters ────────────────────────────────────────────────────

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

const fmtDateTime = (d: string) => `${fmtDate(d)} · ${fmtTime(d)}`;

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
    case 'PAID':      return { label: 'Paid',             tone: 'success' };
    case 'PENDING':   return { label: 'Payment pending',  tone: 'warning' };
    case 'CANCELLED': return { label: 'Cancelled',        tone: 'danger' };
    case 'REFUNDED':  return { label: 'Refunded',         tone: 'info' };
    default:          return { label: status.toLowerCase(), tone: 'neutral' };
  }
}

function customerStatusPill(status: string): { label: string; tone: PillTone } {
  switch (status) {
    case 'ACTIVE':    return { label: 'Active',    tone: 'success' };
    case 'SUSPENDED': return { label: 'Suspended', tone: 'danger' };
    case 'BANNED':    return { label: 'Banned',    tone: 'danger' };
    case 'INACTIVE':  return { label: 'Inactive',  tone: 'neutral' };
    default:          return { label: status.toLowerCase(), tone: 'neutral' };
  }
}

function fulfillmentPill(subOrders: SubOrder[]): { label: string; tone: PillTone } {
  const statuses = Array.from(new Set(subOrders.map((s) => s.fulfillmentStatus)));
  if (statuses.includes('DELIVERED')) return { label: 'Delivered', tone: 'success' };
  if (statuses.includes('FULFILLED')) return { label: 'Fulfilled', tone: 'info' };
  if (statuses.includes('SHIPPED'))   return { label: 'Shipped',   tone: 'info' };
  if (statuses.includes('PACKED'))    return { label: 'Packed',    tone: 'warning' };
  return { label: 'Unfulfilled', tone: 'warning' };
}

// ── Page ──────────────────────────────────────────────────────────

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
      .catch((err) => console.warn(err))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const timelineGroups = useMemo(() => {
    if (!data) return [];
    type Event = { when: Date; text: string };
    const events: Event[] = [];

    for (const o of data.orders) {
      events.push({
        when: new Date(o.createdAt),
        text: o.paymentStatus === 'CANCELLED'
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

  if (loading) return <LoadingState />;
  if (!data) return <NotFound />;

  const { customer, stats, lastOrder, orders } = data;
  const defaultAddr =
    customer.addresses.find((a) => a.isDefault) || customer.addresses[0] || null;
  const fullName = `${customer.firstName} ${customer.lastName}`.trim();
  const statusChip = customerStatusPill(customer.status);
  const color = avatarColor(`${customer.firstName}${customer.lastName}${customer.id}`);

  return (
    <div style={{
      padding: '24px 32px', maxWidth: 1280, margin: '0 auto', color: '#0F1115',
    }}>
      {/* ── Breadcrumb ──────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 12,
      }}>
        <Link href="/dashboard/customers" style={{
          color: '#525A65', textDecoration: 'none', fontWeight: 500,
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          <span aria-hidden>←</span> Customers
        </Link>
        <span aria-hidden style={{ color: '#CBD5E1' }}>/</span>
        <span style={{ color: '#0F1115', fontWeight: 500 }}>{fullName}</span>
      </div>

      {/* ── Identity hero ───────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20,
      }}>
        <div
          aria-hidden
          style={{
            width: 56, height: 56, borderRadius: '50%',
            fontSize: 18, fontWeight: 700, letterSpacing: '0.02em',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            background: color.bg, color: color.fg,
          }}
        >
          {initials(customer.firstName, customer.lastName)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{
              margin: 0, fontSize: 24, fontWeight: 700,
              letterSpacing: '-0.01em', color: '#0F1115',
            }}>
              {fullName}
            </h1>
            <Pill label={statusChip.label} tone={statusChip.tone} />
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            fontSize: 13, color: '#525A65', marginTop: 4,
          }}>
            <span title={customer.email}>{customer.email}</span>
            {customer.phone && (
              <>
                <Dot />
                <span>{customer.phone}</span>
              </>
            )}
            <Dot />
            <span>Joined {fmtDate(customer.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* ── KPI strip ───────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12, marginBottom: 24,
      }}>
        <StatCard label="Amount spent" value={inr(stats.totalSpent)} emphasis />
        <StatCard label="Orders" value={String(stats.totalOrders)} />
        <StatCard label="Customer since" value={pluralDays(stats.customerSinceDays)} />
        <StatCard
          label="Last order"
          value={lastOrder ? fmtDate(lastOrder.createdAt) : '—'}
          muted={!lastOrder}
        />
      </div>

      {/* ── Two-column body ─────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 320px',
        gap: 20, alignItems: 'flex-start',
      }}>
        {/* LEFT */}
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Section title="Last order placed">
            {lastOrder ? (
              <LastOrderCard order={lastOrder} />
            ) : (
              <Muted>This customer hasn't placed an order yet.</Muted>
            )}
          </Section>

          <Section title="Timeline">
            {timelineGroups.length === 0 ? (
              <Muted>No activity recorded.</Muted>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {timelineGroups.map((g) => (
                  <div key={g.key}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: '#7A828F',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 10,
                    }}>{g.label}</div>
                    <div style={{ position: 'relative', paddingLeft: 20 }}>
                      {g.items.map((ev, i) => (
                        <div key={i} style={{ position: 'relative', paddingBottom: 12 }}>
                          <span aria-hidden style={{
                            position: 'absolute', left: -17, top: 6,
                            width: 8, height: 8, borderRadius: '50%',
                            background: '#0F1115', boxShadow: '0 0 0 3px #fff',
                          }} />
                          <div style={{
                            position: 'relative', borderLeft: '2px solid #E5E7EB',
                            marginLeft: -14, paddingLeft: 14, paddingBottom: 2,
                          }}>
                            <div style={{ fontSize: 13, color: '#0F1115', lineHeight: 1.5 }}>
                              {ev.text}
                            </div>
                            <div style={{ fontSize: 12, color: '#7A828F', marginTop: 2 }}>
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

        {/* RIGHT */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionCard title="Contact">
            <SideRow label="Email" value={customer.email} mono />
            {customer.phone && <SideRow label="Phone" value={customer.phone} mono />}
          </SectionCard>

          <SectionCard title="Default address">
            {defaultAddr ? (
              <div style={{ fontSize: 13, color: '#0F1115', lineHeight: 1.55 }}>
                <div style={{ fontWeight: 600 }}>{defaultAddr.fullName}</div>
                <div>{defaultAddr.addressLine1}</div>
                {defaultAddr.addressLine2 && <div>{defaultAddr.addressLine2}</div>}
                <div>
                  {defaultAddr.city}, {defaultAddr.state} {defaultAddr.postalCode}
                </div>
                <div>{defaultAddr.country}</div>
                {defaultAddr.phone && (
                  <div style={{ fontSize: 12, color: '#525A65', marginTop: 4 }}>
                    {defaultAddr.phone}
                  </div>
                )}
              </div>
            ) : (
              <Muted>No address on file.</Muted>
            )}
          </SectionCard>

          <SectionCard title="Verification">
            <VerificationRow label="Email" verified={customer.emailVerified} />
            <VerificationRow label="Phone" verified={customer.phoneVerified} />
          </SectionCard>

          <SectionCard title="Notes">
            <div style={{ fontSize: 12, color: '#7A828F', lineHeight: 1.5 }}>
              Leave notes for this customer — visible to your team only.
            </div>
          </SectionCard>

          {orders.length > 0 && (
            <SectionCard title={`Order history (${orders.length})`}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {(showAllOrders ? orders : orders.slice(0, 10)).map((o) => {
                  const pay = paymentPill(o.paymentStatus);
                  return (
                    <Link
                      key={o.id}
                      href={`/dashboard/orders/${o.id}`}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                        padding: '10px 0', borderBottom: '1px solid #F3F4F6',
                        textDecoration: 'none', color: 'inherit',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 600, color: '#0F1115',
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          #{o.orderNumber}
                        </div>
                        <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}>
                          {fmtDate(o.createdAt)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 600, color: '#0F1115',
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {inr(Number(o.totalAmount))}
                        </div>
                        <div style={{ marginTop: 3 }}>
                          <Pill label={pay.label} tone={pay.tone} size="xs" />
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
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      alignSelf: 'center', marginTop: 10,
                      height: 30, padding: '0 14px',
                      fontSize: 12, fontWeight: 600, color: '#525A65',
                      background: 'transparent',
                      border: '1px solid #E5E7EB', borderRadius: 9999,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {showAllOrders ? 'Show less' : `Show ${orders.length - 10} more`}
                    <ChevronDown rotated={showAllOrders} />
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

// ── Sub-components ────────────────────────────────────────────────

function Section({
  title, action, children,
}: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
      padding: 20,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 14,
      }}>
        <h2 style={{
          margin: 0, fontSize: 14, fontWeight: 700, color: '#0F1115',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, padding: 16,
    }}>
      <h3 style={{
        margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#0F1115',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{title}</h3>
      {children}
    </div>
  );
}

function StatCard({
  label, value, emphasis, muted,
}: { label: string; value: string; emphasis?: boolean; muted?: boolean }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
      padding: '16px 18px', minWidth: 0,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: '#7A828F',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontSize: emphasis ? 24 : 22, fontWeight: 700,
        color: muted ? '#7A828F' : '#0F1115',
        letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</div>
    </div>
  );
}

function Pill({
  label, tone, size = 'sm',
}: { label: string; tone: PillTone; size?: 'xs' | 'sm' }) {
  const t = PILL_TONE[tone];
  const xs = size === 'xs';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: xs ? 20 : 22, padding: '0 10px', borderRadius: 9999,
      fontSize: xs ? 11 : 11, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.05em',
      background: t.chip, color: t.color, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function SideRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: '#7A828F',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2,
      }}>{label}</div>
      <div style={{
        fontSize: 13, color: '#0F1115', wordBreak: 'break-word',
        fontFamily: mono ? 'ui-monospace, monospace' : 'inherit',
      }}>
        {value}
      </div>
    </div>
  );
}

function VerificationRow({ label, verified }: { label: string; verified: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 0', borderBottom: '1px solid #F3F4F6',
    }}>
      <span style={{ fontSize: 13, color: '#0F1115' }}>{label}</span>
      {verified
        ? <Pill label="Verified" tone="success" size="xs" />
        : <Pill label="Not verified" tone="neutral" size="xs" />}
    </div>
  );
}

function LastOrderCard({ order }: { order: Order }) {
  const pay = paymentPill(order.paymentStatus);
  const ful = fulfillmentPill(order.subOrders);
  const items = order.subOrders.flatMap((s) => s.items);
  return (
    <div style={{
      border: '1px solid #E5E7EB', borderRadius: 12, padding: 16,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 8, flexWrap: 'wrap', marginBottom: 4,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Link href={`/dashboard/orders/${order.id}`} style={{
            fontWeight: 700, fontSize: 14, color: '#0F1115',
            textDecoration: 'none', fontVariantNumeric: 'tabular-nums',
          }}>
            #{order.orderNumber}
          </Link>
          <Pill label={pay.label} tone={pay.tone} size="xs" />
          <Pill label={ful.label} tone={ful.tone} size="xs" />
        </div>
        <div style={{
          fontWeight: 700, fontSize: 16, color: '#0F1115',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {inr(Number(order.totalAmount))}
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#7A828F', marginBottom: 12 }}>
        {fmtDateTime(order.createdAt)} · Online Store
      </div>

      <div style={{ borderTop: '1px solid #F3F4F6' }}>
        {items.map((item) => (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 0', borderBottom: '1px solid #F3F4F6',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 8,
              background: '#FAFAFA', border: '1px solid #E5E7EB', overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, color: '#7A828F',
            }}>
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt=""
                     style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <BoxIcon />
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontSize: 13, fontWeight: 500, color: '#0F1115',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{item.productTitle}</div>
              {item.variantTitle && (
                <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}>{item.variantTitle}</div>
              )}
            </div>
            <div style={{
              fontSize: 13, color: '#525A65',
              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            }}>× {item.quantity}</div>
            <div style={{
              fontSize: 13, fontWeight: 600, color: '#0F1115',
              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
              minWidth: 72, textAlign: 'right',
            }}>{inr(Number(item.totalPrice))}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Link href="/dashboard/orders" style={{
          height: 32, padding: '0 14px',
          display: 'inline-flex', alignItems: 'center',
          fontSize: 12, fontWeight: 600, color: '#0F1115',
          background: '#fff', border: '1px solid #D2D6DC', borderRadius: 9999,
          textDecoration: 'none',
        }}>
          View all orders
        </Link>
      </div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, color: '#7A828F' }}>{children}</div>;
}

function Dot() {
  return <span aria-hidden style={{ color: '#CBD5E1' }}>•</span>;
}

function LoadingState() {
  return (
    <div style={{
      padding: '80px 32px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 24, height: 24, border: '2px solid #E5E7EB', borderTopColor: '#0F1115',
        borderRadius: '50%', animation: 'spin 0.8s linear infinite',
      }} />
      <div style={{ fontSize: 13, color: '#525A65' }}>Loading customer…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function NotFound() {
  return (
    <div style={{
      maxWidth: 420, margin: '60px auto 0', textAlign: 'center',
      padding: '40px 24px',
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <UserIcon size={20} />
      </div>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F1115' }}>
        Customer not found
      </h3>
      <p style={{ margin: '6px 0 20px', fontSize: 13, color: '#525A65' }}>
        This customer may have been removed or the link is invalid.
      </p>
      <Link href="/dashboard/customers" style={{
        fontSize: 13, fontWeight: 600, color: '#0F1115',
        textDecoration: 'none',
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '8px 14px', border: '1px solid #D2D6DC', borderRadius: 9999,
      }}>
        <span aria-hidden>←</span> Back to Customers
      </Link>
    </div>
  );
}

// ── Pill tones ────────────────────────────────────────────────────

const PILL_TONE: Record<PillTone, { color: string; chip: string }> = {
  success: { color: '#15803d', chip: '#dcfce7' },
  warning: { color: '#b45309', chip: '#fef3c7' },
  danger:  { color: '#b91c1c', chip: '#fee2e2' },
  info:    { color: '#1d4ed8', chip: '#dbeafe' },
  neutral: { color: '#525A65', chip: '#F3F4F6' },
};

// ── Icons ─────────────────────────────────────────────────────────

function ChevronDown({ rotated }: { rotated: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         style={{ transition: 'transform 0.18s', transform: rotated ? 'rotate(180deg)' : 'rotate(0deg)' }}
         aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function BoxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m21 8-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v10" />
    </svg>
  );
}
function UserIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="9" r="4" />
      <path d="M5 21c1.4-4.5 4-6.5 7-6.5s5.6 2 7 6.5" />
    </svg>
  );
}
