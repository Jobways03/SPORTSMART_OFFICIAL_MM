'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePermissions } from '@/lib/permissions';
import {
  adminPayoutsService,
  PayoutBatchDetail,
  PayoutBatchSummary,
  PAYOUT_STATUS_COLOR,
} from '@/services/admin-payouts.service';

export default function PayoutsPage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canExport = hasPermission('payouts.export');

  const [batches, setBatches] = useState<PayoutBatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminPayoutsService.listBatches();
      if (res.data) setBatches(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payout batches');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const b of batches) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
    const totalPayouts = batches.reduce((acc, b) => acc + (b._count?.payouts ?? 0), 0);
    const exported = batches.filter((b) => Boolean(b.exportedAt)).length;
    return { byStatus, totalPayouts, exported };
  }, [batches]);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 16, gap: 16, flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
            Payouts
          </h1>
          <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 720, lineHeight: 1.5 }}>
            Bundle approved settlements into bank-export batches, generate CSVs, and ingest bank
            responses. One batch per settlement cycle is typical.
          </p>
        </div>
        {canExport && (
          <button onClick={() => setShowCreate(true)} style={btnPrimary}>
            <PlusIcon /> New batch from cycle
          </button>
        )}
      </div>

      <KpiStrip
        loading={loading && batches.length === 0}
        total={batches.length}
        counts={counts}
      />

      {error && <Banner kind="err" text={error} onClose={() => setError('')} />}

      <div style={{
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden',
      }}>
        {loading && batches.length === 0 ? (
          <Skeleton />
        ) : batches.length === 0 ? (
          <EmptyState canExport={canExport} onCreate={() => setShowCreate(true)} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                <th style={th}>Batch ID</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Payouts</th>
                <th style={th}>Created</th>
                <th style={th}>Exported</th>
                <th style={{ ...th, width: 1, whiteSpace: 'nowrap' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <BatchRow
                  key={b.id}
                  batch={b}
                  onOpen={() => router.push(`/dashboard/payouts/${b.id}`)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateBatchModal
          onClose={() => setShowCreate(false)}
          onSaved={async (batch) => {
            setShowCreate(false);
            if (batch) router.push(`/dashboard/payouts/${batch.id}`);
            else await refresh();
          }}
        />
      )}
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  loading, total, counts,
}: {
  loading: boolean;
  total: number;
  counts: { byStatus: Record<string, number>; totalPayouts: number; exported: number };
}) {
  const pending = counts.byStatus['PENDING'] ?? 0;
  const exported = counts.exported;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="Total batches"
        value={total.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="Across all cycles loaded." />
      <Kpi label="Pending"
        value={pending.toLocaleString('en-IN')}
        tone={pending > 0 ? 'warning' : 'muted'} loading={loading}
        hint="Awaiting CSV export or approval." />
      <Kpi label="Exported"
        value={exported.toLocaleString('en-IN')}
        tone="success" loading={loading}
        hint="Bank CSV downloaded at least once." />
      <Kpi label="Payouts inside"
        value={counts.totalPayouts.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="Sum of individual seller payouts across loaded batches." />
    </div>
  );
}

type KpiTone = 'success' | 'warning' | 'danger' | 'neutral' | 'muted';
const KPI_TONE: Record<KpiTone, string> = {
  success: '#15803d', warning: '#b45309', danger: '#b91c1c',
  neutral: '#0F1115', muted: '#525A65',
};
function Kpi({
  label, value, tone, hint, loading,
}: {
  label: string; value: string; tone: KpiTone; hint?: string; loading?: boolean;
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={kpiLabel}>{label}</div>
      {loading ? (
        <div style={{ height: 28, width: '60%', background: '#F3F4F6', borderRadius: 6 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: KPI_TONE[tone], fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </span>
          {(tone === 'warning' || tone === 'danger' || tone === 'success') && (
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: KPI_TONE[tone] }} />
          )}
        </div>
      )}
      {hint && <div style={{ fontSize: 12, color: '#525A65', lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────

function BatchRow({ batch, onOpen }: { batch: PayoutBatchSummary; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <tr
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderTop: '1px solid #F3F4F6',
        cursor: 'pointer',
        background: hover ? '#FAFAFA' : 'transparent',
        transition: 'background 120ms',
      }}
    >
      <td style={{
        ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12,
        color: '#0F1115', fontWeight: 600,
      }}>
        {batch.id.slice(0, 8)}…
      </td>
      <td style={td}><StatusPill status={batch.status} /></td>
      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {batch._count?.payouts ?? '—'}
      </td>
      <td style={{ ...td, color: '#525A65' }}
          title={new Date(batch.createdAt).toLocaleString('en-IN')}>
        {relTime(new Date(batch.createdAt))}
      </td>
      <td style={{ ...td, color: '#525A65' }}>
        {batch.exportedAt ? (
          <span title={new Date(batch.exportedAt).toLocaleString('en-IN')}>
            {relTime(new Date(batch.exportedAt))}
          </span>
        ) : (
          <span style={{ color: '#7A828F' }}>—</span>
        )}
      </td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
        <Link
          href={`/dashboard/payouts/${batch.id}`}
          onClick={(e) => e.stopPropagation()}
          style={linkPill}
        >
          Open <ArrowRight />
        </Link>
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: PayoutBatchSummary['status'] }) {
  const meta = PAYOUT_STATUS_COLOR[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: 22, padding: '0 10px', borderRadius: 9999,
      background: meta.bg, color: meta.fg,
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 9999, background: meta.fg }} />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── Create-batch modal ────────────────────────────────────────────

function CreateBatchModal({
  onClose, onSaved,
}: {
  onClose: () => void;
  onSaved: (batch: PayoutBatchDetail | null) => void;
}) {
  const [cycleId, setCycleId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!cycleId.trim()) return setErr('Settlement cycle ID is required');
    setSubmitting(true);
    try {
      const res = await adminPayoutsService.createBatch(cycleId.trim());
      onSaved(res.data ?? null);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create batch');
    } finally { setSubmitting(false); }
  };

  return (
    <div
      onClick={() => !submitting && onClose()}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15, 17, 21, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 260, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, padding: 24,
          maxWidth: 520, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          New payout batch
        </h2>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', lineHeight: 1.5 }}>
          Pulls every <strong>APPROVED</strong> settlement in the chosen cycle into a new payout
          batch. Find cycle IDs in the Commission / Settlements area.
        </p>

        <div style={{ marginTop: 16 }}>
          <label style={kpiLabel}>Settlement cycle ID *</label>
          <input
            value={cycleId}
            onChange={(e) => setCycleId(e.target.value)}
            placeholder="UUID of the settlement cycle"
            disabled={submitting}
            autoFocus
            style={{ ...input, marginTop: 6, fontFamily: 'ui-monospace, monospace' }}
          />
        </div>

        {err && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 10, fontSize: 13,
            border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c',
          }}>{err}</div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={submitting} style={btnGhost}>Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || !cycleId.trim()}
            style={submitting || !cycleId.trim() ? { ...btnPrimary, ...busyStyle } : btnPrimary}
          >
            {submitting ? 'Creating…' : 'Create batch'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Empty / skeleton / banner ─────────────────────────────────────

function EmptyState({ canExport, onCreate }: { canExport: boolean; onCreate: () => void }) {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <BanknoteIcon />
      </div>
      <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600 }}>No payout batches yet</div>
      <div style={{ fontSize: 13, color: '#525A65', marginTop: 4, maxWidth: 360, margin: '4px auto 0' }}>
        Create one from an approved settlement cycle to get started.
      </div>
      {canExport && (
        <button onClick={onCreate} style={{ ...btnPrimary, marginTop: 16 }}>
          <PlusIcon /> New batch
        </button>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: 16 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0',
          borderBottom: '1px solid #F3F4F6',
        }}>
          <div style={{ width: 120, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 100, height: 22, background: '#F3F4F6', borderRadius: 9999 }} />
          <div style={{ width: 60, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 120, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ flex: 1 }} />
          <div style={{ width: 80, height: 28, background: '#F3F4F6', borderRadius: 9999 }} />
        </div>
      ))}
    </div>
  );
}

function Banner({
  kind, text, onClose,
}: { kind: 'ok' | 'err'; text: string; onClose: () => void }) {
  return (
    <div style={{
      marginBottom: 12, padding: '10px 14px', borderRadius: 12, fontSize: 13,
      border: `1px solid ${kind === 'ok' ? '#bbf7d0' : '#fca5a5'}`,
      background: kind === 'ok' ? '#f0fdf4' : '#fef2f2',
      color: kind === 'ok' ? '#15803d' : '#b91c1c',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    }}>
      <span>{text}</span>
      <button onClick={onClose} aria-label="Dismiss" style={{
        padding: 4, border: 'none', background: 'transparent', cursor: 'pointer',
        color: 'inherit', opacity: 0.6, lineHeight: 1, fontSize: 16,
      }}>×</button>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────

function PlusIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function ArrowRight({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function BanknoteIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 10v.01M18 14v.01" />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function relTime(d: Date): string {
  const diff = Math.max(0, Date.now() - d.getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  const w = Math.floor(days / 7);
  if (w < 4) return `${w}w ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(days / 365);
  return `${y}y ago`;
}

// ── Shared styles ─────────────────────────────────────────────────

const kpiLabel: React.CSSProperties = {
  fontSize: 11, color: '#7A828F', textTransform: 'uppercase',
  letterSpacing: '0.06em', fontWeight: 600,
};
const input: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid #D2D6DC', borderRadius: 9,
  fontSize: 13, color: '#0F1115',
  outline: 'none', background: '#fff', boxSizing: 'border-box', width: '100%',
};
const btnPrimary: React.CSSProperties = {
  height: 36, padding: '0 16px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const btnGhost: React.CSSProperties = {
  height: 36, padding: '0 14px',
  background: 'transparent', color: '#525A65',
  border: '1px solid #E5E7EB', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const busyStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
const linkPill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  height: 28, padding: '0 12px',
  fontSize: 12, fontWeight: 600, color: '#0F1115',
  background: '#fff', border: '1px solid #D2D6DC', borderRadius: 9999,
  textDecoration: 'none',
};
const th: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: '#525A65', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '14px 16px', fontSize: 13, color: '#0F1115',
  verticalAlign: 'middle',
};
