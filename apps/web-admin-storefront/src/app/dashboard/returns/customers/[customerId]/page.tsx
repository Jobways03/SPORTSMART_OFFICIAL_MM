'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  adminReturnsService,
  ReturnListItem,
  CustomerHistoryAggregates,
} from '@/services/admin-returns.service';

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  REQUESTED: { bg: '#fef3c7', fg: '#92400e' },
  APPROVED: { bg: '#dbeafe', fg: '#1e40af' },
  REJECTED: { bg: '#fee2e2', fg: '#991b1b' },
  PICKUP_SCHEDULED: { bg: '#e0e7ff', fg: '#3730a3' },
  IN_TRANSIT: { bg: '#e0e7ff', fg: '#3730a3' },
  RECEIVED: { bg: '#ccfbf1', fg: '#115e59' },
  QC_APPROVED: { bg: '#d1fae5', fg: '#065f46' },
  QC_REJECTED: { bg: '#fee2e2', fg: '#991b1b' },
  PARTIALLY_APPROVED: { bg: '#fef3c7', fg: '#92400e' },
  REFUND_PROCESSING: { bg: '#e0e7ff', fg: '#3730a3' },
  REFUNDED: { bg: '#d1fae5', fg: '#065f46' },
  COMPLETED: { bg: '#d1fae5', fg: '#065f46' },
  CANCELLED: { bg: '#f3f4f6', fg: '#374151' },
};

export default function CustomerReturnHistoryPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const [items, setItems] = useState<ReturnListItem[]>([]);
  const [aggregates, setAggregates] =
    useState<CustomerHistoryAggregates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminReturnsService
      .getCustomerHistory(customerId)
      .then((res) => {
        if (cancelled) return;
        setItems(res.data?.items ?? []);
        setAggregates(res.data?.aggregates ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const customerName =
    items[0]
      ? [items[0].customer?.firstName, items[0].customer?.lastName]
          .filter(Boolean)
          .join(' ') || items[0].customer?.email || customerId
      : customerId;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <Link
        href="/dashboard/returns"
        style={{
          color: '#525A65',
          fontSize: 13,
          textDecoration: 'none',
          display: 'inline-block',
          marginBottom: 8,
        }}
      >
        ← Back to returns
      </Link>

      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#0f172a' }}>
        Return history
      </h1>
      <p style={{ margin: '6px 0 20px', fontSize: 13, color: '#64748b' }}>
        Customer{' '}
        <strong style={{ color: '#0f172a' }}>{customerName}</strong>{' '}
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
          ({customerId.slice(0, 8)}…)
        </span>
      </p>

      {aggregates && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <Stat label="Total returns" value={aggregates.totalReturns} />
          <Stat label="Refunded" value={aggregates.refundedCount} tone="ok" />
          <Stat label="Rejected" value={aggregates.rejectedCount} tone="danger" />
          <Stat label="Pending" value={aggregates.pendingCount} tone="warn" />
          <Stat
            label="Refunded total"
            value={`₹${Number(aggregates.totalRefundedAmount ?? 0).toFixed(2)}`}
          />
        </div>
      )}

      {loading && (
        <div style={{ color: '#64748b', fontSize: 13 }}>Loading history…</div>
      )}

      {error && (
        <div
          style={{
            padding: '10px 14px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div
          style={{
            padding: 32,
            background: '#fff',
            border: '1px dashed #cbd5e1',
            borderRadius: 12,
            textAlign: 'center',
            color: '#64748b',
            fontSize: 14,
          }}
        >
          No returns on record for this customer.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafa', textAlign: 'left' }}>
                <th style={th}>Return</th>
                <th style={th}>Order</th>
                <th style={{ ...th, textAlign: 'right' }}>Items</th>
                <th style={{ ...th, textAlign: 'right' }}>Refund</th>
                <th style={th}>Status</th>
                <th style={th}>Date</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const color = STATUS_COLOR[r.status] ?? {
                  bg: '#f1f5f9',
                  fg: '#475569',
                };
                const orderNumber =
                  r.masterOrder?.orderNumber ??
                  r.subOrder?.masterOrder?.orderNumber ??
                  null;
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={td}>
                      <Link
                        href={`/dashboard/returns/${r.id}`}
                        style={{
                          color: '#1d4ed8',
                          textDecoration: 'none',
                          fontFamily: 'ui-monospace, monospace',
                        }}
                      >
                        {r.returnNumber}
                      </Link>
                    </td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, monospace', color: '#475569' }}>
                      {orderNumber ? `#${orderNumber}` : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {r.items?.length ?? 0}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                      ₹{Number(r.totalRefundAmount ?? 0).toFixed(2)}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          padding: '2px 10px',
                          borderRadius: 9999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: color.bg,
                          color: color.fg,
                        }}
                      >
                        {r.status.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    </td>
                    <td style={{ ...td, color: '#64748b' }}>
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'ok' | 'danger' | 'warn';
}) {
  const color =
    tone === 'ok'
      ? '#16a34a'
      : tone === 'danger'
        ? '#dc2626'
        : tone === 'warn'
          ? '#d97706'
          : '#0f172a';
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: '#64748b',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color }}>
        {value}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const td: React.CSSProperties = {
  padding: '10px 14px',
};
