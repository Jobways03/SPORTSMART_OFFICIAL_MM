'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

/* ────────── types ────────── */
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

/* ────────── helpers ────────── */
const fmt = (n: number) =>
  `\u20B9${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) => {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
};

const fmtDateTime = (d: string) => {
  const dt = new Date(d);
  return (
    dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) +
    ' at ' +
    dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  );
};

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 600, padding: '3px 10px',
      borderRadius: 20, background: color + '18', color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {text}
    </span>
  );
}

/* ────────── page ────────── */
export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<CustomerDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    apiClient<CustomerDetailResponse>(`/admin/customers/${id}`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>Loading customer...</div>;
  }

  if (!data) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Customer not found</h3>
        <Link href="/dashboard/customers" style={{ color: '#2563eb' }}>Back to Customers</Link>
      </div>
    );
  }

  const { customer, stats, lastOrder, orders } = data;
  const defaultAddr = customer.addresses.find((a) => a.isDefault) || customer.addresses[0] || null;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* ── Breadcrumb + Name ── */}
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/dashboard/customers"
          style={{ fontSize: 13, color: '#6b7280', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          &#128100; &rsaquo; <span style={{ fontWeight: 600, color: '#111' }}>{customer.firstName} {customer.lastName}</span>
        </Link>
      </div>

      {/* ── Stats Cards ── */}
      <div style={{
        display: 'flex', gap: 0, background: '#fff', border: '1px solid #e5e7eb',
        borderRadius: 10, overflow: 'hidden', marginBottom: 24,
      }}>
        <StatCard label="Amount spent" value={fmt(stats.totalSpent)} />
        <StatCard label="Orders" value={String(stats.totalOrders)} />
        <StatCard label="Customer since" value={`${stats.customerSinceDays} days`} />
        <StatCard label="Status" value={customer.status} last />
      </div>

      {/* ── Two-column layout ── */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ── LEFT COLUMN ── */}
        <div style={{ flex: '1 1 580px', minWidth: 0 }}>

          {/* ── Last Order Placed ── */}
          {lastOrder && (
            <div style={cardStyle}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 14 }}>Last order placed</div>

              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
                {/* Order header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{lastOrder.orderNumber}</span>
                    <Badge
                      text={lastOrder.paymentStatus === 'PAID' ? 'Paid' : lastOrder.paymentStatus === 'CANCELLED' ? 'Cancelled' : 'Pending'}
                      color={lastOrder.paymentStatus === 'PAID' ? '#6b7280' : lastOrder.paymentStatus === 'CANCELLED' ? '#dc2626' : '#f59e0b'}
                    />
                    {(() => {
                      const statuses = [...new Set(lastOrder.subOrders.map((s) => s.fulfillmentStatus))];
                      const label = statuses.includes('DELIVERED') ? 'Delivered' : statuses.includes('FULFILLED') ? 'Fulfilled' : 'Unfulfilled';
                      const color = label === 'Delivered' ? '#7c3aed' : label === 'Fulfilled' ? '#16a34a' : '#6366f1';
                      return <Badge text={label} color={color} />;
                    })()}
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{fmt(Number(lastOrder.totalAmount))}</span>
                </div>

                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
                  {fmtDateTime(lastOrder.createdAt)} from Online Store
                </div>

                {/* Order items */}
                {lastOrder.subOrders.flatMap((so) => so.items).map((item) => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid #f3f4f6' }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 6, background: '#f3f4f6',
                      border: '1px solid #e5e7eb', overflow: 'hidden',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontSize: 16, color: '#d1d5db' }}>&#128722;</span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 13, color: '#111' }}>{item.productTitle}</div>
                      {item.variantTitle && (
                        <span style={{ fontSize: 11, color: '#6b7280', background: '#f3f4f6', padding: '1px 6px', borderRadius: 3 }}>
                          {item.variantTitle}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap' }}>
                      x {item.quantity}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', minWidth: 70, textAlign: 'right' }}>
                      {fmt(Number(item.totalPrice))}
                    </div>
                  </div>
                ))}

                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
                  <Link
                    href="/dashboard/orders"
                    style={{ padding: '7px 16px', fontSize: 13, fontWeight: 500, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', color: '#374151', textDecoration: 'none' }}
                  >
                    View all orders
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* ── Timeline ── */}
          <div style={cardStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>Timeline</div>

            <div style={{ borderLeft: '2px solid #e5e7eb', paddingLeft: 20, marginLeft: 6 }}>
              {orders.map((order) => (
                <TimelineEvent
                  key={order.id}
                  date={fmtDate(order.createdAt)}
                  time={new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                  text={
                    order.paymentStatus === 'CANCELLED'
                      ? `Order ${order.orderNumber} was cancelled.`
                      : `${customer.firstName} ${customer.lastName} placed order ${order.orderNumber} on Online Store.`
                  }
                  orderNumber={order.orderNumber}
                />
              ))}

              <TimelineEvent
                date={fmtDate(customer.createdAt)}
                time={new Date(customer.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                text={`${customer.firstName} ${customer.lastName} created an account.`}
              />
            </div>
          </div>
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <div style={{ flex: '0 0 320px', minWidth: 280 }}>

          {/* ── Customer Info ── */}
          <div style={sideCardStyle}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Customer</div>

            <div style={{ borderBottom: '1px solid #f3f4f6', paddingBottom: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Contact information</div>
              <div style={{ fontSize: 13, color: '#2563eb', marginBottom: 4 }}>{customer.email}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {customer.emailVerified ? 'Email verified' : 'Email not verified'}
              </div>
              {customer.phone && (
                <div style={{ fontSize: 13, color: '#374151', marginTop: 6 }}>{customer.phone}</div>
              )}
            </div>

            {defaultAddr && (
              <div style={{ borderBottom: '1px solid #f3f4f6', paddingBottom: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Default address</div>
                <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                  {defaultAddr.fullName}<br />
                  {defaultAddr.addressLine1}<br />
                  {defaultAddr.addressLine2 && <>{defaultAddr.addressLine2}<br /></>}
                  {defaultAddr.postalCode} {defaultAddr.city} {defaultAddr.state}<br />
                  {defaultAddr.country}<br />
                  {defaultAddr.phone}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Marketing</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', marginBottom: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: customer.emailVerified ? '#16a34a' : '#9ca3af' }} />
                {customer.emailVerified ? 'Email subscribed' : 'Email not subscribed'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid #9ca3af', background: 'transparent' }} />
                SMS not subscribed
              </div>
            </div>
          </div>

          {/* ── Notes ── */}
          <div style={sideCardStyle}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Notes</div>
            <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>None</p>
          </div>

          {/* ── All Orders ── */}
          {orders.length > 0 && (
            <div style={sideCardStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Order History</div>
              {orders.map((o) => (
                <Link
                  key={o.id}
                  href={`/dashboard/orders/${o.id}`}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 0', borderBottom: '1px solid #f3f4f6', textDecoration: 'none',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#2563eb' }}>{o.orderNumber}</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{fmtDate(o.createdAt)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{fmt(Number(o.totalAmount))}</div>
                    <Badge
                      text={o.paymentStatus === 'PAID' ? 'Paid' : o.paymentStatus === 'CANCELLED' ? 'Cancelled' : 'Pending'}
                      color={o.paymentStatus === 'PAID' ? '#16a34a' : o.paymentStatus === 'CANCELLED' ? '#dc2626' : '#f59e0b'}
                    />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────── sub-components ────────── */
function StatCard({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{
      flex: 1, padding: '16px 20px',
      borderRight: last ? 'none' : '1px solid #e5e7eb',
    }}>
      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 500, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{value}</div>
    </div>
  );
}

function TimelineEvent({ date, time, text, orderNumber }: { date: string; time: string; text: string; orderNumber?: string }) {
  return (
    <div style={{ position: 'relative', paddingBottom: 20 }}>
      <div style={{
        position: 'absolute', left: -26, top: 4,
        width: 10, height: 10, borderRadius: '50%',
        background: '#d1d5db', border: '2px solid #fff',
      }} />
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{date}</div>
      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
        {text}
      </div>
      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{time}</div>
    </div>
  );
}

/* ────────── styles ────────── */
const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};

const sideCardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 18,
  marginBottom: 12,
};
