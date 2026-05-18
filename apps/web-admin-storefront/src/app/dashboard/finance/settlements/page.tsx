'use client';

/**
 * Settlement cycles index — list + create new cycle.
 *
 * Backend endpoints:
 *   GET  /admin/settlements/cycles           — paginated list
 *   POST /admin/settlements/create-cycle     — kick off new cycle for period
 *
 * Each row deep-links to /finance/settlements/[id] for the full
 * cycle detail (per-seller margin breakdown, opening/closing balance,
 * Tally CSV export).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { paiseToRupeesString } from '@sportsmart/shared-utils';

interface SettlementCycle {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: string | number;
  totalAmountInPaise: string | number;
  totalMargin: string | number;
  totalMarginInPaise: string | number;
  sellerCount: number;
  createdAt: string;
}

interface CyclesResponse {
  items: SettlementCycle[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const STATUS_PILL: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: 'Draft', color: '#5b6066', bg: '#e7e8ea' },
  PREVIEWED: { label: 'Previewed', color: '#1565c0', bg: '#e3f2fd' },
  APPROVED: { label: 'Approved', color: '#2e7d32', bg: '#e8f5e9' },
  PAID: { label: 'Paid', color: '#5e35b1', bg: '#ede7f6' },
};

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';

export default function SettlementCyclesPage() {
  const [items, setItems] = useState<SettlementCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<CyclesResponse>('/admin/settlements/cycles');
      const data = (res?.data as CyclesResponse) ?? (res as unknown as CyclesResponse);
      setItems(data.items ?? []);
    } catch (err) {
      setError((err as Error).message || 'Failed to load settlement cycles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main style={{ padding: '24px 32px' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          Settlement cycles
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
          Weekly aggregation of seller commissions into payable settlements.
          Click a row to see the per-seller margin breakdown, opening / closing
          balance, and Tally CSV export.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            background: '#ffebee',
            color: '#c62828',
            padding: '10px 14px',
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {loading && <p style={{ color: '#666' }}>Loading…</p>}
      {!loading && items.length === 0 && (
        <p style={{ color: '#666' }}>No settlement cycles yet.</p>
      )}

      {items.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #d0d7de',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#fafbfc' }}>
              <tr>
                <th style={th}>Period</th>
                <th style={th}>Status</th>
                <th style={th}>Sellers</th>
                <th style={{ ...th, textAlign: 'right' }}>Settlement total</th>
                <th style={{ ...th, textAlign: 'right' }}>Platform margin</th>
                <th style={th}>Created</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((cy) => {
                const pill = STATUS_PILL[cy.status] ?? {
                  label: cy.status,
                  color: '#5b6066',
                  bg: '#e7e8ea',
                };
                return (
                  <tr key={cy.id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={td}>
                      <strong>{fmtDate(cy.periodStart)}</strong> →{' '}
                      <strong>{fmtDate(cy.periodEnd)}</strong>
                      <br />
                      <small style={{ color: '#888' }}>
                        Cycle <code>{cy.id.slice(0, 8)}</code>
                      </small>
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 10px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          background: pill.bg,
                          color: pill.color,
                        }}
                      >
                        {pill.label}
                      </span>
                    </td>
                    <td style={td}>{cy.sellerCount ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                      {paiseToRupeesString(cy.totalAmountInPaise)}
                    </td>
                    <td
                      style={{ ...td, textAlign: 'right', color: '#2e7d32' }}
                    >
                      {paiseToRupeesString(cy.totalMarginInPaise)}
                    </td>
                    <td style={td}>{fmtDate(cy.createdAt)}</td>
                    <td style={td}>
                      <Link
                        href={`/dashboard/finance/settlements/${cy.id}`}
                        style={{
                          padding: '6px 12px',
                          background: '#1565c0',
                          color: '#fff',
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 600,
                          textDecoration: 'none',
                        }}
                      >
                        View detail →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

const th: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: '#5b6066',
  textTransform: 'uppercase',
};

const td: React.CSSProperties = {
  padding: '12px',
  verticalAlign: 'top',
};
