'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminLowStockAlertsService,
  LowStockAlert,
  LowStockSweepResult,
} from '@/services/admin-low-stock-alerts.service';
import { ApiError } from '@/lib/api-client';

const DEFAULT_LIMIT = 200;

export default function LowStockAlertsPage() {
  const [alerts, setAlerts] = useState<LowStockAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sellerFilter, setSellerFilter] = useState('');
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<LowStockSweepResult | null>(
    null,
  );

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminLowStockAlertsService.list({
        sellerId: sellerFilter.trim() || undefined,
        limit: DEFAULT_LIMIT,
      });
      setAlerts(res.data ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [sellerFilter]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const runSweep = async () => {
    setSweeping(true);
    setSweepResult(null);
    setError(null);
    try {
      const res = await adminLowStockAlertsService.sweep();
      if (res.data) setSweepResult(res.data);
      await fetchAlerts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sweep failed');
    } finally {
      setSweeping(false);
    }
  };

  // Group by seller for a more useful at-a-glance view.
  const grouped = alerts.reduce<Record<string, LowStockAlert[]>>(
    (acc, a) => {
      const key = a.sellerId || 'unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(a);
      return acc;
    },
    {},
  );
  const sellerIds = Object.keys(grouped).sort(
    (a, b) => grouped[b].length - grouped[a].length,
  );

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280 }}>
      <header style={{ marginBottom: 20 }}>
        <Link
          href="/dashboard/inventory"
          style={{
            color: '#525A65',
            fontSize: 13,
            textDecoration: 'none',
            display: 'inline-block',
            marginBottom: 8,
          }}
        >
          ← Back to inventory
        </Link>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#0f172a' }}>
              Low-stock alerts
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>
              Open alerts where seller stock has dropped at or below the threshold.
              The cron sweep runs every 15 min — trigger it manually after a bulk
              threshold change.
            </p>
          </div>
          <button
            type="button"
            onClick={runSweep}
            disabled={sweeping}
            style={{
              height: 38,
              padding: '0 16px',
              border: 'none',
              background: '#0F1115',
              color: '#fff',
              borderRadius: 9999,
              fontWeight: 600,
              fontSize: 13,
              cursor: sweeping ? 'wait' : 'pointer',
              opacity: sweeping ? 0.7 : 1,
            }}
          >
            {sweeping ? 'Sweeping…' : 'Run sweep now'}
          </button>
        </div>
      </header>

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 16,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 12,
        }}
      >
        <label style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>
          Filter by sellerId
        </label>
        <input
          type="text"
          value={sellerFilter}
          onChange={(e) => setSellerFilter(e.target.value)}
          placeholder="leave blank for all sellers"
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            fontSize: 13,
            fontFamily: 'ui-monospace, monospace',
          }}
        />
      </div>

      {sweepResult && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
            borderRadius: 10,
            color: '#065f46',
            fontSize: 13,
          }}
        >
          Sweep complete — created <strong>{sweepResult.created}</strong> new alert
          {sweepResult.created === 1 ? '' : 's'}, resolved{' '}
          <strong>{sweepResult.resolved}</strong>.
        </div>
      )}

      {error && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 10,
            color: '#991b1b',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <SummaryStrip alerts={alerts} loading={loading} />

      {loading && (
        <div style={{ color: '#64748b', fontSize: 13, padding: 24 }}>Loading alerts…</div>
      )}

      {!loading && alerts.length === 0 && (
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
          No open low-stock alerts. 🎉
        </div>
      )}

      {!loading && sellerIds.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sellerIds.map((sellerId) => {
            const items = grouped[sellerId];
            return (
              <section
                key={sellerId}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  overflow: 'hidden',
                }}
              >
                <header
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#f8fafc',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                      Seller
                    </span>
                    <Link
                      href={`/dashboard/sellers/${sellerId}`}
                      style={{
                        fontSize: 13,
                        color: '#0f172a',
                        fontFamily: 'ui-monospace, monospace',
                        textDecoration: 'none',
                      }}
                    >
                      {sellerId}
                    </Link>
                  </div>
                  <span
                    style={{
                      padding: '2px 10px',
                      background: '#fef3c7',
                      color: '#92400e',
                      fontSize: 11,
                      fontWeight: 700,
                      borderRadius: 9999,
                    }}
                  >
                    {items.length} alert{items.length === 1 ? '' : 's'}
                  </span>
                </header>

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#fafafa', textAlign: 'left' }}>
                      <th style={th}>Product</th>
                      <th style={th}>Mapping</th>
                      <th style={{ ...th, textAlign: 'right' }}>Current</th>
                      <th style={{ ...th, textAlign: 'right' }}>Threshold</th>
                      <th style={th}>Raised</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => (
                      <tr key={a.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={td}>
                          <Link
                            href={`/dashboard/products/${a.productId}/edit`}
                            style={{ color: '#1d4ed8', textDecoration: 'none', fontFamily: 'ui-monospace, monospace' }}
                          >
                            {a.productId}
                          </Link>
                        </td>
                        <td style={{ ...td, fontFamily: 'ui-monospace, monospace', color: '#64748b' }}>
                          {a.sellerProductMappingId.slice(0, 8)}…
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: a.currentStock === 0 ? '#dc2626' : '#b45309' }}>
                          {a.currentStock}
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: '#64748b' }}>{a.threshold}</td>
                        <td style={{ ...td, color: '#64748b' }}>
                          {new Date(a.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryStrip({
  alerts,
  loading,
}: {
  alerts: LowStockAlert[];
  loading: boolean;
}) {
  if (loading) return null;
  const totalSellers = new Set(alerts.map((a) => a.sellerId)).size;
  const outOfStock = alerts.filter((a) => a.currentStock === 0).length;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 12,
        marginBottom: 16,
      }}
    >
      <Stat label="Open alerts" value={alerts.length} />
      <Stat label="Sellers affected" value={totalSellers} />
      <Stat
        label="Of which out-of-stock"
        value={outOfStock}
        tone={outOfStock > 0 ? 'danger' : undefined}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'danger';
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          marginTop: 4,
          color: tone === 'danger' ? '#dc2626' : '#0f172a',
        }}
      >
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
