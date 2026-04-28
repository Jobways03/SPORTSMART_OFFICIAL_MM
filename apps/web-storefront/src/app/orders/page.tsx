'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { apiClient } from '@/lib/api-client';

interface OrderItem {
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  imageUrl: string | null;
}

interface SubOrder {
  id: string;
  fulfillmentStatus: string;
  acceptStatus: string;
  items: OrderItem[];
}

interface Order {
  id: string;
  orderNumber: string;
  orderStatus: string;
  orderStatusLabel: string;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  itemCount: number;
  createdAt: string;
  subOrders: SubOrder[];
}

interface OrdersResponse {
  orders: Order[];
  pagination: { page: number; total: number; totalPages: number };
}

// ─────────────────────────────────────────────────────────────────
// Status normalization
// ─────────────────────────────────────────────────────────────────
// The API ships raw enum values (PLACED, ROUTED_TO_SELLER, etc.)
// because each backoffice surface needs a different slice. Customer
// orders page collapses them into a small set the customer actually
// understands: Placed / Confirmed / Shipped / Delivered + the two
// terminal states Cancelled / Completed.

const customerStatusLabel = (status: string, paymentStatus?: string): string => {
  if (paymentStatus === 'PAID' && status === 'DELIVERED') return 'Delivered';
  switch (status) {
    case 'PLACED':
    case 'PENDING_VERIFICATION':
      return 'Placed';
    case 'VERIFIED':
    case 'ROUTED_TO_SELLER':
    case 'SELLER_ACCEPTED':
      return 'Confirmed';
    case 'PACKED':
      return 'Packed';
    case 'SHIPPED':
    case 'DISPATCHED':
      return 'Shipped';
    case 'DELIVERED':
      return 'Delivered';
    case 'CANCELLED':
      return 'Cancelled';
    case 'EXCEPTION_QUEUE':
      return 'Processing';
    default:
      return 'Processing';
  }
};

// Semantic status tone — used by the chip and the progress bar so
// they both speak the same colour language.
type Tone = 'success' | 'progress' | 'pending' | 'cancelled';

const customerStatusTone = (status: string, paymentStatus?: string): Tone => {
  if (paymentStatus === 'CANCELLED') return 'cancelled';
  if (status === 'CANCELLED') return 'cancelled';
  if (paymentStatus === 'PAID' && status === 'DELIVERED') return 'success';
  if (status === 'DELIVERED') return 'success';
  if (
    status === 'SHIPPED' ||
    status === 'DISPATCHED' ||
    status === 'PACKED' ||
    status === 'SELLER_ACCEPTED' ||
    status === 'ROUTED_TO_SELLER' ||
    status === 'VERIFIED'
  ) {
    return 'progress';
  }
  return 'pending';
};

// 4-step bar — Placed → Confirmed → Shipped → Delivered. Captures the
// only meaningful transitions for the customer; the seller-side
// micro-states get folded into the nearest customer-visible one.
const orderStatusToProgress = (status: string, paymentStatus?: string): number => {
  if (paymentStatus === 'PAID' && status === 'DELIVERED') return 4;
  switch (status) {
    case 'PLACED':
    case 'PENDING_VERIFICATION':
      return 1;
    case 'VERIFIED':
    case 'ROUTED_TO_SELLER':
    case 'SELLER_ACCEPTED':
    case 'PACKED':
      return 2;
    case 'SHIPPED':
    case 'DISPATCHED':
      return 3;
    case 'DELIVERED':
      return 4;
    case 'CANCELLED':
      return -1;
    case 'EXCEPTION_QUEUE':
      return 1;
    default:
      return 1;
  }
};

// ─────────────────────────────────────────────────────────────────
// Filter logic
// ─────────────────────────────────────────────────────────────────

type Filter = 'all' | 'active' | 'delivered' | 'cancelled';

interface DerivedStatus {
  isCancelled: boolean;
  isDelivered: boolean;
  isActive: boolean;
  effectiveStatus: string;
}

// Derive the "effective" customer-facing status of an order from its
// subOrders + payment + top-level state. Centralised so card render
// and filter counting can't disagree.
function deriveStatus(order: Order): DerivedStatus {
  // Skip rejected sub-orders — when a seller declines, the router
  // spawns a fresh sub-order on another seller and the rejected row
  // hangs around with acceptStatus=REJECTED. Including it muddies
  // the headline status.
  const activeSubs = order.subOrders.filter((so) => so.acceptStatus !== 'REJECTED');
  const relevantSubs = activeSubs.length > 0 ? activeSubs : order.subOrders;

  const allCancelled =
    relevantSubs.length > 0 && relevantSubs.every((so) => so.fulfillmentStatus === 'CANCELLED');
  const allDelivered =
    relevantSubs.length > 0 && relevantSubs.every((so) => so.fulfillmentStatus === 'DELIVERED');

  const isCancelled =
    order.orderStatus === 'CANCELLED' || allCancelled || order.paymentStatus === 'CANCELLED';
  const isDelivered = !isCancelled && (order.paymentStatus === 'PAID' && order.orderStatus === 'DELIVERED' || allDelivered);
  const isActive = !isCancelled && !isDelivered;

  const effectiveStatus = isCancelled
    ? 'CANCELLED'
    : order.orderStatus ||
      (relevantSubs.some((s) => s.fulfillmentStatus === 'SHIPPED')
        ? 'SHIPPED'
        : relevantSubs.some((s) => s.fulfillmentStatus === 'PACKED')
          ? 'PACKED'
          : 'PLACED');

  return { isCancelled, isDelivered, isActive, effectiveStatus };
}

function flattenItems(order: Order): OrderItem[] {
  const activeSubs = order.subOrders.filter((so) => so.acceptStatus !== 'REJECTED');
  const relevantSubs = activeSubs.length > 0 ? activeSubs : order.subOrders;
  return relevantSubs.flatMap((so) => so.items);
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

function StatusChip({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={`orders-chip orders-chip--${tone}`}>
      <span className="orders-chip-dot" aria-hidden />
      {label}
    </span>
  );
}

function ProgressTrack({ progressIdx, tone }: { progressIdx: number; tone: Tone }) {
  if (tone === 'cancelled') return null;
  // 4 segments: Placed, Confirmed, Shipped, Delivered
  return (
    <div className="orders-progress" aria-label={`Step ${progressIdx} of 4`}>
      {[1, 2, 3, 4].map((idx) => {
        const filled = idx <= progressIdx;
        return (
          <div
            key={idx}
            className={`orders-progress-step orders-progress-step--${tone}`}
            data-filled={filled ? 'true' : 'false'}
          />
        );
      })}
    </div>
  );
}

function FilterTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`orders-filter ${active ? 'orders-filter--active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span>{label}</span>
      <span className="orders-filter-count">{count}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>('all');

  const fetchOrders = (p: number) => {
    setLoading(true);
    apiClient<OrdersResponse>(`/customer/orders?page=${p}&limit=20`)
      .then((res) => {
        if (res.data) setData(res.data);
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('accessToken')) {
        router.push('/login');
        return;
      }
    } catch {
      router.push('/login');
      return;
    }
    fetchOrders(page);
  }, [page]);

  const { activeOrders, deliveredOrders, cancelledOrders, allOrders } = useMemo(() => {
    const orders = data?.orders ?? [];
    const buckets = { activeOrders: [] as Order[], deliveredOrders: [] as Order[], cancelledOrders: [] as Order[], allOrders: orders };
    for (const o of orders) {
      const s = deriveStatus(o);
      if (s.isCancelled) buckets.cancelledOrders.push(o);
      else if (s.isDelivered) buckets.deliveredOrders.push(o);
      else buckets.activeOrders.push(o);
    }
    return buckets;
  }, [data]);

  const visibleOrders =
    filter === 'all'
      ? allOrders
      : filter === 'active'
        ? activeOrders
        : filter === 'delivered'
          ? deliveredOrders
          : cancelledOrders;

  const formatPrice = (price: number) => `₹${Number(price).toLocaleString('en-IN')}`;
  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  if (loading && !data) {
    return (
      <>
        <Navbar />
        <div className="products-loading">
          <div className="loading-spinner"></div>
          <span>Loading orders...</span>
        </div>
      </>
    );
  }

  const hasOrders = (data?.orders?.length ?? 0) > 0;

  return (
    <>
      <Navbar />
      <div className="orders-page">
        <header className="orders-header">
          <div>
            <h1 className="orders-title">My Orders</h1>
            {hasOrders && (
              <p className="orders-subtitle">
                {activeOrders.length > 0
                  ? `${activeOrders.length} in progress · ${deliveredOrders.length} delivered`
                  : `${deliveredOrders.length} delivered · ${cancelledOrders.length} cancelled`}
              </p>
            )}
          </div>
        </header>

        {!hasOrders ? (
          <div className="orders-empty">
            <div className="orders-empty-illustration" aria-hidden>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16.5 9.4 7.55 4.24M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </div>
            <h2>No orders yet</h2>
            <p>When you place an order, it will show up here so you can track and manage it.</p>
            <Link href="/" className="orders-empty-cta">Browse products</Link>
          </div>
        ) : (
          <>
            <nav className="orders-filters" aria-label="Filter orders">
              <FilterTab active={filter === 'all'} label="All" count={allOrders.length} onClick={() => setFilter('all')} />
              <FilterTab active={filter === 'active'} label="In progress" count={activeOrders.length} onClick={() => setFilter('active')} />
              <FilterTab active={filter === 'delivered'} label="Delivered" count={deliveredOrders.length} onClick={() => setFilter('delivered')} />
              <FilterTab active={filter === 'cancelled'} label="Cancelled" count={cancelledOrders.length} onClick={() => setFilter('cancelled')} />
            </nav>

            {visibleOrders.length === 0 ? (
              <div className="orders-filtered-empty">
                <p>No orders match this filter.</p>
                <button type="button" className="orders-link-btn" onClick={() => setFilter('all')}>
                  Show all orders
                </button>
              </div>
            ) : (
              <ul className="orders-list" role="list">
                {visibleOrders.map((order) => {
                  const status = deriveStatus(order);
                  const items = flattenItems(order);
                  const tone = customerStatusTone(status.effectiveStatus, order.paymentStatus);
                  const label = customerStatusLabel(status.effectiveStatus, order.paymentStatus);
                  const progressIdx = orderStatusToProgress(status.effectiveStatus, order.paymentStatus);
                  const firstItem = items[0];
                  const moreItemCount = items.length - 1;

                  return (
                    <li key={order.id} className="orders-card-li">
                      <Link href={`/orders/${order.orderNumber}`} className="orders-card" aria-label={`View order ${order.orderNumber}`}>
                        {/* Top row: order # / date on left, total on right.
                            Total leads the visual hierarchy — that's the
                            most-asked question the customer comes here with. */}
                        <div className="orders-card-top">
                          <div className="orders-card-meta">
                            <span className="orders-card-number">{order.orderNumber}</span>
                            <span className="orders-card-date">{formatDate(order.createdAt)}</span>
                          </div>
                          <div className="orders-card-amount">{formatPrice(Number(order.totalAmount))}</div>
                        </div>

                        {/* Body: thumbnails + product preview. The preview
                            text gives more grip than "1 item" — recognising
                            the product is faster than parsing an order id. */}
                        <div className="orders-card-body">
                          <div className="orders-card-thumbs" aria-hidden>
                            {items.slice(0, 3).map((item, idx) => (
                              <div key={idx} className="orders-card-thumb">
                                {item.imageUrl ? (
                                  <img src={item.imageUrl} alt="" loading="lazy" />
                                ) : (
                                  <div className="orders-card-thumb-fallback">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                      <rect x="3" y="3" width="18" height="18" rx="2" />
                                      <circle cx="8.5" cy="8.5" r="1.5" />
                                      <path d="m21 15-5-5L5 21" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                            ))}
                            {items.length > 3 && (
                              <div className="orders-card-thumb orders-card-thumb-more">+{items.length - 3}</div>
                            )}
                          </div>
                          <div className="orders-card-product">
                            <div className="orders-card-product-title">
                              {firstItem?.productTitle ?? 'Order items'}
                            </div>
                            {firstItem?.variantTitle && (
                              <div className="orders-card-product-variant">{firstItem.variantTitle}</div>
                            )}
                            <div className="orders-card-product-extra">
                              {moreItemCount > 0 && (
                                <span>+{moreItemCount} more {moreItemCount === 1 ? 'item' : 'items'}</span>
                              )}
                              {moreItemCount > 0 && <span className="orders-dot" aria-hidden>·</span>}
                              <span>{order.paymentMethod === 'COD' ? 'Cash on Delivery' : order.paymentMethod}</span>
                            </div>
                          </div>
                        </div>

                        {/* Status row + progress: a single source of truth.
                            We removed the duplicate Paid/Completed pills that
                            used to live above the bar — the chip + the bar
                            already say it once. */}
                        <div className="orders-card-status">
                          <StatusChip tone={tone} label={label} />
                          <ProgressTrack progressIdx={progressIdx} tone={tone} />
                          <span className="orders-card-cta" aria-hidden>
                            View
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M5 12h14" />
                              <path d="m12 5 7 7-7 7" />
                            </svg>
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            {data && data.pagination.totalPages > 1 && (
              <div className="orders-pagination">
                <button
                  type="button"
                  className="orders-pagination-btn"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <span className="orders-pagination-info">
                  Page {page} of {data.pagination.totalPages}
                </span>
                <button
                  type="button"
                  className="orders-pagination-btn"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
