'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  adminReconciliationService,
  RunDetail,
  DiscrepancyStatus,
  KIND_LABEL,
  STATUS_COLOR,
  DISCREPANCY_STATUS_COLOR,
  inrFromPaise,
} from '@/services/admin-reconciliation.service';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api/v1';

export default function ReconciliationRunPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DiscrepancyStatus | 'ALL'>('ALL');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminReconciliationService.getRun(id);
      if (res.data) setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && !data) {
    return <div style={{ padding: 32, color: '#7A828F' }}>Loading run…</div>;
  }
  if (!data) {
    return <div style={{ padding: 32, color: '#dc2626' }}>Run not found.</div>;
  }

  const filtered = filter === 'ALL'
    ? data.discrepancies
    : data.discrepancies.filter((d) => d.status === filter);

  return (
    <div style={{ padding: '24px 32px' }}>
      <Link
        href="/dashboard/reconciliation"
        style={{ fontSize: 13, color: '#525A65', textDecoration: 'none' }}
      >
        ← All runs
      </Link>

      <div style={{ marginTop: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0F1115', margin: 0 }}>
          {KIND_LABEL[data.kind]} reconciliation
        </h1>
        <div style={{ marginTop: 6, fontSize: 13, color: '#525A65' }}>
          <span
            style={{
              background: STATUS_COLOR[data.status] + '20',
              color: STATUS_COLOR[data.status],
              padding: '2px 10px',
              borderRadius: 12,
              fontWeight: 600,
              marginRight: 8,
              fontSize: 11,
            }}
          >
            {data.status}
          </span>
          {new Date(data.periodStart).toLocaleString('en-IN')} →{' '}
          {new Date(data.periodEnd).toLocaleString('en-IN')}
        </div>
        {data.failureReason && (
          <div style={{ marginTop: 12, padding: 12, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 13, color: '#B91C1C' }}>
            {data.failureReason}
          </div>
        )}
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <Stat label="Records inspected" value={data.totalExpected.toLocaleString('en-IN')} />
        <Stat label="Matched" value={data.totalMatched.toLocaleString('en-IN')} tone="good" />
        <Stat
          label="Discrepancies"
          value={data.totalDiscrepancies.toLocaleString('en-IN')}
          tone={data.totalDiscrepancies > 0 ? 'bad' : 'good'}
        />
        <Stat label="Expected total" value={inrFromPaise(data.expectedAmountInPaise)} />
      </div>

      {/* Filter + CSV download */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['ALL', 'OPEN', 'RESOLVED', 'IGNORED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                background: filter === s ? '#0F1115' : '#fff',
                color: filter === s ? '#fff' : '#525A65',
                border: '1px solid #D2D6DC',
                borderRadius: 6,
                padding: '6px 14px',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              {s === 'ALL' ? 'All' : s}
            </button>
          ))}
        </div>
        {data.discrepancies.length > 0 && (
          <a
            href={`${API_BASE}${adminReconciliationService.csvUrl(data.id)}`}
            download
            style={{
              fontSize: 13,
              color: '#0F1115',
              border: '1px solid #D2D6DC',
              borderRadius: 6,
              padding: '6px 14px',
              textDecoration: 'none',
            }}
          >
            ⬇ Download CSV
          </a>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 32, color: '#7A828F', textAlign: 'center', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12 }}>
          {data.discrepancies.length === 0
            ? '🎉 No discrepancies — everything matches.'
            : 'No discrepancies in this filter.'}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>
                <th style={th}>Kind</th>
                <th style={th}>Order / Ref</th>
                <th style={th}>Expected</th>
                <th style={th}>Actual</th>
                <th style={th}>Description</th>
                <th style={th}>Status</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <DiscrepancyRow key={d.id} d={d} onChanged={refresh} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DiscrepancyRow({ d, onChanged }: { d: RunDetail['discrepancies'][number]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function transition(target: DiscrepancyStatus) {
    if (busy) return;
    const notes = target === 'IGNORED'
      ? prompt('Reason for ignoring (required):') ?? ''
      : prompt('Resolution notes (optional):') ?? '';
    if (target === 'IGNORED' && !notes.trim()) return;
    setBusy(true);
    try {
      await adminReconciliationService.transitionDiscrepancy(d.id, {
        status: target,
        notes: notes.trim() || undefined,
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr style={{ borderTop: '1px solid #F3F4F6' }}>
      <td style={td}>{d.kind}</td>
      <td style={td}>
        <code style={{ fontSize: 12 }}>{d.orderNumber ?? d.externalRef ?? '—'}</code>
      </td>
      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{inrFromPaise(d.expectedInPaise)}</td>
      <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{inrFromPaise(d.actualInPaise)}</td>
      <td style={{ ...td, maxWidth: 360 }}>
        <div style={{ fontSize: 12, color: '#525A65' }}>{d.description}</div>
        {d.resolutionNotes && (
          <div style={{ fontSize: 11, color: '#7A828F', marginTop: 4, fontStyle: 'italic' }}>
            Notes: {d.resolutionNotes}
          </div>
        )}
      </td>
      <td style={td}>
        <span
          style={{
            background: DISCREPANCY_STATUS_COLOR[d.status] + '20',
            color: DISCREPANCY_STATUS_COLOR[d.status],
            padding: '2px 10px',
            borderRadius: 12,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {d.status}
        </span>
      </td>
      <td style={td}>
        {d.status === 'OPEN' ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => transition('RESOLVED')} disabled={busy} style={smallBtn('#16a34a')}>
              Resolve
            </button>
            <button onClick={() => transition('IGNORED')} disabled={busy} style={smallBtn('#6b7280')}>
              Ignore
            </button>
          </div>
        ) : (
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>—</span>
        )}
      </td>
    </tr>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'neutral';
}) {
  const accent = tone === 'good' ? '#15803d' : tone === 'bad' ? '#b91c1c' : '#0F1115';
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#0F1115', verticalAlign: 'top' };
const smallBtn = (color: string): React.CSSProperties => ({
  background: '#fff',
  color,
  border: `1px solid ${color}40`,
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 600,
});
