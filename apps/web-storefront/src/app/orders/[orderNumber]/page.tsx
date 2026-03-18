'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { apiClient } from '@/lib/api-client';

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

interface SubOrder {
  id: string;
  subTotal: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  acceptStatus: string;
  items: OrderItem[];
  seller: { sellerShopName: string } | null;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod: string;
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
  };
  subOrders: SubOrder[];
}

export default function OrderDetailPage() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const fetchOrder = useCallback(() => {
    apiClient<OrderDetail>(`/customer/orders/${orderNumber}`)
      .then((res) => { if (res.data) setOrder(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orderNumber]);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('accessToken')) { router.push('/login'); return; }
    } catch { router.push('/login'); return; }
    fetchOrder();
  }, [fetchOrder]);

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this order?')) return;
    setCancelling(true);
    try {
      const res = await apiClient(`/customer/orders/${orderNumber}/cancel`, { method: 'PATCH' });
      if (res.success) {
        fetchOrder();
      } else {
        alert(res.message || 'Failed to cancel order');
      }
    } catch {
      alert('Failed to cancel order');
    } finally {
      setCancelling(false);
    }
  };

  const formatPrice = (price: number) => `\u20B9${Number(price).toLocaleString('en-IN')}`;
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const statusBadge = (label: string, color: string) => (
    <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 4, background: color + '20', color }}>{label}</span>
  );

  if (loading) {
    return (<><Navbar /><div className="products-loading">Loading order...</div></>);
  }

  if (!order) {
    return (
      <><Navbar /><div style={{ maxWidth: 800, margin: '0 auto', padding: '60px 16px', textAlign: 'center' }}>
        <h3>Order not found</h3>
        <Link href="/orders" style={{ marginTop: 16, display: 'inline-block' }}>Back to Orders</Link>
      </div></>
    );
  }

  const addr = order.shippingAddressSnapshot;

  return (
    <>
      <Navbar />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 60px' }}>
        <Link href="/orders" style={{ fontSize: 14, color: '#6b7280', textDecoration: 'none', marginBottom: 16, display: 'inline-block' }}>
          &#8592; Back to Orders
        </Link>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Order {order.orderNumber}</h1>
            <div style={{ fontSize: 13, color: '#6b7280' }}>Placed on {formatDate(order.createdAt)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{formatPrice(Number(order.totalAmount))}</div>
            <div style={{ marginTop: 4 }}>{statusBadge(order.paymentStatus, '#d97706')}</div>
          </div>
        </div>

        {/* Shipping Address */}
        <div style={{ background: '#f9fafb', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Shipping Address</h3>
          <div style={{ fontSize: 14 }}>
            <strong>{addr.fullName}</strong> - {addr.phone}<br />
            {addr.addressLine1}{addr.addressLine2 && `, ${addr.addressLine2}`}<br />
            {addr.city}, {addr.state} - {addr.postalCode}
          </div>
        </div>

        {/* Sub-orders */}
        {order.subOrders.map((so) => (
          <div key={so.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                {so.seller && <span style={{ fontWeight: 600, fontSize: 14 }}>{so.seller.sellerShopName}</span>}
                <span style={{ fontSize: 13, color: '#6b7280', marginLeft: 8 }}>Subtotal: {formatPrice(Number(so.subTotal))}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {statusBadge(so.fulfillmentStatus, '#6366f1')}
                {statusBadge(so.acceptStatus, so.acceptStatus === 'ACCEPTED' ? '#16a34a' : so.acceptStatus === 'REJECTED' ? '#dc2626' : '#6b7280')}
              </div>
            </div>
            {so.items.map((item) => (
              <div key={item.id} style={{ display: 'flex', gap: 12, paddingTop: 10, paddingBottom: 10, borderTop: '1px solid #f3f4f6' }}>
                <div style={{ width: 50, height: 50, borderRadius: 6, background: '#f3f4f6', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: 20, color: '#d1d5db' }}>&#128722;</span>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{item.productTitle}</div>
                  {item.variantTitle && <div style={{ fontSize: 12, color: '#6b7280' }}>{item.variantTitle}</div>}
                  <div style={{ fontSize: 12, color: '#6b7280' }}>Qty: {item.quantity} x {formatPrice(Number(item.unitPrice))}</div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{formatPrice(Number(item.totalPrice))}</div>
              </div>
            ))}
          </div>
        ))}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Payment Method: <strong>{order.paymentMethod}</strong>
          </div>
          {order.paymentStatus !== 'CANCELLED' &&
            !order.subOrders.some((so) => so.fulfillmentStatus === 'FULFILLED') && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                style={{
                  padding: '10px 24px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: 'none',
                  background: '#dc2626',
                  color: '#fff',
                  borderRadius: 8,
                  cursor: cancelling ? 'not-allowed' : 'pointer',
                  opacity: cancelling ? 0.7 : 1,
                }}
              >
                {cancelling ? 'Cancelling...' : 'Cancel Order'}
              </button>
            )}
          {order.paymentStatus === 'CANCELLED' && (
            <span style={{ fontSize: 14, fontWeight: 600, color: '#dc2626' }}>Order Cancelled</span>
          )}
        </div>
      </div>
    </>
  );
}
