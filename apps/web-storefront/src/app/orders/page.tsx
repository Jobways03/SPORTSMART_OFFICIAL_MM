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
  seller: { sellerShopName: string } | null;
}

interface Order {
  id: string;
  orderNumber: string;
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

export default function OrdersPage() {
  const router = useRouter();
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('accessToken')) { router.push('/login'); return; }
    } catch { router.push('/login'); return; }

    apiClient<OrdersResponse>('/customer/orders')
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, []);

  const formatPrice = (price: number) => `\u20B9${Number(price).toLocaleString('en-IN')}`;
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const statusBadge = (status: string, color: string) => (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: color + '20', color }}>{status}</span>
  );

  if (loading) {
    return (<><Navbar /><div className="products-loading">Loading orders...</div></>);
  }

  return (
    <>
      <Navbar />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 60px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>My Orders</h1>

        {!data || data.orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#128230;</div>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No orders yet</h3>
            <p style={{ color: '#6b7280', marginBottom: 20 }}>Start shopping to see your orders here</p>
            <Link href="/" style={{ display: 'inline-block', padding: '10px 24px', background: '#111', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
              Browse Products
            </Link>
          </div>
        ) : (
          <div>
            {data.orders.map((order) => (
              <Link
                key={order.id}
                href={`/orders/${order.orderNumber}`}
                style={{ display: 'block', textDecoration: 'none', color: 'inherit', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, marginBottom: 12, transition: 'border-color 0.15s', }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{order.orderNumber}</span>
                    <span style={{ color: '#6b7280', fontSize: 13, marginLeft: 12 }}>{formatDate(order.createdAt)}</span>
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{formatPrice(Number(order.totalAmount))}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {statusBadge(order.paymentStatus, '#d97706')}
                  {order.subOrders.map((so) => (
                    <span key={so.id}>
                      {statusBadge(so.fulfillmentStatus, '#6366f1')}
                      {statusBadge(so.acceptStatus, so.acceptStatus === 'ACCEPTED' ? '#16a34a' : so.acceptStatus === 'REJECTED' ? '#dc2626' : '#6b7280')}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  {order.itemCount} item{order.itemCount !== 1 ? 's' : ''} | {order.paymentMethod}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
