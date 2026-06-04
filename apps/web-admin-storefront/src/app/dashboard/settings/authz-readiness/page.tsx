'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RequirePermission, usePermissions } from '@/lib/permissions';
import { apiClient } from '@/lib/api-client';

/* ── Types ──────────────────────────────────────────────────── */

type RiskTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

interface FlagTriple {
  env: boolean;
  override: boolean | null;
  effective: boolean;
}

interface ReadinessData {
  // Whether the caller holds authz.readiness.full (full key lists vs counts).
  full?: boolean;
  flags: { strictMode: boolean; abacEnabled: boolean; auditEnabled: boolean };
  // env vs runtime-override vs effective, with source + who/when.
  mode?: {
    strictMode: FlagTriple;
    abacEnabled: FlagTriple;
    auditEnabled: FlagTriple;
    source: string;
    updatedAt: string | null;
    updatedByAdminId: string | null;
  };
  registry: {
    totalPermissions: number;
    riskTiers: Record<RiskTier, number>;
    // Key lists are present only for the full-detail caller.
    permissionsByTier?: Record<RiskTier, string[]>;
    ungrantedCount: number;
    ungrantedKeys?: string[];
  };
  roles: { role: string; permissionCount: number; permissions?: string[] }[];
  superAdmin: { permissionCount: number; fullyResolved: boolean; permissions?: string[] };
  warnings: string[];
}

interface DenialRow {
  id: string;
  createdAt: string;
  adminId: string | null;
  actorRole: string | null;
  routeLabel: string;
  method: string | null;
  path: string | null;
  layer: 'PERMISSION' | 'POLICY';
  decision: 'ALLOW' | 'DENY';
  wouldHaveBlocked: boolean;
  requiredPermissions: string[];
  resourceType: string | null;
  action: string | null;
  reason: string | null;
  reviewStatus: ReviewStatus;
  reviewedByAdminId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

type ReviewStatus =
  | 'UNREVIEWED'
  | 'FALSE_POSITIVE'
  | 'EXPECTED_DENY'
  | 'FIXED'
  | 'IGNORED';

interface DenialsResponse {
  items: DenialRow[];
  total: number;
  filters: {
    limit: number;
    wouldHaveBlocked: boolean;
    since: string | null;
    reviewStatus?: string;
  };
}

type DrawerKind =
  | { kind: 'tier'; tier: RiskTier }
  | { kind: 'role'; role: string }
  | { kind: 'super-admin' }
  | { kind: 'ungranted' };

/* ── Page ───────────────────────────────────────────────────── */

export default function AuthzReadinessPage() {
  return (
    <RequirePermission
      anyOf={['roles.read']}
      fallback={<div style={{ padding: 24 }}>Loading…</div>}
    >
      <ReadinessInner />
    </RequirePermission>
  );
}

function ReadinessInner() {
  const [data, setData] = useState<ReadinessData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [denials, setDenials] = useState<DenialsResponse | null>(null);
  const [denialsLoading, setDenialsLoading] = useState(false);
  const [denialsError, setDenialsError] = useState('');
  const [includeStrictDenials, setIncludeStrictDenials] = useState(false);

  const [drawer, setDrawer] = useState<DrawerKind | null>(null);

  // Mode-toggle (SUPER_ADMIN only) + denial review-FSM state.
  const { isSuperAdmin } = usePermissions();
  const [reviewStatusFilter, setReviewStatusFilter] = useState<ReviewStatus | 'all'>('UNREVIEWED');
  const [modeBusy, setModeBusy] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  /* ── Loaders ────────────────────────────────────────────── */

  const fetchReadiness = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    setError('');
    try {
      const res = await apiClient<ReadinessData>('/admin/authz/readiness');
      if (res.data) setData(res.data);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load readiness');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchDenials = useCallback(
    async (alsoStrict: boolean, review: ReviewStatus | 'all') => {
      setDenialsLoading(true);
      setDenialsError('');
      try {
        const params = new URLSearchParams();
        params.set('limit', '30');
        if (alsoStrict) params.set('wouldHaveBlocked', 'false');
        params.set('reviewStatus', review);
        const res = await apiClient<DenialsResponse>(
          `/admin/authz/recent-denials?${params.toString()}`,
        );
        if (res.data) setDenials(res.data);
      } catch (err: any) {
        setDenialsError(err?.message ?? 'Failed to load recent denials');
      } finally {
        setDenialsLoading(false);
      }
    },
    [],
  );

  // SUPER_ADMIN: enable strict/abac/audit at runtime (tighten-only — the
  // server applies the override OR env, so this never weakens enforcement).
  const changeMode = useCallback(
    async (patch: { strictMode?: boolean; abacEnabled?: boolean; auditEnabled?: boolean }) => {
      setModeBusy(true);
      setActionError('');
      try {
        await apiClient('/admin/authz/mode', {
          method: 'POST',
          body: JSON.stringify(patch),
        });
        await fetchReadiness(true);
      } catch (err: any) {
        setActionError(err?.message ?? 'Failed to change authorization mode');
      } finally {
        setModeBusy(false);
      }
    },
    [fetchReadiness],
  );

  // Triage a logged denial (false-positive review FSM).
  const reviewDenial = useCallback(
    async (id: string, reviewStatus: ReviewStatus) => {
      setReviewBusyId(id);
      setActionError('');
      try {
        await apiClient(`/admin/authz/denials/${id}/review`, {
          method: 'PATCH',
          body: JSON.stringify({ reviewStatus }),
        });
        await fetchDenials(includeStrictDenials, reviewStatusFilter);
      } catch (err: any) {
        setActionError(err?.message ?? 'Failed to update review status');
      } finally {
        setReviewBusyId(null);
      }
    },
    [fetchDenials, includeStrictDenials, reviewStatusFilter],
  );

  useEffect(() => {
    fetchReadiness();
  }, [fetchReadiness]);

  useEffect(() => {
    fetchDenials(includeStrictDenials, reviewStatusFilter);
  }, [fetchDenials, includeStrictDenials, reviewStatusFilter]);

  /* ── Verdict logic ───────────────────────────────────────── */

  const verdict = useMemo(() => {
    if (!data) return null;
    const blockers: string[] = [];
    const cautions: string[] = [];

    // Hard blockers: SUPER_ADMIN must resolve to every permission.
    if (!data.superAdmin.fullyResolved) {
      blockers.push(
        'SUPER_ADMIN resolution returned fullyResolved=false. The admin_custom_roles join is failing.',
      );
    }
    if (data.superAdmin.permissionCount !== data.registry.totalPermissions) {
      blockers.push(
        `SUPER_ADMIN resolves to ${data.superAdmin.permissionCount}/${data.registry.totalPermissions} permissions — check SYSTEM_ROLE_PERMISSIONS.SUPER_ADMIN.`,
      );
    }
    if (!data.flags.auditEnabled) {
      blockers.push(
        'AUTHZ_AUDIT_ENABLED is off — without audit history, you have no trail of who-tried-what if strict mode breaks something.',
      );
    }
    // Cautions (would-fail counts surfaced from denials)
    const wouldFailCount =
      denials?.items.filter((d) => d.wouldHaveBlocked).length ?? 0;
    if (wouldFailCount > 0) {
      cautions.push(
        `${wouldFailCount} recent request${wouldFailCount === 1 ? '' : 's'} would 403 in strict mode. Review the Denials panel before flipping.`,
      );
    }
    if (data.registry.ungrantedCount > 0) {
      cautions.push(
        `${data.registry.ungrantedCount} permission${data.registry.ungrantedCount === 1 ? '' : 's'} are not granted to any system role.`,
      );
    }

    let level: 'ready' | 'caution' | 'blocked';
    let title: string;
    if (blockers.length > 0) {
      level = 'blocked';
      title = data.flags.strictMode
        ? 'Strict mode is ON, but you have critical issues to investigate'
        : 'Not ready to flip strict mode';
    } else if (cautions.length > 0 || !data.flags.strictMode) {
      level = data.flags.strictMode ? 'caution' : 'caution';
      title = data.flags.strictMode
        ? 'Strict mode is ON — minor warnings open'
        : 'Almost ready — review cautions before flipping';
    } else {
      level = 'ready';
      title = data.flags.strictMode
        ? 'Strict mode is ON and all checks pass'
        : 'All checks pass — strict mode can be safely flipped';
    }

    return { level, title, blockers, cautions };
  }, [data, denials]);

  /* ── Drawer content resolver ─────────────────────────────── */

  const drawerContent = useMemo(() => {
    if (!data || !drawer) return null;
    if (drawer.kind === 'tier') {
      return {
        title: `${drawer.tier} permissions`,
        subtitle: `${(data.registry.permissionsByTier?.[drawer.tier] ?? []).length} keys`,
        keys: data.registry.permissionsByTier?.[drawer.tier] ?? [],
      };
    }
    if (drawer.kind === 'role') {
      const role = data.roles.find((r) => r.role === drawer.role);
      return role
        ? {
            title: role.role,
            subtitle: `${role.permissionCount} permissions granted`,
            keys: role.permissions ?? [],
          }
        : null;
    }
    if (drawer.kind === 'super-admin') {
      return {
        title: 'SUPER_ADMIN',
        subtitle: `${data.superAdmin.permissionCount} permissions resolved · ${
          data.superAdmin.fullyResolved ? 'fullyResolved' : 'degraded'
        }`,
        keys: data.superAdmin.permissions ?? [],
      };
    }
    if (drawer.kind === 'ungranted') {
      return {
        title: 'Ungranted permissions',
        subtitle: `${data.registry.ungrantedCount} keys not granted to any system role`,
        keys: data.registry.ungrantedKeys ?? [],
      };
    }
    return null;
  }, [data, drawer]);

  /* ── Render ──────────────────────────────────────────────── */

  if (loading && !data) {
    return (
      <div style={styles.page}>
        <div style={styles.loadingBox}>Loading readiness…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={styles.page}>
        <div style={styles.errorBox}>{error}</div>
        <button onClick={() => fetchReadiness()} style={styles.btnGhost}>
          Try again
        </button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={{ minWidth: 0 }}>
          <h1 style={styles.h1}>Authorization Readiness</h1>
          <p style={styles.headerSub}>
            Operator dashboard for the authz stack. Use this before flipping{' '}
            <code style={styles.codeChipInline}>PERMISSIONS_GUARD_STRICT=true</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            fetchReadiness(true);
            fetchDenials(includeStrictDenials, reviewStatusFilter);
          }}
          disabled={refreshing}
          style={{ ...styles.btnGhost, ...(refreshing ? styles.disabled : {}) }}
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16 4v4h-4M4 16v-4h4M5 8a6 6 0 0110-3M15 12a6 6 0 01-10 3"
            />
          </svg>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {/* Verdict banner — the headline answer to "can I flip strict?" */}
      {verdict && <VerdictBanner verdict={verdict} />}

      {/* Flag matrix */}
      <Section title="Runtime flags">
        <FlagRow
          name="PERMISSIONS_GUARD_STRICT"
          value={data.flags.strictMode}
          // "good" when ON; OFF means soak — not a failure but a warning.
          tone={data.flags.strictMode ? 'good' : 'warning'}
          plain={
            data.flags.strictMode
              ? 'Strict mode is ON. Failed permission checks return 403 to the caller.'
              : 'Soak mode. Failed permission checks log wouldHaveBlocked=true but the request is allowed through.'
          }
          risk={
            data.flags.strictMode
              ? null
              : 'Flipping to true will immediately 403 any request matching the denials list below.'
          }
        />
        <FlagRow
          name="ABAC_ENABLED"
          value={data.flags.abacEnabled}
          tone={data.flags.abacEnabled ? 'good' : 'warning'}
          plain={
            data.flags.abacEnabled
              ? 'ABAC strict. Routes with no matching ALLOW policy return 403.'
              : 'ABAC soak. DENY rules are enforced, but routes without a matching ALLOW are let through.'
          }
          risk={
            data.flags.abacEnabled
              ? null
              : 'Flipping requires every policy-guarded route to have an explicit ALLOW rule.'
          }
        />
        <FlagRow
          name="AUTHZ_AUDIT_ENABLED"
          value={data.flags.auditEnabled}
          tone={data.flags.auditEnabled ? 'good' : 'bad'}
          plain={
            data.flags.auditEnabled
              ? 'Every guard decision is persisted to authorization_audits.'
              : 'No audit rows are being written. Compliance and incident response will lack history.'
          }
          risk={
            data.flags.auditEnabled
              ? null
              : 'Turn this on before doing anything else — the rest of this dashboard needs the audit trail.'
          }
        />
      </Section>

      {/* Authorization mode — env vs runtime override. SUPER_ADMIN can
          ENABLE flags early (tighten-only); disabling needs an env redeploy. */}
      {data.mode && (
        <Section
          title="Authorization mode"
          right={
            data.mode.source === 'env+db' ? (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#92400e', background: '#fef3c7', padding: '2px 8px', borderRadius: 999 }}>
                runtime override active
              </span>
            ) : null
          }
        >
          {actionError && <div style={styles.errorBox}>{actionError}</div>}
          <ModeRow
            label="Strict mode"
            flag={data.mode.strictMode}
            canEnable={isSuperAdmin && !data.mode.strictMode.effective}
            busy={modeBusy}
            onEnable={() => changeMode({ strictMode: true })}
            onReset={isSuperAdmin && data.mode.strictMode.override !== null ? () => changeMode({ strictMode: false }) : undefined}
          />
          <ModeRow
            label="ABAC enforce"
            flag={data.mode.abacEnabled}
            canEnable={isSuperAdmin && !data.mode.abacEnabled.effective}
            busy={modeBusy}
            onEnable={() => changeMode({ abacEnabled: true })}
            onReset={isSuperAdmin && data.mode.abacEnabled.override !== null ? () => changeMode({ abacEnabled: false }) : undefined}
          />
          <ModeRow
            label="Authz audit"
            flag={data.mode.auditEnabled}
            canEnable={isSuperAdmin && !data.mode.auditEnabled.effective}
            busy={modeBusy}
            onEnable={() => changeMode({ auditEnabled: true })}
            onReset={isSuperAdmin && data.mode.auditEnabled.override !== null ? () => changeMode({ auditEnabled: false }) : undefined}
          />
          {isSuperAdmin ? (
            <p style={{ margin: '12px 2px 0', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
              Overrides are <strong>tighten-only</strong>: you can enable a flag at runtime, but
              disabling a deployment-mandated flag still requires an env change + redeploy.
            </p>
          ) : (
            <p style={{ margin: '12px 2px 0', fontSize: 12, color: '#94a3b8' }}>
              Only SUPER_ADMIN can change authorization mode.
            </p>
          )}
        </Section>
      )}

      {/* SUPER_ADMIN smoke check */}
      <Section title="SUPER_ADMIN resolution">
        <button
          type="button"
          onClick={() => setDrawer({ kind: 'super-admin' })}
          style={styles.rowButton}
        >
          <span
            style={{
              ...styles.statusDot,
              background:
                data.superAdmin.fullyResolved &&
                data.superAdmin.permissionCount === data.registry.totalPermissions
                  ? '#16a34a'
                  : '#dc2626',
            }}
          />
          <span style={{ flex: 1, fontSize: 13.5 }}>
            <strong style={{ color: '#0f172a' }}>
              {data.superAdmin.permissionCount}
            </strong>
            <span style={{ color: '#94a3b8' }}>
              {' / '}
              {data.registry.totalPermissions}
            </span>{' '}
            permissions resolved ·{' '}
            <span
              style={{
                color: data.superAdmin.fullyResolved ? '#15803d' : '#b91c1c',
                fontWeight: 600,
              }}
            >
              {data.superAdmin.fullyResolved ? 'fullyResolved' : 'degraded'}
            </span>
          </span>
          <span style={styles.viewChip}>View list</span>
        </button>
      </Section>

      {/* Registry tiles — clickable */}
      <Section
        title="Permission registry"
        right={
          data.registry.ungrantedCount > 0 && (
            <button
              type="button"
              onClick={() => setDrawer({ kind: 'ungranted' })}
              style={styles.linkLikeBtn}
            >
              {data.registry.ungrantedCount} ungranted →
            </button>
          )
        }
      >
        <div style={styles.tierGrid}>
          {(
            [
              { tier: null, label: 'Total', value: data.registry.totalPermissions, color: '#0f172a' },
              { tier: 'CRITICAL' as RiskTier, label: 'Critical', value: data.registry.riskTiers.CRITICAL, color: '#b91c1c' },
              { tier: 'HIGH' as RiskTier, label: 'High', value: data.registry.riskTiers.HIGH, color: '#c2410c' },
              { tier: 'MEDIUM' as RiskTier, label: 'Medium', value: data.registry.riskTiers.MEDIUM, color: '#b45309' },
              { tier: 'LOW' as RiskTier, label: 'Low', value: data.registry.riskTiers.LOW, color: '#15803d' },
            ] as { tier: RiskTier | null; label: string; value: number; color: string }[]
          ).map((t) =>
            t.tier ? (
              <button
                key={t.label}
                type="button"
                onClick={() => setDrawer({ kind: 'tier', tier: t.tier as RiskTier })}
                style={styles.tierTileClickable}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {t.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: t.color, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                  {t.value}
                </div>
              </button>
            ) : (
              <div key={t.label} style={styles.tierTile}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {t.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: t.color, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                  {t.value}
                </div>
              </div>
            ),
          )}
        </div>
      </Section>

      {/* Roles — clickable rows */}
      <Section title="System roles">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {data.roles.map((r, idx) => (
            <button
              key={r.role}
              type="button"
              onClick={() => setDrawer({ kind: 'role', role: r.role })}
              style={{
                ...styles.roleRow,
                borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {r.role}
              </span>
              <span style={{ flex: 1 }} />
              <span style={styles.permsCount}>{r.permissionCount}</span>
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" style={{ color: '#cbd5e1', marginLeft: 10 }}>
                <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 3l5 5-5 5" />
              </svg>
            </button>
          ))}
        </div>
      </Section>

      {/* Recent denials — the actionable signal */}
      <Section
        title="Recent denials"
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <label style={styles.toggle}>
              <input
                type="checkbox"
                checked={includeStrictDenials}
                onChange={(e) => setIncludeStrictDenials(e.target.checked)}
                style={{ accentColor: '#0f172a' }}
              />
              <span>Also include strict-mode 403s</span>
            </label>
            <select
              value={reviewStatusFilter}
              onChange={(e) => setReviewStatusFilter(e.target.value as ReviewStatus | 'all')}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #cbd5e1', color: '#334155' }}
              aria-label="Filter by review status"
            >
              <option value="UNREVIEWED">Unreviewed</option>
              <option value="FALSE_POSITIVE">False positive</option>
              <option value="EXPECTED_DENY">Expected deny</option>
              <option value="FIXED">Fixed</option>
              <option value="IGNORED">Ignored</option>
              <option value="all">All statuses</option>
            </select>
          </div>
        }
      >
        {denialsLoading && !denials ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Loading recent denials…
          </div>
        ) : denialsError ? (
          <div style={styles.errorBox}>{denialsError}</div>
        ) : !denials || denials.items.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            No recent denials. {data.flags.strictMode
              ? 'Strict mode is clean — nothing has been 403’d in the recent window.'
              : 'No request would have been blocked in strict mode during the recent window.'}
          </div>
        ) : (
          <DenialsTable rows={denials.items} onReview={reviewDenial} busyId={reviewBusyId} />
        )}
      </Section>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <Section title="Warnings">
          <ul style={styles.warningList}>
            {data.warnings.map((w, i) => (
              <li key={i} style={styles.warningItem}>
                <svg viewBox="0 0 16 16" width="14" height="14" style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} aria-hidden="true">
                  <path fill="currentColor" d="M8 1l7 13H1L8 1zM7.5 6h1v4h-1zM7.5 11h1v1.4h-1z" />
                </svg>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Drawer */}
      {drawer && drawerContent && (
        <KeyListDrawer
          title={drawerContent.title}
          subtitle={drawerContent.subtitle}
          keys={drawerContent.keys}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

/* ── Verdict banner ─────────────────────────────────────────── */

function VerdictBanner({
  verdict,
}: {
  verdict: {
    level: 'ready' | 'caution' | 'blocked';
    title: string;
    blockers: string[];
    cautions: string[];
  };
}) {
  const palette = {
    ready:   { bg: '#f0fdf4', border: '#bbf7d0', dot: '#16a34a', heading: '#15803d' },
    caution: { bg: '#fffbeb', border: '#fde68a', dot: '#d97706', heading: '#b45309' },
    blocked: { bg: '#fef2f2', border: '#fecaca', dot: '#dc2626', heading: '#b91c1c' },
  };
  const p = palette[verdict.level];
  return (
    <div
      role="status"
      style={{
        marginBottom: 20,
        padding: '14px 18px',
        background: p.bg,
        border: `1px solid ${p.border}`,
        borderRadius: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: verdict.blockers.length + verdict.cautions.length === 0 ? 0 : 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.dot, flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: p.heading }}>{verdict.title}</span>
      </div>
      {(verdict.blockers.length > 0 || verdict.cautions.length > 0) && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {verdict.blockers.map((b, i) => (
            <li key={`b${i}`} style={{ fontSize: 12.5, color: '#b91c1c', paddingLeft: 20 }}>
              <strong>Blocker:</strong> {b}
            </li>
          ))}
          {verdict.cautions.map((c, i) => (
            <li key={`c${i}`} style={{ fontSize: 12.5, color: p.heading, paddingLeft: 20 }}>
              <strong>Caution:</strong> {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Flag row ───────────────────────────────────────────────── */

function ModeRow({
  label,
  flag,
  canEnable,
  busy,
  onEnable,
  onReset,
}: {
  label: string;
  flag: FlagTriple;
  canEnable: boolean;
  busy: boolean;
  onEnable: () => void;
  onReset?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 2px',
        borderBottom: '1px solid #f1f5f9',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ width: 110, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{label}</span>
      <span style={{ fontSize: 12, color: '#64748b' }}>
        env{' '}
        <b style={{ color: flag.env ? '#16a34a' : '#94a3b8' }}>{flag.env ? 'ON' : 'OFF'}</b>
        {flag.override !== null && (
          <>
            {' · '}override{' '}
            <b style={{ color: flag.override ? '#16a34a' : '#dc2626' }}>
              {flag.override ? 'ON' : 'OFF'}
            </b>
          </>
        )}
      </span>
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 12,
          fontWeight: 700,
          padding: '2px 10px',
          borderRadius: 999,
          color: flag.effective ? '#166534' : '#92400e',
          background: flag.effective ? '#dcfce7' : '#fef3c7',
        }}
      >
        effective {flag.effective ? 'ON' : 'OFF'}
      </span>
      {canEnable && (
        <button
          type="button"
          disabled={busy}
          onClick={onEnable}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 12px',
            borderRadius: 6,
            border: '1px solid #15803d',
            background: '#16a34a',
            color: '#fff',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          Enable
        </button>
      )}
      {onReset && (
        <button
          type="button"
          disabled={busy}
          onClick={onReset}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid #cbd5e1',
            background: '#fff',
            color: '#475569',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          Reset to env
        </button>
      )}
    </div>
  );
}

function FlagRow({
  name,
  value,
  tone,
  plain,
  risk,
}: {
  name: string;
  value: boolean;
  tone: 'good' | 'warning' | 'bad';
  plain: string;
  risk: string | null;
}) {
  const dotColor = tone === 'good' ? '#16a34a' : tone === 'warning' ? '#d97706' : '#dc2626';
  const valueColor = value ? '#15803d' : '#b91c1c';
  return (
    <div style={styles.flagRow}>
      <span style={{ ...styles.statusDot, background: dotColor, marginTop: 7 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <code style={styles.codeChip}>{name}</code>
          <span style={{ fontSize: 12, fontWeight: 700, color: valueColor }}>
            {value ? 'true' : 'false'}
          </span>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(`${name}=${value}`)}
            style={styles.copyBtn}
            title={`Copy ${name}=${value}`}
            aria-label={`Copy ${name}=${value}`}
          >
            <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 4h7v8H5zM3 7v6h6"
              />
            </svg>
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: '#475569', marginTop: 4, lineHeight: 1.5 }}>
          {plain}
        </div>
        {risk && (
          <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 4, lineHeight: 1.5, fontStyle: 'italic' }}>
            ⚠ {risk}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Denials table ──────────────────────────────────────────── */

function DenialsTable({
  rows,
  onReview,
  busyId,
}: {
  rows: DenialRow[];
  onReview: (id: string, status: ReviewStatus) => void;
  busyId: string | null;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>When</th>
            <th style={styles.th}>Actor</th>
            <th style={styles.th}>Route</th>
            <th style={styles.th}>Required</th>
            <th style={styles.th}>Effect</th>
            <th style={styles.th}>Review</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={styles.tr}>
              <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                <div style={{ fontSize: 12, color: '#0f172a' }}>
                  {new Date(r.createdAt).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </div>
                <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {r.layer}
                </div>
              </td>
              <td style={styles.td}>
                <div style={{ fontSize: 12, color: '#0f172a' }}>
                  {r.actorRole || (r.adminId ? 'admin' : 'unauthenticated')}
                </div>
                {r.adminId && (
                  <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {r.adminId.slice(0, 8)}…
                  </div>
                )}
              </td>
              <td style={styles.td}>
                <div style={{ fontSize: 12, color: '#0f172a', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {r.routeLabel}
                </div>
                {r.method && r.path && (
                  <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {r.method} {r.path}
                  </div>
                )}
              </td>
              <td style={styles.td}>
                {r.requiredPermissions.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {r.requiredPermissions.map((p) => (
                      <code key={p} style={styles.codeChip}>{p}</code>
                    ))}
                  </div>
                ) : r.resourceType ? (
                  <code style={styles.codeChip}>
                    {r.resourceType}{r.action ? `:${r.action}` : ''}
                  </code>
                ) : (
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>
                )}
              </td>
              <td style={styles.td}>
                {r.wouldHaveBlocked ? (
                  <span style={styles.pillWouldBlock}>Would 403 in strict</span>
                ) : (
                  <span style={styles.pillStrict}>403 (strict)</span>
                )}
              </td>
              <td style={styles.td}>
                <select
                  value={r.reviewStatus}
                  disabled={busyId === r.id}
                  onChange={(e) => onReview(r.id, e.target.value as ReviewStatus)}
                  style={{
                    fontSize: 11.5,
                    padding: '3px 6px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    color: r.reviewStatus === 'UNREVIEWED' ? '#92400e' : '#15803d',
                    background: r.reviewStatus === 'UNREVIEWED' ? '#fffbeb' : '#f0fdf4',
                    cursor: busyId === r.id ? 'wait' : 'pointer',
                  }}
                  aria-label="Set review status"
                >
                  <option value="UNREVIEWED">Unreviewed</option>
                  <option value="FALSE_POSITIVE">False positive</option>
                  <option value="EXPECTED_DENY">Expected deny</option>
                  <option value="FIXED">Fixed</option>
                  <option value="IGNORED">Ignored</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Drawer ─────────────────────────────────────────────────── */

function KeyListDrawer({
  title,
  subtitle,
  keys,
  onClose,
}: {
  title: string;
  subtitle: string;
  keys: string[];
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return keys;
    return keys.filter((k) => k.toLowerCase().includes(needle));
  }, [keys, q]);

  return (
    <>
      <div onClick={onClose} style={styles.drawerScrim} />
      <aside role="dialog" aria-label={title} style={styles.drawer}>
        <div style={styles.drawerHeader}>
          <div style={{ minWidth: 0 }}>
            <div style={styles.drawerKicker}>Permission list</div>
            <div style={styles.drawerTitle}>{title}</div>
            <div style={styles.drawerSubtitle}>{subtitle}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={styles.drawerCloseBtn}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={styles.searchWrap}>
            <svg viewBox="0 0 20 20" style={styles.searchIcon} aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M9 3a6 6 0 104.472 10.03L17 17M9 15A6 6 0 109 3a6 6 0 000 12z" />
            </svg>
            <input
              type="search"
              placeholder="Filter permissions"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={styles.searchInput}
              aria-label="Filter permissions"
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px 24px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              No keys match &ldquo;{q}&rdquo;.
            </div>
          ) : (
            <ul style={styles.keyList}>
              {filtered.map((k) => (
                <li key={k} style={styles.keyListItem}>
                  <code style={{ ...styles.codeChip, padding: '4px 8px', fontSize: 12 }}>{k}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

/* ── Section wrapper ────────────────────────────────────────── */

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 22 }}>
      <div style={styles.sectionHead}>
        <h2 style={styles.sectionTitle}>{title}</h2>
        {right && <span>{right}</span>}
      </div>
      <div style={styles.sectionBody}>{children}</div>
    </section>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  page: {
    color: '#0f172a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    padding: '24px 32px',
    maxWidth: 1100,
    margin: '0 auto',
  },

  /* Header */
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  h1: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
  headerSub: {
    margin: '4px 0 0',
    fontSize: 13,
    color: '#64748b',
  },
  btnGhost: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 36,
    padding: '0 14px',
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  disabled: { opacity: 0.6, cursor: 'not-allowed' },

  /* Section */
  sectionHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingLeft: 4,
    gap: 12,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  sectionBody: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },

  /* Flag row */
  flagRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
    padding: '14px 18px',
    borderBottom: '1px solid #f1f5f9',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
    marginTop: 4,
  },
  codeChip: {
    fontSize: 11.5,
    padding: '2px 6px',
    background: '#f1f5f9',
    borderRadius: 4,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#334155',
  },
  codeChipInline: {
    fontSize: 11.5,
    padding: '1px 5px',
    background: '#f1f5f9',
    borderRadius: 4,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#334155',
  },
  copyBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    padding: 0,
    background: 'transparent',
    border: '1px solid #e2e8f0',
    borderRadius: 4,
    cursor: 'pointer',
    color: '#94a3b8',
  },

  /* Row buttons (super-admin, role) */
  rowButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '14px 18px',
    background: '#fff',
    border: 'none',
    borderRadius: 0,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  viewChip: {
    fontSize: 11,
    fontWeight: 600,
    color: '#1d4ed8',
    padding: '3px 8px',
    background: '#eff6ff',
    borderRadius: 4,
  },
  linkLikeBtn: {
    fontSize: 11.5,
    fontWeight: 600,
    color: '#1d4ed8',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
  },

  /* Tier grid */
  tierGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 1,
    background: '#f1f5f9',
  },
  tierTile: {
    padding: '14px 16px',
    background: '#fff',
  },
  tierTileClickable: {
    padding: '14px 16px',
    background: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    transition: 'background-color 0.08s',
  },

  /* Role rows */
  roleRow: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '12px 18px',
    background: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  permsCount: {
    display: 'inline-block',
    fontSize: 12,
    fontWeight: 600,
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
    padding: '2px 8px',
    background: '#f1f5f9',
    borderRadius: 999,
    minWidth: 26,
    textAlign: 'center',
  },

  /* Denials table */
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12.5,
  },
  th: {
    textAlign: 'left',
    padding: '10px 16px',
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '12px 16px', verticalAlign: 'top', color: '#0f172a' },
  pillWouldBlock: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 8px',
    fontSize: 11,
    fontWeight: 600,
    background: '#fffbeb',
    color: '#b45309',
    borderRadius: 999,
    whiteSpace: 'nowrap',
  },
  pillStrict: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 8px',
    fontSize: 11,
    fontWeight: 600,
    background: '#fef2f2',
    color: '#b91c1c',
    borderRadius: 999,
    whiteSpace: 'nowrap',
  },

  toggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#475569',
    cursor: 'pointer',
    userSelect: 'none',
  },

  /* Warning list */
  warningList: { listStyle: 'none', margin: 0, padding: 0 },
  warningItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '12px 18px',
    fontSize: 13,
    color: '#92400e',
    background: '#fffbeb',
    borderBottom: '1px solid #fde68a',
    lineHeight: 1.5,
  },

  /* Drawer — starts below the fixed app navbar (60px tall) and sits
     above it on the z-axis (navbar is z-index 200). Scrim matches so
     the navbar stays visible/clickable when the drawer is open. */
  drawerScrim: {
    position: 'fixed',
    top: 60,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(15, 23, 42, 0.35)',
    zIndex: 250,
  },
  drawer: {
    position: 'fixed',
    top: 60,
    right: 0,
    bottom: 0,
    width: '100%',
    maxWidth: 480,
    background: '#fff',
    borderLeft: '1px solid #e2e8f0',
    boxShadow: '-8px 0 24px rgba(15, 23, 42, 0.08)',
    zIndex: 251,
    display: 'flex',
    flexDirection: 'column',
  },
  drawerHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '18px 20px 14px',
    borderBottom: '1px solid #e2e8f0',
  },
  drawerKicker: {
    fontSize: 11,
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 4,
  },
  drawerTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#0f172a',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    lineHeight: 1.3,
  },
  drawerSubtitle: {
    fontSize: 12.5,
    color: '#64748b',
    marginTop: 3,
  },
  drawerCloseBtn: {
    width: 30,
    height: 30,
    padding: 0,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#64748b',
    flexShrink: 0,
  },
  searchWrap: {
    position: 'relative',
    width: '100%',
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 16,
    height: 16,
    color: '#94a3b8',
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    height: 36,
    padding: '0 12px 0 36px',
    fontSize: 13,
    color: '#0f172a',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  keyList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  keyListItem: {
    padding: '6px 0',
    borderBottom: '1px solid #f1f5f9',
  },

  /* Misc */
  loadingBox: {
    padding: 48,
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 13,
  },
  errorBox: {
    padding: '12px 14px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    color: '#991b1b',
    fontSize: 13,
  },
};
