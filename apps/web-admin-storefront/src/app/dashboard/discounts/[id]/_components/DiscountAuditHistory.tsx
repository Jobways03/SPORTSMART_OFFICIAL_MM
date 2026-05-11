// Phase E (P1.1) — Discount audit history panel.
//
// Renders the AuditLog rows for a single discount, newest first.
// Each row shows actor + action + a compact diff of changed fields
// (only the financially-relevant ones are stored on the audit row,
// per DiscountEventsService.narrowFinancialFields).

'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface AuditRow {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

const ACTION_LABEL: Record<string, string> = {
  'discount.created': 'Created',
  'discount.updated': 'Updated',
  'discount.deleted': 'Deleted',
  'discount.activated': 'Activated',
  'discount.disabled': 'Disabled',
  'discount.approved': 'Approved',
  'discount.rejected': 'Rejected',
  'discount.approval_requested': 'Approval requested',
};

const ACTION_TONE: Record<string, { bg: string; fg: string }> = {
  'discount.created': { bg: '#ecfdf5', fg: '#065f46' },
  'discount.updated': { bg: '#eff6ff', fg: '#1e40af' },
  'discount.deleted': { bg: '#fee2e2', fg: '#991b1b' },
  'discount.activated': { bg: '#ecfdf5', fg: '#065f46' },
  'discount.disabled': { bg: '#fef3c7', fg: '#92400e' },
  'discount.approved': { bg: '#ecfdf5', fg: '#065f46' },
  'discount.rejected': { bg: '#fee2e2', fg: '#991b1b' },
};

function diffFields(
  oldV: Record<string, unknown> | null,
  newV: Record<string, unknown> | null,
): Array<{ key: string; from: unknown; to: unknown }> {
  if (!oldV && newV) {
    return Object.entries(newV).map(([key, to]) => ({
      key,
      from: undefined,
      to,
    }));
  }
  if (oldV && !newV) {
    return Object.entries(oldV).map(([key, from]) => ({
      key,
      from,
      to: undefined,
    }));
  }
  if (!oldV || !newV) return [];
  const keys = new Set([...Object.keys(oldV), ...Object.keys(newV)]);
  const out: Array<{ key: string; from: unknown; to: unknown }> = [];
  for (const key of keys) {
    const from = oldV[key];
    const to = newV[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      out.push({ key, from, to });
    }
  }
  return out;
}

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function DiscountAuditHistory({ discountId }: { discountId: string }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!discountId) return;
    let cancelled = false;
    apiClient<AuditRow[]>(`/admin/discounts/${discountId}/audit-history?limit=50`)
      .then((res) => {
        if (!cancelled) setRows(res.data ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [discountId]);

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 20,
        marginTop: 20,
      }}
    >
      <h3
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: '#374151',
          margin: '0 0 4px',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        Audit history
      </h3>
      <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 16px' }}>
        Tamper-evident log of who changed what + when. Only financially-
        relevant fields are recorded. Newest first.
      </p>

      {error && (
        <div
          style={{
            padding: 8,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            color: '#991b1b',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {!rows && !error && (
        <div style={{ color: '#9ca3af', fontSize: 12 }}>Loading…</div>
      )}

      {rows && rows.length === 0 && (
        <div style={{ color: '#9ca3af', fontSize: 13 }}>
          No audit entries yet.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((row) => {
            const diffs = diffFields(row.oldValue, row.newValue);
            const tone = ACTION_TONE[row.action] ?? { bg: '#f3f4f6', fg: '#374151' };
            return (
              <div
                key={row.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        background: tone.bg,
                        color: tone.fg,
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: 0.3,
                      }}
                    >
                      {ACTION_LABEL[row.action] ?? row.action}
                    </span>
                    <span style={{ color: '#6b7280' }}>
                      by {row.actorId ? truncate(row.actorId, 14) : 'system'}
                      {row.actorRole ? ` · ${row.actorRole}` : ''}
                    </span>
                  </div>
                  <span style={{ color: '#9ca3af', fontSize: 11 }}>
                    {fmtDateTime(row.createdAt)}
                  </span>
                </div>

                {diffs.length > 0 ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr 1fr',
                      columnGap: 12,
                      rowGap: 4,
                      fontSize: 11,
                      paddingTop: 6,
                      borderTop: '1px solid #f3f4f6',
                    }}
                  >
                    <div style={{ color: '#9ca3af', fontWeight: 600 }}>Field</div>
                    <div style={{ color: '#9ca3af', fontWeight: 600 }}>From</div>
                    <div style={{ color: '#9ca3af', fontWeight: 600 }}>To</div>
                    {diffs.map((d) => (
                      <div key={d.key} style={{ display: 'contents' }}>
                        <div style={{ color: '#374151', fontWeight: 600 }}>
                          {d.key}
                        </div>
                        <div style={{ color: '#dc2626', fontFamily: 'monospace' }}>
                          {fmt(d.from)}
                        </div>
                        <div style={{ color: '#15803d', fontFamily: 'monospace' }}>
                          {fmt(d.to)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#9ca3af', fontSize: 11 }}>
                    No field-level diff captured.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function truncate(v: string, n: number): string {
  return v.length > n ? `${v.slice(0, n)}…` : v;
}
