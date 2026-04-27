'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface SubOrder {
  id: string;
  subTotal: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  acceptStatus: string;
  seller: { id: string; sellerName: string; sellerShopName: string; email: string } | null;
  items: { productTitle: string; quantity: number }[];
}

interface ReturnLite {
  id: string;
  returnNumber: string;
  status: string;
  createdAt: string;
}

interface Order {
  id: string;
  orderNumber: string;
  orderStatus: string;
  totalAmount: number;
  discountAmount?: number;
  paymentStatus: string;
  paymentMethod: string;
  itemCount: number;
  verified: boolean;
  createdAt: string;
  customer: { firstName: string; lastName: string; email: string };
  subOrders: SubOrder[];
  returns?: ReturnLite[];
}

interface OrdersResponse {
  orders: Order[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/* ── Formatting helpers ─────────────────────────────────────── */

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

const inr = (v: number) =>
  `₹${Number(v).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/* ── Status mapping ─────────────────────────────────────────── */

const ORDER_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PLACED', label: 'Placed' },
  { value: 'PENDING_VERIFICATION', label: 'Pending verification' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'ROUTED_TO_SELLER', label: 'Routed to seller' },
  { value: 'SELLER_ACCEPTED', label: 'Seller accepted' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'EXCEPTION_QUEUE', label: 'Exception queue' },
];

function orderStatusPill(status: string): { label: string; tone: PillTone } {
  switch (status) {
    case 'PLACED':
      return { label: 'Placed', tone: 'warning' };
    case 'PENDING_VERIFICATION':
      return { label: 'Pending verification', tone: 'warning' };
    case 'VERIFIED':
      return { label: 'Verified', tone: 'info' };
    case 'ROUTED_TO_SELLER':
      return { label: 'Routed', tone: 'info' };
    case 'SELLER_ACCEPTED':
      return { label: 'Accepted', tone: 'success' };
    case 'DISPATCHED':
      return { label: 'Dispatched', tone: 'info' };
    case 'DELIVERED':
      return { label: 'Delivered', tone: 'success' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'danger' };
    case 'EXCEPTION_QUEUE':
      return { label: 'Exception', tone: 'danger' };
    case 'RETURN_REQUESTED':
      return { label: 'Return requested', tone: 'warning' };
    case 'RETURN_IN_PROGRESS':
      return { label: 'Return in progress', tone: 'info' };
    case 'RETURN_REJECTED':
      return { label: 'Return rejected', tone: 'danger' };
    case 'REFUNDED':
      return { label: 'Refunded', tone: 'info' };
    default:
      return {
        label: status.replace(/_/g, ' ').toLowerCase(),
        tone: 'neutral',
      };
  }
}

function paymentPill(status: string): { label: string; tone: PillTone } {
  switch (status) {
    case 'PAID':
      return { label: 'Paid', tone: 'success' };
    case 'PENDING':
      return { label: 'Pending', tone: 'warning' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'danger' };
    case 'REFUNDED':
      return { label: 'Refunded', tone: 'info' };
    default:
      return { label: status.toLowerCase(), tone: 'neutral' };
  }
}

function fulfillmentPill(status: string): { label: string; tone: PillTone } {
  switch (status) {
    case 'DELIVERED':
      return { label: 'Delivered', tone: 'success' };
    case 'FULFILLED':
      return { label: 'Out for delivery', tone: 'info' };
    case 'SHIPPED':
      return { label: 'Shipped', tone: 'info' };
    case 'PACKED':
      return { label: 'Packed', tone: 'warning' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'danger' };
    default:
      return { label: 'Unfulfilled', tone: 'warning' };
  }
}

function acceptPill(status: string): { label: string; tone: PillTone } {
  switch (status) {
    case 'ACCEPTED':
      return { label: 'Accepted', tone: 'success' };
    case 'REJECTED':
      return { label: 'Rejected', tone: 'danger' };
    case 'OPEN':
      return { label: 'Open', tone: 'warning' };
    default:
      return { label: status.toLowerCase(), tone: 'neutral' };
  }
}

const returnToOrderStatus = (returnStatus: string): string => {
  switch (returnStatus) {
    case 'REQUESTED':
      return 'RETURN_REQUESTED';
    case 'REJECTED':
    case 'QC_REJECTED':
      return 'RETURN_REJECTED';
    case 'REFUNDED':
    case 'COMPLETED':
      return 'REFUNDED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'RETURN_IN_PROGRESS';
  }
};

/* ── Page ───────────────────────────────────────────────────── */

export default function AdminOrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('');
  const [acceptFilter, setAcceptFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const hasFilters = !!(
    orderStatusFilter ||
    paymentFilter ||
    fulfillmentFilter ||
    acceptFilter ||
    searchQuery
  );

  const fetchOrders = (p: number) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: '20' });
    if (orderStatusFilter) params.append('orderStatus', orderStatusFilter);
    if (paymentFilter) params.append('paymentStatus', paymentFilter);
    if (fulfillmentFilter) params.append('fulfillmentStatus', fulfillmentFilter);
    if (acceptFilter) params.append('acceptStatus', acceptFilter);
    if (searchQuery) params.append('search', searchQuery);

    apiClient<OrdersResponse>(`/admin/orders?${params.toString()}`)
      .then((res) => {
        if (res.data) setData(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOrders(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, orderStatusFilter, paymentFilter, fulfillmentFilter, acceptFilter]);

  const handleSearch = () => {
    setPage(1);
    fetchOrders(1);
  };

  const handleClear = () => {
    setOrderStatusFilter('');
    setPaymentFilter('');
    setFulfillmentFilter('');
    setAcceptFilter('');
    setSearchQuery('');
    setPage(1);
  };

  return (
    <div style={styles.page}>
      {/* ── Header ─────────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={{ minWidth: 0 }}>
          <h1 style={styles.h1}>
            Orders
            {data && (
              <span style={styles.headerCount}>
                {data.pagination.total.toLocaleString('en-IN')}
              </span>
            )}
          </h1>
          <p style={styles.headerSub}>
            Track, moderate, and resolve every order across the marketplace.
          </p>
        </div>
      </header>

      {/* ── Toolbar ────────────────────────────────────────── */}
      <div style={styles.toolbar}>
        <div style={styles.searchWrap}>
          <svg style={styles.searchIcon} viewBox="0 0 20 20" aria-hidden="true">
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
            placeholder="Search order number or customer"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={styles.searchInput}
            aria-label="Search orders"
          />
        </div>

        <select
          value={orderStatusFilter}
          onChange={(e) => {
            setOrderStatusFilter(e.target.value);
            setPage(1);
          }}
          style={styles.select}
          aria-label="Order status"
        >
          {ORDER_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={paymentFilter}
          onChange={(e) => {
            setPaymentFilter(e.target.value);
            setPage(1);
          }}
          style={styles.select}
          aria-label="Payment status"
        >
          <option value="">All payment</option>
          <option value="PENDING">Pending</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        <select
          value={fulfillmentFilter}
          onChange={(e) => {
            setFulfillmentFilter(e.target.value);
            setPage(1);
          }}
          style={styles.select}
          aria-label="Fulfillment status"
        >
          <option value="">All fulfillment</option>
          <option value="UNFULFILLED">Unfulfilled</option>
          <option value="PACKED">Packed</option>
          <option value="SHIPPED">Shipped</option>
          <option value="FULFILLED">Out for delivery</option>
          <option value="DELIVERED">Delivered</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        <select
          value={acceptFilter}
          onChange={(e) => {
            setAcceptFilter(e.target.value);
            setPage(1);
          }}
          style={styles.select}
          aria-label="Accept status"
        >
          <option value="">All accept</option>
          <option value="OPEN">Open</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="REJECTED">Rejected</option>
        </select>

        {hasFilters && (
          <button type="button" onClick={handleClear} style={styles.btnGhost}>
            Clear
          </button>
        )}
      </div>

      {/* ── States ─────────────────────────────────────────── */}
      {loading && !data ? (
        <SkeletonTable />
      ) : !data || data.orders.length === 0 ? (
        <EmptyState hasFilters={hasFilters} />
      ) : (
        <>
          <div style={styles.card}>
            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Order</th>
                    <th style={styles.th}>Customer</th>
                    <th style={styles.th}>Seller</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Payment</th>
                    <th style={styles.th}>Fulfillment</th>
                    <th style={styles.th}>Accept</th>
                    <th style={styles.th}>Date</th>
                    <th style={{ ...styles.th, textAlign: 'right' as const }}>
                      Amount
                    </th>
                    <th style={{ ...styles.th, width: 36 }} aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      onOpen={() =>
                        router.push(`/dashboard/orders/${order.id}`)
                      }
                      onReturnClick={(returnId) =>
                        router.push(`/dashboard/returns/${returnId}`)
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.pagination.totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={data.pagination.totalPages}
              total={data.pagination.total}
              limit={data.pagination.limit}
              onChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ── Row ────────────────────────────────────────────────────── */

function OrderRow({
  order,
  onOpen,
  onReturnClick,
}: {
  order: Order;
  onOpen: () => void;
  onReturnClick: (returnId: string) => void;
}) {
  const [hover, setHover] = useState(false);

  const activeSubs = order.subOrders.filter((so) => so.acceptStatus !== 'REJECTED');
  const relevantSubs = activeSubs.length > 0 ? activeSubs : order.subOrders;
  const wasRerouted = activeSubs.length > 0 && activeSubs.length < order.subOrders.length;

  const sellers = relevantSubs
    .map((so) => so.seller?.sellerShopName || '—')
    .filter((v, i, a) => a.indexOf(v) === i);

  const fulfillmentStatuses = [
    ...new Set(relevantSubs.map((so) => so.fulfillmentStatus)),
  ];
  const acceptStatuses = [...new Set(relevantSubs.map((so) => so.acceptStatus))];

  const latestReturn = (order.returns ?? [])[0];
  const effectiveStatus = latestReturn
    ? returnToOrderStatus(latestReturn.status)
    : order.orderStatus || (order.verified ? 'VERIFIED' : 'PLACED');

  const statusInfo = orderStatusPill(effectiveStatus);
  const payInfo = paymentPill(order.paymentStatus);
  const total =
    Number(order.totalAmount) + Number(order.discountAmount || 0);

  const customerFullName =
    [order.customer.firstName, order.customer.lastName]
      .filter(Boolean)
      .join(' ') || order.customer.email;
  const color = avatarColor(customerFullName);

  return (
    <tr
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      style={{
        ...styles.tr,
        background: hover ? '#f8fafc' : 'transparent',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <td style={styles.td}>
        <div style={styles.orderNumberCell}>
          <span style={styles.orderNumber}>#{order.orderNumber}</span>
          {wasRerouted && (
            <span
              style={styles.reroutedBadge}
              title="This order was rejected by one seller and re-routed to another."
            >
              Re-routed
            </span>
          )}
        </div>
      </td>
      <td style={styles.td}>
        <div style={styles.customerCell}>
          <div
            style={{
              ...styles.avatar,
              background: color.bg,
              color: color.fg,
            }}
            aria-hidden="true"
          >
            {initials(order.customer.firstName, order.customer.lastName)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.customerName}>{customerFullName}</div>
            {order.customer.email && (
              <div style={styles.customerEmail} title={order.customer.email}>
                {order.customer.email}
              </div>
            )}
          </div>
        </div>
      </td>
      <td style={styles.td}>
        <div style={styles.stackCell}>
          {sellers.map((s, idx) => (
            <span key={idx} style={styles.sellerName}>
              {s}
            </span>
          ))}
        </div>
      </td>
      <td style={styles.td}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Pill label={statusInfo.label} tone={statusInfo.tone} />
          {latestReturn && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReturnClick(latestReturn.id);
              }}
              title={`View ${latestReturn.returnNumber}`}
              style={styles.returnLink}
            >
              {latestReturn.returnNumber}
              {(order.returns?.length ?? 0) > 1 &&
                ` +${(order.returns!.length - 1)}`}
            </button>
          )}
        </div>
      </td>
      <td style={styles.td}>
        <Pill label={payInfo.label} tone={payInfo.tone} />
      </td>
      <td style={styles.td}>
        <div style={styles.pillStack}>
          {fulfillmentStatuses.map((fs, idx) => {
            const p = fulfillmentPill(fs);
            return <Pill key={idx} label={p.label} tone={p.tone} size="xs" />;
          })}
        </div>
      </td>
      <td style={styles.td}>
        <div style={styles.pillStack}>
          {acceptStatuses.map((as2, idx) => {
            const p = acceptPill(as2);
            return <Pill key={idx} label={p.label} tone={p.tone} size="xs" />;
          })}
        </div>
      </td>
      <td style={{ ...styles.td, color: '#475569', whiteSpace: 'nowrap' }}>
        {fmtDate(order.createdAt)}
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {inr(total)}
      </td>
      <td style={{ ...styles.td, padding: 0, textAlign: 'right' }}>
        <svg
          viewBox="0 0 20 20"
          style={{
            ...styles.rowChevron,
            opacity: hover ? 1 : 0,
            color: hover ? '#64748b' : 'transparent',
          }}
          aria-hidden="true"
        >
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 4l6 6-6 6"
          />
        </svg>
      </td>
    </tr>
  );
}

/* ── Pill ───────────────────────────────────────────────────── */

function Pill({
  label,
  tone,
  size = 'sm',
}: {
  label: string;
  tone: PillTone;
  size?: 'xs' | 'sm';
}) {
  const t = pillTones[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: size === 'xs' ? '2px 8px 2px 6px' : '3px 10px 3px 8px',
        fontSize: size === 'xs' ? 11 : 12,
        fontWeight: 500,
        borderRadius: 999,
        border: `1px solid ${t.border}`,
        background: t.bg,
        color: t.color,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: t.dot,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}

const pillTones: Record<
  PillTone,
  { bg: string; color: string; border: string; dot: string }
> = {
  success: {
    bg: 'rgba(22, 163, 74, 0.08)',
    color: '#15803d',
    border: 'rgba(22, 163, 74, 0.2)',
    dot: '#16a34a',
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.1)',
    color: '#b45309',
    border: 'rgba(245, 158, 11, 0.25)',
    dot: '#f59e0b',
  },
  danger: {
    bg: 'rgba(220, 38, 38, 0.08)',
    color: '#b91c1c',
    border: 'rgba(220, 38, 38, 0.2)',
    dot: '#dc2626',
  },
  info: {
    bg: 'rgba(14, 116, 144, 0.08)',
    color: '#0e7490',
    border: 'rgba(14, 116, 144, 0.2)',
    dot: '#0891b2',
  },
  neutral: {
    bg: '#f1f5f9',
    color: '#475569',
    border: '#e2e8f0',
    dot: '#94a3b8',
  },
};

/* ── Pagination ─────────────────────────────────────────────── */

function Pagination({
  page,
  totalPages,
  total,
  limit,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onChange: (p: number) => void;
}) {
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div style={styles.pagination}>
      <span style={styles.paginationLabel}>
        Showing <strong>{from}</strong>–<strong>{to}</strong> of{' '}
        <strong>{total.toLocaleString('en-IN')}</strong>
      </span>
      <div style={styles.paginationControls}>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          style={{
            ...styles.pageBtn,
            ...(page <= 1 ? styles.pageBtnDisabled : {}),
          }}
          aria-label="Previous page"
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4l-6 6 6 6"
            />
          </svg>
        </button>
        <span style={styles.pageIndicator}>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          style={{
            ...styles.pageBtn,
            ...(page >= totalPages ? styles.pageBtnDisabled : {}),
          }}
          aria-label="Next page"
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 4l6 6-6 6"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ── Skeleton / Empty ───────────────────────────────────────── */

function SkeletonTable() {
  return (
    <div style={styles.card}>
      <div style={styles.tableScroll}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Order</th>
              <th style={styles.th}>Customer</th>
              <th style={styles.th}>Seller</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Payment</th>
              <th style={styles.th}>Fulfillment</th>
              <th style={styles.th}>Accept</th>
              <th style={styles.th}>Date</th>
              <th style={{ ...styles.th, textAlign: 'right' as const }}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} style={styles.tr}>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 110 }} />
                </td>
                <td style={styles.td}>
                  <div style={styles.customerCell}>
                    <div style={{ ...styles.avatar, ...styles.shimmer }} />
                    <div>
                      <div style={{ ...styles.skelLine, width: 120 }} />
                      <div
                        style={{ ...styles.skelLine, width: 160, marginTop: 6 }}
                      />
                    </div>
                  </div>
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 90 }} />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 90, height: 22 }} />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 70, height: 22 }} />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 96, height: 22 }} />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 74, height: 22 }} />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 80 }} />
                </td>
                <td style={{ ...styles.td, textAlign: 'right' as const }}>
                  <div
                    style={{
                      ...styles.skelLine,
                      width: 80,
                      marginLeft: 'auto',
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <style>{shimmerKeyframes}</style>
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div style={styles.empty}>
      <svg viewBox="0 0 48 48" style={styles.emptyIcon} aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 12h32v28a4 4 0 01-4 4H12a4 4 0 01-4-4V12zM8 12l4-6h24l4 6M16 22h16M16 30h10"
        />
      </svg>
      <h3 style={styles.emptyTitle}>
        {hasFilters ? 'No orders match your filters' : 'No orders yet'}
      </h3>
      <p style={styles.emptyBody}>
        {hasFilters
          ? 'Try adjusting the status filters or search term above.'
          : 'When customers place orders, they will appear here.'}
      </p>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const shimmerKeyframes = `
@keyframes orders-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}
`;

const styles: Record<string, React.CSSProperties> = {
  page: {
    color: '#0f172a',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  h1: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: '#0f172a',
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
  },
  headerCount: {
    fontSize: 14,
    fontWeight: 500,
    color: '#64748b',
    padding: '2px 10px',
    borderRadius: 999,
    background: '#f1f5f9',
    fontVariantNumeric: 'tabular-nums',
  },
  headerSub: {
    margin: '4px 0 0',
    fontSize: 13,
    color: '#64748b',
  },

  toolbar: {
    display: 'flex',
    gap: 10,
    marginBottom: 16,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  searchWrap: {
    position: 'relative',
    flex: '1 1 240px',
    minWidth: 220,
    maxWidth: 320,
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
    fontSize: 14,
    color: '#0f172a',
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    transition: 'border-color 0.12s, box-shadow 0.12s',
  },
  select: {
    height: 38,
    padding: '0 12px',
    fontSize: 13,
    color: '#0f172a',
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minWidth: 150,
  },
  btnGhost: {
    height: 38,
    padding: '0 14px',
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },

  card: {
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableScroll: { overflowX: 'auto' },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '10px 10px',
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
    cursor: 'pointer',
    outline: 'none',
    transition: 'background-color 0.08s',
  },
  td: {
    padding: '12px 10px',
    verticalAlign: 'middle',
    fontSize: 13,
    color: '#0f172a',
  },

  orderNumberCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  orderNumber: {
    fontWeight: 600,
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  reroutedBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 7px',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#b45309',
    background: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(245, 158, 11, 0.25)',
    borderRadius: 4,
    whiteSpace: 'nowrap',
  },

  customerCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    fontSize: 11,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  customerName: {
    fontWeight: 600,
    color: '#0f172a',
    fontSize: 13,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  customerEmail: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 220,
  },

  stackCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  sellerName: {
    fontSize: 12,
    color: '#0f172a',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 180,
  },

  pillStack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
  },

  returnLink: {
    background: 'transparent',
    border: 'none',
    padding: 0,
    fontSize: 11,
    color: '#0e7490',
    fontFamily: 'inherit',
    cursor: 'pointer',
    textDecoration: 'underline dotted',
    textAlign: 'left',
  },

  rowChevron: {
    width: 16,
    height: 16,
    display: 'inline-block',
    marginRight: 12,
    transition: 'opacity 0.12s, color 0.12s',
  },

  /* Pagination */
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    padding: '0 4px',
    flexWrap: 'wrap',
    gap: 12,
  },
  paginationLabel: {
    fontSize: 13,
    color: '#475569',
  },
  paginationControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  pageBtn: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    background: '#ffffff',
    cursor: 'pointer',
    color: '#334155',
    transition: 'background-color 0.12s, border-color 0.12s, color 0.12s',
  },
  pageBtnDisabled: {
    color: '#cbd5e1',
    cursor: 'not-allowed',
    background: '#f8fafc',
  },
  pageIndicator: {
    padding: '0 10px',
    fontSize: 13,
    color: '#475569',
    fontVariantNumeric: 'tabular-nums',
  },

  /* Empty */
  empty: {
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: '56px 24px',
    textAlign: 'center',
  },
  emptyIcon: {
    width: 40,
    height: 40,
    color: '#94a3b8',
    marginBottom: 12,
  },
  emptyTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: '#0f172a',
  },
  emptyBody: {
    margin: '6px auto 0',
    fontSize: 13,
    color: '#64748b',
    maxWidth: 360,
  },

  skelLine: {
    display: 'block',
    height: 12,
    borderRadius: 4,
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'orders-shimmer 1.2s ease-in-out infinite',
  },
  shimmer: {
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'orders-shimmer 1.2s ease-in-out infinite',
  },
};
