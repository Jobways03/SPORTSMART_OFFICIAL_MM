'use client';

import { useCallback, useEffect, useState } from 'react';
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
  const canIngest = hasPermission('payouts.ingestResponse');

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

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Payouts</h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            Bundle approved settlements into bank-export batches, generate CSVs, and ingest bank responses.
          </p>
        </div>
        {canExport && (
          <button onClick={() => setShowCreate(true)} style={btnPrimary}>
            + New batch from cycle
          </button>
        )}
      </div>

      {error && <div style={errorBox}>{error}</div>}

      {loading ? (
        <div style={{ color: '#64748b' }}>Loading payout batches…</div>
      ) : batches.length === 0 ? (
        <div style={emptyBox}>
          No payout batches yet. Create one from an approved settlement cycle to get started.
        </div>
      ) : (
        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr style={trHead}>
                <th style={th}>Batch ID</th>
                <th style={th}>Status</th>
                <th style={th}>Payouts</th>
                <th style={th}>Created</th>
                <th style={th}>Exported</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr
                  key={b.id}
                  style={trClickable}
                  onClick={() => router.push(`/dashboard/payouts/${b.id}`)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: '#2563eb', fontWeight: 600 }}>
                    {b.id.slice(0, 8)}…
                  </td>
                  <td style={td}><StatusBadge status={b.status} /></td>
                  <td style={td}>{b._count?.payouts ?? '—'}</td>
                  <td style={{ ...td, color: '#64748b', fontSize: 12 }}>
                    {new Date(b.createdAt).toLocaleString('en-IN')}
                  </td>
                  <td style={{ ...td, color: '#64748b', fontSize: 12 }}>
                    {b.exportedAt ? new Date(b.exportedAt).toLocaleString('en-IN') : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <Link
                      href={`/dashboard/payouts/${b.id}`}
                      style={linkBtn}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateBatchModal
          onClose={() => setShowCreate(false)}
          onSaved={async (batch) => {
            setShowCreate(false);
            if (batch) {
              router.push(`/dashboard/payouts/${batch.id}`);
            } else {
              await refresh();
            }
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PayoutBatchSummary['status'] }) {
  const { bg, fg } = PAYOUT_STATUS_COLOR[status];
  return (
    <span style={{ ...badge, background: bg, color: fg }}>
      {status.replace('_', ' ')}
    </span>
  );
}

function CreateBatchModal({
  onClose,
  onSaved,
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
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={{ ...modalBody, maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>New payout batch</h2>
          <button onClick={onClose} style={btnClose}>×</button>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 12, color: '#64748b', marginTop: 0 }}>
            Pulls every <strong>APPROVED</strong> settlement in the chosen cycle into a new payout batch.
            You can find cycle IDs in the Commission / Settlements area.
          </p>
          <label style={{ display: 'block' }}>
            <div style={fieldLabel}>Settlement cycle ID</div>
            <input
              value={cycleId}
              onChange={(e) => setCycleId(e.target.value)}
              placeholder="UUID of the settlement cycle"
              style={inputStyle}
            />
          </label>
          {err && <div style={errorBox}>{err}</div>}
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button
            onClick={submit}
            disabled={submitting}
            style={{ ...btnPrimary, opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? 'Creating…' : 'Create batch'}
          </button>
        </div>
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  fontSize: 11, color: '#64748b', marginBottom: 4, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.5,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none',
  borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  padding: '6px 12px', background: '#fff', color: '#475569',
  border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, fontWeight: 500,
  cursor: 'pointer',
};
const btnClose: React.CSSProperties = {
  width: 28, height: 28, border: 'none', background: 'transparent',
  fontSize: 22, cursor: 'pointer', color: '#64748b', lineHeight: 1,
};
const linkBtn: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#2563eb',
  textDecoration: 'none', padding: '4px 8px',
};
const tableWrap: React.CSSProperties = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden',
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const trHead: React.CSSProperties = { background: '#f8fafc', borderBottom: '1px solid #e2e8f0' };
const trClickable: React.CSSProperties = {
  borderBottom: '1px solid #f1f5f9',
  cursor: 'pointer',
  transition: 'background 120ms',
};
const th: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600,
  color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5,
};
const td: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: '#1e293b' };
const badge: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 12,
  fontSize: 11, fontWeight: 600,
};
const errorBox: React.CSSProperties = {
  marginTop: 12, padding: 10, background: '#fef2f2', border: '1px solid #fecaca',
  borderRadius: 6, color: '#991b1b', fontSize: 12,
};
const emptyBox: React.CSSProperties = {
  background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 10,
  padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13,
};
const modalBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const modalBody: React.CSSProperties = {
  background: '#fff', borderRadius: 12, width: '92%', maxWidth: 480,
  boxShadow: '0 20px 60px rgba(0,0,0,0.20)',
};
const modalHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '14px 20px', borderBottom: '1px solid #e2e8f0',
};
const modalFooter: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 8,
  padding: '12px 20px', borderTop: '1px solid #e2e8f0',
};
