'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatDate } from '../../../lib/api';

interface Affiliate {
  id: string;
  email: string;
  phone?: string | null;
  firstName: string;
  lastName: string;
  status: string;
  kycStatus: string;
  updatedAt?: string;
}

interface PageData {
  affiliates: Affiliate[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface KycRecord {
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  panLast4?: string | null;
  aadhaarLast4?: string | null;
  panDocumentUrl?: string | null;
  aadhaarDocumentUrl?: string | null;
  verifiedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

const FILTERS = ['all', 'PENDING', 'VERIFIED', 'REJECTED'] as const;
type Filter = (typeof FILTERS)[number];

type ConfirmAction =
  | { kind: 'verify'; affiliateId: string; name: string }
  | { kind: 'reject'; affiliateId: string; name: string };

export default function KycQueuePage() {
  const [data, setData] = useState<PageData | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [openName, setOpenName] = useState<string>('');
  const [openKyc, setOpenKyc] = useState<KycRecord | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const url = `/admin/affiliates${filter === 'all' ? '' : `?kycStatus=${filter}`}`;
      const d = await apiFetch<PageData>(url);
      setData(d);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load.');
    } finally {
      setLoading(false);
    }
  };

  const loadCounts = async () => {
    const all: Filter[] = ['PENDING', 'VERIFIED', 'REJECTED'];
    try {
      const results = await Promise.all(
        all.map((s) =>
          apiFetch<PageData>(`/admin/affiliates?kycStatus=${s}&limit=1`).then(
            (r) => [s, r.pagination.total] as const,
          ),
        ),
      );
      const map: Record<string, number> = {};
      for (const [s, n] of results) map[s] = n;
      setCounts(map);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    loadCounts();
  }, []);

  const openDetails = async (a: Affiliate) => {
    setOpenId(a.id);
    setOpenName(`${a.firstName} ${a.lastName}`);
    setOpenKyc(null);
    try {
      const k = await apiFetch<KycRecord | null>(`/admin/affiliates/${a.id}/kyc`);
      setOpenKyc(k);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load KYC.');
      setOpenId(null);
    }
  };

  const closeConfirm = () => {
    setConfirmAction(null);
    setActionError('');
  };

  const runVerify = async (affiliateId: string) => {
    setActionLoading(true);
    setActionError('');
    try {
      await apiFetch(`/admin/affiliates/${affiliateId}/kyc/verify`, { method: 'PATCH' });
      closeConfirm();
      setOpenId(null);
      setOpenKyc(null);
      await load();
      await loadCounts();
    } catch (e: any) {
      setActionError(e?.message ?? 'Verification failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const runReject = async (affiliateId: string, reason: string) => {
    setActionLoading(true);
    setActionError('');
    try {
      await apiFetch(`/admin/affiliates/${affiliateId}/kyc/reject`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      });
      closeConfirm();
      setOpenId(null);
      setOpenKyc(null);
      await load();
      await loadCounts();
    } catch (e: any) {
      setActionError(e?.message ?? 'Rejection failed.');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>
          KYC review
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          Verify affiliate identity documents. Verification unlocks payouts (PAN required for §194H TDS reporting).
        </p>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}>
        <Kpi label="Awaiting review" value={counts.PENDING ?? 0} tone="warning" pulse={!!counts.PENDING} />
        <Kpi label="Verified" value={counts.VERIFIED ?? 0} tone="success" />
        <Kpi label="Rejected" value={counts.REJECTED ?? 0} tone="danger" />
      </section>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 999,
              border: '1px solid ' + (filter === s ? '#2563eb' : '#cbd5e1'),
              background: filter === s ? '#2563eb' : '#fff',
              color: filter === s ? '#fff' : '#475569',
              cursor: 'pointer',
            }}
          >
            {s === 'all' ? 'All' : s}
          </button>
        ))}
      </div>

      {error && <div style={errBox}>{error}</div>}

      {loading ? (
        <ListSkeleton />
      ) : !data || data.affiliates.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.affiliates.map((a) => (
            <KycRow key={a.id} affiliate={a} onOpen={() => openDetails(a)} />
          ))}
        </div>
      )}

      {openId && (
        <Modal onClose={() => { setOpenId(null); setOpenKyc(null); }}>
          {!openKyc ? (
            <p style={{ padding: 20, color: '#64748b' }}>Loading KYC…</p>
          ) : (
            <>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>{openName}</h2>
              <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 18px' }}>
                Submitted {openKyc.createdAt ? formatDate(openKyc.createdAt) : '—'}
                {openKyc.updatedAt && ` · Last updated ${formatDate(openKyc.updatedAt)}`}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
                <KycField label="PAN (last 4)" value={openKyc.panLast4 ? `XXXXXX${openKyc.panLast4}` : '—'} mono />
                <KycField label="Aadhaar (last 4)" value={openKyc.aadhaarLast4 ? `XXXX-XXXX-${openKyc.aadhaarLast4}` : '—'} mono />
                <DocPreview label="PAN document" url={openKyc.panDocumentUrl} />
                <DocPreview label="Aadhaar document" url={openKyc.aadhaarDocumentUrl} />
                <KycField label="Status" value={<span style={kycPill(openKyc.status)}>{openKyc.status}</span>} />
                {openKyc.verifiedAt && <KycField label="Verified" value={formatDate(openKyc.verifiedAt)} />}
                {openKyc.rejectedAt && <KycField label="Rejected" value={formatDate(openKyc.rejectedAt)} />}
                {openKyc.rejectionReason && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <KycField label="Rejection reason" value={openKyc.rejectionReason} />
                  </div>
                )}
              </div>

              {openKyc.status === 'PENDING' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => setConfirmAction({ kind: 'reject', affiliateId: openId!, name: openName })} style={btnDanger}>
                    Reject
                  </button>
                  <button onClick={() => setConfirmAction({ kind: 'verify', affiliateId: openId!, name: openName })} style={btnSuccess}>
                    Verify
                  </button>
                </div>
              )}
            </>
          )}
        </Modal>
      )}

      {confirmAction?.kind === 'verify' && (
        <ConfirmModal
          tone="success"
          title={`Verify ${confirmAction.name}'s KYC?`}
          body="Once verified, this affiliate becomes eligible to request payouts. The action is logged with your admin ID."
          confirmLabel="Verify"
          loading={actionLoading}
          error={actionError}
          onCancel={closeConfirm}
          onConfirm={() => runVerify(confirmAction.affiliateId)}
        />
      )}

      {confirmAction?.kind === 'reject' && (
        <RejectKycModal
          name={confirmAction.name}
          loading={actionLoading}
          error={actionError}
          onCancel={closeConfirm}
          onConfirm={(reason) => runReject(confirmAction.affiliateId, reason)}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, tone, pulse }: { label: string; value: number; tone: 'success' | 'warning' | 'danger'; pulse?: boolean }) {
  const fg =
    tone === 'success' ? '#16a34a' :
    tone === 'warning' ? '#b45309' :
    '#b91c1c';
  return (
    <div style={{ padding: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, position: 'relative' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: fg, marginTop: 4, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
        {value}
      </div>
      {pulse && value > 0 && (
        <span style={{
          position: 'absolute', top: 12, right: 12,
          width: 8, height: 8, borderRadius: '50%',
          background: fg,
          boxShadow: `0 0 0 4px ${fg}22`,
        }} />
      )}
    </div>
  );
}

function KycRow({ affiliate: a, onOpen }: { affiliate: Affiliate; onOpen: () => void }) {
  const initials = `${a.firstName?.[0] ?? ''}${a.lastName?.[0] ?? ''}`.toUpperCase();
  const age = a.updatedAt ? daysAgo(a.updatedAt) : null;
  const stale = age !== null && age >= 2 && a.kycStatus === 'PENDING';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        background: '#fff',
        border: '1px solid ' + (stale ? '#fecaca' : '#e2e8f0'),
        borderRadius: 12,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: '#dbeafe',
          color: '#1d4ed8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 13,
          flexShrink: 0,
        }}
      >
        {initials || '?'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{a.firstName} {a.lastName}</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
          {a.email}
          {a.phone && <> · {a.phone}</>}
        </div>
      </div>
      {age !== null && (
        <span style={{ fontSize: 11, color: stale ? '#b91c1c' : '#94a3b8' }}>
          {stale && '⏰ '}
          {age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}
        </span>
      )}
      <span style={kycPill(a.kycStatus)}>{a.kycStatus.replace(/_/g, ' ')}</span>
      <button onClick={onOpen} style={btnPrimary}>
        Review
      </button>
    </div>
  );
}

function DocPreview({ label, url }: { label: string; url?: string | null }) {
  if (!url) {
    return <KycField label={label} value="—" />;
  }
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        {label}
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#1d4ed8', textDecoration: 'none' }}
      >
        View document
        <span>↗</span>
      </a>
    </div>
  );
}

function KycField({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontFamily: mono ? 'ui-monospace, Menlo, monospace' : 'inherit' }}>
        {value}
      </div>
    </div>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const messages: Record<Filter, { emoji: string; title: string; sub: string }> = {
    PENDING: { emoji: '✨', title: 'Inbox zero', sub: 'No KYC submissions are awaiting review.' },
    VERIFIED: { emoji: '✅', title: 'No verified affiliates', sub: 'Once you verify a submission, it appears here.' },
    REJECTED: { emoji: '🚫', title: 'No rejections', sub: 'Rejected KYC submissions will appear here.' },
    all: { emoji: '🛂', title: 'No KYC records', sub: 'Affiliate KYC submissions will appear here.' },
  };
  const m = messages[filter];
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{m.emoji}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{m.title}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{m.sub}</div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ height: 68, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12 }} />
      ))}
    </div>
  );
}

function ConfirmModal({
  tone,
  title,
  body,
  confirmLabel,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  tone: 'success' | 'danger';
  title: string;
  body: string;
  confirmLabel: string;
  loading: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmStyle = tone === 'success' ? btnSuccess : btnDanger;
  return (
    <Modal onClose={loading ? () => {} : onCancel} zIndex={60} width={460}>
      <h2 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px' }}>{title}</h2>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 18px', lineHeight: 1.55 }}>{body}</p>
      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} disabled={loading} style={btnGhost}>Cancel</button>
        <button onClick={onConfirm} disabled={loading} style={confirmStyle}>
          {loading ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function RejectKycModal({
  name,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  loading: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  return (
    <Modal onClose={loading ? () => {} : onCancel} zIndex={60} width={520}>
      <h2 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px' }}>Reject {name}'s KYC?</h2>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 16px', lineHeight: 1.55 }}>
        The affiliate will see this reason and can re-submit corrected documents.
      </p>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
        Reason (visible to affiliate) <span style={{ color: '#dc2626' }}>*</span>
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={4}
        autoFocus
        placeholder="e.g. PAN scan is too blurry to verify; please re-upload a clearer image."
        style={{
          width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 6,
          fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
        }}
      />
      {error && (
        <div style={{ padding: '8px 12px', marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onCancel} disabled={loading} style={btnGhost}>Cancel</button>
        <button
          onClick={() => onConfirm(trimmed)}
          disabled={loading || !trimmed}
          style={{ ...btnDanger, opacity: !trimmed ? 0.5 : 1, cursor: !trimmed ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'Rejecting…' : 'Reject submission'}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, zIndex = 50, width = 640 }: { children: React.ReactNode; onClose: () => void; zIndex?: number; width?: number }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 28,
          maxWidth: width,
          width: 'calc(100% - 32px)',
          maxHeight: 'calc(100vh - 80px)',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function kycPill(status: string): React.CSSProperties {
  const palette: Record<string, { bg: string; fg: string }> = {
    NOT_STARTED: { bg: '#f1f5f9', fg: '#475569' },
    PENDING: { bg: '#fef3c7', fg: '#92400e' },
    VERIFIED: { bg: '#dcfce7', fg: '#15803d' },
    REJECTED: { bg: '#fee2e2', fg: '#991b1b' },
  };
  const p = palette[status] ?? { bg: '#f1f5f9', fg: '#475569' };
  return {
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 999,
    background: p.bg,
    color: p.fg,
    whiteSpace: 'nowrap',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
  };
}

function daysAgo(date: string): number {
  const ms = Date.now() - new Date(date).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

const errBox: React.CSSProperties = {
  padding: '10px 12px',
  marginBottom: 16,
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 8,
  fontSize: 12,
  color: '#991b1b',
};

const btnPrimary: React.CSSProperties = {
  padding: '7px 14px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  padding: '7px 14px',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnSuccess: React.CSSProperties = {
  padding: '8px 18px',
  background: '#16a34a',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  padding: '8px 18px',
  background: '#fff',
  color: '#b91c1c',
  border: '1px solid #fecaca',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
