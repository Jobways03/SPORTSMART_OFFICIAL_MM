'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Package,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Image as ImageIcon,
} from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
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

// ───────── status normalization ─────────

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

// ───────── filter logic ─────────

type Filter = 'all' | 'active' | 'delivered' | 'cancelled';

interface DerivedStatus {
  isCancelled: boolean;
  isDelivered: boolean;
  isActive: boolean;
  effectiveStatus: string;
}

function deriveStatus(order: Order): DerivedStatus {
  const activeSubs = order.subOrders.filter((so) => so.acceptStatus !== 'REJECTED');
  const relevantSubs = activeSubs.length > 0 ? activeSubs : order.subOrders;

  const allCancelled =
    relevantSubs.length > 0 && relevantSubs.every((so) => so.fulfillmentStatus === 'CANCELLED');
  const allDelivered =
    relevantSubs.length > 0 && relevantSubs.every((so) => so.fulfillmentStatus === 'DELIVERED');

  const isCancelled =
    order.orderStatus === 'CANCELLED' || allCancelled || order.paymentStatus === 'CANCELLED';
  const isDelivered =
    !isCancelled &&
    ((order.paymentStatus === 'PAID' && order.orderStatus === 'DELIVERED') || allDelivered);
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

// ───────── chips / progress ─────────

const TONE_CHIP: Record<Tone, string> = {
  success:   'bg-green-50 text-success border border-green-200',
  progress:  'bg-accent-soft text-accent-dark border border-accent/30',
  pending:   'bg-ink-100 text-ink-700 border border-ink-200',
  cancelled: 'bg-red-50 text-danger border border-red-200',
};

const TONE_DOT: Record<Tone, string> = {
  success:   'bg-success',
  progress:  'bg-accent-dark',
  pending:   'bg-ink-500',
  cancelled: 'bg-danger',
};

function StatusChip({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 px-2 text-[11px] font-semibold uppercase tracking-wider rounded-full ${TONE_CHIP[tone]}`}>
      <span className={`size-1.5 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
      {label}
    </span>
  );
}

function ProgressTrack({ progressIdx, tone }: { progressIdx: number; tone: Tone }) {
  if (tone === 'cancelled') return null;
  const fillColor =
    tone === 'success' ? 'bg-success' : tone === 'progress' ? 'bg-accent-dark' : 'bg-ink-700';
  return (
    <div
      className="flex items-center gap-1 flex-1 max-w-[200px]"
      aria-label={`Step ${progressIdx} of 4`}
    >
      {[1, 2, 3, 4].map((idx) => (
        <div
          key={idx}
          className={`h-1 flex-1 rounded-full transition-colors ${
            idx <= progressIdx ? fillColor : 'bg-ink-200'
          }`}
        />
      ))}
    </div>
  );
}

function FilterPill({
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
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-9 px-3.5 text-body font-medium transition-colors ${
        active
          ? 'bg-ink-900 text-white border border-ink-900'
          : 'bg-white text-ink-700 border border-ink-300 hover:border-ink-900 hover:text-ink-900'
      }`}
    >
      {label}
      <span
        className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold tabular ${
          active ? 'bg-white/20 text-white' : 'bg-ink-100 text-ink-700'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// ───────── page ─────────

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const { activeOrders, deliveredOrders, cancelledOrders, allOrders } = useMemo(() => {
    const orders = data?.orders ?? [];
    const buckets = {
      activeOrders: [] as Order[],
      deliveredOrders: [] as Order[],
      cancelledOrders: [] as Order[],
      allOrders: orders,
    };
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
      <StorefrontShell>
        <div className="container-x py-12">
          <div className="h-8 w-40 bg-ink-100 animate-pulse mb-3" />
          <div className="h-4 w-60 bg-ink-100 animate-pulse mb-8" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 bg-ink-100 animate-pulse" />
            ))}
          </div>
        </div>
      </StorefrontShell>
    );
  }

  const hasOrders = (data?.orders?.length ?? 0) > 0;

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12">
        {/* Breadcrumb */}
        <div className="text-caption uppercase tracking-wider text-ink-600 mb-3">
          <Link href="/" className="hover:text-ink-900">
            Home
          </Link>
          {' / '}
          <span className="text-ink-900">My orders</span>
        </div>

        {/* Header */}
        <div className="flex items-end justify-between gap-4 flex-wrap mb-8">
          <div>
            <h1 className="font-display text-h1 text-ink-900 leading-none tracking-tight">
              My Orders
            </h1>
            {hasOrders && (
              <p className="mt-3 text-body text-ink-600">
                {activeOrders.length > 0
                  ? `${activeOrders.length} in progress · ${deliveredOrders.length} delivered`
                  : `${deliveredOrders.length} delivered · ${cancelledOrders.length} cancelled`}
              </p>
            )}
          </div>
          <Link
            href="/returns"
            className="text-caption uppercase tracking-wider font-semibold text-accent-dark hover:text-ink-900 underline-offset-2 hover:underline"
          >
            View returns &rarr;
          </Link>
        </div>

        {!hasOrders ? (
          <div className="bg-white border border-ink-200 py-20 px-6 text-center rounded-2xl">
            <div className="size-20 mx-auto rounded-full bg-accent-soft grid place-items-center mb-5">
              <Package className="size-9 text-accent-dark" strokeWidth={1.5} />
            </div>
            <h2 className="font-display text-h2 text-ink-900">No orders yet</h2>
            <p className="mt-3 max-w-sm mx-auto text-body text-ink-600">
              When you place an order it will show up here so you can track and manage it.
            </p>
            <Link
              href="/products"
              className="mt-6 inline-flex items-center h-11 px-5 bg-ink-900 text-white font-semibold hover:bg-ink-800 transition-colors rounded-full"
            >
              Browse products
              <ArrowRight className="size-4 ml-2" />
            </Link>
          </div>
        ) : (
          <>
            {/* Filters */}
            <nav
              aria-label="Filter orders"
              className="flex flex-wrap items-center gap-2 mb-6 pb-6 border-b border-ink-200"
            >
              <FilterPill
                active={filter === 'all'}
                label="All"
                count={allOrders.length}
                onClick={() => setFilter('all')}
              />
              <FilterPill
                active={filter === 'active'}
                label="In progress"
                count={activeOrders.length}
                onClick={() => setFilter('active')}
              />
              <FilterPill
                active={filter === 'delivered'}
                label="Delivered"
                count={deliveredOrders.length}
                onClick={() => setFilter('delivered')}
              />
              <FilterPill
                active={filter === 'cancelled'}
                label="Cancelled"
                count={cancelledOrders.length}
                onClick={() => setFilter('cancelled')}
              />
            </nav>

            {visibleOrders.length === 0 ? (
              <div className="bg-white border border-ink-200 py-16 px-6 text-center rounded-2xl">
                <p className="text-body text-ink-600">
                  No orders match this filter.
                </p>
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className="mt-3 text-caption font-semibold text-accent-dark hover:text-ink-900 hover:underline underline-offset-2"
                >
                  Show all orders
                </button>
              </div>
            ) : (
              <ul role="list" className="space-y-3">
                {visibleOrders.map((order) => {
                  const status = deriveStatus(order);
                  const items = flattenItems(order);
                  const tone = customerStatusTone(status.effectiveStatus, order.paymentStatus);
                  const label = customerStatusLabel(status.effectiveStatus, order.paymentStatus);
                  const progressIdx = orderStatusToProgress(status.effectiveStatus, order.paymentStatus);
                  const firstItem = items[0];
                  const moreItemCount = items.length - 1;

                  return (
                    <li key={order.id}>
                      <Link
                        href={`/orders/${order.orderNumber}`}
                        aria-label={`View order ${order.orderNumber}`}
                        className="group block bg-white border border-ink-200 hover:border-ink-900 transition-colors p-5 rounded-2xl"
                      >
                        {/* Top row: id+date, total */}
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div>
                            <div className="font-display text-body-lg text-ink-900 leading-none">
                              {order.orderNumber}
                            </div>
                            <div className="mt-1.5 text-caption text-ink-600 tabular">
                              {formatDate(order.createdAt)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-body-lg font-semibold text-ink-900 tabular">
                              {formatPrice(Number(order.totalAmount))}
                            </div>
                            <div className="mt-1 text-caption text-ink-500">
                              {order.itemCount} item{order.itemCount !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>

                        {/* Body: thumbs + product preview */}
                        <div className="flex items-center gap-4">
                          <div className="flex -space-x-2 shrink-0">
                            {items.slice(0, 3).map((item, idx) => (
                              <div
                                key={idx}
                                className="size-14 bg-ink-100 border-2 border-white grid place-items-center overflow-hidden"
                              >
                                {item.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={item.imageUrl}
                                    alt=""
                                    loading="lazy"
                                    className="size-full object-contain p-1"
                                  />
                                ) : (
                                  <ImageIcon className="size-5 text-ink-400" strokeWidth={1.5} />
                                )}
                              </div>
                            ))}
                            {items.length > 3 && (
                              <div className="size-14 bg-ink-900 text-white border-2 border-white grid place-items-center text-caption font-semibold tabular">
                                +{items.length - 3}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-body font-medium text-ink-900 truncate">
                              {firstItem?.productTitle ?? 'Order items'}
                            </div>
                            {firstItem?.variantTitle && (
                              <div className="text-caption text-ink-600 truncate mt-0.5">
                                {firstItem.variantTitle}
                              </div>
                            )}
                            <div className="mt-1 text-caption text-ink-500 flex items-center gap-1.5">
                              {moreItemCount > 0 && (
                                <>
                                  <span>
                                    +{moreItemCount} more {moreItemCount === 1 ? 'item' : 'items'}
                                  </span>
                                  <span aria-hidden>·</span>
                                </>
                              )}
                              <span>
                                {order.paymentMethod === 'COD'
                                  ? 'Cash on Delivery'
                                  : order.paymentMethod}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Status row */}
                        <div className="mt-5 pt-4 border-t border-ink-100 flex items-center gap-4">
                          <StatusChip tone={tone} label={label} />
                          <ProgressTrack progressIdx={progressIdx} tone={tone} />
                          <span className="ml-auto inline-flex items-center gap-1 text-caption font-semibold text-ink-700 group-hover:text-ink-900">
                            View
                            <ChevronRight className="size-3.5" />
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            {data && data.pagination.totalPages > 1 && (
              <nav
                aria-label="Pagination"
                className="mt-10 flex items-center justify-center gap-3"
              >
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="inline-flex items-center gap-2 h-10 px-4 border border-ink-300 hover:border-ink-900 disabled:opacity-40 disabled:hover:border-ink-300 text-body font-medium rounded-full"
                >
                  <ArrowLeft className="size-4" />
                  Previous
                </button>
                <span className="text-caption text-ink-600 tabular">
                  Page {page} of {data.pagination.totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage(page + 1)}
                  className="inline-flex items-center gap-2 h-10 px-4 border border-ink-300 hover:border-ink-900 disabled:opacity-40 disabled:hover:border-ink-300 text-body font-medium rounded-full"
                >
                  Next
                  <ArrowRight className="size-4" />
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </StorefrontShell>
  );
}
