'use client';

// Tax mode toggle (Super Admin only).
//
// Three modes drive how strictly the tax engine validates invoice data:
//   OFF     — no validation; passthrough fallbacks. Initial onboarding only.
//   AUDIT   — validation runs, violations are LOGGED, requests still pass.
//             Recommended 2-week soak before flipping STRICT.
//   STRICT  — validation throws; bad data fails the request. Production.
//
// Each change writes an audit row (action='TAX_MODE_CHANGED'); the
// /admin/audit?module=tax-mode endpoint feeds the history table below.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useModal } from '@sportsmart/ui';
import { apiClient } from '@/lib/api-client';

type TaxMode = 'OFF' | 'AUDIT' | 'STRICT';

interface ModeResponse {
  mode: TaxMode;
}
interface AuditEntry {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

interface ModeMeta {
  value: TaxMode;
  label: string;
  short: string;
  tone: 'danger' | 'warning' | 'success';
  oneLiner: string;
  description: string;
  whenToUse: string;
  risks: string;
  recommended: boolean;
}

const MODES: ModeMeta[] = [
  {
    value: 'OFF',
    label: 'OFF',
    short: 'No validation',
    tone: 'danger',
    oneLiner: 'Bypass everything — silently fall back on missing data.',
    description:
      'No tax validation runs. Missing HSN, GST rate, or seller GSTIN values silently fall back ' +
      'to defaults. Invoices may be issued with incorrect tax fields.',
    whenToUse: 'Initial seeding only. Never run a production day in OFF.',
    risks: 'Invoices with bad tax data; downstream GSTR mismatches and customer disputes.',
    recommended: false,
  },
  {
    value: 'AUDIT',
    label: 'AUDIT',
    short: 'Log only',
    tone: 'warning',
    oneLiner: 'Validation runs, violations are logged but never throw.',
    description:
      'Validation logic runs on every request. Violations are written to structured logs for ' +
      "compliance review but don't block checkout or invoice generation.",
    whenToUse:
      'Run for at least 2 weeks after seeding masters. Review logs daily until the violation rate trends to zero, then graduate to STRICT.',
    risks: 'Bad data still hits invoices — but you can see the size of the problem.',
    recommended: false,
  },
  {
    value: 'STRICT',
    label: 'STRICT',
    short: 'Throw on bad data',
    tone: 'success',
    oneLiner: 'Validation throws. Bad data fails the request.',
    description:
      'Validation throws TaxStrictModeViolationError on any violation. The request fails — the ' +
      'caller must fix the source data before retrying. This is the production posture.',
    whenToUse:
      'Only flip to STRICT after AUDIT has shown a clean log for at least 7 consecutive days.',
    risks: 'Premature flip means checkouts fail. Don\'t flip without an audit-readiness check.',
    recommended: true,
  },
];

// ── Page ──────────────────────────────────────────────────────────

export default function TaxModePage() {
  const { confirmDialog } = useModal();
  const [currentMode, setCurrentMode] = useState<TaxMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<TaxMode | null>(null);
  const [banner, setBanner] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const loadMode = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<ModeResponse>('/admin/tax/reports/mode');
      const data = (res?.data as ModeResponse) ?? (res as unknown as ModeResponse);
      setCurrentMode(data?.mode ?? null);
      setRefreshedAt(new Date());
    } catch (err) {
      setError((err as Error).message || 'Failed to load current tax mode');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiClient<{ items: AuditEntry[] }>(
        '/admin/audit?module=tax-mode&limit=20',
      );
      const items =
        ((res?.data as { items?: AuditEntry[] })?.items as AuditEntry[]) ?? [];
      setHistory(items);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMode();
    loadHistory();
  }, [loadMode, loadHistory]);

  const handleChange = async (target: TaxMode) => {
    if (target === currentMode) return;
    const message =
      target === 'OFF'
        ? 'Switch tax mode to OFF? This bypasses ALL validation and lets bad data into invoices. Only do this for initial seeding.'
        : target === 'STRICT'
          ? 'Switch tax mode to STRICT? Once enabled, every invoice/checkout that fails validation will be REJECTED. Confirm that AUDIT mode has shown a clean log for at least 7 days.'
          : 'Switch tax mode to AUDIT? Validation runs but does not block requests — safe for soak.';
    const ok = await confirmDialog({
      title: `Switch tax mode to ${target}?`,
      message,
      confirmText: `Set ${target}`,
      cancelText: 'Cancel',
      danger: target === 'OFF' || target === 'STRICT',
    });
    if (!ok) return;

    setSubmitting(target);
    setBanner(null);
    try {
      await apiClient('/admin/tax/reports/mode', {
        method: 'POST',
        body: JSON.stringify({ mode: target }),
      });
      setBanner({ tone: 'success', message: `Tax mode set to ${target}.` });
      setCurrentMode(target);
      setRefreshedAt(new Date());
      await loadHistory();
    } catch (err) {
      setBanner({ tone: 'error', message: (err as Error).message || 'Failed to change tax mode' });
    } finally {
      setSubmitting(null);
    }
  };

  const currentMeta = currentMode ? MODES.find((m) => m.value === currentMode) ?? null : null;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <Link href="/dashboard/tax" style={crumb}>
        <span aria-hidden>←</span> Tax & GST
      </Link>

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
            Tax mode
          </h1>
          <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 720, lineHeight: 1.5 }}>
            Controls how strict the tax engine is about missing or invalid data. Every change is
            audited and requires the <Mono>tax.configure</Mono> permission.
          </p>
        </div>
        <button onClick={() => { void loadMode(); void loadHistory(); }} style={btnGhost} disabled={loading}>
          <RefreshIcon /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {banner && (
        <div role="alert" style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 12, fontSize: 13,
          border: `1px solid ${banner.tone === 'success' ? '#bbf7d0' : '#fca5a5'}`,
          background: banner.tone === 'success' ? '#f0fdf4' : '#fef2f2',
          color: banner.tone === 'success' ? '#15803d' : '#b91c1c',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <span>{banner.message}</span>
          <button onClick={() => setBanner(null)} aria-label="Dismiss" style={{
            padding: 4, border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'inherit', opacity: 0.6, lineHeight: 1, fontSize: 16,
          }}>×</button>
        </div>
      )}

      {/* Current mode hero */}
      <CurrentModeCard
        meta={currentMeta}
        loading={loading}
        error={error}
        refreshedAt={refreshedAt}
      />

      {/* Switch-to grid */}
      <h2 style={sectionHeading}>Switch to</h2>
      <p style={sectionSub}>
        Pick a posture below. The current one is filled in solid; switching to a non-current row
        opens a confirm dialog with the consequences spelled out.
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 12, marginBottom: 24,
      }}>
        {MODES.map((m) => (
          <ModeCard
            key={m.value}
            meta={m}
            isCurrent={currentMode === m.value}
            submitting={submitting === m.value}
            disabled={submitting !== null || currentMode === m.value || loading}
            onClick={() => void handleChange(m.value)}
          />
        ))}
      </div>

      {/* History */}
      <h2 style={sectionHeading}>Recent changes</h2>
      <p style={sectionSub}>
        Most recent 20 audit entries from <Mono>action=TAX_MODE_CHANGED</Mono>. Wider audit log
        lives under <Mono>/admin/audit?module=tax-mode</Mono>.
      </p>
      <div style={{
        background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden',
      }}>
        {historyLoading && history.length === 0 ? (
          <HistorySkeleton />
        ) : history.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <div style={{
              width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
              margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#7A828F',
            }}>
              <ClockIcon size={20} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0F1115' }}>No changes yet</div>
            <div style={{ fontSize: 13, color: '#525A65', marginTop: 4, maxWidth: 420, margin: '4px auto 0' }}>
              No tax-mode changes recorded yet (or the audit-log endpoint isn't wired). Once a
              change is made, it will appear here.
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                <th style={th}>When</th>
                <th style={th}>Admin</th>
                <th style={th}>Change</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => {
                const oldMode = (row.oldValue as { mode?: TaxMode })?.mode ?? null;
                const newMode = (row.newValue as { mode?: TaxMode })?.mode ?? null;
                return (
                  <tr key={row.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                    <td style={td}>
                      <div style={{ fontSize: 13, color: '#0F1115' }}
                           title={new Date(row.createdAt).toLocaleString('en-IN')}>
                        {relTime(new Date(row.createdAt))}
                      </div>
                      <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}>
                        {new Date(row.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </div>
                    </td>
                    <td style={td}>
                      {row.actorId ? (
                        <>
                          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#0F1115' }}>
                            {row.actorId.slice(0, 8)}…
                          </div>
                          {row.actorRole && (
                            <div style={{ fontSize: 11, color: '#7A828F', marginTop: 2 }}>
                              {row.actorRole}
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <ModePill mode={oldMode} muted />
                        <ArrowRightIcon size={12} />
                        <ModePill mode={newMode} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        Showing {history.length} of {history.length} recent changes
      </p>
    </div>
  );
}

// ── Current-mode hero card ────────────────────────────────────────

function CurrentModeCard({
  meta, loading, error, refreshedAt,
}: {
  meta: ModeMeta | null;
  loading: boolean;
  error: string | null;
  refreshedAt: Date | null;
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16,
      padding: 20, marginBottom: 24,
      display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center',
    }}>
      <div style={{ flex: '0 0 auto' }}>
        <div style={kpiLabel}>Current mode</div>
        {loading && !meta ? (
          <div style={{ marginTop: 6, height: 32, width: 120, background: '#F3F4F6', borderRadius: 9999 }} />
        ) : error ? (
          <div style={{ marginTop: 6, color: '#b91c1c', fontSize: 14, fontWeight: 600 }}>{error}</div>
        ) : meta ? (
          <div style={{ marginTop: 6 }}>
            <ModePill mode={meta.value} size="lg" />
          </div>
        ) : (
          <div style={{ marginTop: 6, color: '#7A828F', fontSize: 14 }}>Unknown</div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 240 }}>
        {meta && (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#0F1115' }}>
              {meta.oneLiner}
            </div>
            <div style={{ fontSize: 13, color: '#525A65', marginTop: 6, lineHeight: 1.5 }}>
              {meta.description}
            </div>
          </>
        )}
        {refreshedAt && (
          <div style={{ fontSize: 11, color: '#7A828F', marginTop: 8 }}
               title={refreshedAt.toLocaleString('en-IN')}>
            Refreshed {relTime(refreshedAt)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Mode card ─────────────────────────────────────────────────────

function ModeCard({
  meta, isCurrent, submitting, disabled, onClick,
}: {
  meta: ModeMeta;
  isCurrent: boolean;
  submitting: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const accent = TONE_ACCENT[meta.tone];
  return (
    <div style={{
      background: isCurrent ? '#FAFAFA' : '#fff',
      border: '1px solid ' + (isCurrent ? '#0F1115' : '#E5E7EB'),
      borderRadius: 14,
      padding: 16,
      display: 'flex', flexDirection: 'column', gap: 12,
      position: 'relative',
    }}>
      {/* Tone stripe */}
      <span style={{
        position: 'absolute', left: 0, top: 16, bottom: 16, width: 3,
        background: accent.color, borderRadius: 9999,
      }} />
      <div style={{ paddingLeft: 8, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0F1115', letterSpacing: '0.04em' }}>
            {meta.label}
          </span>
          {isCurrent && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 700, color: '#fff',
              padding: '2px 8px', borderRadius: 9999, background: '#0F1115',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              Current
            </span>
          )}
          {meta.recommended && !isCurrent && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 700, color: '#15803d',
              padding: '2px 8px', borderRadius: 9999, background: '#dcfce7',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <StarIcon size={10} /> Recommended
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: '#7A828F', fontWeight: 600 }}>
          {meta.short}
        </span>
      </div>

      <div style={{ paddingLeft: 8, fontSize: 13, color: '#0F1115', fontWeight: 600 }}>
        {meta.oneLiner}
      </div>

      <div style={{ paddingLeft: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Detail label="When to use" body={meta.whenToUse} />
        <Detail label="Risks" body={meta.risks} tone={meta.tone === 'danger' ? 'danger' : 'muted'} />
      </div>

      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={
          isCurrent
            ? { ...btnSecondary, opacity: 0.6, cursor: 'not-allowed' }
            : disabled
              ? { ...btnPrimary, ...busyStyle }
              : btnPrimary
        }
      >
        {submitting
          ? 'Switching…'
          : isCurrent
            ? 'Already active'
            : <>Switch to {meta.label}</>}
      </button>
    </div>
  );
}

function Detail({
  label, body, tone,
}: { label: string; body: string; tone?: 'danger' | 'muted' }) {
  const color = tone === 'danger' ? '#b91c1c' : '#525A65';
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#7A828F',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        marginBottom: 2,
      }}>{label}</div>
      <div style={{ fontSize: 12, color, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

// ── Mode pill ─────────────────────────────────────────────────────

function ModePill({
  mode, size = 'sm', muted = false,
}: { mode: TaxMode | null; size?: 'sm' | 'lg'; muted?: boolean }) {
  if (!mode) return <span style={{ color: '#7A828F', fontSize: 12 }}>—</span>;
  const tone = MODES.find((m) => m.value === mode)?.tone ?? 'muted';
  const accent = TONE_ACCENT[tone];
  const big = size === 'lg';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      height: big ? 32 : 22,
      padding: big ? '0 16px' : '0 10px',
      borderRadius: 9999,
      background: muted ? '#F3F4F6' : accent.chip,
      color: muted ? '#7A828F' : accent.color,
      fontSize: big ? 14 : 11,
      fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      <span style={{
        width: big ? 8 : 6, height: big ? 8 : 6,
        borderRadius: 9999,
        background: muted ? '#7A828F' : accent.color,
      }} />
      {mode}
    </span>
  );
}

// ── Tone palette ──────────────────────────────────────────────────

const TONE_ACCENT: Record<'danger' | 'warning' | 'success' | 'muted', { color: string; chip: string }> = {
  danger:  { color: '#b91c1c', chip: '#fee2e2' },
  warning: { color: '#b45309', chip: '#fef3c7' },
  success: { color: '#15803d', chip: '#dcfce7' },
  muted:   { color: '#525A65', chip: '#F3F4F6' },
};

// ── Skeleton ──────────────────────────────────────────────────────

function HistorySkeleton() {
  return (
    <div style={{ padding: 16 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{
          display: 'flex', gap: 16, padding: '12px 0',
          borderBottom: '1px solid #F3F4F6',
        }}>
          <div style={{ width: 100, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 140, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          <div style={{ width: 200, height: 22, background: '#F3F4F6', borderRadius: 9999 }} />
        </div>
      ))}
    </div>
  );
}

// ── Mono / icons ──────────────────────────────────────────────────

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code style={{
      fontFamily: 'ui-monospace, monospace', fontSize: 12,
      padding: '1px 6px', background: '#F3F4F6', borderRadius: 4,
    }}>{children}</code>
  );
}

function RefreshIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 0 0-15-6.7L3 8" /><path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" /><path d="M21 21v-5h-5" />
    </svg>
  );
}
function StarIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
         stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m12 2 3 7 7 .8-5 5 1.5 7L12 18l-6.5 3.8L7 14.8 2 9.8 9 9z" />
    </svg>
  );
}
function ArrowRightIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function ClockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
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

const crumb: React.CSSProperties = {
  fontSize: 13, color: '#525A65', textDecoration: 'none',
  marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 4,
};
const kpiLabel: React.CSSProperties = {
  fontSize: 11, color: '#7A828F', textTransform: 'uppercase',
  letterSpacing: '0.06em', fontWeight: 600,
};
const sectionHeading: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: '#0F1115', margin: 0,
  marginTop: 8, marginBottom: 4,
  textTransform: 'uppercase', letterSpacing: '0.06em',
};
const sectionSub: React.CSSProperties = {
  fontSize: 13, color: '#525A65', margin: 0, marginBottom: 12, maxWidth: 720, lineHeight: 1.5,
};
const btnPrimary: React.CSSProperties = {
  height: 36, padding: '0 16px',
  background: '#0F1115', color: '#fff',
  border: '1px solid #0F1115', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  width: '100%',
};
const btnSecondary: React.CSSProperties = {
  height: 36, padding: '0 16px',
  background: '#fff', color: '#0F1115',
  border: '1px solid #D2D6DC', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  width: '100%',
};
const btnGhost: React.CSSProperties = {
  height: 36, padding: '0 14px',
  background: 'transparent', color: '#525A65',
  border: '1px solid #E5E7EB', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const busyStyle: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
const th: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: '#525A65',
};
const td: React.CSSProperties = {
  padding: '14px 16px', fontSize: 13, color: '#0F1115',
  verticalAlign: 'top',
};
