'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient, ApiError } from '@/lib/api-client';

type Severity = 'OK' | 'WARNING' | 'ERROR';
type Health = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

interface Issue {
  check: string;
  severity: Severity;
  count: number;
  description: string;
  samples?: unknown[];
}

interface ValidationReport {
  overallHealth: Health;
  summary: {
    errors: number;
    warnings: number;
    passed: number;
    totalChecks: number;
  };
  systemStats: {
    totalProducts: number;
    totalActiveProducts: number;
    totalVariants: number;
    totalMappings: number;
    totalActiveMappings: number;
    totalOrders: number;
    totalCommissionRecords: number;
    totalReservations: number;
  };
  issues: Issue[];
  executionTimeMs: number;
  runAt: string;
}

const HEALTH_COLOR: Record<Health, { bg: string; fg: string; label: string }> = {
  HEALTHY: { bg: '#dcfce7', fg: '#166534', label: 'Healthy' },
  DEGRADED: { bg: '#fef3c7', fg: '#92400e', label: 'Degraded' },
  UNHEALTHY: { bg: '#fee2e2', fg: '#991b1b', label: 'Unhealthy' },
};

const SEVERITY_COLOR: Record<Severity, { bg: string; fg: string }> = {
  OK: { bg: '#dcfce7', fg: '#166534' },
  WARNING: { bg: '#fef3c7', fg: '#92400e' },
  ERROR: { bg: '#fee2e2', fg: '#991b1b' },
};

const labelOf = (check: string) =>
  check
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');

export default function DataValidationPage() {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<ValidationReport>(
        '/admin/system/data-validation',
      );
      if (res.data) setReport(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Validation failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const toggle = (check: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(check) ? next.delete(check) : next.add(check);
      return next;
    });
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200 }}>
      <Link
        href="/dashboard"
        style={{
          color: '#525A65',
          fontSize: 13,
          textDecoration: 'none',
          display: 'inline-block',
          marginBottom: 8,
        }}
      >
        ← Back to dashboard
      </Link>

      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#0f172a' }}>
            Data validation
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>
            Cross-table integrity report. Run after schema changes or large
            imports. Heavy query — don&apos;t auto-poll.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          style={{
            height: 36,
            padding: '0 16px',
            border: 'none',
            background: '#0F1115',
            color: '#fff',
            borderRadius: 9999,
            fontWeight: 600,
            fontSize: 13,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Running…' : '↻ Re-run validation'}
        </button>
      </header>

      {error && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {loading && !report && (
        <div style={{ color: '#64748b', fontSize: 13, padding: 24 }}>
          Running checks…
        </div>
      )}

      {report && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 18px',
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              marginBottom: 16,
            }}
          >
            <span
              style={{
                padding: '4px 14px',
                borderRadius: 9999,
                fontWeight: 700,
                fontSize: 12,
                background: HEALTH_COLOR[report.overallHealth].bg,
                color: HEALTH_COLOR[report.overallHealth].fg,
              }}
            >
              {HEALTH_COLOR[report.overallHealth].label}
            </span>
            <span style={{ fontSize: 13, color: '#475569' }}>
              <strong>{report.summary.errors}</strong> error
              {report.summary.errors === 1 ? '' : 's'} ·{' '}
              <strong>{report.summary.warnings}</strong> warning
              {report.summary.warnings === 1 ? '' : 's'} ·{' '}
              <strong>{report.summary.passed}</strong> passed
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>
              {report.executionTimeMs} ms · {new Date(report.runAt).toLocaleString()}
            </span>
          </div>

          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              marginBottom: 18,
            }}
          >
            <Stat label="Products" value={report.systemStats.totalProducts} sub={`${report.systemStats.totalActiveProducts} active`} />
            <Stat label="Variants" value={report.systemStats.totalVariants} />
            <Stat label="Mappings" value={report.systemStats.totalMappings} sub={`${report.systemStats.totalActiveMappings} active`} />
            <Stat label="Orders" value={report.systemStats.totalOrders} />
            <Stat label="Commission records" value={report.systemStats.totalCommissionRecords} />
            <Stat label="Stock reservations" value={report.systemStats.totalReservations} />
          </section>

          <section
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#fafafa', textAlign: 'left' }}>
                  <th style={th}>Check</th>
                  <th style={th}>Severity</th>
                  <th style={{ ...th, textAlign: 'right' }}>Count</th>
                  <th style={th}>Description</th>
                  <th style={{ ...th, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {report.issues.map((iss) => {
                  const c = SEVERITY_COLOR[iss.severity];
                  const isExpanded = expanded.has(iss.check);
                  return (
                    <>
                      <tr key={iss.check} style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={td}>
                          <span style={{ fontWeight: 600, color: '#0f172a' }}>{labelOf(iss.check)}</span>
                          <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>
                            {iss.check}
                          </div>
                        </td>
                        <td style={td}>
                          <span
                            style={{
                              padding: '2px 10px',
                              borderRadius: 9999,
                              fontSize: 11,
                              fontWeight: 700,
                              background: c.bg,
                              color: c.fg,
                            }}
                          >
                            {iss.severity}
                          </span>
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: iss.count > 0 ? '#0f172a' : '#94a3b8' }}>
                          {iss.count}
                        </td>
                        <td style={{ ...td, color: '#475569' }}>{iss.description}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {iss.samples && iss.samples.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggle(iss.check)}
                              style={{
                                height: 26,
                                padding: '0 10px',
                                border: '1px solid #d1d5db',
                                background: '#fff',
                                color: '#0F1115',
                                borderRadius: 9999,
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              {isExpanded ? 'Hide' : `Samples (${iss.samples.length})`}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && iss.samples && (
                        <tr style={{ background: '#fafafa' }}>
                          <td colSpan={5} style={{ padding: '12px 18px' }}>
                            <pre
                              style={{
                                margin: 0,
                                background: '#0f172a',
                                color: '#e2e8f0',
                                padding: 12,
                                borderRadius: 8,
                                fontSize: 11,
                                lineHeight: 1.5,
                                overflowX: 'auto',
                                fontFamily: 'ui-monospace, monospace',
                              }}
                            >
                              {JSON.stringify(iss.samples, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: '#64748b',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: '#0f172a' }}>
        {value.toLocaleString()}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const td: React.CSSProperties = {
  padding: '12px 14px',
};
