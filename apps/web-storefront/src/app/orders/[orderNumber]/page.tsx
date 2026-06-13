'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { apiClient } from '@/lib/api-client';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { useModal } from '@sportsmart/ui';
import { DeliveryMethodBadge } from '@/components/DeliveryMethodBadge';
import { InvoiceDownloadCard } from '@/components/tax/InvoiceDownloadCard';
import type {
  OrderDetail,
  SubOrder,
  ReturnEligibilityResponse,
  ReturnEligibilityItem,
  OrderTimelineEvent,
} from '@/types/order';

/** Subset of the `Return` row shape the listing endpoint returns. */
interface ActiveReturn {
  id: string;
  returnNumber: string;
  status: string;
  masterOrderId: string;
  createdAt: string;
}

/** Statuses that mean "still in flight" — terminal states are excluded. */
const ACTIVE_RETURN_STATUSES = new Set([
  'REQUESTED',
  'APPROVED',
  'PICKUP_SCHEDULED',
  'IN_TRANSIT',
  'RECEIVED',
  'PARTIALLY_APPROVED',
  'QC_APPROVED',
  'REFUND_PROCESSING',
  'REFUNDED', // refund money in flight; not yet COMPLETED
]);

/** Customer-friendly status label. Mirrors the admin labels but in
 *  storefront tone. */
const RETURN_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Pending review',
  APPROVED: 'Approved — awaiting pickup',
  PICKUP_SCHEDULED: 'Pickup scheduled',
  IN_TRANSIT: 'In transit to warehouse',
  RECEIVED: 'Received — under inspection',
  PARTIALLY_APPROVED: 'Inspection complete (partial)',
  QC_APPROVED: 'Inspection passed — refund queued',
  REFUND_PROCESSING: 'Refund being processed',
  REFUNDED: 'Refunded',
};

/**
 * Build a best-effort direct-tracking URL for common Indian carriers plus
 * Shiprocket's universal tracker. Falls back to the Shiprocket URL which
 * accepts any AWB, so the link is always usable even for uncommon couriers.
 */
function courierTrackingUrl(
  carrier: string | null | undefined,
  awb: string,
): string {
  const c = (carrier ?? '').toLowerCase();
  const a = encodeURIComponent(awb);
  if (c.includes('bluedart')) return `https://www.bluedart.com/tracking?trackingNumber=${a}`;
  if (c.includes('delhivery')) return `https://www.delhivery.com/track/package/${a}`;
  if (c.includes('dtdc')) return `https://www.dtdc.in/tracking.asp?strCnno=${a}`;
  if (c.includes('ekart')) return `https://ekartlogistics.com/shipmenttrack/${a}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${a}`;
  if (c.includes('ecom')) return `https://ecomexpress.in/tracking/?awb_field=${a}`;
  if (c.includes('xpressbees')) return `https://www.xpressbees.com/track?awb=${a}`;
  if (c.includes('india post') || c.includes('speedpost'))
    return `https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?ID=${a}`;
  // Shiprocket accepts any AWB as a fallback
  return `https://www.shiprocket.in/shipment-tracking/?awb=${a}`;
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

// 5-step customer progress: Order Placed -> Confirmed -> Shipped -> Delivered -> Completed
const ORDER_PROGRESS_STEPS = [
  { key: 'PLACED', label: 'Order Placed' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'SHIPPED', label: 'Shipped' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'COMPLETED', label: 'Completed' },
];

const orderStatusToStepIndex = (status: string, paymentStatus?: string): number => {
  // NOTE: payment being PAID does NOT advance the fulfillment progress. The
  // pre-fix `if (paymentStatus === 'PAID') return 4` jumped every paid order
  // straight to "Completed" — invisible for COD (paid only at delivery) but
  // wrong for ONLINE orders (paid at placement), making a just-placed order
  // show as Delivered/Completed before the admin even verified it. The order's
  // own lifecycle drives the steps; "Completed" = Delivered AND Paid.
  switch (status) {
    case 'PLACED': return 0;
    case 'PENDING_VERIFICATION': return 0;
    case 'VERIFIED': return 1;
    case 'ROUTED_TO_SELLER': return 1;
    case 'SELLER_ACCEPTED': return 1;
    case 'PACKED': return 1;
    case 'SHIPPED': return 2;
    case 'DISPATCHED': return 2;
    case 'DELIVERED': return paymentStatus === 'PAID' ? 4 : 3;
    case 'COMPLETED': return 4;
    case 'CANCELLED': return -1;
    case 'EXCEPTION_QUEUE': return 0;
    default: return 0;
  }
};

const fulfillmentToStepIndex = (status: string, paymentStatus?: string): number => {
  // Same fix as orderStatusToStepIndex — PAID alone must not complete the bar.
  switch (status) {
    case 'DELIVERED': return paymentStatus === 'PAID' ? 4 : 3;
    case 'FULFILLED': return 2;
    case 'SHIPPED': return 2;
    case 'PACKED': return 1;
    case 'CANCELLED': return -1;
    default: return 0;
  }
};

// Per-sub-order step index for the SHARED 5-step bar
// [Placed, Confirmed, Shipped, Delivered, Completed]. Used to render an
// INDEPENDENT progress bar per shipment on multi-seller orders, where the
// rolled-up master status (e.g. PARTIALLY_SHIPPED) can't faithfully represent
// "racket shipped, bat still being prepared". An accepted-but-unpacked item
// sits at "Confirmed"; PACKED also shows as Confirmed (there's no Packed step
// in the buyer bar — packing is internal).
const subOrderStepIndex = (so: SubOrder, paymentStatus?: string): number => {
  switch (so.fulfillmentStatus) {
    case 'DELIVERED': return paymentStatus === 'PAID' ? 4 : 3;
    case 'FULFILLED': return 2;
    case 'SHIPPED': return 2;
    case 'PACKED': return 1;
    case 'CANCELLED': return -1;
    default: return so.acceptStatus === 'ACCEPTED' ? 1 : 0;
  }
};

const fulfillmentLabel = (status: string, paymentStatus?: string) => {
  if (paymentStatus === 'PAID' && status === 'DELIVERED') return 'Completed';
  switch (status) {
    case 'DELIVERED': return 'Delivered';
    case 'SHIPPED': return 'Shipped';
    case 'PACKED': return 'Packed & Ready';
    case 'FULFILLED': return 'Shipped';
    case 'CANCELLED': return 'Cancelled';
    default: return 'Processing';
  }
};

const fulfillmentColor = (status: string, paymentStatus?: string) => {
  if (paymentStatus === 'PAID') return '#16a34a';
  switch (status) {
    case 'DELIVERED': return '#16a34a';
    case 'SHIPPED': return '#2563eb';
    case 'PACKED': return '#d97706';
    case 'FULFILLED': return '#7c3aed';
    case 'CANCELLED': return '#dc2626';
    default: return '#6366f1';
  }
};

// Maps timeline event kinds to a small icon name + accent colour.
// Kept inline so the entire vertical-bar timeline is self-contained.
type TimelineIcon = 'pencil' | 'check' | 'arrow-up-right' | 'x' | 'dot';
const TIMELINE_KIND_STYLE: Record<string, { icon: TimelineIcon; color: string }> = {
  ORDER_PLACED: { icon: 'pencil', color: '#2563eb' },
  ORDER_VERIFIED: { icon: 'check', color: '#0d9488' },
  TRACKING_UPDATED: { icon: 'arrow-up-right', color: '#7c3aed' },
  SHIPMENT_DELIVERED: { icon: 'check', color: '#16a34a' },
  ORDER_CANCELLED: { icon: 'x', color: '#dc2626' },
};

function TimelineIconSvg({ name }: { name: TimelineIcon }) {
  const p = {
    width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2.5,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'pencil':         return (<svg {...p}><path d="m12 20 9-9-3-3-9 9-1 4z" /></svg>);
    case 'check':          return (<svg {...p}><path d="m5 12 5 5 9-11" /></svg>);
    case 'arrow-up-right': return (<svg {...p}><path d="M7 17 17 7M9 7h8v8" /></svg>);
    case 'x':              return (<svg {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>);
    case 'dot':            return (<svg {...p}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>);
  }
}

function OrderTimeline({ events }: { events: OrderTimelineEvent[] }) {
  if (!events || events.length === 0) return null;
  const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {events.map((ev, idx) => {
        const style = TIMELINE_KIND_STYLE[ev.kind] ?? { icon: 'dot' as TimelineIcon, color: '#6b7280' };
        const isLast = idx === events.length - 1;
        return (
          <li key={`${ev.kind}-${ev.at}-${ev.subOrderId ?? ''}`} style={{ position: 'relative', paddingLeft: 28, paddingBottom: isLast ? 0 : 18 }}>
            {!isLast && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 9,
                  top: 20,
                  bottom: -2,
                  width: 2,
                  background: '#e5e7eb',
                }}
              />
            )}
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: style.color,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TimelineIconSvg name={style.icon} />
            </span>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{ev.label}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              {formatWhen(ev.at)}
              {ev.subOrderId && <span style={{ marginLeft: 6, color: '#9ca3af' }}>· shipment</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// Formats "X hr Y min" or "X min" relative to now. Returns null when the
// deadline has already passed — caller shows a different label in that case.
function formatCountdown(iso: string): string | null {
  const deltaMs = new Date(iso).getTime() - Date.now();
  if (deltaMs <= 0) return null;
  const totalMin = Math.round(deltaMs / 60000);
  if (totalMin < 60) return `${totalMin} min left`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 24) return mins === 0 ? `${hours} hr left` : `${hours} hr ${mins} min left`;
  const days = Math.floor(hours / 24);
  const remHr = hours % 24;
  return remHr === 0 ? `${days} d left` : `${days} d ${remHr} hr left`;
}

function OrderProgressTracker({ orderStatus, fulfillmentStatus, paymentStatus, currentIdxOverride }: { orderStatus?: string; fulfillmentStatus: string; paymentStatus?: string; currentIdxOverride?: number }) {
  const isCancelled = orderStatus === 'CANCELLED' || fulfillmentStatus === 'CANCELLED';
  if (isCancelled) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>X</span>
        </div>
        <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>Cancelled</span>
      </div>
    );
  }

  const currentIdx =
    currentIdxOverride ??
    (orderStatus
      ? orderStatusToStepIndex(orderStatus, paymentStatus)
      : fulfillmentToStepIndex(fulfillmentStatus, paymentStatus));

  const activeColor = paymentStatus === 'PAID' ? '#16a34a' : (orderStatus ? orderStatusColor(orderStatus, paymentStatus) : '#6366f1');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '16px 0', overflowX: 'auto' }}>
      {ORDER_PROGRESS_STEPS.map((step, idx) => {
        const isActive = idx <= currentIdx;
        const isLast = idx === ORDER_PROGRESS_STEPS.length - 1;
        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: isLast ? '0 0 auto' : '1 1 0' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 60 }}>
              <div style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: isActive ? activeColor : '#e5e7eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.3s',
              }}>
                {isActive && (
                  <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>&#10003;</span>
                )}
              </div>
              <span style={{
                fontSize: 10,
                color: isActive ? '#374151' : '#9ca3af',
                fontWeight: isActive ? 600 : 400,
                marginTop: 4,
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div style={{
                flex: 1,
                height: 2,
                background: idx < currentIdx ? activeColor : '#e5e7eb',
                marginTop: -16,
                minWidth: 20,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function OrderDetailPage() {
  const { notify, confirmDialog } = useModal();
const { orderNumber } = useParams<{ orderNumber: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [retryingPayment, setRetryingPayment] = useState(false);
  // Summary of whether the Return Items button should be enabled. Set
  // from the eligibility endpoint after the order loads. When disabled,
  // we also capture a reason so the customer sees *why* (forfeit policy
  // after rejection vs. window expired vs. nothing left to return).
  const [returnEligibility, setReturnEligibility] = useState<{
    enabled: boolean;
    reason: string;
  } | null>(null);
  // In-flight returns for this order. Populated alongside the order
  // fetch so the page can show "View Return RET-…" cards regardless of
  // whether the return-creation window is still open. Without this, a
  // customer who opens the order page after the return window expired
  // sees only the greyed-out "Return Items — Return window has expired"
  // button and has no way to find the return they already filed.
  const [activeReturns, setActiveReturns] = useState<ActiveReturn[] | null>(
    null,
  );

  const fetchOrder = useCallback(() => {
    apiClient<OrderDetail>(`/customer/orders/${orderNumber}`)
      .then((res) => { if (res.data) setOrder(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orderNumber]);

  const authStatus = useAuthGuard();

  useEffect(() => {
    if (authStatus !== 'authed') return;
    fetchOrder();
  }, [authStatus, fetchOrder]);

  // Existing returns for this order. Phase 197 (My-Orders audit #10) —
  // the detail endpoint now EMBEDS the returns scoped to this order, so
  // prefer that (no N+1, no `?limit=50` over-fetch that could miss a
  // return on a heavy account). Fall back to the legacy listing endpoint
  // only when an older API didn't include `order.returns`.
  useEffect(() => {
    if (!order) return;
    if (Array.isArray(order.returns)) {
      const mine: ActiveReturn[] = order.returns
        .filter((r) => ACTIVE_RETURN_STATUSES.has(r.status))
        .map((r) => ({
          id: r.id,
          returnNumber: r.returnNumber ?? '',
          status: r.status,
          masterOrderId: order.id,
          createdAt: r.createdAt,
        }));
      setActiveReturns(mine);
      return;
    }
    // Legacy fallback (server didn't embed returns).
    apiClient<{ returns: ActiveReturn[] }>(`/customer/returns?limit=50`)
      .then((res) => {
        const all = res.data?.returns ?? [];
        const mine = all.filter(
          (r) =>
            r.masterOrderId === order.id &&
            ACTIVE_RETURN_STATUSES.has(r.status),
        );
        setActiveReturns(mine);
      })
      .catch(() => {
        // Failure is non-fatal — the page still renders the order, just
        // without the in-flight return banner. The user can navigate to
        // /returns from the account menu as a fallback.
        setActiveReturns([]);
      });
  }, [order]);

  // Once we have the order + it's delivered, check return eligibility so
  // the Return Items button accurately reflects whether any items can
  // still be returned (window open + not previously rejected).
  useEffect(() => {
    if (!order) return;
    const anyDelivered = order.subOrders.some((so) => so.fulfillmentStatus === 'DELIVERED');
    if (!anyDelivered) {
      setReturnEligibility({ enabled: false, reason: 'Order not delivered yet' });
      return;
    }
    apiClient<ReturnEligibilityResponse>(`/customer/returns/eligibility/${order.id}`)
      .then((res) => {
        const data = res.data;
        if (!data) {
          setReturnEligibility({ enabled: false, reason: 'Unable to check return eligibility' });
          return;
        }
        const allItems: ReturnEligibilityItem[] = (data.eligibleSubOrders ?? []).flatMap(
          (so) => so.items ?? [],
        );
        const anyEligible = allItems.some((i) => i.eligible);
        if (anyEligible) {
          setReturnEligibility({ enabled: true, reason: '' });
          return;
        }
        // Nothing eligible — prefer the most specific reason to show.
        const reasons = new Set(allItems.map((i) => i.ineligibleReason));
        if (reasons.has('PREVIOUSLY_REJECTED')) {
          setReturnEligibility({
            enabled: false,
            reason:
              'A previous return for this order was rejected. Under the forfeit policy you accepted, re-submission is not allowed.',
          });
        } else if (reasons.has('WINDOW_EXPIRED')) {
          setReturnEligibility({ enabled: false, reason: 'Return window has expired' });
        } else if (reasons.has('ALREADY_RETURNED')) {
          setReturnEligibility({ enabled: false, reason: 'All items have already been returned' });
        } else {
          setReturnEligibility({ enabled: false, reason: 'No items eligible for return' });
        }
      })
      .catch(() => {
        // Fail-open: if eligibility check errors, let the dedicated return
        // page handle it (that flow also re-checks on submit).
        setReturnEligibility({ enabled: true, reason: '' });
      });
  }, [order]);

  const handleCancel = async () => {if (!(await confirmDialog('Are you sure you want to cancel this order?'))) return;
    setCancelling(true);
    try {
      const res = await apiClient(`/customer/orders/${orderNumber}/cancel`, { method: 'PATCH' });
      if (res.success) {
        fetchOrder();
      } else {
        void notify(res.message || 'Failed to cancel order');
      }
    } catch {
      void notify('Failed to cancel order');
    } finally {
      setCancelling(false);
    }
  };

  // Story 2.4 — payment retry. Asks the backend to mint a new Razorpay
  // order for this MasterOrder, then opens the Razorpay checkout modal
  // in-page. Success path POSTs to /payment/verify (the modal handler
  // does this — see lib/razorpay.ts).
  const handleRetryPayment = async () => {
    setRetryingPayment(true);
    try {
      // The backend nests the gateway details under `data.payment` with the
      // amount in RUPEES (mirrors placeOrder). Pre-fix this read
      // res.data.razorpayOrderId directly → undefined → the modal never
      // opened (you'd only see the "New payment session created" toast).
      const res = await apiClient<{
        payment?: { razorpayOrderId: string; amount: number; currency: string };
      }>(
        `/customer/checkout/payment/retry`,
        {
          method: 'POST',
          body: JSON.stringify({ orderNumber }),
        },
      );
      const pay = res.data?.payment;
      if (!res.success || !pay?.razorpayOrderId) {
        void notify(res.message || 'Failed to start a new payment session');
        return;
      }
      const { openRazorpayCheckout } = await import('@/lib/razorpay');
      const result = await openRazorpayCheckout({
        razorpayOrderId: pay.razorpayOrderId,
        amountInPaise: Math.round((pay.amount ?? 0) * 100),
        currency: pay.currency || 'INR',
        orderNumber: orderNumber!,
        customerName: order?.shippingAddressSnapshot?.fullName ?? null,
        customerPhone: order?.shippingAddressSnapshot?.phone ?? null,
      });
      if (result.status === 'success') {
        void notify('Payment successful');
        fetchOrder();
      } else if (result.status === 'dismissed') {
        // No-op — customer can hit Retry again. Don't surface a noisy
        // "cancelled" toast because dismissals are routine.
      } else {
        void notify(result.error || 'Payment did not complete');
      }
    } catch (err: any) {
      void notify(err?.message || 'Failed to start a new payment session');
    } finally {
      setRetryingPayment(false);
    }
  };

  const formatPrice = (price: number) => `\u20B9${Number(price).toLocaleString('en-IN')}`;
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const statusBadge = (label: string, color: string) => (
    <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 4, background: color + '20', color }}>{label}</span>
  );

  if (loading) {
    return (<StorefrontShell><div className="products-loading">Loading order...</div></StorefrontShell>);
  }

  if (!order) {
    return (
      <StorefrontShell><div style={{ maxWidth: 800, margin: '0 auto', padding: '60px 16px', textAlign: 'center' }}>
        <h3>Order not found</h3>
        <Link href="/orders" style={{ marginTop: 16, display: 'inline-block' }}>Back to Orders</Link>
      </div></StorefrontShell>
    );
  }

  const addr = order.shippingAddressSnapshot;

  // Only consider active (non-rejected) sub-orders for status
  const activeSubOrders = order.subOrders.filter((so: SubOrder) => so.acceptStatus !== 'REJECTED' && so.fulfillmentStatus !== 'CANCELLED');
  const displaySubOrders = activeSubOrders.length > 0 ? activeSubOrders : order.subOrders;

  // Each sub-order is a distinct seller/fulfilment unit (the split happens by
  // seller at routing), so >1 active sub-order ⇒ items ship from different
  // sellers and progress INDEPENDENTLY. In that case a single rolled-up
  // timeline at the top lies ("racket shipped, bat not"), so we render a
  // per-shipment timeline inside each product group instead. A single
  // sub-order (one seller) keeps the clean single timeline at the top.
  const isMultiShipment = activeSubOrders.length > 1;
  // Order-level events (no subOrderId) are shared by every shipment — they
  // seed each per-shipment timeline before it diverges. Computed once.
  const sharedTimelineEvents = (order.timeline ?? []).filter((e) => !e.subOrderId);

  // "Effectively cancelled" — same shortcut the orders LIST uses: when every
  // sub-order is cancelled/rejected (or the master/payment is cancelled) the
  // order IS cancelled, even if the master orderStatus didn't roll up (e.g. an
  // order force-cancelled while DISPATCHED before the master-FSM fix). Without
  // this the detail page read the raw master status and showed "Shipped" while
  // the list correctly showed "Cancelled".
  const allSubOrdersCancelled =
    order.subOrders.length > 0 &&
    order.subOrders.every(
      (so: SubOrder) => so.fulfillmentStatus === 'CANCELLED' || so.acceptStatus === 'REJECTED',
    );
  const effectiveOrderStatus =
    order.orderStatus === 'CANCELLED' ||
    order.paymentStatus === 'CANCELLED' ||
    allSubOrdersCancelled
      ? 'CANCELLED'
      : order.orderStatus || 'PLACED';

  // Determine if order can be cancelled.
  // Phase 258 — a customer may cancel any order that has NOT yet shipped,
  // INCLUDING paid online orders (the cancel refunds the full amount to the
  // wallet). Pre-fix the `paymentStatus !== 'PAID'` condition hid the button
  // for EVERY online order (which is PAID at placement), so a paid-but-
  // unshipped order could never be cancelled. Shipment/delivery still block it.
  const canCancel = effectiveOrderStatus !== 'CANCELLED' &&
    order.orderStatus !== 'DELIVERED' &&
    !displaySubOrders.some((so: SubOrder) => so.fulfillmentStatus === 'DELIVERED' || so.fulfillmentStatus === 'SHIPPED' || so.fulfillmentStatus === 'FULFILLED');

  // Story 2.4 part 2 — retry-payment surface. ONLINE orders that
  // didn't complete the Razorpay handoff get stuck in
  // PENDING_VERIFICATION. The /customer/checkout/payment/retry
  // endpoint creates a fresh Razorpay order keyed to this MasterOrder
  // so the customer can re-pay without losing the order shell.
  // Phase 197 (My-Orders audit #16) — once the Razorpay payment window
  // (paymentExpiresAt) has elapsed the gateway order is dead and the
  // backend sweep will cancel the order shortly; the Retry CTA must
  // hide so the customer doesn't open a Razorpay modal that 400s.
  const paymentWindowOpen =
    !order.paymentExpiresAt || new Date(order.paymentExpiresAt).getTime() > Date.now();
  const canRetryPayment =
    order.paymentMethod !== 'COD' &&
    order.paymentStatus !== 'PAID' &&
    effectiveOrderStatus !== 'CANCELLED' &&
    paymentWindowOpen;

  // Phase 197 (My-Orders audit #12) — prefer the server-computed,
  // derived `orderStatusLabel` so the storefront and the API never
  // disagree (the backend already rolls sub-order fulfillment into the
  // headline status). Fall back to the local map only for a legacy
  // response that didn't carry the label. The fallback keys off the
  // locally-derived `effectiveOrderStatus` (Delhivery wiring) so a stale
  // master status / fully-cancelled sub-orders still render correctly.
  const displayStatusLabel =
    order.orderStatusLabel ||
    customerStatusLabel(effectiveOrderStatus, order.paymentStatus);
  const displayStatusColor = orderStatusColor(effectiveOrderStatus, order.paymentStatus);

  return (
    <StorefrontShell>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 60px' }}>
        <Link href="/orders" style={{ fontSize: 14, color: '#6b7280', textDecoration: 'none', marginBottom: 16, display: 'inline-block' }}>
          &#8592; Back to Orders
        </Link>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Order {order.orderNumber}</h1>
            <div style={{ fontSize: 13, color: '#6b7280' }}>Placed on {formatDate(order.createdAt)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{formatPrice(Number(order.totalAmount))}</div>
            {order.appliedDiscount && Number(order.appliedDiscount.discountAmount) > 0 && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
                You saved {formatPrice(Number(order.appliedDiscount.discountAmount))}
                {order.appliedDiscount.code ? ` with ${order.appliedDiscount.code}` : ''}
              </div>
            )}
            {order.shipping && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#6b7280' }}>
                Includes {formatPrice(Number(order.shipping.feeInRupees))} shipping
                {order.shipping.optionName ? ` (${order.shipping.optionName})` : ''}
              </div>
            )}
            <div style={{ marginTop: 4, display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {statusBadge(
                order.paymentStatus === 'CANCELLED' ? 'Cancelled' : order.paymentStatus === 'PAID' ? 'Paid' : 'Payment Pending',
                order.paymentStatus === 'CANCELLED' ? '#dc2626' : order.paymentStatus === 'PAID' ? '#16a34a' : '#d97706',
              )}
              {statusBadge(displayStatusLabel, displayStatusColor)}
            </div>
          </div>
        </div>

        {/* Order Progress Tracker. For multi-shipment (multi-seller) orders
            the items progress independently, so a single rolled-up bar is
            misleading — we render a per-shipment bar inside each group below
            instead. Single-shipment orders keep this clean top bar. */}
        {!isMultiShipment && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '8px 16px', marginBottom: 20, background: '#fafafa' }}>
            <OrderProgressTracker
              orderStatus={effectiveOrderStatus}
              paymentStatus={order.paymentStatus}
              fulfillmentStatus={
                displaySubOrders.length > 0
                  ? displaySubOrders.every((so: SubOrder) => so.fulfillmentStatus === 'DELIVERED')
                    ? 'DELIVERED'
                    : displaySubOrders.every((so: SubOrder) => ['FULFILLED', 'DELIVERED'].includes(so.fulfillmentStatus))
                      ? 'FULFILLED'
                      : displaySubOrders.some((so: SubOrder) => so.fulfillmentStatus === 'SHIPPED')
                        ? 'SHIPPED'
                        : displaySubOrders.some((so: SubOrder) => so.fulfillmentStatus === 'PACKED')
                          ? 'PACKED'
                          : 'UNFULFILLED'
                  : 'UNFULFILLED'
              }
            />
          </div>
        )}

        {isMultiShipment && (
          <div style={{ marginBottom: 20, fontSize: 13, color: '#6b7280' }}>
            This order ships in {activeSubOrders.length} separate shipments — each
            has its own progress below.
          </div>
        )}

        {/* Order Timeline — synthesized from row timestamps server-side.
            Single-shipment only: for multi-shipment orders the per-shipment
            timelines (inside each group below) carry the same detail scoped to
            the right parcel, so a combined top timeline would just duplicate. */}
        {!isMultiShipment && order.timeline && order.timeline.length > 0 && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 20, background: '#fff' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#111827' }}>Timeline</h3>
            <OrderTimeline events={order.timeline} />
          </div>
        )}

        {/* Phase 26 GST — per-order tax breakdown. Renders only when
            the order has a non-zero tax snapshot (Phase B allocation
            ran). Customers see CGST/SGST/IGST without needing to
            download the PDF — the inclusive-price model means there
            are no surprises here, this is purely informational. */}
        {order.taxSummary && Number(order.taxSummary.totalTaxInPaise) > 0 && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#111827' }}>
              GST Breakdown
            </h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
              GST is included in the prices shown. The breakdown is
              snapshotted from the tax engine at order time.
            </p>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 16, rowGap: 6, margin: 0, fontSize: 14 }}>
              <dt style={{ color: '#6b7280' }}>Taxable value</dt>
              <dd style={{ textAlign: 'right', margin: 0 }}>
                ₹{(Number(order.taxSummary.taxableInPaise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </dd>
              {Number(order.taxSummary.cgstInPaise) > 0 && (
                <>
                  <dt style={{ color: '#6b7280' }}>CGST</dt>
                  <dd style={{ textAlign: 'right', margin: 0 }}>
                    ₹{(Number(order.taxSummary.cgstInPaise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </dd>
                </>
              )}
              {Number(order.taxSummary.sgstInPaise) > 0 && (
                <>
                  <dt style={{ color: '#6b7280' }}>SGST</dt>
                  <dd style={{ textAlign: 'right', margin: 0 }}>
                    ₹{(Number(order.taxSummary.sgstInPaise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </dd>
                </>
              )}
              {Number(order.taxSummary.igstInPaise) > 0 && (
                <>
                  <dt style={{ color: '#6b7280' }}>IGST</dt>
                  <dd style={{ textAlign: 'right', margin: 0 }}>
                    ₹{(Number(order.taxSummary.igstInPaise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </dd>
                </>
              )}
              <dt style={{ paddingTop: 8, borderTop: '1px solid #f3f4f6', color: '#111827', fontWeight: 600 }}>
                Total GST
              </dt>
              <dd style={{ paddingTop: 8, borderTop: '1px solid #f3f4f6', textAlign: 'right', margin: 0, fontWeight: 600 }}>
                ₹{(Number(order.taxSummary.totalTaxInPaise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </dd>
            </dl>
          </div>
        )}

        {/* Phase 25 — Tax invoice download (Phase 19 PDF + Phase 20 signed URL).
            Self-contained card that lists every tax_documents row for this
            masterOrderId; renders a Download button per row that opens the
            stub-provider's file:// URL (or the real cloud signed URL in prod). */}
        <InvoiceDownloadCard orderId={order.id} />

        {/* Shipping Address */}
        <div style={{ background: '#f9fafb', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Shipping Address</h3>
          <div style={{ fontSize: 14 }}>
            <strong>{addr.fullName}</strong> - {addr.phone}<br />
            {addr.addressLine1}{addr.addressLine2 && `, ${addr.addressLine2}`}<br />
            {addr.city}, {addr.state} - {addr.postalCode}
          </div>
        </div>

        {/* Fulfillment tracking — only show active sub-orders to customer */}
        {order.subOrders.filter((so) => so.acceptStatus !== 'REJECTED' && so.fulfillmentStatus !== 'CANCELLED').map((so) => (
          <div key={so.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#2563eb', fontWeight: 600 }}>
                  Fulfilled by SPORTSMART
                </span>
                {/* Delivery method indicator. */}
                {so.deliveryMethod && (
                  <DeliveryMethodBadge method={so.deliveryMethod} />
                )}
                {so.acceptStatus === 'CANCELLED' && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: '#dc262620', color: '#dc2626' }}>Cancelled</span>
                )}
              </div>
              <span style={{ fontSize: 13, color: '#6b7280' }}>Subtotal: {formatPrice(Number(so.subTotal))}</span>
            </div>

            {/* Per-shipment progress + timeline. Only for multi-shipment
                (multi-seller) orders — each parcel moves on its own schedule,
                so it gets its own bar (scoped via subOrderStepIndex) and its
                own timeline (shared order-level events + this shipment's own
                tracking/delivery events). Single-shipment orders use the top
                bar/timeline instead. */}
            {isMultiShipment && (
              <div style={{ marginTop: 10, marginBottom: 6, padding: '4px 12px', background: '#fafafa', border: '1px solid #f1f5f9', borderRadius: 8 }}>
                <OrderProgressTracker
                  fulfillmentStatus={so.fulfillmentStatus}
                  paymentStatus={order.paymentStatus}
                  currentIdxOverride={subOrderStepIndex(so, order.paymentStatus)}
                />
                {(() => {
                  const events = [
                    ...sharedTimelineEvents,
                    ...(order.timeline ?? []).filter((e) => e.subOrderId === so.id),
                  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
                  return events.length > 0 ? (
                    <div style={{ paddingTop: 4, paddingBottom: 4, borderTop: '1px solid #f1f5f9' }}>
                      <OrderTimeline events={events} />
                    </div>
                  ) : null;
                })()}
              </div>
            )}

            {/* Seller-accept countdown — only meaningful while we're
                still waiting for the seller. Once they accept, the
                fulfillmentStatus advances past PENDING and we hide it. */}
            {so.acceptDeadlineAt &&
              so.acceptStatus === 'PENDING' &&
              !['DELIVERED', 'SHIPPED', 'PACKED', 'FULFILLED', 'CANCELLED'].includes(so.fulfillmentStatus) &&
              (() => {
                const remaining = formatCountdown(so.acceptDeadlineAt);
                const overdue = remaining === null;
                return (
                  <div
                    style={{
                      marginTop: 8,
                      padding: '8px 12px',
                      background: overdue ? '#fef2f2' : '#fffbeb',
                      border: `1px solid ${overdue ? '#fecaca' : '#fde68a'}`,
                      borderRadius: 8,
                      fontSize: 12,
                      color: overdue ? '#991b1b' : '#92400e',
                    }}
                  >
                    {overdue
                      ? 'Seller has missed the accept deadline — order will be re-routed automatically.'
                      : `Awaiting seller acceptance · ${remaining}`}
                  </div>
                );
              })()}

            {/* Last shipment update timestamp — surfaced when we have a
                tracking event but the row hasn't reached DELIVERED yet,
                so customers know when the courier last updated. */}
            {so.lastTrackingEventAt && so.fulfillmentStatus !== 'DELIVERED' && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                Last courier update:{' '}
                <span style={{ color: '#374151', fontWeight: 500 }}>
                  {new Date(so.lastTrackingEventAt).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}

            {/* Shipment tracking — shown once a courier has picked up */}
            {so.trackingNumber && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  marginTop: 8,
                  marginBottom: 4,
                  background: '#ecfeff',
                  border: '1px solid #a5f3fc',
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <span style={{ color: '#0c4a6e', fontWeight: 600 }}>
                  {so.courierName ? `${so.courierName}` : 'Tracking'}
                </span>
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#0f172a' }}>
                  {so.trackingNumber}
                </span>
                <a
                  href={courierTrackingUrl(so.courierName, so.trackingNumber)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    marginLeft: 'auto',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#2563eb',
                    textDecoration: 'none',
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid #bfdbfe',
                    background: '#fff',
                  }}
                >
                  Track shipment &rarr;
                </a>
              </div>
            )}

            {/* Items */}
            {so.items.map((item) => (
              <div key={item.id} style={{ display: 'flex', gap: 12, paddingTop: 10, paddingBottom: 10, borderTop: '1px solid #f3f4f6' }}>
                <div style={{ width: 56, height: 56, borderRadius: 8, background: '#f3f4f6', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e5e7eb' }}>
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: 22, color: '#d1d5db' }}>&#128722;</span>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{item.productTitle}</div>
                  {item.variantTitle && <div style={{ fontSize: 12, color: '#6b7280' }}>{item.variantTitle}</div>}
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    Qty: {item.quantity} x {formatPrice(Number(item.unitPrice))}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    {statusBadge(fulfillmentLabel(so.fulfillmentStatus, order.paymentStatus), fulfillmentColor(so.fulfillmentStatus, order.paymentStatus))}
                  </div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>
                  {formatPrice(Number(item.totalPrice))}
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* In-flight returns — wins over the "file a new return" button when
            present, so the customer always has a path to track an existing
            return even after the return window closes. */}
        {activeReturns && activeReturns.length > 0 && (
          <div style={{ marginTop: 16, padding: 16, border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e3a8a', marginBottom: 8 }}>
              {activeReturns.length === 1 ? 'Return in progress' : 'Returns in progress'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activeReturns.map((r) => (
                <Link
                  key={r.id}
                  href={`/returns/${r.id}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    background: '#fff',
                    border: '1px solid #dbeafe',
                    borderRadius: 8,
                    textDecoration: 'none',
                    color: '#1e3a8a',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.returnNumber}</div>
                    <div style={{ fontSize: 12, color: '#1d4ed8', marginTop: 2 }}>
                      {RETURN_STATUS_LABEL[r.status] ?? r.status}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#1d4ed8' }}>View →</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, padding: '12px 0', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Payment Method: <strong>{order.paymentMethodLabel ?? (order.paymentMethod === 'COD' ? 'Cash on Delivery' : order.paymentMethod)}</strong>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {/* Suppress the "Return Items" CTA when there's already an
                in-flight return for this order — the in-progress card above
                is the right call-to-action in that case. */}
            {(activeReturns?.length ?? 0) === 0 &&
            displaySubOrders.some((so: SubOrder) => so.fulfillmentStatus === 'DELIVERED') && (
              returnEligibility?.enabled ? (
                <Link
                  href={`/orders/${order.orderNumber}/return`}
                  style={{
                    padding: '10px 24px',
                    fontSize: 14,
                    fontWeight: 600,
                    border: '1px solid #2563eb',
                    background: '#fff',
                    color: '#2563eb',
                    borderRadius: 8,
                    textDecoration: 'none',
                  }}
                >
                  Return Items
                </Link>
              ) : returnEligibility ? (
                <span
                  title={returnEligibility.reason}
                  style={{
                    display: 'inline-flex',
                    flexDirection: 'column',
                    padding: '10px 24px',
                    fontSize: 14,
                    fontWeight: 600,
                    border: '1px solid #e5e7eb',
                    background: '#f9fafb',
                    color: '#9ca3af',
                    borderRadius: 8,
                    cursor: 'not-allowed',
                  }}
                >
                  Return Items
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', marginTop: 2 }}>
                    {returnEligibility.reason}
                  </span>
                </span>
              ) : null
            )}
            {canRetryPayment && (
              <button
                onClick={handleRetryPayment}
                disabled={retryingPayment}
                style={{
                  padding: '10px 24px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: '1px solid #16a34a',
                  background: '#16a34a',
                  color: '#fff',
                  borderRadius: 8,
                  cursor: retryingPayment ? 'not-allowed' : 'pointer',
                  opacity: retryingPayment ? 0.7 : 1,
                }}
              >
                {retryingPayment ? 'Starting…' : 'Retry Payment'}
              </button>
            )}
            {canCancel && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                style={{
                  padding: '10px 24px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: '1px solid #dc2626',
                  background: '#fff',
                  color: '#dc2626',
                  borderRadius: 8,
                  cursor: cancelling ? 'not-allowed' : 'pointer',
                  opacity: cancelling ? 0.7 : 1,
                }}
              >
                {cancelling ? 'Cancelling...' : 'Cancel Order'}
              </button>
            )}
            {(order.paymentStatus === 'CANCELLED' || order.orderStatus === 'CANCELLED') && (
              <span style={{ fontSize: 14, fontWeight: 600, color: '#dc2626' }}>Order Cancelled</span>
            )}
          </div>
        </div>
      </div>
    </StorefrontShell>
  );
}
