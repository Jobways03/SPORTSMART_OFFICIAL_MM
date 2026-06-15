'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRoutingHealth,
  previewRouting,
  RoutingHealthSnapshot,
  PreviewResponse,
  PreviewItem,
  PreviewItemResult,
  AllocationCandidate,
} from '@/services/admin-routing.service';
import { ApiError } from '@/lib/api-client';

type Tab = 'health' | 'preview';

const HEALTH_REFRESH_MS = 30_000;
const PINCODE_RE = /^[1-9][0-9]{5}$/;

const fmtAgo = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
};

export default function AdminRoutingPage() {
  const [tab, setTab] = useState<Tab>('health');

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1
        style={{
          fontSize: 24,
          fontWeight: 700,
          margin: 0,
          color: '#0F1115',
        }}
      >
        Routing diagnostics
      </h1>
      <p
        style={{
          marginTop: 4,
          marginBottom: 20,
          fontSize: 13,
          color: '#525A65',
        }}
      >
        Inspect the allocation engine: backlog, reassign volume, coverage gaps,
        and dry-run any (pincode, cart) without committing an order.
      </p>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '2px solid #e5e7eb',
          marginBottom: 20,
        }}
      >
        {(
          [
            { key: 'health', label: 'Health snapshot' },
            { key: 'preview', label: 'Dry-run preview' },
          ] as Array<{ key: Tab; label: string }>
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 22px',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              borderBottom:
                tab === t.key
                  ? '2px solid #2563eb'
                  : '2px solid transparent',
              background: 'none',
              color: tab === t.key ? '#2563eb' : '#6b7280',
              cursor: 'pointer',
              marginBottom: -2,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'health' ? <HealthTab /> : <PreviewTab />}
    </div>
  );
}

// ─── HEALTH TAB ──────────────────────────────────────────────────────────

function HealthTab() {
  const [data, setData] = useState<RoutingHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reqRef = useRef(0);

  const load = useCallback(async (silent = false) => {
    const id = ++reqRef.current;
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await getRoutingHealth();
      if (id !== reqRef.current) return;
      if (res.data) setData(res.data);
    } catch (err) {
      if (id !== reqRef.current) return;
      setError(
        err instanceof ApiError
          ? err.body?.message || 'Failed to load routing health'
          : 'Failed to load routing health',
      );
    } finally {
      if (!silent && id === reqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), HEALTH_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>
        Loading routing health…
      </div>
    );
  }

  if (error && !data) {
    return <ErrorBanner message={error} onRetry={() => load()} />;
  }

  if (!data) return null;

  const eqWarn = data.exceptionQueue.count > 0;
  const eqOldHours = data.exceptionQueue.oldestAgeHours;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          fontSize: 11,
          color: '#9ca3af',
          textAlign: 'right',
        }}
      >
        Snapshot taken {fmtAgo(data.generatedAt)} · auto-refreshes every 30s
        {loading && <span style={{ marginLeft: 8 }}>· refreshing…</span>}
      </div>

      {/* KPI cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14,
        }}
      >
        <KpiCard
          label="Exception queue"
          value={String(data.exceptionQueue.count)}
          sub={
            eqOldHours == null
              ? 'No stuck orders'
              : `Oldest: ${eqOldHours}h ago`
          }
          tone={eqWarn ? 'red' : 'green'}
        />
        <KpiCard
          label="Reassignments · 7d"
          value={String(data.reassignments.last7dTotal)}
          sub={`${data.reassignments.last7dFromSlaTimeout} from SLA timeout`}
          tone="blue"
        />
        <KpiCard
          label="Coverage gaps · 30d"
          value={String(data.unservicablePincodes.length)}
          sub="Pincodes with failed allocations"
          tone={data.unservicablePincodes.length > 0 ? 'amber' : 'green'}
        />
        <KpiCard
          label="Top rejecting nodes"
          value={String(data.topRejectingNodes.length)}
          sub="Tracked over last 7 days"
          tone="neutral"
        />
      </div>

      {/* Two tables side by side on wide screens */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 14,
        }}
      >
        <Panel title="Top rejecting nodes (last 7 days)">
          {data.topRejectingNodes.length === 0 ? (
            <Empty text="No rejections in the last 7 days." />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr style={trHead}>
                  <th style={th}>Node ID</th>
                  <th style={{ ...th, textAlign: 'right' }}>Rejections</th>
                </tr>
              </thead>
              <tbody>
                {data.topRejectingNodes.map((n) => (
                  <tr key={n.nodeId} style={trBody}>
                    <td
                      style={{
                        ...td,
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 12,
                      }}
                    >
                      {n.nodeId}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: 'right',
                        fontWeight: 600,
                      }}
                    >
                      {n.rejectionsLast7d}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Coverage gaps · pincodes (last 30 days)">
          {data.unservicablePincodes.length === 0 ? (
            <Empty text="No coverage gaps detected." />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr style={trHead}>
                  <th style={th}>Pincode</th>
                  <th style={{ ...th, textAlign: 'right' }}>
                    Failed allocations
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.unservicablePincodes.map((p) => (
                  <tr key={p.pincode} style={trBody}>
                    <td
                      style={{
                        ...td,
                        fontFamily: 'ui-monospace, monospace',
                      }}
                    >
                      {p.pincode}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: 'right',
                        fontWeight: 600,
                      }}
                    >
                      {p.failedAllocationsLast30d}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: 'green' | 'red' | 'amber' | 'blue' | 'neutral';
}) {
  const top: Record<typeof tone, string> = {
    green: '#16a34a',
    red: '#dc2626',
    amber: '#d97706',
    blue: '#2563eb',
    neutral: '#6b7280',
  };
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderTop: `3px solid ${top[tone]}`,
        borderRadius: 10,
        padding: '14px 18px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: '#6b7280',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: top[tone] }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── PREVIEW TAB ─────────────────────────────────────────────────────────

interface FormRow {
  productId: string;
  variantId: string;
  quantity: string;
}

function emptyRow(): FormRow {
  return { productId: '', variantId: '', quantity: '1' };
}

function PreviewTab() {
  const [pincode, setPincode] = useState('');
  const [rows, setRows] = useState<FormRow[]>([emptyRow()]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PreviewResponse | null>(null);

  const validRows = rows.filter(
    (r) => r.productId.trim() && parseInt(r.quantity, 10) > 0,
  );
  const canRun =
    !running && PINCODE_RE.test(pincode.trim()) && validRows.length > 0;

  const onRun = async () => {
    setError('');
    setResult(null);
    if (!PINCODE_RE.test(pincode.trim())) {
      setError('Enter a valid 6-digit pincode.');
      return;
    }
    if (validRows.length === 0) {
      setError('Add at least one item with a Product ID and quantity ≥ 1.');
      return;
    }
    if (validRows.length > 50) {
      setError('Preview is capped at 50 items per request.');
      return;
    }
    setRunning(true);
    try {
      const items: PreviewItem[] = validRows.map((r) => ({
        productId: r.productId.trim(),
        variantId: r.variantId.trim() || null,
        quantity: parseInt(r.quantity, 10),
      }));
      const res = await previewRouting({
        pincode: pincode.trim(),
        items,
      });
      if (res.data) setResult(res.data);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.body?.message || 'Preview failed'
          : 'Preview failed',
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Panel title="Input">
        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            marginBottom: 14,
          }}
        >
          <div style={{ flex: '0 0 180px' }}>
            <label style={labelStyle}>Customer pincode</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pincode}
              onChange={(e) =>
                setPincode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))
              }
              placeholder="560001"
              style={{
                ...inputStyle,
                fontFamily: 'ui-monospace, monospace',
                letterSpacing: '0.05em',
              }}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={trHead}>
                <th style={th}>Product ID *</th>
                <th style={th}>Variant ID (optional)</th>
                <th style={{ ...th, width: 100 }}>Qty</th>
                <th style={{ ...th, width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} style={trBody}>
                  <td style={tdInput}>
                    <input
                      type="text"
                      value={r.productId}
                      onChange={(e) =>
                        setRows((rs) =>
                          rs.map((row, i) =>
                            i === idx ? { ...row, productId: e.target.value } : row,
                          ),
                        )
                      }
                      placeholder="prd_..."
                      style={inlineInputStyle}
                    />
                  </td>
                  <td style={tdInput}>
                    <input
                      type="text"
                      value={r.variantId}
                      onChange={(e) =>
                        setRows((rs) =>
                          rs.map((row, i) =>
                            i === idx ? { ...row, variantId: e.target.value } : row,
                          ),
                        )
                      }
                      placeholder="var_... (leave blank if no variant)"
                      style={inlineInputStyle}
                    />
                  </td>
                  <td style={tdInput}>
                    <input
                      type="number"
                      min={1}
                      value={r.quantity}
                      onChange={(e) =>
                        setRows((rs) =>
                          rs.map((row, i) =>
                            i === idx ? { ...row, quantity: e.target.value } : row,
                          ),
                        )
                      }
                      style={inlineInputStyle}
                    />
                  </td>
                  <td style={{ ...tdInput, textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() =>
                        setRows((rs) =>
                          rs.length === 1
                            ? [emptyRow()]
                            : rs.filter((_, i) => i !== idx),
                        )
                      }
                      title="Remove row"
                      style={removeBtnStyle}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          style={{
            marginTop: 14,
            display: 'flex',
            gap: 10,
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, emptyRow()])}
            disabled={rows.length >= 50}
            style={secondaryBtn}
          >
            + Add another item
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                setRows([emptyRow()]);
                setPincode('');
                setResult(null);
                setError('');
              }}
              style={secondaryBtn}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onRun}
              disabled={!canRun}
              style={{
                ...primaryBtn,
                background: canRun ? '#2563eb' : '#9ca3af',
                cursor: canRun ? 'pointer' : 'not-allowed',
              }}
            >
              {running ? 'Running…' : 'Run dry-run preview'}
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              color: '#991b1b',
              background: '#fee2e2',
              border: '1px solid #fecaca',
              padding: '8px 12px',
              borderRadius: 6,
            }}
          >
            {error}
          </div>
        )}
      </Panel>

      {result && (
        <Panel title={`Result · pincode ${result.pincode}`}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 14,
            }}
          >
            <SummaryPill
              label="Total"
              value={result.summary.totalItems}
              color="#374151"
            />
            <SummaryPill
              label="Serviceable"
              value={result.summary.servicableItems}
              color="#16a34a"
            />
            <SummaryPill
              label="Unserviceable"
              value={result.summary.unservicableItems}
              color="#d97706"
            />
            <SummaryPill
              label="Failed"
              value={result.summary.failedItems}
              color="#dc2626"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {result.results.map((r, idx) => (
              <ItemResultCard key={idx} index={idx + 1} result={r} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function SummaryPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      style={{
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '8px 12px',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function ItemResultCard({
  index,
  result,
}: {
  index: number;
  result: PreviewItemResult;
}) {
  const okPrimary =
    !result.error && result.allocation?.serviceable && result.allocation?.primary;
  const accent = result.error
    ? '#dc2626'
    : !result.allocation?.serviceable
      ? '#d97706'
      : '#16a34a';

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderLeft: `4px solid ${accent}`,
        borderRadius: 8,
        padding: '14px 16px',
        background: '#fff',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 8,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: '#6b7280',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Item #{index} · qty {result.quantity}
          </div>
          <div
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 12,
              color: '#374151',
              marginTop: 4,
            }}
          >
            product {result.productId ?? '—'}
            {result.variantId ? ` · variant ${result.variantId}` : ''}
          </div>
        </div>
        <span
          style={{
            padding: '3px 9px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            background: result.error
              ? '#fee2e2'
              : !result.allocation?.serviceable
                ? '#fef3c7'
                : '#dcfce7',
            color: accent,
          }}
        >
          {result.error
            ? 'Error'
            : !result.allocation?.serviceable
              ? 'Unserviceable'
              : 'Serviceable'}
        </span>
      </div>

      {result.error && (
        <div style={{ fontSize: 13, color: '#991b1b' }}>{result.error}</div>
      )}

      {!result.error && result.allocation && (
        <>
          {!okPrimary && result.allocation.reason && (
            <div
              style={{
                fontSize: 12,
                color: '#92400e',
                background: '#fef3c7',
                padding: '6px 10px',
                borderRadius: 6,
                marginBottom: 8,
              }}
            >
              {result.allocation.reason}
            </div>
          )}
          {result.allocation.primary && (
            <CandidateRow
              tag="Primary"
              candidate={result.allocation.primary}
              accent="#16a34a"
            />
          )}
          {result.allocation.alternates.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 4,
                }}
              >
                Alternates ({result.allocation.alternates.length})
              </div>
              {result.allocation.alternates.map((c, i) => (
                <CandidateRow
                  key={`${c.mappingId}-${i}`}
                  tag={`#${i + 2}`}
                  candidate={c}
                  accent="#6b7280"
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CandidateRow({
  tag,
  candidate,
  accent,
}: {
  tag: string;
  candidate: AllocationCandidate;
  accent: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: '8px 10px',
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        marginTop: 6,
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: accent,
          background: '#fff',
          border: `1px solid ${accent}`,
          padding: '2px 7px',
          borderRadius: 999,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {tag}
      </span>
      <span
        style={{
          fontSize: 12,
          color: '#374151',
          fontWeight: 600,
        }}
      >
        {candidate.nodeType.toLowerCase()}
      </span>
      <span
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11,
          color: '#6b7280',
        }}
      >
        {candidate.sellerId ?? candidate.franchiseId ?? candidate.mappingId}
      </span>
      {candidate.nodeName && (
        <span style={{ fontSize: 12, color: '#374151' }}>
          {candidate.nodeName}
        </span>
      )}
      <span
        style={{
          marginLeft: 'auto',
          display: 'flex',
          gap: 12,
          fontSize: 11,
          color: '#6b7280',
        }}
      >
        <span>
          score{' '}
          <strong style={{ color: '#111827' }}>
            {candidate.score?.toFixed?.(2) ?? candidate.score}
          </strong>
        </span>
        <span>
          dist{' '}
          <strong style={{ color: '#111827' }}>
            {candidate.distanceKm != null
              ? `${candidate.distanceKm.toFixed(1)} km`
              : '—'}
          </strong>
        </span>
        <span>
          stock{' '}
          <strong style={{ color: '#111827' }}>{candidate.availableQty}</strong>
        </span>
      </span>
      {candidate.reasons && candidate.reasons.length > 0 && (
        <div style={{ width: '100%', marginTop: 4 }}>
          {candidate.reasons.map((r, i) => (
            <span
              key={i}
              style={{
                display: 'inline-block',
                fontSize: 11,
                color: '#525A65',
                background: '#fff',
                border: '1px solid #e5e7eb',
                padding: '2px 8px',
                borderRadius: 999,
                marginRight: 4,
                marginTop: 2,
              }}
            >
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: '18px 20px',
      }}
    >
      <h2
        style={{
          fontSize: 13,
          fontWeight: 700,
          margin: 0,
          marginBottom: 14,
          color: '#374151',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 24,
        textAlign: 'center',
        color: '#9ca3af',
        fontSize: 13,
        background: '#f9fafb',
        borderRadius: 8,
      }}
    >
      {text}
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        background: '#fee2e2',
        border: '1px solid #fecaca',
        color: '#991b1b',
        borderRadius: 8,
        padding: '14px 16px',
        fontSize: 14,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <span>{message}</span>
      <button
        onClick={onRetry}
        style={{
          background: '#fff',
          border: '1px solid #fecaca',
          color: '#991b1b',
          padding: '6px 12px',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const trHead: React.CSSProperties = {
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
};

const trBody: React.CSSProperties = {
  borderBottom: '1px solid #f3f4f6',
};

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 10,
  fontWeight: 700,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const td: React.CSSProperties = {
  padding: '10px 14px',
};

const tdInput: React.CSSProperties = {
  padding: '6px 8px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 14,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
};

const inlineInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 12,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'ui-monospace, monospace',
};

const primaryBtn: React.CSSProperties = {
  padding: '9px 18px',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
};

const secondaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  background: '#fff',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  cursor: 'pointer',
};

const removeBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: '1px solid #e5e7eb',
  background: '#fff',
  color: '#6b7280',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
};
