'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import { apiClient } from '@/lib/api-client';

/* ────────── types ────────── */
interface OrderItem {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
}

interface CommissionRecord {
  id: string;
  orderItemId: string;
  productTitle: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  productEarning: number;
  commissionRate: string;
  unitCommission: number;
  totalCommission: number;
  adminEarning: number;
  refundedAdminEarning: number;
  createdAt: string;
}

interface SubOrder {
  id: string;
  subTotal: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  acceptStatus: string;
  deliveredAt: string | null;
  returnWindowEndsAt: string | null;
  commissionProcessed: boolean;
  acceptDeadline: string | null;
  fulfillmentNodeType?: 'SELLER' | 'FRANCHISE';
  items: OrderItem[];
  commissionRecords: CommissionRecord[];
  seller: { id: string; sellerShopName: string; sellerName?: string } | null;
  franchise: { id: string; businessName: string; warehousePincode?: string | null; status?: string } | null;
}

interface ReassignmentLog {
  id: string;
  subOrderId: string;
  fromSellerId: string;
  toSellerId: string | null;
  fromSellerName: string;
  toSellerName: string;
  reason: string;
  successful: boolean;
  newSubOrderId: string | null;
  createdAt: string;
}

interface EligibleNode {
  nodeType: 'SELLER' | 'FRANCHISE';
  nodeId: string;
  name: string;
  distanceKm: number;
  dispatchSla: number;
  availableStock: number;
  score: number;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  orderStatus: string;
  totalAmount: number;
  discountCode?: string | null;
  discountAmount?: number;
  paymentStatus: string;
  paymentMethod: string;
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationRemarks: string | null;
  itemCount: number;
  createdAt: string;
  shippingAddressSnapshot: {
    fullName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  };
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  subOrders: SubOrder[];
  reassignmentLogs?: ReassignmentLog[];
  discount?: DiscountDetail | null;
}

interface DiscountProductLink {
  id: string;
  scope: 'APPLIES' | 'BUY' | 'GET';
  productId: string;
  product: {
    id: string;
    title: string;
    basePrice: number | string;
    images: { url: string }[];
  } | null;
}

interface DiscountDetail {
  id: string;
  code: string | null;
  title: string | null;
  type: 'AMOUNT_OFF_PRODUCTS' | 'BUY_X_GET_Y' | 'AMOUNT_OFF_ORDER' | 'FREE_SHIPPING';
  method: 'CODE' | 'AUTOMATIC';
  valueType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: number | string;
  appliesTo: string;
  minRequirement: string;
  minRequirementValue: number | string | null;
  maxUses: number | null;
  onePerCustomer: boolean;
  usedCount: number;
  startsAt: string;
  endsAt: string | null;
  buyType: string | null;
  buyValue: number | string | null;
  getQuantity: number | null;
  getDiscountType: 'PERCENTAGE' | 'AMOUNT_OFF' | 'FREE' | null;
  getDiscountValue: number | string | null;
  products: DiscountProductLink[];
}

/* ────────── helpers ────────── */
const fmt = (n: number) => `\u20B9${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const humanizeDiscountType = (t: DiscountDetail['type']): string => {
  switch (t) {
    case 'AMOUNT_OFF_ORDER': return 'Amount off order';
    case 'AMOUNT_OFF_PRODUCTS': return 'Amount off products';
    case 'BUY_X_GET_Y': return 'Buy X get Y';
    case 'FREE_SHIPPING': return 'Free shipping';
    default: return String(t);
  }
};

const humanizeAppliesTo = (a: string): string => {
  switch (a) {
    case 'ALL_PRODUCTS': return 'All products';
    case 'SPECIFIC_COLLECTIONS': return 'Specific collections';
    case 'SPECIFIC_PRODUCTS': return 'Specific products';
    default: return a;
  }
};

function ProductChipList({
  heading,
  items,
  emptyLabel,
}: {
  heading: string;
  items: DiscountProductLink[];
  emptyLabel: string;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {heading}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic' }}>{emptyLabel}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((row) => (
            <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 6, background: '#fff', border: '1px solid #e5e7eb', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {row.product?.images?.[0]?.url ? (
                  <img src={row.product.images[0].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ color: '#d1d5db', fontSize: 14 }}>&#128722;</span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.product?.title || '(removed product)'}
                </div>
                {row.product?.basePrice && (
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{fmt(Number(row.product.basePrice))}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) +
  ' at ' +
  new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/* ────────── order status helpers ────────── */
const orderStatusColor = (status: string): string => {
  switch (status) {
    case 'PLACED': return '#d97706';
    case 'PENDING_VERIFICATION': return '#d97706';
    case 'VERIFIED': return '#2563eb';
    case 'ROUTED_TO_SELLER': return '#7c3aed';
    case 'SELLER_ACCEPTED': return '#16a34a';
    case 'DISPATCHED': return '#0d9488';
    case 'DELIVERED': return '#15803d';
    case 'CANCELLED': return '#dc2626';
    case 'EXCEPTION_QUEUE': return '#dc2626';
    default: return '#6b7280';
  }
};

const orderStatusLabel = (status: string): string => {
  switch (status) {
    case 'PLACED': return 'Placed - Pending Verification';
    case 'PENDING_VERIFICATION': return 'Pending Verification';
    case 'VERIFIED': return 'Verified';
    case 'ROUTED_TO_SELLER': return 'Routed';
    case 'SELLER_ACCEPTED': return 'Seller Accepted';
    case 'DISPATCHED': return 'Dispatched';
    case 'DELIVERED': return 'Delivered';
    case 'CANCELLED': return 'Cancelled';
    case 'EXCEPTION_QUEUE': return 'Exception Queue';
    default: return status;
  }
};

/* ────────── badge components ────────── */
function StatusBadge({ label, variant }: { label: string; variant: 'warning' | 'success' | 'info' | 'danger' | 'neutral' }) {
  const colors: Record<string, { bg: string; fg: string; dot: string }> = {
    warning: { bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' },
    success: { bg: '#dcfce7', fg: '#166534', dot: '#22c55e' },
    info:    { bg: '#ede9fe', fg: '#5b21b6', dot: '#8b5cf6' },
    danger:  { bg: '#fee2e2', fg: '#991b1b', dot: '#ef4444' },
    neutral: { bg: '#f3f4f6', fg: '#374151', dot: '#9ca3af' },
  };
  const c = colors[variant] || colors.neutral;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 12, fontWeight: 600, padding: '4px 10px',
      borderRadius: 6, background: c.bg, color: c.fg,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot }} />
      {label}
    </span>
  );
}

function OrderStatusBanner({ status }: { status: string }) {
  const color = orderStatusColor(status);
  const label = orderStatusLabel(status);
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      fontSize: 14, fontWeight: 700, padding: '6px 16px',
      borderRadius: 8, background: color + '15', color,
      border: `1px solid ${color}30`,
    }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
      {label}
    </div>
  );
}

function paymentBadgeVariant(s: string): 'warning' | 'success' | 'danger' | 'neutral' {
  if (s === 'PAID') return 'success';
  if (s === 'CANCELLED' || s === 'VOIDED') return 'danger';
  return 'warning';
}
function fulfillmentBadgeVariant(s: string): 'success' | 'info' | 'warning' | 'danger' {
  if (s === 'DELIVERED') return 'success';
  if (s === 'SHIPPED') return 'info';
  if (s === 'PACKED') return 'warning';
  if (s === 'CANCELLED') return 'danger';
  return s === 'FULFILLED' ? 'success' : 'info';
}

function fulfillmentLabel(s: string): string {
  if (s === 'DELIVERED') return 'Delivered';
  if (s === 'SHIPPED') return 'Shipped';
  if (s === 'PACKED') return 'Packed';
  if (s === 'FULFILLED') return 'Fulfilled';
  if (s === 'CANCELLED') return 'Cancelled';
  return 'Unfulfilled';
}
function acceptBadgeVariant(s: string): 'success' | 'danger' | 'neutral' {
  if (s === 'ACCEPTED') return 'success';
  if (s === 'REJECTED') return 'danger';
  return 'neutral';
}

/* ────────── order status timeline (Epic 5.3) ────────── */
const ADMIN_TIMELINE_STEPS = [
  { key: 'PLACED', label: 'Placed' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'ROUTED', label: 'Routed' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'PACKED', label: 'Packed' },
  { key: 'SHIPPED', label: 'Shipped' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'PAID', label: 'Paid' },
];

function AdminOrderTimeline({ orderStatus, paymentStatus, fulfillmentStatuses }: {
  orderStatus: string;
  paymentStatus: string;
  fulfillmentStatuses: string[];
}) {
  if (orderStatus === 'CANCELLED') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>X</span>
        </div>
        <span style={{ fontSize: 14, color: '#dc2626', fontWeight: 600 }}>Cancelled</span>
      </div>
    );
  }

  // Determine which step is current
  const isPaid = paymentStatus === 'PAID';
  const allDelivered = fulfillmentStatuses.length > 0 && fulfillmentStatuses.every(s => s === 'DELIVERED');
  const anyShipped = fulfillmentStatuses.some(s => s === 'SHIPPED' || s === 'DELIVERED');
  const anyPacked = fulfillmentStatuses.some(s => s === 'PACKED' || s === 'SHIPPED' || s === 'DELIVERED');

  const getStepIndex = (): number => {
    if (isPaid) return 7;
    if (allDelivered) return 6;
    if (anyShipped) return 5;
    if (anyPacked) return 4;
    if (orderStatus === 'SELLER_ACCEPTED') return 3;
    if (orderStatus === 'ROUTED_TO_SELLER') return 2;
    if (orderStatus === 'VERIFIED') return 1;
    if (orderStatus === 'EXCEPTION_QUEUE') return 1;
    return 0;
  };

  const currentIdx = getStepIndex();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '4px 0', overflowX: 'auto' }}>
      {ADMIN_TIMELINE_STEPS.map((step, idx) => {
        const isCompleted = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isLast = idx === ADMIN_TIMELINE_STEPS.length - 1;
        const color = isCompleted ? '#16a34a' : isCurrent ? '#2563eb' : '#d1d5db';
        const textColor = isCompleted ? '#166534' : isCurrent ? '#1d4ed8' : '#9ca3af';
        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: isLast ? '0 0 auto' : '1 1 0' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 56 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                background: color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: isCurrent ? '2px solid #93c5fd' : 'none',
                transition: 'all 0.3s',
              }}>
                {isCompleted && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>&#10003;</span>}
                {isCurrent && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
              </div>
              <span style={{
                fontSize: 10, color: textColor, fontWeight: isCompleted || isCurrent ? 600 : 400,
                marginTop: 4, textAlign: 'center', whiteSpace: 'nowrap',
              }}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div style={{
                flex: 1, height: 2, minWidth: 16,
                background: idx < currentIdx ? '#16a34a' : '#e5e7eb',
                marginTop: -16, transition: 'background 0.3s',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ────────── page ────────── */
export default function OrderDetailPage() {
  const { notify } = useModal();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [verifyRemarks, setVerifyRemarks] = useState('');
  const [verifySuccess, setVerifySuccess] = useState(false);

  // Reassignment state
  const [reassignSubOrderId, setReassignSubOrderId] = useState<string | null>(null);
  const [eligibleNodes, setEligibleNodes] = useState<EligibleNode[]>([]);
  const [loadingEligible, setLoadingEligible] = useState(false);
  const [reassignReason, setReassignReason] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [reassignError, setReassignError] = useState('');

  const fetchOrder = useCallback(() => {
    apiClient<OrderDetail>(`/admin/orders/${id}`)
      .then((res) => { if (res.data) setOrder(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);

  const handleAction = async (endpoint: string, label: string) => {
    setActionLoading(label);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);
    try {
      await apiClient(endpoint, { method: 'PATCH', signal: abort.signal });
      fetchOrder();
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        void notify('The server took too long to respond. Please refresh and try again.');
      } else {
        void notify(err?.body?.message || err?.message || 'Action failed');
      }
    } finally {
      clearTimeout(timer);
      setActionLoading(null);
    }
  };

  const handleVerifyOrder = async () => {
    setActionLoading('verify');
    setVerifySuccess(false);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);
    try {
      await apiClient(`/admin/orders/${id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ remarks: verifyRemarks || undefined }),
        signal: abort.signal,
      });
      setVerifySuccess(true);
      setVerifyRemarks('');
      fetchOrder();
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        void notify('The server took too long to respond. Please refresh and try again.');
      } else {
        void notify(err?.body?.message || err?.message || 'Failed to verify order');
      }
    } finally {
      clearTimeout(timer);
      setActionLoading(null);
    }
  };

  const openReassignModal = async (subOrderId: string) => {
    setReassignSubOrderId(subOrderId);
    setEligibleNodes([]);
    setReassignReason('');
    setReassignError('');
    setLoadingEligible(true);
    try {
      const res = await apiClient<EligibleNode[]>(`/admin/orders/sub-orders/${subOrderId}/eligible-nodes`);
      if (res.data) setEligibleNodes(res.data);
    } catch (err: any) {
      setReassignError(err?.body?.message || 'Failed to fetch eligible fulfillment nodes');
    } finally {
      setLoadingEligible(false);
    }
  };

  const handleReassign = async (node: EligibleNode) => {
    if (!reassignSubOrderId) return;
    setReassigning(true);
    setReassignError('');
    try {
      await apiClient(`/admin/orders/sub-orders/${reassignSubOrderId}/reassign`, {
        method: 'POST',
        body: JSON.stringify({
          nodeType: node.nodeType,
          nodeId: node.nodeId,
          reason: reassignReason || undefined,
        }),
      });
      setReassignSubOrderId(null);
      setEligibleNodes([]);
      setReassignReason('');
      fetchOrder();
    } catch (err: any) {
      setReassignError(err?.body?.message || 'Reassignment failed');
    } finally {
      setReassigning(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>Loading order...</div>;
  }

  if (!order) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Order not found</h3>
        <Link href="/dashboard/orders" style={{ color: '#2563eb' }}>Back to Orders</Link>
      </div>
    );
  }

  const addr = order.shippingAddressSnapshot;
  // Only consider active (non-rejected) sub-orders for status checks
  const activeSubOrders = order.subOrders.filter((s) => s.acceptStatus !== 'REJECTED');
  const relevantSubOrders = activeSubOrders.length > 0 ? activeSubOrders : order.subOrders;
  const allDelivered = relevantSubOrders.every((s) => s.fulfillmentStatus === 'DELIVERED');
  const allFulfilled = relevantSubOrders.every((s) => s.fulfillmentStatus === 'FULFILLED' || s.fulfillmentStatus === 'DELIVERED');
  const totalItems = relevantSubOrders.reduce((sum, s) => sum + s.items.reduce((a, i) => a + i.quantity, 0), 0);
  const currentStatus = order.orderStatus || (order.verified ? 'VERIFIED' : 'PLACED');
  const isPlaced = currentStatus === 'PLACED' || currentStatus === 'PENDING_VERIFICATION';
  const isExceptionQueue = currentStatus === 'EXCEPTION_QUEUE';
  const discountAmount = Number(order.discountAmount || 0);
  const nominalTotal = Number(order.totalAmount) + discountAmount;
  const hasDiscount = discountAmount > 0;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* -- Header -- */}
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/dashboard/orders"
          style={{ fontSize: 13, color: '#6b7280', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12 }}
        >
          &#8592; Orders
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{order.orderNumber}</h1>
          <OrderStatusBanner status={currentStatus} />
          <StatusBadge label={`Payment ${order.paymentStatus.toLowerCase()}`} variant={paymentBadgeVariant(order.paymentStatus)} />
          <StatusBadge label={allDelivered ? 'Delivered' : allFulfilled ? 'Fulfilled' : 'Unfulfilled'} variant={allFulfilled ? 'success' : 'info'} />
        </div>
        <div style={{ fontSize: 13, color: '#6b7280' }}>{fmtDate(order.createdAt)} from Online Store</div>
      </div>

      {/* -- Order Status Timeline (Epic 5.3) -- */}
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
        padding: '16px 20px', marginBottom: 20, overflowX: 'auto',
      }}>
        <AdminOrderTimeline
          orderStatus={currentStatus}
          paymentStatus={order.paymentStatus}
          fulfillmentStatuses={relevantSubOrders.map(s => s.fulfillmentStatus)}
        />
      </div>

      {/* -- Action Card (Epic 5.1) -- */}
      {(() => {
        const anyShipped = order.subOrders.some(s => s.fulfillmentStatus === 'SHIPPED');
        if (currentStatus === 'PLACED' || currentStatus === 'PENDING_VERIFICATION') {
          return null; /* Verify card is shown below */
        }
        if (currentStatus === 'EXCEPTION_QUEUE') {
          return null; /* Exception banner is shown below */
        }
        if (anyShipped && !allDelivered) {
          return (
            <div style={{
              background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10,
              padding: '16px 20px', marginBottom: 20,
            }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#166534', marginBottom: 4 }}>
                Awaiting Delivery Confirmation
              </div>
              <div style={{ fontSize: 13, color: '#15803d', marginBottom: 12 }}>
                One or more sub-orders have been shipped. Use the &quot;Mark as Delivered&quot; button on each shipped sub-order below to confirm delivery.
              </div>
            </div>
          );
        }
        if (allDelivered && order.paymentStatus === 'PENDING') {
          return (
            <div style={{
              background: '#ede9fe', border: '1px solid #c4b5fd', borderRadius: 10,
              padding: '16px 20px', marginBottom: 20,
            }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#5b21b6', marginBottom: 4 }}>
                Awaiting Payment Confirmation
              </div>
              <div style={{ fontSize: 13, color: '#6d28d9', marginBottom: 12 }}>
                All sub-orders have been delivered. Mark the order as paid to complete it.
              </div>
              <button
                onClick={() => handleAction(`/admin/orders/${order.id}/mark-paid`, 'mark-paid')}
                disabled={!!actionLoading}
                style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, border: 'none', background: '#16a34a', color: '#fff', borderRadius: 8, cursor: 'pointer' }}
              >
                {actionLoading === 'mark-paid' ? 'Updating...' : 'Mark as Paid'}
              </button>
            </div>
          );
        }
        return null;
      })()}

      {/* -- Exception Queue Banner -- */}
      {isExceptionQueue && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10,
          padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>&#9888;</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#991b1b', marginBottom: 4 }}>
                No Eligible Seller Found
              </div>
              <div style={{ fontSize: 13, color: '#7f1d1d' }}>
                This order has been placed in the exception queue. Use the &quot;Reassign Order&quot; button on each sub-order below to manually assign a seller.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* -- Verify Order Card -- */}
      {isPlaced && order.paymentStatus !== 'CANCELLED' && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 10,
          padding: '20px', marginBottom: 20,
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#92400e', marginBottom: 8 }}>
            Verify Order
          </div>
          <div style={{ fontSize: 13, color: '#78350f', marginBottom: 16 }}>
            Please call the customer to verify this order. Once verified, it will be automatically routed to the best eligible seller.
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
              Remarks (optional)
            </label>
            <textarea
              value={verifyRemarks}
              onChange={(e) => setVerifyRemarks(e.target.value)}
              placeholder="e.g. Customer confirmed via phone call..."
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid #fbbf24',
                borderRadius: 8, fontSize: 13, resize: 'vertical', minHeight: 70,
                background: '#fff', boxSizing: 'border-box',
              }}
            />
          </div>

          {verifySuccess && (
            <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 600, marginBottom: 12 }}>
              Order verified and routed successfully!
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleVerifyOrder}
              disabled={!!actionLoading}
              style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, border: 'none', background: '#16a34a', color: '#fff', borderRadius: 8, cursor: 'pointer' }}
            >
              {actionLoading === 'verify' ? 'Verifying & Routing...' : 'Verify & Route'}
            </button>
            <button
              onClick={() => handleAction(`/admin/orders/${order.id}/reject-order`, 'reject-order')}
              disabled={!!actionLoading}
              style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, border: 'none', background: '#dc2626', color: '#fff', borderRadius: 8, cursor: 'pointer' }}
            >
              {actionLoading === 'reject-order' ? 'Rejecting...' : 'Reject Order'}
            </button>
          </div>
        </div>
      )}

      {/* -- Verification Info Card -- */}
      {order.verified && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10,
          padding: '14px 20px', marginBottom: 20, fontSize: 13,
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
            <div>
              <span style={{ color: '#166534', fontWeight: 700 }}>Verified</span>
              {order.verifiedAt && (
                <span style={{ color: '#15803d', marginLeft: 8 }}>on {fmtDate(order.verifiedAt)}</span>
              )}
            </div>
            {order.verifiedBy && (
              <div style={{ color: '#15803d' }}>
                <span style={{ fontWeight: 600 }}>By:</span> {order.verifiedBy}
              </div>
            )}
            {order.verificationRemarks && (
              <div style={{ color: '#15803d' }}>
                <span style={{ fontWeight: 600 }}>Remarks:</span> {order.verificationRemarks}
              </div>
            )}
          </div>
        </div>
      )}

      {/* -- Two-column layout -- */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* -- LEFT COLUMN -- */}
        <div style={{ flex: '1 1 620px', minWidth: 0 }}>

          {/* -- Sub-order cards (active sub-orders only) -- */}
          {relevantSubOrders.map((so) => (
            <div key={so.id} style={cardStyle}>
              {/* Card header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <StatusBadge
                  label={fulfillmentLabel(so.fulfillmentStatus)}
                  variant={fulfillmentBadgeVariant(so.fulfillmentStatus)}
                />
                <StatusBadge
                  label={so.acceptStatus}
                  variant={acceptBadgeVariant(so.acceptStatus)}
                />
              </div>

              {/* Assignee + shipping info — show whichever fulfillment node owns this sub-order. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#f9fafb', borderRadius: 8, marginBottom: 14, fontSize: 13, color: '#374151' }}>
                <span>&#128666;</span>
                <span>Free Shipping</span>
                {so.franchise ? (
                  <span style={{ marginLeft: 'auto', fontWeight: 500, color: '#6b7280', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      display: 'inline-block', padding: '1px 8px', fontSize: 10, fontWeight: 700,
                      borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
                      background: '#ecfeff', color: '#0e7490',
                    }}>Franchise</span>
                    {so.franchise.businessName}
                  </span>
                ) : so.seller ? (
                  <span style={{ marginLeft: 'auto', fontWeight: 500, color: '#6b7280', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      display: 'inline-block', padding: '1px 8px', fontSize: 10, fontWeight: 700,
                      borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
                      background: '#eef2ff', color: '#4338ca',
                    }}>Seller</span>
                    {so.seller.sellerShopName}
                  </span>
                ) : (
                  <span style={{ marginLeft: 'auto', fontWeight: 500, color: '#9ca3af', fontStyle: 'italic' }}>
                    Unassigned
                  </span>
                )}
              </div>

              {/* Accept deadline info */}
              {so.acceptDeadline && so.acceptStatus === 'OPEN' && (
                <div style={{ fontSize: 12, color: '#d97706', fontWeight: 500, marginBottom: 10, padding: '6px 12px', background: '#fffbeb', borderRadius: 6, border: '1px solid #fde68a' }}>
                  Accept deadline: {fmtDate(so.acceptDeadline)}
                </div>
              )}

              {/* Reassign button — show when order is ROUTED_TO_SELLER, SELLER_ACCEPTED, or EXCEPTION_QUEUE */}
              {(currentStatus === 'ROUTED_TO_SELLER' || currentStatus === 'SELLER_ACCEPTED' || currentStatus === 'EXCEPTION_QUEUE') &&
                (so.acceptStatus === 'OPEN' || so.acceptStatus === 'REJECTED') &&
                so.fulfillmentStatus !== 'DELIVERED' && so.fulfillmentStatus !== 'CANCELLED' && (
                <div style={{ marginBottom: 12 }}>
                  <button
                    onClick={() => openReassignModal(so.id)}
                    disabled={!!actionLoading || reassigning}
                    style={{
                      padding: '8px 16px', fontSize: 13, fontWeight: 600,
                      border: '1px solid #7c3aed', background: '#f5f3ff',
                      color: '#7c3aed', borderRadius: 8, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    &#8634; Reassign Order
                  </button>
                </div>
              )}

              {/* Line items */}
              {so.items.map((item) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: '1px solid #f3f4f6' }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 8, background: '#f3f4f6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden', flexShrink: 0, border: '1px solid #e5e7eb',
                  }}>
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 20, color: '#d1d5db' }}>&#128722;</span>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#111' }}>{item.productTitle}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {item.variantTitle && <span>{item.variantTitle}</span>}
                      {item.variantTitle && item.sku && <span> &middot; </span>}
                      {item.sku && <span>{item.sku}</span>}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', fontSize: 14, whiteSpace: 'nowrap', color: '#374151' }}>
                    {fmt(Number(item.unitPrice))} &times; {item.quantity}
                  </div>

                  <div style={{ fontWeight: 600, fontSize: 14, minWidth: 90, textAlign: 'right' }}>
                    {fmt(Number(item.totalPrice))}
                  </div>
                </div>
              ))}

              {/* Fulfillment / Accept actions (only after verification) */}
              {order.verified && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #f3f4f6', flexWrap: 'wrap', alignItems: 'center' }}>
                  {so.acceptStatus === 'OPEN' && (
                    <>
                      <button
                        onClick={() => handleAction(`/admin/orders/sub-orders/${so.id}/accept`, `accept-${so.id}`)}
                        disabled={!!actionLoading}
                        style={btnOutline}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleAction(`/admin/orders/sub-orders/${so.id}/reject`, `reject-${so.id}`)}
                        disabled={!!actionLoading}
                        style={{ ...btnOutline, color: '#dc2626', borderColor: '#fca5a5' }}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {so.fulfillmentStatus === 'UNFULFILLED' && so.acceptStatus === 'ACCEPTED' && (
                    <span style={{ fontSize: 12, color: '#6b7280' }}>Awaiting seller to pack</span>
                  )}
                  {so.fulfillmentStatus === 'PACKED' && so.acceptStatus === 'ACCEPTED' && (
                    <span style={{ fontSize: 12, color: '#d97706', fontWeight: 500 }}>Packed - Awaiting shipment by seller</span>
                  )}
                  {so.fulfillmentStatus === 'SHIPPED' && so.acceptStatus === 'ACCEPTED' && (
                    <button
                      onClick={() => handleAction(`/admin/orders/sub-orders/${so.id}/deliver`, `deliver-${so.id}`)}
                      disabled={!!actionLoading}
                      style={{ ...btnDark, background: '#16a34a' }}
                    >
                      {actionLoading === `deliver-${so.id}` ? 'Updating...' : 'Mark as Delivered'}
                    </button>
                  )}
                  {so.fulfillmentStatus === 'DELIVERED' && (
                    <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 500 }}>&#10003; Delivered</span>
                  )}
                </div>
              )}
              {!order.verified && order.paymentStatus !== 'CANCELLED' && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f3f4f6', fontSize: 12, color: '#f59e0b', fontWeight: 500 }}>
                  Verify this order to enable actions
                </div>
              )}

              {/* Delivery & Commission Info */}
              {so.fulfillmentStatus === 'DELIVERED' && (
                <DeliveryInfoCard subOrder={so} onRefresh={fetchOrder} />
              )}
            </div>
          ))}

          {/* -- Payment card -- */}
          <div style={cardStyle}>
            <div style={{ marginBottom: 16 }}>
              <StatusBadge label={`Payment ${order.paymentStatus.toLowerCase()}`} variant={paymentBadgeVariant(order.paymentStatus)} />
            </div>

            <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={payTd}>Subtotal</td>
                  <td style={payTdRight}>{totalItems} item{totalItems !== 1 ? 's' : ''}</td>
                  <td style={{ ...payTdRight, fontWeight: 600 }}>{fmt(nominalTotal)}</td>
                </tr>
                <tr>
                  <td style={payTd}>Shipping</td>
                  <td style={payTdRight}>Free Shipping</td>
                  <td style={{ ...payTdRight, fontWeight: 600 }}>{fmt(0)}</td>
                </tr>
                {hasDiscount && (
                  <tr>
                    <td style={{ ...payTd, color: '#047857' }}>
                      Discount
                      {order.discountCode && (
                        <span style={{
                          marginLeft: 8,
                          padding: '2px 8px',
                          background: '#ecfdf5',
                          border: '1px solid #a7f3d0',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#065f46',
                          letterSpacing: 0.4,
                        }}>{order.discountCode}</span>
                      )}
                    </td>
                    <td style={{ ...payTdRight, color: '#6b7280', fontSize: 12 }}>
                      {order.discountCode ? 'Coupon applied' : 'Applied'}
                    </td>
                    <td style={{ ...payTdRight, fontWeight: 600, color: '#047857' }}>
                      -{fmt(discountAmount)}
                    </td>
                  </tr>
                )}
                <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ ...payTd, fontWeight: 700, paddingTop: 12 }}>Total</td>
                  <td style={payTdRight} />
                  <td style={{ ...payTdRight, fontWeight: 700, paddingTop: 12 }}>{fmt(Number(order.totalAmount))}</td>
                </tr>
              </tbody>
            </table>

            <div style={{ borderTop: '1px solid #f3f4f6', marginTop: 14, paddingTop: 14 }}>
              <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td style={payTd}>Paid</td>
                    <td style={{ ...payTdRight, fontWeight: 600 }}>
                      {order.paymentStatus === 'PAID' ? fmt(Number(order.totalAmount)) : fmt(0)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ ...payTd, fontWeight: 700 }}>Balance</td>
                    <td style={{ ...payTdRight, fontWeight: 700 }}>
                      {order.paymentStatus === 'PAID' ? fmt(0) : fmt(Number(order.totalAmount))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Payment actions — only show Mark as Paid when all sub-orders are DELIVERED */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>
              {order.verified && allDelivered && order.paymentStatus !== 'PAID' && order.paymentStatus !== 'CANCELLED' && (
                <button
                  onClick={() => handleAction(`/admin/orders/${order.id}/mark-paid`, 'mark-paid')}
                  disabled={!!actionLoading}
                  style={{ ...btnDark, background: '#16a34a' }}
                >
                  {actionLoading === 'mark-paid' ? 'Updating...' : 'Mark as Paid'}
                </button>
              )}
              {order.verified && !allDelivered && order.paymentStatus !== 'PAID' && order.paymentStatus !== 'CANCELLED' && (
                <span style={{ fontSize: 12, color: '#6b7280' }}>Payment can be marked after all sub-orders are delivered</span>
              )}
              {order.paymentStatus === 'PAID' && (
                <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 500 }}>&#10003; Paid</span>
              )}
              {order.paymentStatus === 'CANCELLED' && (
                <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 500 }}>Order Cancelled</span>
              )}
            </div>
          </div>

          {/* -- Applied Discount (super-admin only breakdown) -- */}
          {order.discount && hasDiscount && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Applied Discount</h3>
                {order.discount.code && (
                  <span style={{
                    padding: '3px 10px',
                    background: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#065f46',
                    letterSpacing: 0.4,
                  }}>{order.discount.code}</span>
                )}
              </div>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px' }}>
                Full breakdown of the coupon applied to this order. Visible only to super-admin.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 8, columnGap: 12, fontSize: 13 }}>
                <div style={{ color: '#6b7280' }}>Type</div>
                <div style={{ fontWeight: 600 }}>{humanizeDiscountType(order.discount.type)}</div>

                <div style={{ color: '#6b7280' }}>Method</div>
                <div>
                  {order.discount.method === 'CODE' ? 'Coupon code (manual)' : 'Automatic'}
                </div>

                {order.discount.type !== 'BUY_X_GET_Y' && (
                  <>
                    <div style={{ color: '#6b7280' }}>Value</div>
                    <div>
                      {order.discount.valueType === 'PERCENTAGE'
                        ? `${Number(order.discount.value)}% off`
                        : `${fmt(Number(order.discount.value))} flat off`}
                    </div>
                  </>
                )}

                {order.discount.type === 'BUY_X_GET_Y' && (
                  <>
                    <div style={{ color: '#6b7280' }}>Buy rule</div>
                    <div>
                      {order.discount.buyType === 'MIN_QUANTITY'
                        ? `Minimum ${Number(order.discount.buyValue)} qty`
                        : `Minimum ₹${Number(order.discount.buyValue).toLocaleString('en-IN')}`}
                      {' of qualifying product(s)'}
                    </div>

                    <div style={{ color: '#6b7280' }}>Get rule</div>
                    <div>
                      {Number(order.discount.getQuantity) || 1} unit(s){' '}
                      {order.discount.getDiscountType === 'FREE'
                        ? 'FREE'
                        : order.discount.getDiscountType === 'PERCENTAGE'
                        ? `at ${Number(order.discount.getDiscountValue)}% off`
                        : `with ₹${Number(order.discount.getDiscountValue)} off each`}
                    </div>
                  </>
                )}

                <div style={{ color: '#6b7280' }}>Applies to</div>
                <div>{humanizeAppliesTo(order.discount.appliesTo)}</div>

                <div style={{ color: '#6b7280' }}>Minimum requirement</div>
                <div>
                  {order.discount.minRequirement === 'NONE'
                    ? 'None'
                    : order.discount.minRequirement === 'MIN_PURCHASE_AMOUNT'
                    ? `Cart ≥ ₹${Number(order.discount.minRequirementValue || 0).toLocaleString('en-IN')}`
                    : `Cart ≥ ${Number(order.discount.minRequirementValue || 0)} items`}
                </div>

                <div style={{ color: '#6b7280' }}>Usage limit</div>
                <div>
                  {order.discount.maxUses
                    ? `${order.discount.usedCount} / ${order.discount.maxUses} uses`
                    : `${order.discount.usedCount} uses (unlimited)`}
                  {order.discount.onePerCustomer && ' · one per customer'}
                </div>

                <div style={{ color: '#6b7280' }}>Active window</div>
                <div>
                  {fmtDate(order.discount.startsAt)}
                  {order.discount.endsAt ? ` → ${fmtDate(order.discount.endsAt)}` : ' (no end date)'}
                </div>
              </div>

              {/* Qualifying products */}
              {order.discount.type === 'BUY_X_GET_Y' && (
                <>
                  <ProductChipList
                    heading="Customer buys"
                    items={order.discount.products.filter((p) => p.scope === 'BUY')}
                    emptyLabel="Any product qualifies"
                  />
                  <ProductChipList
                    heading="Customer gets"
                    items={order.discount.products.filter((p) => p.scope === 'GET')}
                    emptyLabel="Any product qualifies"
                  />
                </>
              )}
              {order.discount.type === 'AMOUNT_OFF_PRODUCTS' && (
                <ProductChipList
                  heading="Applies to products"
                  items={order.discount.products.filter((p) => p.scope === 'APPLIES')}
                  emptyLabel="All products"
                />
              )}

              {/* Savings summary */}
              <div style={{
                marginTop: 16,
                padding: '12px 14px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: 12, color: '#065f46', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Customer saved</div>
                  <div style={{ fontSize: 11, color: '#047857' }}>
                    Subtotal {fmt(nominalTotal)} → charged {fmt(Number(order.totalAmount))}
                  </div>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#065f46' }}>
                  -{fmt(discountAmount)}
                </div>
              </div>
            </div>
          )}

          {/* -- Reassignment History -- */}
          {order.reassignmentLogs && order.reassignmentLogs.length > 0 && (
            <div style={cardStyle}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Reassignment History</h3>
              <div style={{ borderLeft: '2px solid #c4b5fd', paddingLeft: 16, marginLeft: 4 }}>
                {order.reassignmentLogs.map((log) => (
                  <div key={log.id} style={{ position: 'relative', paddingBottom: 16, borderBottom: '1px solid #f3f4f6', marginBottom: 12 }}>
                    <div style={{
                      position: 'absolute', left: -22, top: 4,
                      width: 10, height: 10, borderRadius: '50%',
                      background: log.successful ? '#22c55e' : '#ef4444',
                      border: '2px solid #fff',
                    }} />
                    <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                      <span style={{ fontWeight: 600 }}>{log.fromSellerName}</span>
                      <span style={{ color: '#6b7280' }}> → </span>
                      <span style={{ fontWeight: 600 }}>{log.toSellerName}</span>
                      {!log.successful && (
                        <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, marginLeft: 8 }}>FAILED</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {log.reason}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                      {fmtDate(log.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* -- Timeline -- */}
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Timeline</h3>
            <div style={{ borderLeft: '2px solid #e5e7eb', paddingLeft: 20, marginLeft: 6 }}>
              {isExceptionQueue && (
                <TimelineEvent
                  text="Order placed in exception queue - no eligible seller found."
                  time=""
                />
              )}
              {order.subOrders.some((so) => so.commissionProcessed) && (
                <TimelineEvent
                  text="Commission has been processed for this order."
                  time=""
                />
              )}
              {order.subOrders.some((so) => so.fulfillmentStatus === 'DELIVERED') && (
                <TimelineEvent
                  text="Order has been marked as delivered. Return/exchange window started."
                  time={order.subOrders.find((so) => so.deliveredAt)?.deliveredAt ? fmtDate(order.subOrders.find((so) => so.deliveredAt)!.deliveredAt!) : ''}
                />
              )}
              {order.subOrders.some((so) => so.fulfillmentStatus === 'FULFILLED' || so.fulfillmentStatus === 'DELIVERED') && (
                <TimelineEvent text="Order has been fulfilled." time="" />
              )}
              {order.subOrders.some((so) => so.seller) && (
                <TimelineEvent
                  text={`Order routed to seller: ${order.subOrders.find((so) => so.seller)?.seller?.sellerShopName || 'N/A'}`}
                  time=""
                />
              )}
              {order.verified && (
                <TimelineEvent
                  text={`Order verified${order.verificationRemarks ? ` - "${order.verificationRemarks}"` : ''}`}
                  time={order.verifiedAt ? fmtDate(order.verifiedAt) : ''}
                />
              )}
              {order.paymentStatus === 'PAID' && (
                <TimelineEvent
                  text={`Payment of ${fmt(Number(order.totalAmount))} was collected on Cash on Delivery (COD).`}
                  time=""
                />
              )}
              <TimelineEvent
                text={`A ${fmt(Number(order.totalAmount))} INR payment is pending on Cash on Delivery (COD).`}
                time={fmtDate(order.createdAt)}
              />
              <TimelineEvent
                text={`${order.customer.firstName} ${order.customer.lastName} placed this order on Online Store.`}
                time={fmtDate(order.createdAt)}
              />
            </div>
          </div>
        </div>

        {/* -- RIGHT COLUMN (sidebar) -- */}
        <div style={{ flex: '0 0 320px', minWidth: 280 }}>
          {/* Notes */}
          <div style={sideCardStyle}>
            <h3 style={sideTitle}>Notes</h3>
            <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>No notes from customer</p>
          </div>

          {/* Customer */}
          <div style={sideCardStyle}>
            <h3 style={sideTitle}>Customer</h3>
            <div style={{ fontSize: 14 }}>
              <div style={{ fontWeight: 600, color: '#2563eb', marginBottom: 2 }}>
                {order.customer.firstName} {order.customer.lastName}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>1 order</div>
            </div>

            <div style={sideSection}>
              <h4 style={sideSubTitle}>Contact information</h4>
              <div style={{ fontSize: 13 }}>
                <div style={{ color: '#2563eb', marginBottom: 4 }}>{order.customer.email}</div>
                <div style={{ color: '#6b7280' }}>{order.customer.phone || 'No phone number'}</div>
              </div>
            </div>

            <div style={sideSection}>
              <h4 style={sideSubTitle}>Shipping address</h4>
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                {addr.fullName}<br />
                {addr.addressLine1}<br />
                {addr.addressLine2 && <>{addr.addressLine2}<br /></>}
                {addr.postalCode} {addr.city} {addr.state}<br />
                {addr.country || 'India'}<br />
                {addr.phone}
              </div>
            </div>

            <div style={sideSection}>
              <h4 style={sideSubTitle}>Billing address</h4>
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Same as shipping address</p>
            </div>
          </div>

          {/* Payment method */}
          <div style={sideCardStyle}>
            <h3 style={sideTitle}>Payment method</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <span style={{ fontSize: 18 }}>&#128176;</span>
              <div>
                <div style={{ fontWeight: 600 }}>Cash on Delivery</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Customer pays on delivery</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Reassignment Modal ── */}
      {reassignSubOrderId && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => { if (!reassigning) { setReassignSubOrderId(null); setEligibleNodes([]); setReassignError(''); } }}>
          <div
            style={{
              background: '#fff', borderRadius: 16, padding: 28,
              width: '100%', maxWidth: 760, maxHeight: '80vh',
              overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Reassign Sub-Order</h2>
              <button
                onClick={() => { if (!reassigning) { setReassignSubOrderId(null); setEligibleNodes([]); setReassignError(''); } }}
                style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6b7280', padding: 4 }}
              >
                &#10005;
              </button>
            </div>

            {/* Reason input */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                Reason for reassignment (optional)
              </label>
              <input
                type="text"
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
                placeholder="e.g. Seller out of stock, faster delivery needed..."
                style={{
                  width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
                  borderRadius: 8, fontSize: 13, boxSizing: 'border-box',
                }}
              />
            </div>

            {reassignError && (
              <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, marginBottom: 16, fontSize: 13, color: '#991b1b' }}>
                {reassignError}
              </div>
            )}

            {loadingEligible ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Loading eligible fulfillment nodes...</div>
            ) : eligibleNodes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>&#128683;</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>No eligible nodes found</div>
                <div style={{ fontSize: 13 }}>No other sellers or franchises can fulfill this order at this time.</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                  {eligibleNodes.length} eligible node{eligibleNodes.length !== 1 ? 's' : ''} found (sellers + franchises), ranked by allocation score:
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, fontSize: 11, color: '#6b7280', textTransform: 'uppercase' }}>Rank</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, fontSize: 11, color: '#6b7280', textTransform: 'uppercase' }}>Type</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, fontSize: 11, color: '#6b7280', textTransform: 'uppercase' }}>Name</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, fontSize: 11, color: '#6b7280', textTransform: 'uppercase' }}>Distance</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, fontSize: 11, color: '#6b7280', textTransform: 'uppercase' }}>Dispatch SLA</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, fontSize: 11, color: '#6b7280', textTransform: 'uppercase' }}>Stock</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, fontSize: 11, color: '#6b7280', textTransform: 'uppercase' }}>Score</th>
                      <th style={{ padding: '8px 10px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligibleNodes.map((node, idx) => {
                      const isFranchise = node.nodeType === 'FRANCHISE';
                      return (
                        <tr key={`${node.nodeType}:${node.nodeId}`} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px' }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 24, height: 24, borderRadius: '50%', fontSize: 12, fontWeight: 700,
                              background: idx === 0 ? '#dcfce7' : '#f3f4f6',
                              color: idx === 0 ? '#166534' : '#374151',
                            }}>
                              {idx + 1}
                            </span>
                          </td>
                          <td style={{ padding: '10px' }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', fontSize: 11, fontWeight: 700,
                              borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
                              background: isFranchise ? '#ecfeff' : '#eef2ff',
                              color: isFranchise ? '#0e7490' : '#4338ca',
                            }}>
                              {isFranchise ? 'Franchise' : 'Seller'}
                            </span>
                          </td>
                          <td style={{ padding: '10px' }}>
                            <div style={{ fontWeight: 600, color: '#111' }}>{node.name}</div>
                          </td>
                          <td style={{ padding: '10px', textAlign: 'right', color: '#374151' }}>{node.distanceKm} km</td>
                          <td style={{ padding: '10px', textAlign: 'right', color: '#374151' }}>{node.dispatchSla} day{node.dispatchSla !== 1 ? 's' : ''}</td>
                          <td style={{ padding: '10px', textAlign: 'right', color: '#374151' }}>{node.availableStock}</td>
                          <td style={{ padding: '10px', textAlign: 'right' }}>
                            <span style={{
                              fontWeight: 700, fontSize: 12, padding: '2px 8px', borderRadius: 4,
                              background: node.score >= 0.7 ? '#dcfce7' : node.score >= 0.4 ? '#fef3c7' : '#fee2e2',
                              color: node.score >= 0.7 ? '#166534' : node.score >= 0.4 ? '#92400e' : '#991b1b',
                            }}>
                              {(node.score * 100).toFixed(0)}%
                            </span>
                          </td>
                          <td style={{ padding: '10px', textAlign: 'right' }}>
                            <button
                              onClick={() => handleReassign(node)}
                              disabled={reassigning}
                              style={{
                                padding: '6px 14px', fontSize: 12, fontWeight: 700,
                                border: 'none', borderRadius: 6, cursor: 'pointer',
                                background: idx === 0 ? '#7c3aed' : '#111',
                                color: '#fff',
                              }}
                            >
                              {reassigning ? '...' : 'Reassign'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────── delivery info card ────────── */
function DeliveryInfoCard({ subOrder, onRefresh }: { subOrder: SubOrder; onRefresh: () => void }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
      // Auto-refresh when return window expires to pick up commission
      if (subOrder.returnWindowEndsAt && !subOrder.commissionProcessed) {
        const ends = new Date(subOrder.returnWindowEndsAt);
        if (new Date() >= ends) onRefresh();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [subOrder.returnWindowEndsAt, subOrder.commissionProcessed, onRefresh]);

  const returnWindowEnds = subOrder.returnWindowEndsAt ? new Date(subOrder.returnWindowEndsAt) : null;
  const returnWindowActive = returnWindowEnds ? now < returnWindowEnds : false;
  const remainingMs = returnWindowEnds ? Math.max(0, returnWindowEnds.getTime() - now.getTime()) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);

  const totalSellerEarning = (subOrder.commissionRecords || []).reduce((a, c) => a + Number(c.productEarning), 0);
  const totalCommission = (subOrder.commissionRecords || []).reduce((a, c) => a + Number(c.totalCommission), 0);

  return (
    <div style={{ marginTop: 14, padding: 14, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#374151' }}>Delivery & Commission Status</div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, color: '#374151', marginBottom: 10 }}>
        <div>
          <span style={{ color: '#6b7280', fontWeight: 500 }}>Delivered at: </span>
          <span style={{ fontWeight: 600 }}>
            {subOrder.deliveredAt ? fmtDate(subOrder.deliveredAt) : '-'}
          </span>
        </div>
        <div>
          <span style={{ color: '#6b7280', fontWeight: 500 }}>Return window: </span>
          {returnWindowActive ? (
            <span style={{ fontWeight: 600, color: '#f59e0b' }}>
              {remainingSec}s remaining
            </span>
          ) : (
            <span style={{ fontWeight: 600, color: '#16a34a' }}>Expired</span>
          )}
        </div>
      </div>

      {/* Commission status */}
      {subOrder.commissionProcessed && subOrder.commissionRecords?.length > 0 ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', marginBottom: 8 }}>
            Commission Processed
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Product</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Rate</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Commission</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Seller Earning</th>
              </tr>
            </thead>
            <tbody>
              {subOrder.commissionRecords.map((cr) => (
                <tr key={cr.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 8px', color: '#374151' }}>{cr.productTitle}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: '#6b7280' }}>{cr.commissionRate}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>{fmt(Number(cr.totalCommission))}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>{fmt(Number(cr.productEarning))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                <td style={{ padding: '8px', fontWeight: 700, color: '#111' }} colSpan={2}>Total</td>
                <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{fmt(totalCommission)}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmt(totalSellerEarning)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : returnWindowActive ? (
        <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 500 }}>
          Commission will be processed after return window expires ({remainingSec}s)
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>
          Processing commission...
        </div>
      )}
    </div>
  );
}

/* ────────── timeline event ────────── */
function TimelineEvent({ text, time }: { text: string; time: string }) {
  return (
    <div style={{ position: 'relative', paddingBottom: 18 }}>
      <div style={{
        position: 'absolute', left: -26, top: 4,
        width: 10, height: 10, borderRadius: '50%',
        background: '#d1d5db', border: '2px solid #fff',
      }} />
      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{text}</div>
      {time && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{time}</div>}
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

const sideTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  marginBottom: 10,
  margin: '0 0 10px 0',
};

const sideSubTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  margin: '0 0 6px 0',
};

const sideSection: React.CSSProperties = {
  borderTop: '1px solid #f3f4f6',
  marginTop: 14,
  paddingTop: 14,
};

const payTd: React.CSSProperties = {
  padding: '6px 0',
  color: '#374151',
};

const payTdRight: React.CSSProperties = {
  padding: '6px 0',
  textAlign: 'right',
  color: '#6b7280',
};

const btnDark: React.CSSProperties = {
  padding: '8px 18px',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  background: '#111',
  color: '#fff',
  borderRadius: 8,
  cursor: 'pointer',
};

const btnOutline: React.CSSProperties = {
  padding: '8px 18px',
  fontSize: 13,
  fontWeight: 600,
  border: '1px solid #d1d5db',
  background: '#fff',
  color: '#374151',
  borderRadius: 8,
  cursor: 'pointer',
};
