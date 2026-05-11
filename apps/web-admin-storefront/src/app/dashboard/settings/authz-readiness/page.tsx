'use client';

import { useEffect, useState } from 'react';
import { RequirePermission } from '@/lib/permissions';
import { apiClient } from '@/lib/api-client';

interface ReadinessResponse {
  success: boolean;
  data: {
    flags: {
      strictMode: boolean;
      abacEnabled: boolean;
      auditEnabled: boolean;
    };
    registry: {
      totalPermissions: number;
      riskTiers: Record<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW', number>;
      ungrantedKeys: string[];
    };
    roles: Array<{ role: string; permissionCount: number }>;
    superAdmin: {
      permissionCount: number;
      fullyResolved: boolean;
    };
    warnings: string[];
  };
}

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
  const [data, setData] = useState<ReadinessResponse['data'] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiClient<ReadinessResponse['data']>('/admin/authz/readiness')
      .then((res) => {
        if (cancelled) return;
        if (res.data) setData(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? 'Failed to load readiness');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <ErrorBox message="No data returned" />;

  const superAdminHealthy = data.superAdmin.permissionCount > 0 && data.superAdmin.fullyResolved;

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1080 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#0f172a' }}>
          Authorization Readiness
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: '#64748b' }}>
          Operator dashboard for the authz stack. Use this before flipping <code>PERMISSIONS_GUARD_STRICT=true</code>.
        </p>
      </header>

      <Section title="Flags">
        <FlagRow
          name="PERMISSIONS_GUARD_STRICT"
          value={data.flags.strictMode}
          good={data.flags.strictMode}
          help={data.flags.strictMode
            ? 'Strict mode is ON — failed permission checks return 403.'
            : 'Soak mode — failed permission checks are logged but allowed through. Flip to ON after reviewing authz.deny logs.'}
        />
        <FlagRow
          name="ABAC_ENABLED"
          value={data.flags.abacEnabled}
          good={data.flags.abacEnabled}
          help={data.flags.abacEnabled
            ? 'ABAC strict — no matching ALLOW policy yields a 403.'
            : 'ABAC soak — DENY rules enforced, but routes with no matching ALLOW are let through.'}
        />
        <FlagRow
          name="AUTHZ_AUDIT_ENABLED"
          value={data.flags.auditEnabled}
          good={data.flags.auditEnabled}
          help={data.flags.auditEnabled
            ? 'Guard decisions are being persisted to authorization_audits.'
            : 'No audit rows are being written. Compliance + incident response will lack history.'}
        />
      </Section>

      <Section title="SUPER_ADMIN resolution">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              ...statusDot,
              background: superAdminHealthy ? '#10b981' : '#ef4444',
            }}
          />
          <span style={{ fontSize: 14 }}>
            <strong>{data.superAdmin.permissionCount}</strong> permission
            {data.superAdmin.permissionCount === 1 ? '' : 's'} resolved
            {' · '}
            <span style={{ color: data.superAdmin.fullyResolved ? '#16a34a' : '#dc2626' }}>
              {data.superAdmin.fullyResolved ? 'fullyResolved' : 'degraded'}
            </span>
          </span>
        </div>
        {!superAdminHealthy && (
          <div style={alertWarn}>
            <strong>Regression risk.</strong> SUPER_ADMIN should resolve to every permission with{' '}
            <code>fullyResolved=true</code>. The earlier production incident had this counter at zero.
            Check <code>AdminPermissionResolver</code> and the <code>admin_custom_role_permissions</code> join.
          </div>
        )}
      </Section>

      <Section title="Permission registry">
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Metric label="Total" value={data.registry.totalPermissions} />
          <Metric label="CRITICAL" value={data.registry.riskTiers.CRITICAL} color="#dc2626" />
          <Metric label="HIGH" value={data.registry.riskTiers.HIGH} color="#ea580c" />
          <Metric label="MEDIUM" value={data.registry.riskTiers.MEDIUM} color="#ca8a04" />
          <Metric label="LOW" value={data.registry.riskTiers.LOW} color="#16a34a" />
        </div>
        {data.registry.ungrantedKeys.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary style={summaryStyle}>
              {data.registry.ungrantedKeys.length} permission
              {data.registry.ungrantedKeys.length === 1 ? '' : 's'} not granted to any system role
            </summary>
            <ul style={ulStyle}>
              {data.registry.ungrantedKeys.map((k) => (
                <li key={k}>
                  <code style={codeChip}>{k}</code>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title="System roles">
        <table style={tableStyle}>
          <thead>
            <tr style={trHead}>
              <th style={th}>Role</th>
              <th style={{ ...th, textAlign: 'right' }}>Permissions</th>
            </tr>
          </thead>
          <tbody>
            {data.roles.map((r) => (
              <tr key={r.role} style={tr}>
                <td style={{ ...td, fontWeight: 600 }}>{r.role}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.permissionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {data.warnings.length > 0 && (
        <Section title="Warnings">
          <ul style={{ ...ulStyle, paddingLeft: 0, listStyle: 'none' }}>
            {data.warnings.map((w, i) => (
              <li key={i} style={alertWarn}>
                {w}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </h2>
      <div style={sectionBody}>{children}</div>
    </section>
  );
}

function FlagRow({ name, value, good, help }: { name: string; value: boolean; good: boolean; help: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span
        style={{
          ...statusDot,
          background: good ? '#10b981' : '#f59e0b',
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <code style={codeChip}>{name}</code>
          <span style={{ fontSize: 12, fontWeight: 700, color: value ? '#16a34a' : '#dc2626' }}>
            {value ? 'true' : 'false'}
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{help}</div>
      </div>
    </div>
  );
}

function Metric({ label, value, color = '#0f172a' }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 100 }}>
      <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</span>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{ padding: 32 }}>
      <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b' }}>
        {message}
      </div>
    </div>
  );
}

const sectionBody: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '14px 18px',
};

const statusDot: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 999,
  flexShrink: 0,
  marginTop: 4,
};

const codeChip: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 6px',
  background: '#f1f5f9',
  borderRadius: 4,
  fontFamily: 'ui-monospace, monospace',
  color: '#334155',
};

const alertWarn: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  background: '#fffbeb',
  border: '1px solid #fde68a',
  borderRadius: 6,
  color: '#92400e',
  fontSize: 13,
  lineHeight: 1.5,
};

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const trHead: React.CSSProperties = { borderBottom: '1px solid #e2e8f0' };
const tr: React.CSSProperties = { borderBottom: '1px solid #f1f5f9' };
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, color: '#1e293b' };

const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12, color: '#475569', userSelect: 'none' };
const ulStyle: React.CSSProperties = { marginTop: 8, paddingLeft: 18, fontSize: 12, color: '#475569', lineHeight: 1.7 };
