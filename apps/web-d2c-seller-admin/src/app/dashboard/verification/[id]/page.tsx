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
  rescoreOrder,
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
  const [rescoring, setRescoring] = useState(false);
  // Rescore reason capture (confirmDialog only returns a boolean, so we use a
  // small inline reason field — the same shape the risk panel already uses).
  const [rescoreOpen, setRescoreOpen] = useState(false);
  const [rescoreReason, setRescoreReason] = useState('');
  // Old→new band/score diff shown briefly after a successful rescore.
  const [rescoreDiff, setRescoreDiff] = useState<{
    oldBand: RiskInfo['band'];
    oldScore: number | null;
    newBand: RiskInfo['band'];
    newScore: number | null;
  } | null>(null);

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
    // RED/CRITICAL approvals require a written reason (>= 10 chars). The
    // backend 400s otherwise; mirror the rule client-side for a clean message.
    if (highRiskApproval && remarks.trim().length < 10) {
      setError(
        'Approving a RED/CRITICAL order requires a reason of at least 10 characters.',
      );
      return;
    }
    setSubmitting('approve');
    setError(null);
    try {
      await approveOrder(id, remarks.trim() || undefined);
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

  const handleRescore = async () => {
    if (!id || rescoring) return;
    const trimmed = rescoreReason.trim();
    // Reason is optional; the backend rejects a present-but-too-short reason
    // (3..500), so guard before the round-trip.
    if (trimmed && trimmed.length < 3) {
      setError('Rescore reason must be at least 3 characters (or leave it blank)');
      return;
    }
    setRescoring(true);
    setError(null);
    // Snapshot the current band/score BEFORE the call so we can show a diff.
    const prev = risk;
    try {
      const res = await rescoreOrder(id, trimmed || undefined);
      if (res.data) {
        setRisk(res.data);
        setRescoreDiff({
          oldBand: prev?.band ?? null,
          oldScore: prev?.score ?? null,
          newBand: res.data.band,
          newScore: res.data.score,
        });
        setRescoreOpen(false);
        setRescoreReason('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rescore failed');
    } finally {
      setRescoring(false);
    }
  };

  // RED/CRITICAL approvals are gated on a >= 10-char reason (backend enforced).
  const highRiskApproval = risk?.band === 'RED' || risk?.band === 'CRITICAL';
  const approveReasonMissing = highRiskApproval && remarks.trim().length < 10;

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
            <div
              style={{
                marginTop: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12,
                color: 'var(--color-text-secondary)',
              }}
            >
              {risk.scoredAt && (
                <span>
                  Last scored {new Date(risk.scoredAt).toLocaleString()}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setRescoreOpen(o => !o);
                  setRescoreDiff(null);
                }}
                disabled={rescoring}
                style={{
                  marginLeft: 'auto',
                  height: 28,
                  padding: '0 12px',
                  border: '1px solid var(--color-border)',
                  background: '#fff',
                  borderRadius: 9999,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: rescoring ? 'wait' : 'pointer',
                  opacity: rescoring ? 0.6 : 1,
                }}
              >
                {rescoring ? 'Re-scoring…' : '↻ Re-score'}
              </button>
            </div>

            {/* Inline reason capture for a manual rescore (reason is optional). */}
            {rescoreOpen && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  background: 'var(--color-bg-page)',
                }}
              >
                <label
                  htmlFor="rescore-reason"
                  style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}
                >
                  Reason for rescoring (optional)
                </label>
                <input
                  id="rescore-reason"
                  type="text"
                  value={rescoreReason}
                  onChange={e => setRescoreReason(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. fraud feed refreshed, AVS now available"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    marginBottom: 10,
                  }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setRescoreOpen(false);
                      setRescoreReason('');
                    }}
                    disabled={rescoring}
                    style={{
                      padding: '8px 14px',
                      fontSize: 13,
                      fontWeight: 500,
                      background: '#fff',
                      border: '1px solid var(--color-border)',
                      borderRadius: 6,
                      cursor: rescoring ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRescore}
                    disabled={rescoring}
                    style={{
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#fff',
                      background: 'var(--color-primary)',
                      border: 'none',
                      borderRadius: 6,
                      cursor: rescoring ? 'wait' : 'pointer',
                    }}
                  >
                    {rescoring ? 'Re-scoring…' : 'Re-score now'}
                  </button>
                </div>
              </div>
            )}

            {/* Old→new diff after a successful rescore. */}
            {rescoreDiff && (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ color: 'var(--color-text-secondary)' }}>Previous:</span>
                <RiskBadge band={rescoreDiff.oldBand} score={rescoreDiff.oldScore} />
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  ({rescoreDiff.oldScore ?? '—'}) →
                </span>
                <span style={{ color: 'var(--color-text-secondary)' }}>New:</span>
                <RiskBadge band={rescoreDiff.newBand} score={rescoreDiff.newScore} />
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  ({rescoreDiff.newScore ?? '—'})
                </span>
              </div>
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
            {highRiskApproval
              ? `Verification remarks (required for ${risk?.band} — min 10 characters)`
              : 'Verification remarks (optional)'}
          </label>
          <textarea
            id="remarks"
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            rows={2}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: `1px solid ${approveReasonMissing ? 'var(--color-error)' : 'var(--color-border)'}`,
              borderRadius: 6,
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
            placeholder={
              highRiskApproval
                ? 'Why this high-risk order is safe to approve (min 10 characters)'
                : 'Anything the rest of ops should know about this approval'
            }
          />
          {approveReasonMissing && (
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-error)' }}>
              A {risk?.band} order can only be approved with a written reason of
              at least 10 characters.
            </div>
          )}
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
            disabled={!!submitting || approveReasonMissing}
            title={
              approveReasonMissing
                ? `Add a reason (min 10 characters) to approve this ${risk?.band} order`
                : undefined
            }
            style={{
              padding: '10px 22px',
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background:
                approveReasonMissing && !submitting ? '#9ca3af' : 'var(--color-success)',
              border: 'none',
              borderRadius: 6,
              cursor:
                submitting || approveReasonMissing ? 'not-allowed' : 'pointer',
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
