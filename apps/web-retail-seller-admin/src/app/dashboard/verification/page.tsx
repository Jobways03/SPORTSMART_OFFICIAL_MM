'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  bulkApproveGreen,
  claimNext,
  getMyTray,
  getQueueStats,
  listVerificationOrders,
  releaseClaim,
  BulkApproveResult,
  MyTrayItem,
  QueueStats,
  VerificationBandFilter,
  VerificationOrderRow,
} from '@/services/admin-verification.service';
import { RiskBadge } from '@/components/RiskBadge';

const REFRESH_INTERVAL_MS = 30_000;
const LIST_PAGE_SIZE = 20;

// Tabs for the band-filtered list. `claimBand` is the concrete band a
// "Claim next" shortcut should target (only set where claim-next supports it).
const BAND_TABS: Array<{
  key: VerificationBandFilter;
  label: string;
  claimBand?: 'GREEN' | 'YELLOW' | 'RED' | 'CRITICAL';
}> = [
  { key: 'ALL', label: 'All' },
  { key: 'HIGH', label: 'High (Red + Critical)', claimBand: 'RED' },
  { key: 'RED', label: 'Red', claimBand: 'RED' },
  { key: 'CRITICAL', label: 'Critical', claimBand: 'CRITICAL' },
  { key: 'YELLOW', label: 'Yellow', claimBand: 'YELLOW' },
  { key: 'GREEN', label: 'Green', claimBand: 'GREEN' },
  { key: 'UNSCORED', label: 'Unscored' },
];

const BAND_KEYS = BAND_TABS.map(t => t.key);

function parseBand(raw: string | null): VerificationBandFilter {
  return raw && (BAND_KEYS as string[]).includes(raw)
    ? (raw as VerificationBandFilter)
    : 'ALL';
}

// useSearchParams() must sit under a Suspense boundary so a prerender pass
// doesn't bail the whole page out of static optimisation.
export default function VerificationQueuePage() {
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>Loading…</div>}>
      <VerificationQueueInner />
    </Suspense>
  );
}

function VerificationQueueInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const band = parseBand(searchParams.get('band'));
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [tray, setTray] = useState<MyTrayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  // Tracks which "Claim next <band>" shortcut is in flight, so only that
  // button shows a spinner.
  const [claimingBand, setClaimingBand] = useState<
    'GREEN' | 'YELLOW' | 'RED' | 'CRITICAL' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [listPage, setListPage] = useState(1);
  const [list, setList] = useState<{
    items: VerificationOrderRow[];
    total: number;
  } | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [sweepState, setSweepState] = useState<
    | { kind: 'idle' }
    | { kind: 'previewing' }
    | { kind: 'preview'; ids: string[] }
    | { kind: 'sweeping' }
    | { kind: 'done'; result: BulkApproveResult }
  >({ kind: 'idle' });
  // Tick once a second to drive the per-row countdowns. Decoupled from the
  // 30s refresh so the timer label updates smoothly without re-fetching.
  const [, setNowTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([getQueueStats(), getMyTray()]);
      if (s.data) setStats(s.data);
      if (t.data) setTray(t.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load queue');
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

  // Read-only band-filtered list. Only unclaimed orders are shown, since a
  // claimed order is already in someone's tray.
  const refreshList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await listVerificationOrders({
        band,
        onlyUnclaimed: true,
        page: listPage,
        limit: LIST_PAGE_SIZE,
      });
      if (res.data) {
        setList({ items: res.data.items, total: res.data.total });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load orders');
    } finally {
      setListLoading(false);
    }
  }, [band, listPage]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // Reset to page 1 whenever the band filter changes.
  useEffect(() => {
    setListPage(1);
  }, [band]);

  const selectBand = (next: VerificationBandFilter) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'ALL') params.delete('band');
    else params.set('band', next);
    const qs = params.toString();
    router.replace(qs ? `/dashboard/verification?${qs}` : '/dashboard/verification');
  };

  const handleClaimBand = async (
    targetBand: 'GREEN' | 'YELLOW' | 'RED' | 'CRITICAL',
  ) => {
    if (claimingBand) return;
    setClaimingBand(targetBand);
    setError(null);
    try {
      const res = await claimNext(targetBand);
      if (res.data?.id) {
        router.push(`/dashboard/verification/${res.data.id}`);
      } else {
        setError(`No unclaimed ${targetBand.toLowerCase()} orders to claim`);
        await Promise.all([refresh(), refreshList()]);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to claim');
    } finally {
      setClaimingBand(null);
    }
  };

  const handleClaim = async () => {
    setClaiming(true);
    setError(null);
    try {
      const res = await claimNext();
      if (res.data?.id) {
        router.push(`/dashboard/verification/${res.data.id}`);
      } else {
        await Promise.all([refresh(), refreshList()]);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to claim');
    } finally {
      setClaiming(false);
    }
  };

  const handleRelease = async (orderId: string) => {
    try {
      await releaseClaim(orderId);
      await Promise.all([refresh(), refreshList()]);
    } catch (err: any) {
      setError(err?.message || 'Failed to release');
    }
  };

  const handleSweepPreview = async () => {
    setSweepState({ kind: 'previewing' });
    setError(null);
    try {
      const res = await bulkApproveGreen(25, true);
      const ids = res.data?.previewIds ?? [];
      if (ids.length === 0) {
        setSweepState({ kind: 'idle' });
        setError('No green orders available to sweep');
        return;
      }
      setSweepState({ kind: 'preview', ids });
    } catch (err: any) {
      setSweepState({ kind: 'idle' });
      setError(err?.message || 'Preview failed');
    }
  };

  const handleSweepConfirm = async () => {
    setSweepState({ kind: 'sweeping' });
    setError(null);
    try {
      const res = await bulkApproveGreen(25, false);
      if (res.data) {
        setSweepState({ kind: 'done', result: res.data });
        await Promise.all([refresh(), refreshList()]);
      } else {
        setSweepState({ kind: 'idle' });
      }
    } catch (err: any) {
      setSweepState({ kind: 'idle' });
      setError(err?.message || 'Sweep failed');
    }
  };

  const queueIsEmpty = !stats || stats.unclaimed === 0;
  const greensAvailable = stats?.unclaimedGreen ?? 0;

  return (
    <div style={{ padding: 32 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
            Verification Queue
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
            Claim the next order, review it, then approve or reject. Each claim is held for 15 minutes; release if you walk away.
          </p>
        </div>
        <Link
          href="/dashboard/verification/team"
          style={{
            fontSize: 13,
            padding: '6px 12px',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            textDecoration: 'none',
            color: 'var(--color-text)',
            whiteSpace: 'nowrap',
          }}
        >
          Team status →
        </Link>
      </div>

      <StatsBanner stats={stats} loading={loading} />

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
          gridTemplateColumns: '320px 1fr',
          gap: 24,
          alignItems: 'start',
        }}
      >
        {/* Claim panel */}
        <div
          style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            padding: 24,
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
            Unclaimed in queue
          </div>
          <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1, marginBottom: 16 }}>
            {loading ? '—' : stats?.unclaimed ?? 0}
          </div>
          <button
            onClick={handleClaim}
            disabled={claiming || queueIsEmpty}
            style={{
              width: '100%',
              padding: '14px 16px',
              fontSize: 15,
              fontWeight: 600,
              color: '#fff',
              background: queueIsEmpty ? '#9ca3af' : 'var(--color-primary)',
              border: 'none',
              borderRadius: 8,
              cursor: queueIsEmpty || claiming ? 'not-allowed' : 'pointer',
            }}
          >
            {claiming ? 'Claiming…' : queueIsEmpty ? 'Queue is empty' : 'Claim next order'}
          </button>

          <button
            onClick={handleSweepPreview}
            disabled={greensAvailable === 0 || sweepState.kind === 'previewing'}
            style={{
              width: '100%',
              marginTop: 8,
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: 600,
              color: greensAvailable === 0 ? 'var(--color-text-secondary)' : 'var(--color-success)',
              background: '#fff',
              border: `1px solid ${greensAvailable === 0 ? 'var(--color-border)' : 'var(--color-success)'}`,
              borderRadius: 8,
              cursor: greensAvailable === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {sweepState.kind === 'previewing'
              ? 'Loading…'
              : greensAvailable === 0
                ? 'No greens to sweep'
                : `Sweep ${Math.min(greensAvailable, 25)} green${Math.min(greensAvailable, 25) === 1 ? '' : 's'}`}
          </button>
        </div>

        {/* My tray */}
        <div
          style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--color-border)',
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            My tray ({tray.length})
          </div>

          {loading && (
            <div style={{ padding: 24, color: 'var(--color-text-secondary)' }}>
              Loading…
            </div>
          )}

          {!loading && tray.length === 0 && (
            <div style={{ padding: 24, color: 'var(--color-text-secondary)', fontSize: 14 }}>
              You have no claimed orders. Click <em>Claim next order</em> to get one.
            </div>
          )}

          {!loading && tray.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {tray.map(item => (
                <TrayRow
                  key={item.id}
                  item={item}
                  onRelease={() => handleRelease(item.id)}
                  onOpen={() => router.push(`/dashboard/verification/${item.id}`)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <BandQueueList
        band={band}
        list={list}
        loading={listLoading}
        page={listPage}
        claimingBand={claimingBand}
        onSelectBand={selectBand}
        onClaimBand={handleClaimBand}
        onOpen={orderId => router.push(`/dashboard/verification/${orderId}`)}
        onPageChange={setListPage}
      />

      {sweepState.kind === 'preview' && (
        <SweepConfirmModal
          ids={sweepState.ids}
          onCancel={() => setSweepState({ kind: 'idle' })}
          onConfirm={handleSweepConfirm}
        />
      )}

      {sweepState.kind === 'sweeping' && (
        <ModalShell>
          <div style={{ padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              Sweeping greens…
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              Verifying each order in turn. This usually takes a few seconds.
            </div>
          </div>
        </ModalShell>
      )}

      {sweepState.kind === 'done' && (
        <SweepResultModal
          result={sweepState.result}
          onClose={() => setSweepState({ kind: 'idle' })}
        />
      )}
    </div>
  );
}

function StatsBanner({ stats, loading }: { stats: QueueStats | null; loading: boolean }) {
  const cards: Array<{ label: string; value: number | string; tone: 'neutral' | 'warn' | 'good' }> = [
    { label: 'Unclaimed', value: loading ? '—' : stats?.unclaimed ?? 0, tone: 'neutral' },
    { label: 'In my tray', value: loading ? '—' : stats?.mine ?? 0, tone: 'good' },
    { label: 'SLA breached', value: loading ? '—' : stats?.breachedSla ?? 0, tone: 'warn' },
    { label: 'Orders today', value: loading ? '—' : stats?.totalToday ?? 0, tone: 'neutral' },
  ];

  const toneColor = (tone: 'neutral' | 'warn' | 'good') =>
    tone === 'warn'
      ? 'var(--color-warning)'
      : tone === 'good'
        ? 'var(--color-success)'
        : 'var(--color-text)';

  // Per-band breakdown of the *unclaimed* queue. Colours echo the RiskBadge.
  const tiers: Array<{ label: string; value: number | string; color: string }> = [
    { label: 'Green', value: loading ? '—' : stats?.unclaimedGreen ?? 0, color: 'var(--color-success)' },
    { label: 'Yellow', value: loading ? '—' : stats?.unclaimedYellow ?? 0, color: 'var(--color-warning)' },
    { label: 'Red', value: loading ? '—' : stats?.unclaimedRed ?? 0, color: 'var(--color-error)' },
    { label: 'Critical', value: loading ? '—' : stats?.unclaimedCritical ?? 0, color: '#7f1d1d' },
    { label: 'Unscored', value: loading ? '—' : stats?.unclaimedUnscored ?? 0, color: 'var(--color-text-secondary)' },
  ];

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 12,
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
            <div style={{ fontSize: 22, fontWeight: 700, color: toneColor(c.tone) }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 12,
        }}
      >
        {tiers.map(t => (
          <div
            key={t.label}
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderLeft: `3px solid ${t.color}`,
              borderRadius: 8,
              padding: '12px 16px',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
              {t.label} unclaimed
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: t.color }}>
              {t.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BandQueueList({
  band,
  list,
  loading,
  page,
  claimingBand,
  onSelectBand,
  onClaimBand,
  onOpen,
  onPageChange,
}: {
  band: VerificationBandFilter;
  list: { items: VerificationOrderRow[]; total: number } | null;
  loading: boolean;
  page: number;
  claimingBand: 'GREEN' | 'YELLOW' | 'RED' | 'CRITICAL' | null;
  onSelectBand: (band: VerificationBandFilter) => void;
  onClaimBand: (band: 'GREEN' | 'YELLOW' | 'RED' | 'CRITICAL') => void;
  onOpen: (orderId: string) => void;
  onPageChange: (page: number) => void;
}) {
  const activeTab = BAND_TABS.find(t => t.key === band) ?? BAND_TABS[0];
  const items = list?.items ?? [];
  const total = list?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));

  return (
    <div
      style={{
        marginTop: 24,
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Tab strip + claim-next shortcut */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="tablist">
          {BAND_TABS.map(tab => {
            const active = tab.key === band;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectBand(tab.key)}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 999,
                  border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  background: active ? 'var(--color-primary)' : '#fff',
                  color: active ? '#fff' : 'var(--color-text)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab.claimBand && (
          <button
            type="button"
            onClick={() => onClaimBand(activeTab.claimBand!)}
            disabled={claimingBand !== null}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background:
                claimingBand !== null ? '#9ca3af' : 'var(--color-primary)',
              border: 'none',
              borderRadius: 8,
              cursor: claimingBand !== null ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {claimingBand === activeTab.claimBand
              ? 'Claiming…'
              : `Claim next ${activeTab.claimBand.toLowerCase()}`}
          </button>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div style={{ padding: 24, color: 'var(--color-text-secondary)' }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: 24, color: 'var(--color-text-secondary)', fontSize: 14 }}>
          No unclaimed orders in this band.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr
              style={{
                background: 'var(--color-bg-page)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <ListTh>Order</ListTh>
              <ListTh>Risk</ListTh>
              <ListTh>Payment</ListTh>
              <ListTh>Placed</ListTh>
              <ListTh>Total</ListTh>
              <ListTh> </ListTh>
            </tr>
          </thead>
          <tbody>
            {items.map(row => (
              <tr
                key={row.id}
                style={{ borderBottom: '1px solid var(--color-border)' }}
              >
                <ListTd>
                  <div style={{ fontWeight: 600 }}>{row.orderNumber}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
                  </div>
                </ListTd>
                <ListTd>
                  <RiskBadge band={row.riskBand} score={row.riskScore} />
                </ListTd>
                <ListTd>
                  <div>{row.paymentMethod}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {row.paymentStatus}
                  </div>
                </ListTd>
                <ListTd>{new Date(row.createdAt).toLocaleString()}</ListTd>
                <ListTd>
                  <strong>₹{row.totalAmount}</strong>
                </ListTd>
                <ListTd>
                  <button
                    type="button"
                    onClick={() => onOpen(row.id)}
                    style={{
                      padding: '6px 14px',
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--color-text)',
                      background: '#fff',
                      border: '1px solid var(--color-border)',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >
                    Open
                  </button>
                </ListTd>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {total > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderTop: '1px solid var(--color-border)',
            fontSize: 13,
            color: 'var(--color-text-secondary)',
          }}
        >
          <span>
            {total} order{total === 1 ? '' : 's'} · page {page} of {totalPages}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page <= 1 || loading}
              style={pagerStyle(page <= 1 || loading)}
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages || loading}
              style={pagerStyle(page >= totalPages || loading)}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function pagerStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 500,
    color: disabled ? 'var(--color-text-secondary)' : 'var(--color-text)',
    background: '#fff',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function ListTh({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '10px 16px',
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

function ListTd({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: '12px 16px', fontSize: 14, verticalAlign: 'middle' }}>
      {children}
    </td>
  );
}

function TrayRow({
  item,
  onOpen,
  onRelease,
}: {
  item: MyTrayItem;
  onOpen: () => void;
  onRelease: () => void;
}) {
  const remaining = useCountdown(item.claimExpiresAt);
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto auto auto',
        gap: 16,
        alignItems: 'center',
        padding: '16px 24px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{item.orderNumber}</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>
          ₹{item.totalAmount} · {item.paymentMethod} · {item.itemCount} item{item.itemCount === 1 ? '' : 's'}
        </div>
      </div>
      <RiskBadge band={item.riskBand} score={item.riskScore} />
      <CountdownBadge ms={remaining} />
      <button
        onClick={onOpen}
        style={{
          padding: '8px 16px',
          fontSize: 14,
          fontWeight: 500,
          color: '#fff',
          background: 'var(--color-primary)',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Open
      </button>
      <button
        onClick={onRelease}
        style={{
          padding: '8px 16px',
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--color-text)',
          background: '#fff',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Release
      </button>
    </li>
  );
}

function useCountdown(targetIso: string) {
  const [ms, setMs] = useState(() => new Date(targetIso).getTime() - Date.now());
  useEffect(() => {
    const i = setInterval(() => {
      setMs(new Date(targetIso).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(i);
  }, [targetIso]);
  return ms;
}

function CountdownBadge({ ms }: { ms: number }) {
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
      ⏱ {label}
    </span>
  );
}

function ModalShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(17,24,39,0.45)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          maxWidth: 560,
          width: '90%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function SweepConfirmModal({
  ids,
  onCancel,
  onConfirm,
}: {
  ids: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell>
      <div style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          Sweep {ids.length} green order{ids.length === 1 ? '' : 's'}?
        </h2>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
          Each will be verified and routed to its seller using the same pipeline as a single approval. Failures
          (e.g. unserviceable address) are released back to the queue and reported below the action — you don&apos;t
          have to babysit the sweep.
        </p>
        <div
          style={{
            background: 'var(--color-bg-page)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            fontFamily: 'monospace',
            color: 'var(--color-text-secondary)',
            maxHeight: 160,
            overflow: 'auto',
            marginBottom: 20,
          }}
        >
          {ids.slice(0, 25).map(id => (
            <div key={id}>{id}</div>
          ))}
          {ids.length > 25 && <div>… and {ids.length - 25} more</div>}
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: 500,
              background: '#fff',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '10px 22px',
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background: 'var(--color-success)',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Approve all {ids.length}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function SweepResultModal({
  result,
  onClose,
}: {
  result: BulkApproveResult;
  onClose: () => void;
}) {
  const allOk = result.failed.length === 0;
  return (
    <ModalShell>
      <div style={{ padding: 24 }}>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            marginBottom: 8,
            color: allOk ? 'var(--color-success)' : 'var(--color-warning)',
          }}
        >
          {allOk
            ? `Approved ${result.succeeded} order${result.succeeded === 1 ? '' : 's'}`
            : `Approved ${result.succeeded} of ${result.attempted}`}
        </h2>
        {!allOk && (
          <div style={{ marginTop: 12, marginBottom: 16 }}>
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
              {result.failed.length} failed and released back to the queue
            </div>
            <div
              style={{
                background: 'var(--color-bg-page)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: 12,
                fontSize: 13,
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {result.failed.map(f => (
                <div key={f.orderId} style={{ marginBottom: 6 }}>
                  <strong>{f.orderNumber || f.orderId}</strong>
                  <div style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>
                    {f.reason}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 22px',
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background: 'var(--color-primary)',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
