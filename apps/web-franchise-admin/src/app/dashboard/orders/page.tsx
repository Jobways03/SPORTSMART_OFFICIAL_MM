'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  adminFranchisesService,
  FranchiseOrderRow,
  FranchiseSubOrderDetail,
} from '@/services/admin-franchises.service';
import { ShipmentPanel } from '../franchises/[id]/_components/ShipmentPanel';

/* ── Types & helpers ─────────────────────────────────────────── */

type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const initials = (name: string) =>
  ((name || '').trim() || '?')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

function avatarColor(seed: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return { bg: `hsl(${hue}, 42%, 94%)`, fg: `hsl(${hue}, 48%, 30%)` };
}

const inr = (v: number) =>
  `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const ORDER_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PLACED', label: 'Placed' },
  { value: 'PENDING_VERIFICATION', label: 'Pending verification' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function orderStatusPill(status?: string | null): { label: string; tone: PillTone } {
  switch (status) {
    case 'PLACED': return { label: 'Placed', tone: 'warning' };
    case 'PENDING_VERIFICATION': return { label: 'Pending verification', tone: 'warning' };
    case 'VERIFIED': return { label: 'Verified', tone: 'info' };
    case 'DISPATCHED': return { label: 'Dispatched', tone: 'info' };
    case 'DELIVERED': return { label: 'Delivered', tone: 'success' };
    case 'CANCELLED': return { label: 'Cancelled', tone: 'danger' };
    case 'REFUNDED': return { label: 'Refunded', tone: 'info' };
    default: return { label: (status || '—').replace(/_/g, ' ').toLowerCase(), tone: 'neutral' };
  }
}

function paymentPill(status?: string | null): { label: string; tone: PillTone } {
  switch (status) {
    case 'PAID': return { label: 'Paid', tone: 'success' };
    case 'PENDING': return { label: 'Pending', tone: 'warning' };
    case 'CANCELLED': return { label: 'Cancelled', tone: 'danger' };
    case 'REFUNDED': return { label: 'Refunded', tone: 'info' };
    default: return { label: (status || '—').toLowerCase(), tone: 'neutral' };
  }
}

function fulfillmentPill(status?: string | null): { label: string; tone: PillTone } {
  switch (status) {
    case 'DELIVERED': return { label: 'Delivered', tone: 'success' };
    case 'FULFILLED': return { label: 'Out for delivery', tone: 'info' };
    case 'SHIPPED': return { label: 'Shipped', tone: 'info' };
    case 'PACKED': return { label: 'Packed', tone: 'warning' };
    case 'CANCELLED': return { label: 'Cancelled', tone: 'danger' };
    default: return { label: 'Unfulfilled', tone: 'warning' };
  }
}

function acceptPill(status?: string | null): { label: string; tone: PillTone } {
  switch (status) {
    case 'ACCEPTED': return { label: 'Accepted', tone: 'success' };
    case 'REJECTED': return { label: 'Rejected', tone: 'danger' };
    case 'OPEN': return { label: 'Open', tone: 'warning' };
    default: return { label: (status || '—').toLowerCase(), tone: 'neutral' };
  }
}

const pillTones: Record<PillTone, { bg: string; color: string; border: string; dot: string }> = {
  success: { bg: 'rgba(22, 163, 74, 0.08)', color: '#15803d', border: 'rgba(22, 163, 74, 0.2)', dot: '#16a34a' },
  warning: { bg: 'rgba(245, 158, 11, 0.1)', color: '#b45309', border: 'rgba(245, 158, 11, 0.25)', dot: '#f59e0b' },
  danger: { bg: 'rgba(220, 38, 38, 0.08)', color: '#b91c1c', border: 'rgba(220, 38, 38, 0.2)', dot: '#dc2626' },
  info: { bg: 'rgba(14, 116, 144, 0.08)', color: '#0e7490', border: 'rgba(14, 116, 144, 0.2)', dot: '#0891b2' },
  neutral: { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0', dot: '#94a3b8' },
};

function Pill({ label, tone }: { label: string; tone: PillTone }) {
  const t = pillTones[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px 3px 8px',
      fontSize: 12, fontWeight: 500, borderRadius: 999, border: `1px solid ${t.border}`,
      background: t.bg, color: t.color, lineHeight: 1.4, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.dot, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function customerNameOf(o: FranchiseOrderRow): string {
  const c = o.masterOrder?.customer;
  const full = `${c?.firstName ?? ''} ${c?.lastName ?? ''}`.trim();
  return full || o.masterOrder?.shippingAddressSnapshot?.fullName || o.masterOrder?.shippingAddressSnapshot?.name || '—';
}

/* ── Page ────────────────────────────────────────────────────── */

export default function FranchiseOrdersPage() {
  const [rows, setRows] = useState<FranchiseOrderRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('');
  const [acceptFilter, setAcceptFilter] = useState('');
  const [selected, setSelected] = useState<FranchiseOrderRow | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFranchisesService.listAllFranchiseOrders({
        page,
        limit: 20,
        search: searchQuery || undefined,
        orderStatus: orderStatusFilter || undefined,
        paymentStatus: paymentFilter || undefined,
        fulfillmentStatus: fulfillmentFilter || undefined,
        acceptStatus: acceptFilter || undefined,
      });
      setRows(res.data?.subOrders ?? []);
      if (res.data?.pagination) setPagination(res.data.pagination);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, orderStatusFilter, paymentFilter, fulfillmentFilter, acceptFilter]);

  useEffect(() => { void fetchOrders(); }, [fetchOrders]);

  const hasFilters = !!(searchQuery || orderStatusFilter || paymentFilter || fulfillmentFilter || acceptFilter);
  const clearFilters = () => {
    setSearchInput(''); setSearchQuery('');
    setOrderStatusFilter(''); setPaymentFilter('');
    setFulfillmentFilter(''); setAcceptFilter(''); setPage(1);
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>
            Orders
            {pagination.total > 0 && (
              <span style={styles.headerCount}>{pagination.total.toLocaleString('en-IN')}</span>
            )}
          </h1>
          <p style={styles.headerSub}>Track and resolve orders across every franchise.</p>
        </div>
      </header>

      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.searchWrap}>
          <svg style={styles.searchIcon} viewBox="0 0 20 20" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
              d="M9 3a6 6 0 104.472 10.03L17 17M9 15A6 6 0 109 3a6 6 0 000 12z" />
          </svg>
          <input
            type="search"
            placeholder="Search order number or customer"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setSearchQuery(searchInput); setPage(1); } }}
            style={styles.searchInput}
            aria-label="Search orders"
          />
        </div>
        <select value={orderStatusFilter} onChange={(e) => { setOrderStatusFilter(e.target.value); setPage(1); }} style={styles.select} aria-label="Order status">
          {ORDER_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={paymentFilter} onChange={(e) => { setPaymentFilter(e.target.value); setPage(1); }} style={styles.select} aria-label="Payment status">
          <option value="">All payment</option>
          <option value="PENDING">Pending</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select value={fulfillmentFilter} onChange={(e) => { setFulfillmentFilter(e.target.value); setPage(1); }} style={styles.select} aria-label="Fulfillment status">
          <option value="">All fulfillment</option>
          <option value="UNFULFILLED">Unfulfilled</option>
          <option value="PACKED">Packed</option>
          <option value="SHIPPED">Shipped</option>
          <option value="FULFILLED">Out for delivery</option>
          <option value="DELIVERED">Delivered</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select value={acceptFilter} onChange={(e) => { setAcceptFilter(e.target.value); setPage(1); }} style={styles.select} aria-label="Accept status">
          <option value="">All accept</option>
          <option value="OPEN">Open</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="REJECTED">Rejected</option>
        </select>
        {hasFilters && <button type="button" onClick={clearFilters} style={styles.btnGhost}>Clear</button>}
      </div>

      {/* Table */}
      {loading && rows.length === 0 ? (
        <div style={styles.card}><p style={styles.stateMsg}>Loading orders…</p></div>
      ) : rows.length === 0 ? (
        <div style={styles.card}><p style={styles.stateMsg}>{hasFilters ? 'No orders match your filters.' : 'No franchise orders yet.'}</p></div>
      ) : (
        <>
          <div style={styles.card}>
            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Order</th>
                    <th style={styles.th}>Customer</th>
                    <th style={styles.th}>Franchise</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Payment</th>
                    <th style={styles.th}>Fulfillment</th>
                    <th style={styles.th}>Delivery</th>
                    <th style={styles.th}>Accept</th>
                    <th style={styles.th}>Date</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
                    <th style={{ ...styles.th, width: 36 }} aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => <OrderRow key={o.id} o={o} onOpen={() => setSelected(o)} />)}
                </tbody>
              </table>
            </div>
          </div>

          {pagination.totalPages > 1 && (
            <div style={styles.pagination}>
              <span style={styles.pageInfo}>
                Page {pagination.page} of {pagination.totalPages} · {pagination.total.toLocaleString('en-IN')} orders
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={styles.pageBtn} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
                <button type="button" style={styles.pageBtn} disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </div>
          )}
        </>
      )}

      {selected && <OrderDrawer order={selected} onClose={() => setSelected(null)} onChange={fetchOrders} />}
    </div>
  );
}

/* ── Row ─────────────────────────────────────────────────────── */

function OrderRow({ o, onOpen }: { o: FranchiseOrderRow; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  const name = customerNameOf(o);
  const email = o.masterOrder?.customer?.email ?? '';
  const av = avatarColor(name);
  const os = orderStatusPill(o.masterOrder?.orderStatus);
  const pay = paymentPill(o.masterOrder?.paymentStatus);
  const ful = fulfillmentPill(o.fulfillmentStatus);
  const acc = acceptPill(o.acceptStatus);
  const amount = Number(o.masterOrder?.totalAmount ?? o.subTotal ?? 0);
  return (
    <tr
      style={{ ...styles.tr, background: hover ? '#f8fafc' : undefined }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      title="View order details"
    >
      <td style={styles.td}><span style={styles.orderNumber}>#{o.masterOrder?.orderNumber ?? '—'}</span></td>
      <td style={styles.td}>
        <div style={styles.customerCell}>
          <span style={{ ...styles.avatar, background: av.bg, color: av.fg }}>{initials(name)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={styles.customerName}>{name}</div>
            {email && <div style={styles.customerEmail}>{email}</div>}
          </div>
        </div>
      </td>
      <td style={styles.td}><span style={styles.sellerName}>{o.franchise?.businessName ?? '—'}</span></td>
      <td style={styles.td}><Pill label={os.label} tone={os.tone} /></td>
      <td style={styles.td}><Pill label={pay.label} tone={pay.tone} /></td>
      <td style={styles.td}><Pill label={ful.label} tone={ful.tone} /></td>
      <td style={styles.td}><span style={styles.delivery}>{o.deliveryMethod ? `— ${o.deliveryMethod}` : '— Not chosen'}</span></td>
      <td style={styles.td}><Pill label={acc.label} tone={acc.tone} /></td>
      <td style={{ ...styles.td, color: '#64748b', whiteSpace: 'nowrap' }}>{fmtDate(o.createdAt)}</td>
      <td style={{ ...styles.td, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{inr(amount)}</td>
      <td style={{ ...styles.td, textAlign: 'right' }}><span style={{ color: hover ? '#475569' : '#cbd5e1', fontWeight: 700 }}>{'›'}</span></td>
    </tr>
  );
}

/* ── Detail drawer (reuses getFranchiseOrder + ShipmentPanel) ── */

function OrderDrawer({ order, onClose, onChange }: { order: FranchiseOrderRow; onClose: () => void; onChange: () => void }) {
  const [detail, setDetail] = useState<FranchiseSubOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLoading(true);
    adminFranchisesService
      .getFranchiseOrder(order.id)
      .then((res) => { if (!cancelled) setDetail(res.data ?? null); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [order.id]);

  const money = (v?: string | number | null) => inr(Number(v ?? 0));
  const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 10 };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.45)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 94vw)', height: '100%', background: '#fff', boxShadow: '-8px 0 28px rgba(15,23,42,0.18)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 22px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: '#0f172a' }}>#{order.masterOrder?.orderNumber ?? '—'}</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{customerNameOf(order)} · {order.franchise?.businessName ?? '—'}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#475569', fontSize: 15, cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 22, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {loading && !detail && <p style={{ fontSize: 13, color: '#64748b' }}>Loading order details…</p>}
          {detail && (
            <>
              <div>
                <div style={sectionTitle}>Items</div>
                {(detail.items ?? []).map((it) => (
                  <div key={it.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <div style={{ width: 42, height: 42, borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {it.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (<span style={{ fontSize: 16, color: '#9ca3af' }}>&#128722;</span>)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                        {it.productTitle}{it.variantTitle ? <span style={{ color: '#6b7280', fontWeight: 400 }}> — {it.variantTitle}</span> : null}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{it.sku || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{it.quantity} × {money(it.unitPrice)}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{money(it.totalPrice)}</div>
                    </div>
                  </div>
                ))}
                <div style={{ textAlign: 'right', marginTop: 10, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Sub-order total: {money(detail.subTotal)}</div>
              </div>

              <div>
                <div style={sectionTitle}>Shipping address</div>
                {(() => {
                  const a = detail.masterOrder?.shippingAddressSnapshot;
                  if (!a) return <p style={{ fontSize: 13, color: '#9ca3af' }}>No address snapshot</p>;
                  return (
                    <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>{a.fullName ?? a.name ?? '—'}</div>
                      {a.phone && <div>{a.phone}</div>}
                      <div>{a.addressLine1 ?? a.line1 ?? ''}</div>
                      {(a.addressLine2 ?? a.line2) && <div>{a.addressLine2 ?? a.line2}</div>}
                      <div>{[a.city, a.state, a.pincode].filter(Boolean).join(', ')}</div>
                    </div>
                  );
                })()}
              </div>

              <div>
                <div style={sectionTitle}>Payment &amp; order</div>
                <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.9 }}>
                  <div>Order #: {detail.masterOrder?.orderNumber ?? order.masterOrder?.orderNumber ?? '—'}</div>
                  <div>Payment: {detail.masterOrder?.paymentMethodLabel ?? detail.masterOrder?.paymentMethod ?? '—'}</div>
                  <div>Payment status: {detail.masterOrder?.paymentStatus ?? '—'}</div>
                  <div>Accept status: {detail.acceptStatus?.replace(/_/g, ' ') ?? '—'}</div>
                  <div>Delivery: {detail.deliveryMethod ?? '—'}</div>
                  {detail.trackingNumber && (<div>Tracking: {detail.courierName ? `${detail.courierName} · ` : ''}{detail.trackingNumber}</div>)}
                  <div>Order total: {money(detail.masterOrder?.totalAmount)}</div>
                </div>
              </div>
            </>
          )}

          {order.fulfillmentStatus !== 'CANCELLED' && (
            <ShipmentPanel subOrderId={order.id} onChange={onChange} defaultExpanded />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Styles ──────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '28px 32px', color: '#0f172a', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20, flexWrap: 'wrap' },
  h1: { margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', color: '#0f172a', display: 'flex', alignItems: 'baseline', gap: 10 },
  headerCount: { fontSize: 14, fontWeight: 500, color: '#64748b', padding: '2px 10px', borderRadius: 999, background: '#f1f5f9', fontVariantNumeric: 'tabular-nums' },
  headerSub: { margin: '4px 0 0', fontSize: 13, color: '#64748b' },
  toolbar: { display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' },
  searchWrap: { position: 'relative', flex: '1 1 240px', minWidth: 220, maxWidth: 320 },
  searchIcon: { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: '#94a3b8', pointerEvents: 'none' },
  searchInput: { width: '100%', height: 38, padding: '0 12px 0 36px', fontSize: 14, color: '#0f172a', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  select: { height: 38, padding: '0 12px', fontSize: 13, color: '#0f172a', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, outline: 'none', cursor: 'pointer', fontFamily: 'inherit', minWidth: 150 },
  btnGhost: { height: 38, padding: '0 14px', fontSize: 13, fontWeight: 500, color: '#334155', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' },
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '10px 10px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f1f5f9', cursor: 'pointer', transition: 'background-color 0.08s' },
  td: { padding: '12px 10px', verticalAlign: 'middle', fontSize: 13, color: '#0f172a' },
  orderNumber: { fontWeight: 600, color: '#0f172a', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  customerCell: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  avatar: { width: 32, height: 32, borderRadius: '50%', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  customerName: { fontWeight: 600, color: '#0f172a', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 },
  customerEmail: { fontSize: 12, color: '#64748b', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 },
  sellerName: { fontSize: 12, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180, display: 'inline-block' },
  delivery: { fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' },
  stateMsg: { padding: '40px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 },
  pagination: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, padding: '0 4px', flexWrap: 'wrap', gap: 10 },
  pageInfo: { fontSize: 13, color: '#64748b' },
  pageBtn: { height: 34, padding: '0 14px', fontSize: 13, fontWeight: 500, color: '#334155', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer' },
};
