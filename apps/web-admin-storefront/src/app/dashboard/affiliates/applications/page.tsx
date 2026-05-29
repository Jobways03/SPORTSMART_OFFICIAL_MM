'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePermissions } from '@/lib/permissions';
import {
  adminAffiliatesService as svc,
  AffiliateRow,
  AFFILIATE_STATUS_COLOR,
} from '@/services/admin-affiliates.service';

const STATUS_FILTERS = ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'ALL'] as const;

export default function AffiliateApplicationsPage() {
  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('affiliates.approve'); // approve + reject
  const canSuspend = hasPermission('affiliates.suspend');

  const [rows, setRows] = useState<AffiliateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('PENDING_APPROVAL');
  const [busy, setBusy] = useState<string | null>(null);

  // Reason modal (reject / suspend).
  const [reasonFor, setReasonFor] = useState<{ row: AffiliateRow; kind: 'reject' | 'suspend' | 'reactivate' } | null>(null);
  const [reason, setReason] = useState('');
  const [modalErr, setModalErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await svc.list({ status: statusFilter === 'ALL' ? undefined : statusFilter });
      setRows(res?.data?.affiliates ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load affiliate applications');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (row: AffiliateRow) => {
    if (!window.confirm(`Approve ${name(row)}'s affiliate application? A primary coupon will be generated.`)) return;
    setBusy(row.id);
    setError('');
    try {
      await svc.approve(row.id);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Approve failed');
    } finally {
      setBusy(null);
    }
  };

  const submitReason = async () => {
    if (!reasonFor) return;
    setModalErr('');
    // Reactivation reason is optional; reject/suspend require one.
    if (reasonFor.kind !== 'reactivate' && reason.trim().length < 1) {
      setModalErr('A reason is required.');
      return;
    }
    setBusy(reasonFor.row.id);
    try {
      if (reasonFor.kind === 'reject') await svc.reject(reasonFor.row.id, reason.trim());
      else if (reasonFor.kind === 'suspend') await svc.suspend(reasonFor.row.id, reason.trim());
      else await svc.reactivate(reasonFor.row.id, reason.trim() || undefined);
      setReasonFor(null);
      setReason('');
      await load();
    } catch (e: any) {
      setModalErr(e?.message ?? 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Affiliate applications</h1>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
        Review affiliate sign-ups. Approve a pending application (generates a coupon), reject it, or suspend an active affiliate.
      </p>

      <div style={{ display: 'flex', gap: 6, margin: '16px 0', flexWrap: 'wrap' }}>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: '1px solid #e2e8f0',
              background: statusFilter === s ? '#0F1115' : '#fff',
              color: statusFilter === s ? '#fff' : '#475569',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#64748b' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#64748b' }}>No applications in this view.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '2px solid #eee' }}>
              <th style={th}>Applicant</th>
              <th style={th}>Contact</th>
              <th style={th}>Website / social</th>
              <th style={th}>Status</th>
              <th style={th}>Applied</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meta = AFFILIATE_STATUS_COLOR[r.status];
              return (
                <tr key={r.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={td}>
                    {/* Link to the detail page where coupon discounts are configured. */}
                    <Link href={`/dashboard/affiliates/${r.id}`} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 700 }}>
                      {name(r)}
                    </Link>
                    {r.joinReason && (
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, maxWidth: 280 }}>
                        {r.joinReason.slice(0, 120)}
                        {r.joinReason.length > 120 ? '…' : ''}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    {r.email}
                    <br />
                    <small style={{ color: '#94a3b8' }}>{r.phone ?? '—'}</small>
                  </td>
                  <td style={{ ...td, fontSize: 11, color: '#475569', maxWidth: 200, wordBreak: 'break-all' }}>
                    {r.websiteUrl ? (
                      // Render as text (not a clickable link) — the URL is
                      // applicant-supplied; React escapes it so no injection.
                      <span>{r.websiteUrl}</span>
                    ) : (
                      '—'
                    )}
                    {r.socialHandle && <div style={{ color: '#94a3b8' }}>{r.socialHandle}</div>}
                  </td>
                  <td style={td}>
                    <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: meta?.bg, color: meta?.fg }}>
                      {r.status.replace(/_/g, ' ')}
                    </span>
                    {(r.rejectionReason || r.suspensionReason) && (
                      <div style={{ fontSize: 10, color: '#b91c1c', marginTop: 2 }}>{r.rejectionReason || r.suspensionReason}</div>
                    )}
                  </td>
                  <td style={{ ...td, color: '#64748b', fontSize: 11 }}>
                    {new Date(r.createdAt).toLocaleDateString('en-IN')}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {r.status === 'PENDING_APPROVAL' && canApprove && (
                        <button disabled={busy === r.id} onClick={() => approve(r)} style={{ ...btn, borderColor: '#15803d', color: '#15803d' }}>
                          Approve
                        </button>
                      )}
                      {r.status === 'PENDING_APPROVAL' && canApprove && (
                        <button disabled={busy === r.id} onClick={() => { setReasonFor({ row: r, kind: 'reject' }); setReason(''); setModalErr(''); }} style={{ ...btn, borderColor: '#b91c1c', color: '#b91c1c' }}>
                          Reject
                        </button>
                      )}
                      {r.status === 'ACTIVE' && canSuspend && (
                        <button disabled={busy === r.id} onClick={() => { setReasonFor({ row: r, kind: 'suspend' }); setReason(''); setModalErr(''); }} style={btn}>
                          Suspend
                        </button>
                      )}
                      {(r.status === 'SUSPENDED' || r.status === 'INACTIVE') && canSuspend && (
                        <button disabled={busy === r.id} onClick={() => { setReasonFor({ row: r, kind: 'reactivate' }); setReason(''); setModalErr(''); }} style={{ ...btn, borderColor: '#15803d', color: '#15803d' }}>
                          Reactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {reasonFor && (
        <div style={backdrop} onClick={() => !busy && setReasonFor(null)}>
          <div style={card} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
              {reasonFor.kind === 'reject'
                ? 'Reject application'
                : reasonFor.kind === 'suspend'
                ? 'Suspend affiliate'
                : 'Reactivate affiliate'}
            </h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '6px 0 12px' }}>
              {name(reasonFor.row)} — this reason is recorded on the affiliate + the status-history audit trail.
              {reasonFor.kind === 'reactivate' ? ' (Optional.)' : ''}
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonFor.kind === 'reactivate' ? 'Reason (optional)' : 'Reason'}
              rows={3}
              autoFocus
              style={{ ...input, resize: 'vertical' }}
            />
            {modalErr && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>{modalErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setReasonFor(null)} disabled={!!busy} style={btn}>Cancel</button>
              <button
                onClick={submitReason}
                disabled={!!busy}
                style={{
                  ...btn,
                  background: reasonFor.kind === 'reactivate' ? '#15803d' : '#b91c1c',
                  color: '#fff',
                  borderColor: reasonFor.kind === 'reactivate' ? '#15803d' : '#b91c1c',
                }}
              >
                {busy
                  ? 'Saving…'
                  : reasonFor.kind === 'reject'
                  ? 'Reject'
                  : reasonFor.kind === 'suspend'
                  ? 'Suspend'
                  : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function name(r: AffiliateRow): string {
  return `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || r.email;
}

const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px', verticalAlign: 'top' };
const btn: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#475569',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,17,21,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
  padding: 16,
};
const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: 14,
  padding: 22,
  width: '100%',
  maxWidth: 440,
  boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
};
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  fontSize: 13,
  fontFamily: 'inherit',
};
