'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import { apiClient } from '@/lib/api-client';
import {
  approveOrder,
  getRiskInfo,
  rejectOrder,
  releaseClaim,
  RiskInfo,
} from '@/services/admin-verification.service';
import { RiskBadge } from '@/components/RiskBadge';

interface OrderItem {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  masterSku: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
}

interface SubOrder {
  id: string;
  subTotal: number;
  fulfillmentNodeType?: string;
  items: OrderItem[];
  seller: { sellerShopName: string } | null;
  franchise?: { businessName: string } | null;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  orderStatus: string;
  totalAmount: number;
  discountAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  itemCount: number;
  createdAt: string;
  claimedByAdminId?: string | null;
  claimExpiresAt?: string | null;
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
    phone: string;
  };
  subOrders: SubOrder[];
}

export default function VerificationDetailPage() {
  const { confirmDialog } = useModal();
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [risk, setRisk] = useState<RiskInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState<null | 'approve' | 'reject' | 'release'>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [orderRes, riskRes] = await Promise.all([
        apiClient<OrderDetail>(`/admin/orders/${id}`),
        getRiskInfo(id).catch(() => null),
      ]);
      if (orderRes.data) setOrder(orderRes.data);
      if (riskRes?.data) setRisk(riskRes.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load order');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async () => {
    if (submitting) return;
    setSubmitting('approve');
    setError(null);
    try {
      await approveOrder(id, remarks || undefined);
      router.push('/dashboard/verification');
    } catch (err: any) {
      setError(err?.message || 'Approve failed');
      setSubmitting(null);
    }
  };

  const handleReject = async () => {
    if (submitting) return;
    const ok = await confirmDialog({
      title: 'Reject this order?',
      message:
        'Stock will be restored and the order will be cancelled. This cannot be undone.',
      confirmText: 'Reject order',
      cancelText: 'Keep order',
      danger: true,
    });
    if (!ok) return;
    setSubmitting('reject');
    setError(null);
    try {
      await rejectOrder(id);
      router.push('/dashboard/verification');
    } catch (err: any) {
      setError(err?.message || 'Reject failed');
      setSubmitting(null);
    }
  };

  const handleRelease = async () => {
    if (submitting) return;
    setSubmitting('release');
    setError(null);
    try {
      await releaseClaim(id);
      router.push('/dashboard/verification');
    } catch (err: any) {
      setError(err?.message || 'Release failed');
      setSubmitting(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 32 }}>Loading…</div>;
  }
  if (!order) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: 'var(--color-error)', marginBottom: 12 }}>
          {error || 'Order not found'}
        </div>
        <Link href="/dashboard/verification">← Back to queue</Link>
      </div>
    );
  }

  const a = order.shippingAddressSnapshot;
  const fullName = a?.fullName || `${order.customer.firstName} ${order.customer.lastName}`;

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/dashboard/verification"
          style={{ fontSize: 13, color: 'var(--color-text-secondary)', textDecoration: 'none' }}
        >
          ← Back to verification queue
        </Link>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
            Verify {order.orderNumber}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Placed {new Date(order.createdAt).toLocaleString()} · Status:{' '}
            <strong>{order.orderStatus}</strong>
          </div>
        </div>
        <Link
          href={`/dashboard/orders/${order.id}`}
          style={{
            fontSize: 13,
            padding: '6px 12px',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            textDecoration: 'none',
            color: 'var(--color-text)',
          }}
        >
          Open full timeline ↗
        </Link>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--color-error-bg)',
            color: 'var(--color-error)',
            padding: '12px 16px',
            borderRadius: 8,
            marginBottom: 16,
            border: '1px solid var(--color-error)',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
          gap: 24,
          marginBottom: 24,
        }}
      >
        {/* Left: items + payment */}
        <div>
          <Card title="Items">
            {order.subOrders.map(so => (
              <div key={so.id} style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    marginBottom: 6,
                  }}
                >
                  {so.fulfillmentNodeType === 'FRANCHISE'
                    ? `Franchise: ${so.franchise?.businessName ?? 'unknown'}`
                    : `Seller: ${so.seller?.sellerShopName ?? 'unknown'}`}
                </div>
                {so.items.map(it => (
                  <div
                    key={it.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto',
                      gap: 12,
                      padding: '10px 0',
                      borderTop: '1px solid var(--color-border)',
                      fontSize: 14,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500 }}>{it.productTitle}</div>
                      {it.variantTitle && (
                        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                          {it.variantTitle}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        SKU {it.sku ?? it.masterSku ?? '—'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>×{it.quantity}</div>
                    <div style={{ textAlign: 'right', fontWeight: 600 }}>
                      ₹{it.totalPrice}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </Card>

          <Card title="Payment">
            <Row k="Payment method" v={order.paymentMethod} />
            <Row k="Payment status" v={order.paymentStatus} />
            {order.discountAmount > 0 && (
              <Row k="Discount" v={`−₹${order.discountAmount}`} />
            )}
            <Row
              k="Total"
              v={<strong style={{ fontSize: 18 }}>₹{order.totalAmount}</strong>}
            />
          </Card>
        </div>

        {/* Right: customer + address */}
        <div>
          <Card title="Customer">
            <Row k="Name" v={fullName} />
            <Row k="Phone" v={a?.phone || order.customer.phone || '—'} />
            <Row k="Email" v={order.customer.email || '—'} />
          </Card>

          <Card title="Shipping address">
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>
              {a.addressLine1}
              {a.addressLine2 && <><br />{a.addressLine2}</>}
              <br />
              {a.city}, {a.state} {a.postalCode}
              {a.country && <>, {a.country}</>}
            </div>
          </Card>
        </div>
      </div>

      {/* Risk panel — show what the rules said before the verifier acts */}
      {risk && (
        <div
          style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            padding: 20,
            marginBottom: 24,
            display: 'flex',
            gap: 24,
            alignItems: 'flex-start',
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <RiskBadge band={risk.band} score={risk.score} size="md" />
            {risk.score != null && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--color-text-secondary)',
                  marginTop: 6,
                  textAlign: 'center',
                }}
              >
                Score {risk.score}
              </div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: 'var(--color-text-secondary)',
                marginBottom: 8,
              }}
            >
              Pre-screen signals
            </div>
            {risk.reasons.length === 0 ? (
              <div style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                No signals — order looks clean.
              </div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
                {risk.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Action bar */}
      <div
        style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          padding: 24,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="remarks"
            style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}
          >
            Verification remarks (optional)
          </label>
          <textarea
            id="remarks"
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            rows={2}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
            placeholder="Anything the rest of ops should know about this approval"
          />
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={handleRelease}
            disabled={!!submitting}
            style={{
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--color-text)',
              background: '#fff',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting === 'release' ? 'Releasing…' : 'Release claim'}
          </button>
          <button
            onClick={handleReject}
            disabled={!!submitting}
            style={{
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background: 'var(--color-error)',
              border: 'none',
              borderRadius: 6,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
          <button
            onClick={handleApprove}
            disabled={!!submitting}
            style={{
              padding: '10px 22px',
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background: 'var(--color-success)',
              border: 'none',
              borderRadius: 6,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting === 'approve' ? 'Approving…' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: 'var(--color-text-secondary)',
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '6px 0',
        fontSize: 14,
      }}
    >
      <span style={{ color: 'var(--color-text-secondary)' }}>{k}</span>
      <span>{v}</span>
    </div>
  );
}
