'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  forceRelease,
  getTeamStatus,
  TeamClaim,
  TeamStatus,
} from '@/services/admin-verification.service';
import { RiskBadge } from '@/components/RiskBadge';

const REFRESH_INTERVAL_MS = 30_000;

export default function TeamLeadPage() {
  const [status, setStatus] = useState<TeamStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [, setNowTick] = useState(0);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('admin');
      if (raw) setAdminRole((JSON.parse(raw) as { role?: string }).role ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await getTeamStatus();
      if (res.data) setStatus(res.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load team status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const i = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(i);
  }, [refresh]);

  useEffect(() => {
    const i = setInterval(() => setNowTick(t => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const handleForceRelease = async (claim: TeamClaim) => {
    const reason = prompt(
      `Force-release order ${claim.orderNumber} held by ${claim.adminName}?\n\nReason (min 3 chars):`,
    );
    if (!reason || reason.trim().length < 3) return;
    setBusyId(claim.id);
    setError(null);
    try {
      await forceRelease(claim.id, reason.trim());
      await refresh();
    } catch (err: any) {
      setError(err?.message || 'Force-release failed');
    } finally {
      setBusyId(null);
    }
  };

  const isSuperAdmin = adminRole === 'SUPER_ADMIN';
  const claims = status?.claims ?? [];

  return (
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/dashboard/verification"
          style={{ fontSize: 13, color: 'var(--color-text-secondary)', textDecoration: 'none' }}
        >
          ← Back to my queue
        </Link>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
          Verification — team status
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
          Every order currently being verified, who has it, and how long they&apos;ve held it. Auto-refreshes every 30s.
        </p>
      </div>

      <SummaryBanner status={status} loading={loading} />

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
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {loading && (
          <div style={{ padding: 24, color: 'var(--color-text-secondary)' }}>
            Loading…
          </div>
        )}
        {!loading && claims.length === 0 && (
          <div style={{ padding: 24, color: 'var(--color-text-secondary)', fontSize: 14 }}>
            No orders are currently claimed. Either the queue is empty, or every claim has expired.
          </div>
        )}
        {!loading && claims.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  background: 'var(--color-bg-page)',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <Th>Order</Th>
                <Th>Risk</Th>
                <Th>Held by</Th>
                <Th>Held for</Th>
                <Th>Time remaining</Th>
                <Th>Total</Th>
                {isSuperAdmin && <Th>Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {claims.map(c => (
                <ClaimRow
                  key={c.id}
                  claim={c}
                  isSuperAdmin={isSuperAdmin}
                  busy={busyId === c.id}
                  onForceRelease={() => handleForceRelease(c)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SummaryBanner({
  status,
  loading,
}: {
  status: TeamStatus | null;
  loading: boolean;
}) {
  const cards: Array<{ label: string; value: number | string }> = [
    { label: 'Currently claimed', value: loading ? '—' : status?.summary.totalClaimed ?? 0 },
    { label: 'Active verifiers', value: loading ? '—' : status?.summary.activeAdmins ?? 0 },
  ];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 12,
        marginBottom: 24,
      }}
    >
      {cards.map(c => (
        <div
          key={c.label}
          style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
            {c.label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function ClaimRow({
  claim,
  isSuperAdmin,
  busy,
  onForceRelease,
}: {
  claim: TeamClaim;
  isSuperAdmin: boolean;
  busy: boolean;
  onForceRelease: () => void;
}) {
  const heldMs = Date.now() - new Date(claim.claimedAt).getTime();
  const remainingMs = new Date(claim.claimExpiresAt).getTime() - Date.now();
  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
      <Td>
        <div style={{ fontWeight: 600 }}>{claim.orderNumber}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {claim.paymentMethod} · {claim.itemCount} item{claim.itemCount === 1 ? '' : 's'}
        </div>
      </Td>
      <Td>
        <RiskBadge band={claim.riskBand} score={claim.riskScore} />
      </Td>
      <Td>
        <div style={{ fontWeight: 500 }}>{claim.adminName}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {claim.adminEmail}
        </div>
      </Td>
      <Td>{formatDuration(Math.max(0, heldMs))}</Td>
      <Td>
        <RemainingBadge ms={remainingMs} />
      </Td>
      <Td>₹{claim.totalAmount}</Td>
      {isSuperAdmin && (
        <Td>
          <button
            onClick={onForceRelease}
            disabled={busy}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--color-error)',
              background: '#fff',
              border: '1px solid var(--color-error)',
              borderRadius: 6,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Releasing…' : 'Force release'}
          </button>
        </Td>
      )}
    </tr>
  );
}

function RemainingBadge({ ms }: { ms: number }) {
  const expired = ms <= 0;
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const seconds = Math.floor((Math.max(0, ms) % 60_000) / 1000);
  const label = expired ? 'Expired' : `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  const tone =
    expired
      ? { color: 'var(--color-error)', bg: 'var(--color-error-bg)' }
      : ms < 5 * 60_000
        ? { color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' }
        : { color: 'var(--color-success)', bg: 'var(--color-success-bg)' };
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: 999,
        color: tone.color,
        background: tone.bg,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function formatDuration(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '12px 16px',
        textAlign: 'left',
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: 'var(--color-text-secondary)',
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: '12px 16px', fontSize: 14, verticalAlign: 'middle' }}>
      {children}
    </td>
  );
}
