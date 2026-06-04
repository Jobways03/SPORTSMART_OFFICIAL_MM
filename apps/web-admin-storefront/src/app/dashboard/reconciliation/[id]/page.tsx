'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  adminReconciliationService,
  RunDetail,
  DiscrepancyStatus,
  DiscrepancyKind,
  ReconciliationDiscrepancy,
  DiscrepancyHistoryEntry,
  KIND_LABEL,
  STATUS_COLOR,
  DISCREPANCY_STATUS_COLOR,
  inrFromPaise,
  severityColor,
} from '@/services/admin-reconciliation.service';

const LIVE = (s: string) => s === 'QUEUED' || s === 'RUNNING';
const TERMINAL = (s: DiscrepancyStatus) => s === 'RESOLVED' || s === 'IGNORED';
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/api/v1';

const ALL_STATUSES: DiscrepancyStatus[] = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED'];

// Phase 174 (#7) — a single notes/reason modal replaces the fragile window.prompt.
type ModalKind = 'resolve' | 'ignore' | 'reopen';
interface ModalState {
  kind: ModalKind;
  ids: string[]; // 1 for single-row actions; N for bulk
  required: boolean;
}

export default function ReconciliationRunPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Filters (#15) — status / severity / kind. Filtering is client-side over the
  // already-loaded run.
  const [statusFilter, setStatusFilter] = useState<DiscrepancyStatus | 'ALL'>('ALL');
  const [minSeverity, setMinSeverity] = useState(0);
  const [kindFilter, setKindFilter] = useState<DiscrepancyKind | ''>('');

  // Bulk selection (#11) + the notes modal (#7).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalState | null>(null);

  // History timeline (#2).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, DiscrepancyHistoryEntry[]>>({});

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

  // Phase 173 (#1) — poll while the run is still QUEUED/RUNNING.
  const live = data ? LIVE(data.status) : false;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [live, refresh]);

  if (loading && !data) {
    return <div style={{ padding: 32, color: '#7A828F' }}>Loading run…</div>;
  }
  if (!data) {
    return <div style={{ padding: 32, color: '#dc2626' }}>Run not found.</div>;
  }

  // Per-status counts (#17).
  const statusCounts = ALL_STATUSES.reduce(
    (acc, s) => {
      acc[s] = data.discrepancies.filter((d) => d.status === s).length;
      return acc;
    },
    {} as Record<DiscrepancyStatus, number>,
  );

  // Kinds present, for the kind filter.
  const presentKinds = Array.from(new Set(data.discrepancies.map((d) => d.kind))).sort();

  const filtered = data.discrepancies.filter(
    (d) =>
      (statusFilter === 'ALL' || d.status === statusFilter) &&
      d.severity >= minSeverity &&
      (kindFilter === '' || d.kind === kindFilter),
  );

  // Only non-terminal rows are bulk-transitionable.
  const selectableInView = filtered.filter((d) => !TERMINAL(d.status));
  const allSelected = selectableInView.length > 0 && selectableInView.every((d) => selected.has(d.id));

  function toggleSelect(rowId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableInView.map((d) => d.id)));
  }

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  // Direct (no-notes) transitions: Review (→IN_REVIEW), Return-to-open.
  const directTransition = (rowId: string, status: DiscrepancyStatus) =>
    run(() => adminReconciliationService.transitionDiscrepancy(rowId, { status }));

  const doAssignSelf = (rowId: string) =>
    run(() => adminReconciliationService.assignDiscrepancy(rowId, {}));
  const doUnassign = (rowId: string) =>
    run(() => adminReconciliationService.assignDiscrepancy(rowId, { assignedToAdminId: null }));

  async function toggleHistory(rowId: string) {
    if (expandedId === rowId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(rowId);
    if (!history[rowId]) {
      const res = await adminReconciliationService.getDiscrepancyHistory(rowId);
      if (res.data) setHistory((h) => ({ ...h, [rowId]: res.data as DiscrepancyHistoryEntry[] }));
    }
  }

  // Modal confirm → resolve / ignore (single or bulk) / reopen (single).
  async function confirmModal(notes: string) {
    if (!modal) return;
    const { kind, ids } = modal;
    await run(async () => {
      if (kind === 'reopen') {
        await adminReconciliationService.reopenDiscrepancy(ids[0], { reason: notes });
      } else {
        const status: DiscrepancyStatus = kind === 'resolve' ? 'RESOLVED' : 'IGNORED';
        if (ids.length > 1) {
          await adminReconciliationService.bulkTransition({ ids, status, notes: notes || undefined });
        } else {
          await adminReconciliationService.transitionDiscrepancy(ids[0], {
            status,
            notes: notes || undefined,
          });
        }
      }
      setSelected(new Set());
    });
    setModal(null);
  }

  const selectedNonTerminal = filtered.filter((d) => selected.has(d.id) && !TERMINAL(d.status));

  return (
    <div style={{ padding: '24px 32px' }}>
      <Link href="/dashboard/reconciliation" style={{ fontSize: 13, color: '#525A65', textDecoration: 'none' }}>
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
          {new Date(data.periodStart).toLocaleString('en-IN')} → {new Date(data.periodEnd).toLocaleString('en-IN')}
        </div>
        {data.failureReason && (
          <div style={{ marginTop: 12, padding: 12, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 13, color: '#B91C1C' }}>
            {data.failureReason}
          </div>
        )}
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <Stat label="Records inspected" value={data.totalExpected.toLocaleString('en-IN')} />
        <Stat label="Matched" value={data.totalMatched.toLocaleString('en-IN')} tone="good" />
        <Stat label="Discrepancies" value={data.totalDiscrepancies.toLocaleString('en-IN')} tone={data.totalDiscrepancies > 0 ? 'bad' : 'good'} />
        <Stat label="Expected total" value={inrFromPaise(data.expectedAmountInPaise)} />
      </div>

      {/* Per-status breakdown (#17) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {ALL_STATUSES.map((s) => (
          <div
            key={s}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: '6px 12px',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 4, background: DISCREPANCY_STATUS_COLOR[s] }} />
            <span style={{ fontSize: 12, color: '#525A65' }}>{s}</span>
            <strong style={{ fontSize: 13, color: '#0F1115', fontVariantNumeric: 'tabular-nums' }}>{statusCounts[s]}</strong>
          </div>
        ))}
      </div>

      {/* Filters (#15) + CSV download */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as DiscrepancyStatus | 'ALL')} style={selectStyle}>
            <option value="ALL">All statuses</option>
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={minSeverity} onChange={(e) => setMinSeverity(Number(e.target.value))} style={selectStyle}>
            <option value={0}>Any severity</option>
            <option value={40}>≥ 40</option>
            <option value={60}>≥ 60</option>
            <option value={80}>≥ 80 (urgent)</option>
          </select>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as DiscrepancyKind | '')} style={selectStyle}>
            <option value="">All kinds</option>
            {presentKinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        {data.discrepancies.length > 0 && (
          <a href={`${API_BASE}${adminReconciliationService.csvUrl(data.id)}`} download style={downloadBtn}>
            ⬇ Download CSV
          </a>
        )}
      </div>

      {err && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {/* Bulk toolbar (#11) */}
      {selectedNonTerminal.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '10px 14px', background: '#0F1115', borderRadius: 8, color: '#fff' }}>
          <strong style={{ fontSize: 13 }}>{selectedNonTerminal.length} selected</strong>
          <button disabled={busy} onClick={() => setModal({ kind: 'resolve', ids: selectedNonTerminal.map((d) => d.id), required: false })} style={bulkBtn('#16a34a')}>
            Resolve all
          </button>
          <button disabled={busy} onClick={() => setModal({ kind: 'ignore', ids: selectedNonTerminal.map((d) => d.id), required: true })} style={bulkBtn('#6b7280')}>
            Ignore all
          </button>
          <button disabled={busy} onClick={() => setSelected(new Set())} style={{ ...bulkBtn('#9CA3AF'), marginLeft: 'auto' }}>
            Clear
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ padding: 32, color: '#7A828F', textAlign: 'center', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12 }}>
          {data.discrepancies.length === 0 ? '🎉 No discrepancies — everything matches.' : 'No discrepancies in this filter.'}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>
                <th style={{ ...th, width: 32 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all" />
                </th>
                <th style={th}>Sev</th>
                <th style={th}>Kind</th>
                <th style={th}>Order / Ref</th>
                <th style={th}>Difference</th>
                <th style={th}>Description</th>
                <th style={th}>Owner</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <DiscrepancyRow
                  key={d.id}
                  d={d}
                  busy={busy}
                  selected={selected.has(d.id)}
                  onToggleSelect={() => toggleSelect(d.id)}
                  onReview={() => directTransition(d.id, 'IN_REVIEW')}
                  onReturnOpen={() => directTransition(d.id, 'OPEN')}
                  onResolve={() => setModal({ kind: 'resolve', ids: [d.id], required: false })}
                  onIgnore={() => setModal({ kind: 'ignore', ids: [d.id], required: true })}
                  onReopen={() => setModal({ kind: 'reopen', ids: [d.id], required: true })}
                  onAssignSelf={() => doAssignSelf(d.id)}
                  onUnassign={() => doUnassign(d.id)}
                  expanded={expandedId === d.id}
                  onToggleHistory={() => toggleHistory(d.id)}
                  historyRows={history[d.id]}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ActionModal
          kind={modal.kind}
          count={modal.ids.length}
          required={modal.required}
          busy={busy}
          onCancel={() => setModal(null)}
          onConfirm={confirmModal}
        />
      )}
    </div>
  );
}

function DiscrepancyRow({
  d, busy, selected, onToggleSelect,
  onReview, onReturnOpen, onResolve, onIgnore, onReopen,
  onAssignSelf, onUnassign,
  expanded, onToggleHistory, historyRows,
}: {
  d: ReconciliationDiscrepancy;
  busy: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onReview: () => void;
  onReturnOpen: () => void;
  onResolve: () => void;
  onIgnore: () => void;
  onReopen: () => void;
  onAssignSelf: () => void;
  onUnassign: () => void;
  expanded: boolean;
  onToggleHistory: () => void;
  historyRows?: DiscrepancyHistoryEntry[];
}) {
  const terminal = TERMINAL(d.status);
  return (
    <>
      <tr style={{ borderTop: '1px solid #F3F4F6', background: selected ? '#F0F9FF' : undefined }}>
        <td style={td}>
          {!terminal && <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label="Select row" />}
        </td>
        <td style={td}>
          <span title={`Severity ${d.severity}`} style={{ display: 'inline-block', minWidth: 26, textAlign: 'center', background: severityColor(d.severity) + '20', color: severityColor(d.severity), padding: '2px 6px', borderRadius: 6, fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {d.severity}
          </span>
        </td>
        <td style={td}>{d.kind}</td>
        <td style={td}><code style={{ fontSize: 12 }}>{d.orderNumber ?? d.externalRef ?? '—'}</code></td>
        <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: d.differenceInPaise && d.differenceInPaise !== 0 ? '#b91c1c' : '#0F1115' }}>
          {inrFromPaise(d.differenceInPaise)}
        </td>
        <td style={{ ...td, maxWidth: 320 }}>
          <div style={{ fontSize: 12, color: '#525A65' }}>{d.description}</div>
          {d.suggestedAction && <div style={{ fontSize: 11, color: '#2563eb', marginTop: 4 }}>→ {d.suggestedAction}</div>}
          {d.resolutionNotes && <div style={{ fontSize: 11, color: '#7A828F', marginTop: 4, fontStyle: 'italic' }}>Notes: {d.resolutionNotes}</div>}
        </td>
        {/* Owner (#6) */}
        <td style={td}>
          {d.assignedToAdminId ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <code title={d.assignedToAdminId} style={{ fontSize: 11, background: '#EEF2FF', color: '#3730A3', padding: '2px 6px', borderRadius: 6 }}>
                …{d.assignedToAdminId.slice(-6)}
              </code>
              <button disabled={busy} onClick={onUnassign} title="Unassign" style={iconBtn}>×</button>
            </span>
          ) : (
            <button disabled={busy} onClick={onAssignSelf} style={smallBtn('#2563eb')}>+ Me</button>
          )}
        </td>
        <td style={td}>
          <span style={{ background: DISCREPANCY_STATUS_COLOR[d.status] + '20', color: DISCREPANCY_STATUS_COLOR[d.status], padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
            {d.status}
          </span>
        </td>
        <td style={td}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {d.status === 'OPEN' && <button disabled={busy} onClick={onReview} style={smallBtn('#d97706')}>Review</button>}
            {d.status === 'IN_REVIEW' && <button disabled={busy} onClick={onReturnOpen} style={smallBtn('#6b7280')}>Return</button>}
            {!terminal && <button disabled={busy} onClick={onResolve} style={smallBtn('#16a34a')}>Resolve</button>}
            {!terminal && <button disabled={busy} onClick={onIgnore} style={smallBtn('#6b7280')}>Ignore</button>}
            {terminal && <button disabled={busy} onClick={onReopen} style={smallBtn('#dc2626')}>Reopen</button>}
            <button onClick={onToggleHistory} title="History" style={iconBtn}>🕑</button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: '#FAFAFA' }}>
          <td />
          <td colSpan={8} style={{ padding: '8px 14px 14px' }}>
            <HistoryPanel rows={historyRows} createdAt={d.createdAt} />
          </td>
        </tr>
      )}
    </>
  );
}

function HistoryPanel({ rows, createdAt }: { rows?: DiscrepancyHistoryEntry[]; createdAt: string }) {
  return (
    <div style={{ borderLeft: '2px solid #E5E7EB', paddingLeft: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Transition timeline
      </div>
      {rows === undefined ? (
        <div style={{ fontSize: 12, color: '#7A828F' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((h) => (
            <div key={h.id} style={{ fontSize: 12, color: '#0F1115' }}>
              <span style={{ color: '#7A828F', fontVariantNumeric: 'tabular-nums' }}>
                {new Date(h.occurredAt).toLocaleString('en-IN')}
              </span>{' '}
              <strong>{h.fromStatus ?? '∅'} → {h.toStatus}</strong>{' '}
              <span style={{ color: '#525A65' }}>by {h.actorAdminId ? `…${h.actorAdminId.slice(-6)}` : h.actorRole ?? 'system'}</span>
              {h.notes && <div style={{ color: '#7A828F', fontStyle: 'italic', marginLeft: 8 }}>“{h.notes}”</div>}
            </div>
          ))}
          <div style={{ fontSize: 12, color: '#7A828F' }}>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{new Date(createdAt).toLocaleString('en-IN')}</span>{' '}
            <strong>∅ → OPEN</strong> <span>(detected)</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionModal({
  kind, count, required, busy, onCancel, onConfirm,
}: {
  kind: ModalKind;
  count: number;
  required: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (notes: string) => void;
}) {
  const [text, setText] = useState('');
  const titles: Record<ModalKind, string> = {
    resolve: count > 1 ? `Resolve ${count} discrepancies` : 'Resolve discrepancy',
    ignore: count > 1 ? `Ignore ${count} discrepancies` : 'Ignore discrepancy',
    reopen: 'Reopen discrepancy',
  };
  const labels: Record<ModalKind, string> = {
    resolve: 'Resolution notes (optional)',
    ignore: 'Reason for ignoring (required)',
    reopen: 'Reason for reopening (required)',
  };
  const canConfirm = !busy && (!required || text.trim().length >= 3) && text.length <= 2000;

  return (
    <div style={overlay} onClick={onCancel}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, color: '#0F1115' }}>{titles[kind]}</h3>
        <label style={{ fontSize: 12, color: '#525A65' }}>{labels[kind]}</label>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="Explain your reasoning…"
          style={{ width: '100%', marginTop: 6, padding: 10, border: '1px solid #D2D6DC', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontSize: 11, color: text.length > 1900 ? '#dc2626' : '#9CA3AF', fontVariantNumeric: 'tabular-nums' }}>
            {text.length}/2000
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onCancel} style={modalCancelBtn}>Cancel</button>
            <button disabled={!canConfirm} onClick={() => onConfirm(text.trim())} style={{ ...modalConfirmBtn, opacity: canConfirm ? 1 : 0.5 }}>
              {busy ? 'Working…' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const accent = tone === 'good' ? '#15803d' : tone === 'bad' ? '#b91c1c' : '#0F1115';
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#7A828F', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#0F1115', verticalAlign: 'top' };
const selectStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #D2D6DC', borderRadius: 8, fontSize: 13, background: '#fff' };
const downloadBtn: React.CSSProperties = { fontSize: 13, color: '#0F1115', border: '1px solid #D2D6DC', borderRadius: 6, padding: '6px 14px', textDecoration: 'none' };
const smallBtn = (color: string): React.CSSProperties => ({ background: '#fff', color, border: `1px solid ${color}40`, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 });
const bulkBtn = (color: string): React.CSSProperties => ({ background: color, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 });
const iconBtn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, color: '#7A828F', padding: 2 };
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 };
const modalBox: React.CSSProperties = { background: '#fff', borderRadius: 12, padding: 20, width: 'min(520px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' };
const modalCancelBtn: React.CSSProperties = { background: '#fff', color: '#525A65', border: '1px solid #D2D6DC', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 };
const modalConfirmBtn: React.CSSProperties = { background: '#0F1115', color: '#fff', border: '1px solid #0F1115', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 };
