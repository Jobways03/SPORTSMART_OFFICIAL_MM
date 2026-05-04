'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  adminPaymentOpsService,
  PaymentMismatchAlert,
  PaymentMismatchStatus,
  PaymentAttempt,
  STATUS_COLOR,
  KIND_LABEL,
  inrFromPaise,
} from '@/services/admin-payment-ops.service';

const STATUS_TRANSITIONS: Record<PaymentMismatchStatus, PaymentMismatchStatus[]> = {
  OPEN: ['IN_REVIEW', 'RESOLVED', 'IGNORED'],
  IN_REVIEW: ['RESOLVED', 'IGNORED', 'OPEN'],
  RESOLVED: [],
  IGNORED: [],
};

export default function AlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [alert, setAlert] = useState<PaymentMismatchAlert | null>(null);
  const [attempts, setAttempts] = useState<PaymentAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminPaymentOpsService.getAlert(id);
      if (res.data) {
        setAlert(res.data.alert);
        setAttempts(res.data.attempts);
        setNotes(res.data.alert.resolutionNotes ?? '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  const transition = async (status: PaymentMismatchStatus) => {
    setBusy(true);
    try {
      await adminPaymentOpsService.transitionAlert(id, { status, notes });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !alert) return <div style={{ padding: 32, color: '#7A828F' }}>Loading alert…</div>;
  if (!alert) return (
    <div style={{ padding: 32 }}>
      <Link href="/dashboard/payment-ops" style={{ color: '#525A65', fontSize: 13 }}>← Back</Link>
      <div style={{ marginTop: 12, color: '#b91c1c' }}>{error || 'Not found'}</div>
    </div>
  );

  const transitions = STATUS_TRANSITIONS[alert.status];

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100 }}>
      <Link href="/dashboard/payment-ops" style={{ color: '#525A65', fontSize: 13, textDecoration: 'none', display: 'inline-block', marginBottom: 12 }}>
        ← Back to alerts
      </Link>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 9999,
            background: STATUS_COLOR[alert.status] + '22', color: STATUS_COLOR[alert.status],
            fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>{alert.status.replace('_', ' ')}</span>
          <span style={{ fontSize: 12, color: '#7A828F' }}>severity {alert.severity}</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>{KIND_LABEL[alert.kind]}</h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginTop: 16, fontSize: 13 }}>
          <div><div style={metaLabel}>Order #</div><div style={mono}>{alert.orderNumber ?? '(orphan)'}</div></div>
          <div><div style={metaLabel}>Razorpay payment</div><div style={mono}>{alert.providerPaymentId ?? '—'}</div></div>
          <div><div style={metaLabel}>Expected</div><div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{inrFromPaise(alert.expectedInPaise)}</div></div>
          <div><div style={metaLabel}>Actual</div><div style={{ fontWeight: 600, color: '#b91c1c', fontVariantNumeric: 'tabular-nums' }}>{inrFromPaise(alert.actualInPaise)}</div></div>
        </div>
        <p style={{ marginTop: 16, padding: 12, background: '#FAFAFA', borderRadius: 10, fontSize: 14, color: '#0F1115' }}>
          {alert.description}
        </p>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 20, marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0, marginBottom: 12, color: '#0F1115' }}>Triage</h3>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy}
          placeholder="Investigation notes — refunded? duplicate captured? customer contacted?"
          rows={4}
          style={{ width: '100%', padding: 12, border: '1px solid #D2D6DC', borderRadius: 12, fontSize: 14, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', minHeight: 100 }} />
        {transitions.length > 0 ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {transitions.map((s) => (
              <button key={s} type="button" onClick={() => transition(s)} disabled={busy} style={{
                height: 36, padding: '0 14px', border: '1px solid #D2D6DC',
                background: s === 'IGNORED' ? '#fff' : s === 'RESOLVED' ? '#0F1115' : '#fff',
                color: s === 'RESOLVED' ? '#fff' : s === 'IGNORED' ? '#7A828F' : '#0F1115',
                borderRadius: 9999, fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
              }}>
                Mark {s.toLowerCase().replace('_', ' ')}
              </button>
            ))}
          </div>
        ) : (
          <p style={{ marginTop: 8, color: '#7A828F', fontSize: 13 }}>This alert is closed. Resolution: <em>{alert.resolutionNotes || '(no notes)'}</em></p>
        )}
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0F1115', marginBottom: 12 }}>Gateway attempts ({attempts.length})</h3>
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        {attempts.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#7A828F', fontSize: 14 }}>No attempt records linked to this order.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                <th style={th}>When</th><th style={th}>Kind</th><th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={th}>Provider id</th><th style={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ ...td, color: '#525A65', whiteSpace: 'nowrap' }}>
                    {new Date(a.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{a.kind.replace('_', ' ').toLowerCase()}</div>
                    <div style={{ fontSize: 11, color: '#7A828F' }}>attempt {a.attemptNumber}</div>
                  </td>
                  <td style={td}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999,
                      background: a.status === 'SUCCESS' ? '#dcfce7' : '#fee2e2',
                      color: a.status === 'SUCCESS' ? '#15803d' : '#b91c1c',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>{a.status}</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inrFromPaise(a.amountInPaise)}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#7A828F' }}>
                    {a.providerPaymentId || a.providerOrderId || a.providerRefundId || '—'}
                  </td>
                  <td style={{ ...td, fontSize: 12, color: '#525A65' }}>
                    {a.failureReason || a.responseSummary || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#525A65' };
const td: React.CSSProperties = { padding: '12px 16px', fontSize: 14 };
const metaLabel: React.CSSProperties = { fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4 };
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#0F1115' };
