'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatDateTime, formatINR } from '../../../lib/api';

interface PayoutRequest {
  id: string;
  affiliateId: string;
  affiliate?: { firstName?: string; lastName?: string; email?: string };
  payoutMethodId: string;
  grossAmount: string;
  reversalDebit: string;
  tdsAmount: string;
  netAmount: string;
  financialYear: string;
  status: 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';
  requestedAt: string;
  approvedAt?: string | null;
  paidAt?: string | null;
  failedAt?: string | null;
  failureReason?: string | null;
  transactionRef?: string | null;
}

interface PageData {
  requests: PayoutRequest[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const FILTERS = ['all', 'REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED'] as const;
type Filter = (typeof FILTERS)[number];

type PromptModal =
  | { kind: 'approve'; request: PayoutRequest }
  | { kind: 'mark-paid'; request: PayoutRequest }
  | { kind: 'mark-failed'; request: PayoutRequest }
  | null;

export default function PayoutsQueuePage() {
  const [data, setData] = useState<PageData | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [promptModal, setPromptModal] = useState<PromptModal>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const url = `/admin/affiliates/payouts${filter === 'all' ? '' : `?status=${filter}`}`;
      const d = await apiFetch<PageData>(url);
      setData(d);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load.');
    } finally {
      setLoading(false);
    }
  };

  const loadCounts = async () => {
    const all: Filter[] = ['REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED'];
    try {
      const results = await Promise.all(
        all.map((s) =>
          apiFetch<PageData>(`/admin/affiliates/payouts?status=${s}&limit=1`).then(
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

  const closePrompt = () => {
    setPromptModal(null);
    setActionError('');
  };

  const runApprove = async (id: string) => {
    setActionError('');
    setActionLoading(true);
    try {
      await apiFetch(`/admin/affiliates/payouts/${id}/approve`, { method: 'PATCH' });
      closePrompt();
      await load();
      await loadCounts();
    } catch (e: any) {
      setActionError(e?.message ?? 'Approval failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const runMarkPaid = async (id: string, ref: string) => {
    setActionError('');
    setActionLoading(true);
    try {
      await apiFetch(`/admin/affiliates/payouts/${id}/mark-paid`, {
        method: 'PATCH',
        body: JSON.stringify({ transactionRef: ref || undefined }),
      });
      closePrompt();
      await load();
      await loadCounts();
    } catch (e: any) {
      setActionError(e?.message ?? 'Mark-paid failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const runMarkFailed = async (id: string, reason: string) => {
    setActionError('');
    setActionLoading(true);
    try {
      await apiFetch(`/admin/affiliates/payouts/${id}/mark-failed`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      });
      closePrompt();
      await load();
      await loadCounts();
    } catch (e: any) {
      setActionError(e?.message ?? 'Mark-failed failed.');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 1280 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' }}>Payouts</h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          Approve withdrawal requests, then mark paid after the bank transfer settles.
          Mark-failed releases bundled commissions back to CONFIRMED so the affiliate can retry.
        </p>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
        <Kpi label="Awaiting approval" value={counts.REQUESTED ?? 0} tone="warning" pulse={!!counts.REQUESTED} />
        <Kpi label="Approved" value={counts.APPROVED ?? 0} tone="info" />
        <Kpi label="Processing" value={counts.PROCESSING ?? 0} tone="info" />
        <Kpi label="Paid" value={counts.PAID ?? 0} tone="success" />
        <Kpi label="Failed" value={counts.FAILED ?? 0} tone="danger" />
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
      ) : !data || data.requests.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.requests.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              busy={actionLoading}
              onApprove={() => setPromptModal({ kind: 'approve', request: r })}
              onMarkPaid={() => setPromptModal({ kind: 'mark-paid', request: r })}
              onMarkFailed={() => setPromptModal({ kind: 'mark-failed', request: r })}
            />
          ))}
        </div>
      )}

      {promptModal?.kind === 'approve' && (
        <ConfirmModal
          tone="success"
          title="Approve payout?"
          body={`This moves the request from REQUESTED to APPROVED. After the bank transfer settles, mark it paid to settle the bundled commissions.`}
          summary={promptModal.request}
          confirmLabel="Approve"
          loading={actionLoading}
          error={actionError}
          onCancel={closePrompt}
          onConfirm={() => runApprove(promptModal.request.id)}
        />
      )}
      {promptModal?.kind === 'mark-paid' && (
        <PromptModalText
          tone="success"
          title="Mark payout as paid"
          summary={promptModal.request}
          fieldLabel="Bank transaction reference (UTR / RRN)"
          placeholder="e.g. UTR123456789 (optional)"
          confirmLabel="Mark paid"
          required={false}
          loading={actionLoading}
          error={actionError}
          onCancel={closePrompt}
          onConfirm={(value) => runMarkPaid(promptModal.request.id, value)}
        />
      )}
      {promptModal?.kind === 'mark-failed' && (
        <PromptModalText
          tone="danger"
          title="Mark payout as failed"
          summary={promptModal.request}
          fieldLabel="Failure reason (visible to the affiliate)"
          placeholder="e.g. Bank account inactive — affiliate to verify details."
          confirmLabel="Mark failed"
          required
          loading={actionLoading}
          error={actionError}
          onCancel={closePrompt}
          onConfirm={(value) => runMarkFailed(promptModal.request.id, value)}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, tone, pulse }: { label: string; value: number; tone: 'success' | 'warning' | 'info' | 'danger' | 'neutral'; pulse?: boolean }) {
  const fg =
    tone === 'success' ? '#16a34a' :
    tone === 'warning' ? '#b45309' :
    tone === 'info' ? '#1d4ed8' :
    tone === 'danger' ? '#b91c1c' :
    '#0f172a';
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

function RequestCard({
  request: r,
  busy,
  onApprove,
  onMarkPaid,
  onMarkFailed,
}: {
  request: PayoutRequest;
  busy: boolean;
  onApprove: () => void;
  onMarkPaid: () => void;
  onMarkFailed: () => void;
}) {
  const initials = `${r.affiliate?.firstName?.[0] ?? ''}${r.affiliate?.lastName?.[0] ?? ''}`.toUpperCase();
  const showApprove = r.status === 'REQUESTED';
  const showMarkPaid = ['REQUESTED', 'APPROVED', 'PROCESSING'].includes(r.status);
  const showMarkFailed = ['REQUESTED', 'APPROVED', 'PROCESSING'].includes(r.status);

  return (
    <article style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
      {/* Top row: affiliate + status + net amount */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {r.affiliate?.firstName} {r.affiliate?.lastName}
            </div>
            <PayoutStatusPill status={r.status} />
            <span style={{ fontSize: 11, color: '#94a3b8' }}>FY {r.financialYear}</span>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {r.affiliate?.email}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
            Requested {formatDateTime(r.requestedAt)}
            {r.approvedAt && <> · Approved {formatDateTime(r.approvedAt)}</>}
            {r.paidAt && <> · Paid {formatDateTime(r.paidAt)}</>}
            {r.failedAt && <> · Failed {formatDateTime(r.failedAt)}</>}
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 130 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Net</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
            {formatINR(r.netAmount)}
          </div>
        </div>
      </div>

      {/* Breakdown */}
      <div
        style={{
          padding: '12px 14px',
          background: '#f8fafc',
          border: '1px solid #f1f5f9',
          borderRadius: 8,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 10,
          marginBottom: r.failureReason || (r.transactionRef && r.status === 'PAID') ? 12 : 0,
        }}
      >
        <Field label="Gross" value={formatINR(r.grossAmount)} />
        <Field label="Reversal" value={Number(r.reversalDebit) > 0 ? `−${formatINR(r.reversalDebit)}` : '—'} tone={Number(r.reversalDebit) > 0 ? 'danger' : 'muted'} />
        <Field label="TDS" value={Number(r.tdsAmount) > 0 ? `−${formatINR(r.tdsAmount)}` : '—'} tone={Number(r.tdsAmount) > 0 ? 'danger' : 'muted'} />
        <Field label="Reference" value={r.transactionRef ?? '—'} mono />
      </div>

      {r.failureReason && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
          <strong>Failure reason:</strong> {r.failureReason}
        </div>
      )}

      {(showApprove || showMarkPaid || showMarkFailed) && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {showApprove && (
            <button onClick={onApprove} disabled={busy} style={btnPrimary}>
              Approve
            </button>
          )}
          {showMarkPaid && (
            <button onClick={onMarkPaid} disabled={busy} style={btnSuccess}>
              Mark paid
            </button>
          )}
          {showMarkFailed && (
            <button onClick={onMarkFailed} disabled={busy} style={btnDanger}>
              Mark failed
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function Field({ label, value, tone, mono }: { label: string; value: string; tone?: 'danger' | 'muted'; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>{label}</div>
      <div style={{
        fontSize: 13,
        fontWeight: 600,
        color: tone === 'danger' ? '#b91c1c' : tone === 'muted' ? '#94a3b8' : '#0f172a',
        fontFamily: mono ? 'ui-monospace, Menlo, monospace' : 'inherit',
        fontVariantNumeric: !mono ? 'tabular-nums' : 'normal',
        marginTop: 2,
      }}>
        {value}
      </div>
    </div>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const messages: Record<Filter, { emoji: string; title: string; sub: string }> = {
    REQUESTED: { emoji: '✨', title: 'Inbox zero', sub: 'No payout requests are awaiting approval.' },
    APPROVED: { emoji: '⏳', title: 'Nothing approved', sub: 'Approved-but-not-paid requests will appear here.' },
    PROCESSING: { emoji: '⚙️', title: 'Nothing processing', sub: 'In-flight bank transfers will appear here.' },
    PAID: { emoji: '✅', title: 'No completed payouts', sub: 'Paid payouts show up here for record-keeping.' },
    FAILED: { emoji: '⚠️', title: 'No failures', sub: 'Failed payouts (with reasons) will appear here.' },
    all: { emoji: '🪙', title: 'No payouts yet', sub: 'Once an affiliate requests a payout, it appears here.' },
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[0, 1].map((i) => (
        <div key={i} style={{ height: 160, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12 }} />
      ))}
    </div>
  );
}

function PayoutStatusPill({ status }: { status: PayoutRequest['status'] }) {
  const palette: Record<PayoutRequest['status'], { bg: string; fg: string }> = {
    REQUESTED: { bg: '#fef3c7', fg: '#92400e' },
    APPROVED: { bg: '#dbeafe', fg: '#1e40af' },
    PROCESSING: { bg: '#e0e7ff', fg: '#3730a3' },
    PAID: { bg: '#dcfce7', fg: '#15803d' },
    FAILED: { bg: '#fee2e2', fg: '#991b1b' },
    CANCELLED: { bg: '#f1f5f9', fg: '#475569' },
  };
  const p = palette[status];
  return (
    <span style={{ padding: '3px 9px', fontSize: 10, fontWeight: 700, borderRadius: 999, background: p.bg, color: p.fg, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {status}
    </span>
  );
}

/* ── Modals ─────────────────────────── */

function PayoutSummary({ request: r }: { request: PayoutRequest }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ color: '#64748b' }}>Affiliate</span>
        <strong>{r.affiliate?.firstName} {r.affiliate?.lastName}</strong>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ color: '#64748b' }}>Gross</span>
        <span>{formatINR(r.grossAmount)}</span>
      </div>
      {Number(r.reversalDebit) > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: '#64748b' }}>Reversal</span>
          <span style={{ color: '#b91c1c' }}>−{formatINR(r.reversalDebit)}</span>
        </div>
      )}
      {Number(r.tdsAmount) > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ color: '#64748b' }}>TDS (10%)</span>
          <span style={{ color: '#b91c1c' }}>−{formatINR(r.tdsAmount)}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid #e2e8f0', fontWeight: 700 }}>
        <span>Net</span>
        <span style={{ color: '#16a34a' }}>{formatINR(r.netAmount)}</span>
      </div>
    </div>
  );
}

function ConfirmModal({
  tone,
  title,
  body,
  summary,
  confirmLabel,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  tone: 'success' | 'danger';
  title: string;
  body: string;
  summary?: PayoutRequest;
  confirmLabel: string;
  loading: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmStyle = tone === 'success' ? btnSuccess : btnDanger;
  return (
    <Modal onClose={loading ? () => {} : onCancel} width={460}>
      <h2 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px' }}>{title}</h2>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 16px', lineHeight: 1.55 }}>{body}</p>
      {summary && <PayoutSummary request={summary} />}
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

function PromptModalText({
  tone,
  title,
  summary,
  fieldLabel,
  placeholder,
  confirmLabel,
  required,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  tone: 'success' | 'danger';
  title: string;
  summary: PayoutRequest;
  fieldLabel: string;
  placeholder: string;
  confirmLabel: string;
  required: boolean;
  loading: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const confirmStyle = tone === 'success' ? btnSuccess : btnDanger;
  return (
    <Modal onClose={loading ? () => {} : onCancel} width={520}>
      <h2 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px' }}>{title}</h2>
      <PayoutSummary request={summary} />
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
        {fieldLabel} {required && <span style={{ color: '#dc2626' }}>*</span>}
      </label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        autoFocus
        placeholder={placeholder}
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
          disabled={loading || (required && !trimmed)}
          style={{ ...confirmStyle, opacity: required && !trimmed ? 0.5 : 1, cursor: required && !trimmed ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, width = 640 }: { children: React.ReactNode; onClose: () => void; width?: number }) {
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
        zIndex: 50,
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
  padding: '8px 16px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnSuccess: React.CSSProperties = {
  padding: '8px 16px',
  background: '#16a34a',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  padding: '8px 16px',
  background: '#fff',
  color: '#b91c1c',
  border: '1px solid #fecaca',
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
