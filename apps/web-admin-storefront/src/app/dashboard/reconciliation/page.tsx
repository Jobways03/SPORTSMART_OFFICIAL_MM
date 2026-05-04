'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminReconciliationService,
  ReconciliationRun,
  ReconciliationKind,
  ReconciliationStatus,
  KIND_LABEL,
  STATUS_COLOR,
} from '@/services/admin-reconciliation.service';

const KIND_OPTIONS: ReconciliationKind[] = [
  'PAYMENT', 'COD', 'SETTLEMENT', 'REFUND', 'WALLET',
];

export default function ReconciliationPage() {
  const router = useRouter();
  const [items, setItems] = useState<ReconciliationRun[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [kindFilter, setKindFilter] = useState<ReconciliationKind | ''>('');
  const [statusFilter, setStatusFilter] = useState<ReconciliationStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [showStartForm, setShowStartForm] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminReconciliationService.listRuns({
        page,
        limit: 50,
        kind: kindFilter || undefined,
        status: statusFilter || undefined,
      });
      if (res.data) {
        setItems(res.data.items);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, kindFilter, statusFilter]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Reconciliation</h1>
          <p style={{ marginTop: 4, marginBottom: 0, fontSize: 14, color: '#525A65' }}>
            Compare what we expected to settle against what actually moved.
          </p>
        </div>
        <button
          onClick={() => setShowStartForm((v) => !v)}
          style={primaryBtn}
        >
          {showStartForm ? 'Cancel' : '+ Start a run'}
        </button>
      </div>

      {showStartForm && (
        <StartRunForm
          onDone={() => {
            setShowStartForm(false);
            void fetch();
          }}
        />
      )}

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <select
          value={kindFilter}
          onChange={(e) => { setKindFilter(e.target.value as any); setPage(1); }}
          style={selectStyle}
        >
          <option value="">All kinds</option>
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }}
          style={selectStyle}
        >
          <option value="">All statuses</option>
          <option value="RUNNING">Running</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      {loading ? (
        <div style={{ padding: 32, color: '#7A828F' }}>Loading runs…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>
          No reconciliation runs yet. Start one above.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Kind</th>
                <th style={th}>Period</th>
                <th style={th}>Status</th>
                <th style={th}>Records</th>
                <th style={th}>Discrepancies</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderTop: '1px solid #F3F4F6', cursor: 'pointer' }}
                  onClick={() => router.push(`/dashboard/reconciliation/${r.id}`)}
                >
                  <td style={td}>{new Date(r.startedAt).toLocaleString('en-IN')}</td>
                  <td style={td}><strong>{KIND_LABEL[r.kind]}</strong></td>
                  <td style={td}>
                    {new Date(r.periodStart).toLocaleDateString('en-IN')} →{' '}
                    {new Date(r.periodEnd).toLocaleDateString('en-IN')}
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        background: STATUS_COLOR[r.status] + '20',
                        color: STATUS_COLOR[r.status],
                        padding: '2px 10px',
                        borderRadius: 12,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td style={td}>
                    {r.totalMatched} / {r.totalExpected}
                  </td>
                  <td style={{ ...td, fontWeight: r.totalDiscrepancies > 0 ? 700 : 400, color: r.totalDiscrepancies > 0 ? '#dc2626' : '#16a34a' }}>
                    {r.totalDiscrepancies}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={pageBtn}>
            ← Prev
          </button>
          <span style={{ fontSize: 13, color: '#525A65' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={pageBtn}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function StartRunForm({ onDone }: { onDone: () => void }) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const [kind, setKind] = useState<ReconciliationKind>('PAYMENT');
  const [periodStart, setPeriodStart] = useState(fmt(yesterday));
  const [periodEnd, setPeriodEnd] = useState(fmt(today));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      // Send full-day boundaries — start of day to end of day.
      const start = new Date(periodStart + 'T00:00:00.000Z').toISOString();
      const end = new Date(periodEnd + 'T23:59:59.999Z').toISOString();
      await adminReconciliationService.startRun({
        kind,
        periodStart: start,
        periodEnd: end,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to start run');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-end',
        flexWrap: 'wrap',
      }}
    >
      <div>
        <label style={lbl}>Kind</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as ReconciliationKind)} style={selectStyle}>
          {KIND_OPTIONS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Period start</label>
        <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} style={inputStyle} />
      </div>
      <div>
        <label style={lbl}>Period end</label>
        <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} style={inputStyle} />
      </div>
      <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Running…' : 'Start run'}
      </button>
      {err && <div style={{ color: '#dc2626', fontSize: 13, width: '100%' }}>{err}</div>}
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  fontSize: 13,
};
const selectStyle: React.CSSProperties = { ...inputStyle, minWidth: 140 };
const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#0F1115' };
const pageBtn: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #D2D6DC',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 13,
  cursor: 'pointer',
  color: '#0F1115',
};
const primaryBtn: React.CSSProperties = {
  ...pageBtn,
  background: '#0F1115',
  color: '#fff',
  border: '1px solid #0F1115',
  fontWeight: 600,
};
const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: '#525A65',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
};
