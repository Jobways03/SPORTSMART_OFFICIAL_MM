'use client';

// Phase 70 (2026-05-22) — Phase 68 audit Gap #5. Admin
// verification tray UI. Pre-Phase-70 the AdminVerificationController
// surface (claim-next / my-tray / queue-stats / bulk-approve /
// team-status) was UI-unreachable — verifiers used the regular
// orders list filtered by PLACED, which bypassed the claim
// system. This page wires the queue endpoints so the claim-based
// concurrency, risk-band triage, and bulk-approve actually work.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface QueueStats {
  unclaimed: number;
  unclaimedGreen: number;
  unclaimedYellow: number;
  unclaimedRed: number;
  mine: number;
  breachedSla: number;
  totalToday: number;
}

interface TrayOrder {
  id: string;
  orderNumber: string;
  totalAmount: string;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  itemCount: number;
  createdAt: string;
  claimedAt: string;
  claimExpiresAt: string;
  riskScore: number | null;
  riskBand: 'GREEN' | 'YELLOW' | 'RED' | null;
}

interface BulkApproveResult {
  attempted: number;
  succeeded: number;
  failed: Array<{ orderId: string; orderNumber?: string; reason: string }>;
  approvedIds: string[];
  previewIds?: string[];
}

const bandColor = (band: TrayOrder['riskBand']): string => {
  switch (band) {
    case 'GREEN': return '#16a34a';
    case 'YELLOW': return '#d97706';
    case 'RED': return '#dc2626';
    default: return '#6b7280';
  }
};

const fmtCurrency = (amount: string | number): string => {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const fmtTimeRemaining = (expiresAt: string): string => {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
};

export default function VerificationQueuePage() {
  const router = useRouter();
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [tray, setTray] = useState<TrayOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkLimit, setBulkLimit] = useState(10);
  const [bulkPreview, setBulkPreview] = useState<BulkApproveResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [statsRes, trayRes] = await Promise.all([
        apiClient<QueueStats>('/admin/verification/queue-stats'),
        apiClient<TrayOrder[]>('/admin/verification/my-tray'),
      ]);
      if (statsRes.data) setStats(statsRes.data);
      setTray(trayRes.data ?? []);
      setError(null);
    } catch (err: any) {
      setError(err?.body?.message || err?.message || 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleClaimNext = async () => {
    setActionLoading('claim');
    try {
      const res = await apiClient<{ id: string } | null>(
        '/admin/verification/claim-next',
        { method: 'POST' },
      );
      if (res.data && (res.data as { id: string }).id) {
        router.push(`/dashboard/orders/${(res.data as { id: string }).id}?from=verification`);
      } else {
        setError('Queue is empty — no orders awaiting verification');
      }
      await refresh();
    } catch (err: any) {
      setError(err?.body?.message || err?.message || 'Failed to claim next order');
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async (orderId: string) => {
    setActionLoading(`approve-${orderId}`);
    try {
      await apiClient(`/admin/verification/orders/${orderId}/approve`, {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: {
          'X-Idempotency-Key': `verify-approve-${orderId}-${Date.now()}`,
        },
      });
      await refresh();
    } catch (err: any) {
      setError(err?.body?.message || err?.message || 'Failed to approve');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (orderId: string) => {
    if (!confirm(`Reject order ${orderId}? This cancels the order + restores stock.`)) return;
    setActionLoading(`reject-${orderId}`);
    try {
      await apiClient(`/admin/verification/orders/${orderId}/reject`, {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: {
          'X-Idempotency-Key': `verify-reject-${orderId}-${Date.now()}`,
        },
      });
      await refresh();
    } catch (err: any) {
      setError(err?.body?.message || err?.message || 'Failed to reject');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRelease = async (orderId: string) => {
    setActionLoading(`release-${orderId}`);
    try {
      await apiClient(`/admin/verification/orders/${orderId}/release`, {
        method: 'POST',
      });
      await refresh();
    } catch (err: any) {
      setError(err?.body?.message || err?.message || 'Failed to release');
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkPreview = async () => {
    setActionLoading('bulk-preview');
    setBulkPreview(null);
    try {
      const res = await apiClient<BulkApproveResult>(
        '/admin/verification/bulk-approve-green',
        {
          method: 'POST',
          body: JSON.stringify({ limit: bulkLimit, dryRun: true }),
          headers: {
            'X-Idempotency-Key': `bulk-preview-${Date.now()}`,
          },
        },
      );
      if (res.data) setBulkPreview(res.data);
    } catch (err: any) {
      setError(err?.body?.message || err?.message || 'Bulk preview failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkApprove = async () => {
    if (!bulkPreview || bulkPreview.attempted === 0) return;
    if (!confirm(`Approve ${bulkPreview.attempted} GREEN orders in one sweep?`)) return;
    setActionLoading('bulk-approve');
    try {
      const res = await apiClient<BulkApproveResult>(
        '/admin/verification/bulk-approve-green',
        {
          method: 'POST',
          body: JSON.stringify({ limit: bulkLimit, dryRun: false }),
          headers: {
            'X-Idempotency-Key': `bulk-approve-${Date.now()}`,
          },
        },
      );
      setBulkPreview(null);
      setError(res.message ?? null);
      await refresh();
    } catch (err: any) {
      setError(err?.body?.message || err?.message || 'Bulk approve failed');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 32 }}>Loading verification queue…</div>;
  }

  return (
    <div style={{ padding: 32, maxWidth: 1400 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Verification Queue</h1>
        <button
          onClick={handleClaimNext}
          disabled={actionLoading === 'claim' || (stats?.unclaimed ?? 0) === 0}
          style={{
            padding: '10px 24px',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            cursor: 'pointer',
            opacity: (stats?.unclaimed ?? 0) === 0 ? 0.5 : 1,
          }}
        >
          {actionLoading === 'claim' ? 'Claiming…' : 'Claim Next'}
        </button>
      </header>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 6, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Queue stats banner */}
      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}>
        <StatCard label="Unclaimed" value={stats?.unclaimed ?? 0} />
        <StatCard label="GREEN" value={stats?.unclaimedGreen ?? 0} color="#16a34a" />
        <StatCard label="YELLOW" value={stats?.unclaimedYellow ?? 0} color="#d97706" />
        <StatCard label="RED" value={stats?.unclaimedRed ?? 0} color="#dc2626" />
        <StatCard label="My Tray" value={stats?.mine ?? 0} />
        <StatCard label="SLA Breached" value={stats?.breachedSla ?? 0} color="#dc2626" />
        <StatCard label="Today" value={stats?.totalToday ?? 0} />
      </section>

      {/* Bulk-approve GREEN */}
      <section style={{
        padding: 16,
        background: '#f0fdf4',
        border: '1px solid #bbf7d0',
        borderRadius: 8,
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>Bulk Approve GREEN:</strong>
          <input
            type="number"
            min={1}
            max={25}
            value={bulkLimit}
            onChange={(e) => setBulkLimit(Math.min(25, Math.max(1, Number(e.target.value) || 1)))}
            style={{ width: 60, padding: 6, borderRadius: 4, border: '1px solid #d1d5db' }}
          />
          <button
            onClick={handleBulkPreview}
            disabled={actionLoading === 'bulk-preview' || (stats?.unclaimedGreen ?? 0) === 0}
            style={{ padding: '6px 14px', borderRadius: 4, border: '1px solid #16a34a', background: 'white', cursor: 'pointer' }}
          >
            Preview
          </button>
          {bulkPreview && (
            <>
              <span>{bulkPreview.attempted} orders would be approved</span>
              <button
                onClick={handleBulkApprove}
                disabled={actionLoading === 'bulk-approve' || bulkPreview.attempted === 0}
                style={{ padding: '6px 14px', borderRadius: 4, border: 'none', background: '#16a34a', color: 'white', cursor: 'pointer' }}
              >
                {actionLoading === 'bulk-approve' ? 'Approving…' : 'Confirm Sweep'}
              </button>
            </>
          )}
        </div>
      </section>

      {/* My tray */}
      <section>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>My Tray ({tray.length})</h2>
        {tray.length === 0 ? (
          <p style={{ color: '#6b7280' }}>You don't have any orders claimed. Click "Claim Next" to start.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                <th style={{ padding: 10 }}>Order</th>
                <th style={{ padding: 10 }}>Risk</th>
                <th style={{ padding: 10 }}>Amount</th>
                <th style={{ padding: 10 }}>Payment</th>
                <th style={{ padding: 10 }}>Items</th>
                <th style={{ padding: 10 }}>Claim expires</th>
                <th style={{ padding: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tray.map((o) => (
                <tr key={o.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 10 }}>
                    <a
                      href={`/dashboard/orders/${o.id}?from=verification`}
                      style={{ color: '#2563eb', textDecoration: 'none' }}
                    >
                      {o.orderNumber}
                    </a>
                  </td>
                  <td style={{ padding: 10 }}>
                    {o.riskBand ? (
                      <span style={{
                        padding: '2px 10px',
                        borderRadius: 999,
                        background: bandColor(o.riskBand),
                        color: 'white',
                        fontSize: 12,
                      }}>
                        {o.riskBand} ({o.riskScore})
                      </span>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: 10 }}>{fmtCurrency(o.totalAmount)}</td>
                  <td style={{ padding: 10 }}>{o.paymentMethod} / {o.paymentStatus}</td>
                  <td style={{ padding: 10 }}>{o.itemCount}</td>
                  <td style={{ padding: 10 }}>{fmtTimeRemaining(o.claimExpiresAt)}</td>
                  <td style={{ padding: 10 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleApprove(o.id)}
                        disabled={actionLoading === `approve-${o.id}`}
                        style={{ padding: '4px 10px', borderRadius: 4, border: 'none', background: '#16a34a', color: 'white', cursor: 'pointer', fontSize: 12 }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(o.id)}
                        disabled={actionLoading === `reject-${o.id}`}
                        style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #dc2626', background: 'white', color: '#dc2626', cursor: 'pointer', fontSize: 12 }}
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => handleRelease(o.id)}
                        disabled={actionLoading === `release-${o.id}`}
                        style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #6b7280', background: 'white', color: '#374151', cursor: 'pointer', fontSize: 12 }}
                      >
                        Release
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      padding: 16,
      background: 'white',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 24, fontWeight: 600, color: color ?? '#111827' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{label}</div>
    </div>
  );
}
