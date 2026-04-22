'use client';

import { useEffect, useState } from 'react';
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

const customerStatusLabel = (status: string, paymentStatus?: string): string => {
  if (paymentStatus === 'PAID' && status === 'DELIVERED') return 'Completed';
  switch (status) {
    case 'PLACED': return 'Order Placed';
    case 'PENDING_VERIFICATION': return 'Order Placed';
    case 'VERIFIED': return 'Order Confirmed';
    case 'ROUTED_TO_SELLER': return 'Being Prepared';
    case 'SELLER_ACCEPTED': return 'Order Accepted';
    case 'PACKED': return 'Packed & Ready';
    case 'SHIPPED': return 'Shipped';
    case 'DISPATCHED': return 'Shipped';
    case 'DELIVERED': return 'Delivered';
    case 'CANCELLED': return 'Cancelled';
    case 'EXCEPTION_QUEUE': return 'Processing';
    default: return status;
  }
};

const orderStatusColor = (status: string, paymentStatus?: string): string => {
  if (paymentStatus === 'PAID' && status === 'DELIVERED') return '#16a34a';
  switch (status) {
    case 'PLACED': return '#d97706';
    case 'PENDING_VERIFICATION': return '#d97706';
    case 'VERIFIED': return '#2563eb';
    case 'ROUTED_TO_SELLER': return '#7c3aed';
    case 'SELLER_ACCEPTED': return '#16a34a';
    case 'PACKED': return '#d97706';
    case 'SHIPPED': return '#2563eb';
    case 'DISPATCHED': return '#0d9488';
    case 'DELIVERED': return '#15803d';
    case 'CANCELLED': return '#dc2626';
    case 'EXCEPTION_QUEUE': return '#d97706';
    default: return '#6366f1';
  }
};

const ORDER_PROGRESS_STEPS = ['Placed', 'Confirmed', 'Shipped', 'Delivered', 'Completed'];

const orderStatusToProgress = (status: string, paymentStatus?: string): number => {
  if (paymentStatus === 'PAID') return 4;
  switch (status) {
    case 'PLACED': return 0;
    case 'PENDING_VERIFICATION': return 0;
    case 'VERIFIED': return 1;
    case 'ROUTED_TO_SELLER': return 1;
    case 'SELLER_ACCEPTED': return 1;
    case 'PACKED': return 1;
    case 'SHIPPED': return 2;
    case 'DISPATCHED': return 2;
    case 'DELIVERED': return 3;
    case 'CANCELLED': return -1;
    case 'EXCEPTION_QUEUE': return 0;
    default: return 0;
  }
};

const fulfillmentToProgress = (status: string, paymentStatus?: string): number => {
  if (paymentStatus === 'PAID') return 4;
  switch (status) {
    case 'DELIVERED': return 3;
    case 'FULFILLED': return 2;
    case 'SHIPPED': return 2;
    case 'PACKED': return 1;
    case 'CANCELLED': return -1;
    default: return 0;
  }
};

function MiniProgressBar({ orderStatus, fulfillmentStatus, paymentStatus }: { orderStatus?: string; fulfillmentStatus: string; paymentStatus?: string }) {
  const isCancelled = orderStatus === 'CANCELLED' || fulfillmentStatus === 'CANCELLED';
  if (isCancelled) {
    return (
      <div className="orders-progress-cancelled">
        <span className="orders-progress-cancelled-dot">X</span>
        <span>Cancelled</span>
      </div>
    );
  }

  const progressIdx = orderStatus ? orderStatusToProgress(orderStatus, paymentStatus) : fulfillmentToProgress(fulfillmentStatus, paymentStatus);
  const barColor = paymentStatus === 'PAID' ? '#16a34a' : (orderStatus ? orderStatusColor(orderStatus, paymentStatus) : '#6366f1');

  return (
    <div className="orders-progress-bar">
      {Array.from({ length: ORDER_PROGRESS_STEPS.length }).map((_, idx) => (
        <div
          key={idx}
          className="orders-progress-segment"
          style={{ background: idx <= progressIdx ? barColor : '#e5e7eb' }}
        />
      ))}
    </div>
  );
}

export default function OrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchOrders = (p: number) => {
    setLoading(true);
    apiClient<OrdersResponse>(`/customer/orders?page=${p}&limit=20`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('accessToken')) { router.push('/login'); return; }
    } catch { router.push('/login'); return; }
    fetchOrders(page);
  }, [page]);

  const formatPrice = (price: number) => `\u20B9${Number(price).toLocaleString('en-IN')}`;
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

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

  return (
    <>
      <Navbar />
      <div className="orders-page">
        <h1 className="orders-page-title">My Orders</h1>

        {!data || data.orders.length === 0 ? (
          <div className="orders-empty">
            <span className="orders-empty-icon">&#128230;</span>
            <h3>No orders yet</h3>
            <p>Start shopping to see your orders here</p>
            <Link href="/" className="orders-empty-btn">Browse Products</Link>
          </div>
        ) : (
          <div className="orders-list">
            {data.orders.map((order) => {
              // When a seller rejects, the router spawns a fresh sub-order on
              // another seller — the rejected row stays in the DB with
              // acceptStatus=REJECTED / fulfillmentStatus=CANCELLED but
              // surfacing it on the customer page is misleading (they see
              // both "Paid + Completed" and "Cancelled" for the same order).
              // Collapse the view to the *active* sub-orders unless the
              // entire order was actually cancelled.
              const activeSubs = order.subOrders.filter((so) => so.acceptStatus !== 'REJECTED');
              const relevantSubs = activeSubs.length > 0 ? activeSubs : order.subOrders;

              const allItems = relevantSubs.flatMap((so) => so.items);
              const overallFulfillment = relevantSubs.length > 0
                ? relevantSubs.every((so) => so.fulfillmentStatus === 'DELIVERED')
                  ? 'DELIVERED'
                  : relevantSubs.every((so) => so.fulfillmentStatus === 'FULFILLED' || so.fulfillmentStatus === 'DELIVERED')
                    ? 'FULFILLED'
                    : relevantSubs.some((so) => so.fulfillmentStatus === 'SHIPPED')
                      ? 'SHIPPED'
                      : relevantSubs.some((so) => so.fulfillmentStatus === 'PACKED')
                        ? 'PACKED'
                        : relevantSubs.every((so) => so.fulfillmentStatus === 'CANCELLED')
                          ? 'CANCELLED'
                          : 'UNFULFILLED'
                : 'UNFULFILLED';

              const displayLabel = customerStatusLabel(order.orderStatus || overallFulfillment, order.paymentStatus);
              const displayColor = orderStatusColor(order.orderStatus || overallFulfillment, order.paymentStatus);

              const paymentLabel = order.paymentStatus === 'CANCELLED' ? 'Cancelled' : order.paymentStatus === 'PAID' ? 'Paid' : 'Payment Pending';
              const paymentColor = order.paymentStatus === 'CANCELLED' ? '#dc2626' : order.paymentStatus === 'PAID' ? '#16a34a' : '#d97706';

              // Collapse redundant status chatter: when the order is fully
              // cancelled, the single "Cancelled" banner from MiniProgressBar
              // is enough — we don't also need the Payment and Status pills
              // repeating the word three times.
              const isCancelled =
                order.orderStatus === 'CANCELLED' ||
                overallFulfillment === 'CANCELLED' ||
                order.paymentStatus === 'CANCELLED';

              return (
                <Link key={order.id} href={`/orders/${order.orderNumber}`} className="orders-card">
                  {/* Header row */}
                  <div className="orders-card-header">
                    <div className="orders-card-header-left">
                      <span className="orders-card-number">{order.orderNumber}</span>
                      <span className="orders-card-date">{formatDate(order.createdAt)}</span>
                    </div>
                    <span className="orders-card-amount">{formatPrice(Number(order.totalAmount))}</span>
                  </div>

                  {/* Status row — hidden for cancelled orders since the
                      MiniProgressBar already shows "Cancelled" prominently. */}
                  {!isCancelled && (
                    <div className="orders-card-status-row">
                      <span className="orders-status-badge" style={{ background: paymentColor + '15', color: paymentColor }}>{paymentLabel}</span>
                      <span className="orders-status-badge" style={{ background: displayColor + '15', color: displayColor }}>{displayLabel}</span>
                    </div>
                  )}

                  {/* Progress */}
                  <MiniProgressBar orderStatus={order.orderStatus} fulfillmentStatus={overallFulfillment} paymentStatus={order.paymentStatus} />

                  {/* Footer row */}
                  <div className="orders-card-footer">
                    <span className="orders-card-meta">
                      {order.itemCount} item{order.itemCount !== 1 ? 's' : ''} &middot; {order.paymentMethod === 'COD' ? 'Cash on Delivery' : order.paymentMethod}
                    </span>
                    <span className="orders-card-fulfilled">Fulfilled by SPORTSMART</span>
                  </div>

                  {/* Thumbnails */}
                  {allItems.length > 0 && (
                    <div className="orders-card-thumbs">
                      {allItems.slice(0, 4).map((item, idx) => (
                        <div key={idx} className="orders-card-thumb">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt="" />
                          ) : (
                            <span className="orders-card-thumb-placeholder">&#128722;</span>
                          )}
                        </div>
                      ))}
                      {allItems.length > 4 && (
                        <div className="orders-card-thumb orders-card-thumb-more">
                          +{allItems.length - 4}
                        </div>
                      )}
                    </div>
                  )}
                </Link>
              );
            })}

            {data.pagination.totalPages > 1 && (
              <div className="orders-pagination">
                <button className="pagination-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span className="orders-pagination-info">Page {page} of {data.pagination.totalPages}</span>
                <button className="pagination-btn" disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
