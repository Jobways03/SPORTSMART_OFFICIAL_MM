'use client';

// Phase 13 (P1.11) — admin queue for HIGH-risk returns.
//
// Returns whose intake-time risk score >= 60 land here so an admin
// reviews them before approving a refund. The score and its flags
// are surfaced inline so reviewers see "why is this risky" at a
// glance without re-running the scorer.
//
// Risk-review audit — filtering moved SERVER-SIDE. Previously this
// page pulled one limit:200 page (the backend caps at 100, so it was
// really 100 rows) and bucketed by score in the browser. That made
// every HIGH return past row 100 invisible and gave no pagination.
// We now translate the active bucket into the backend's
// riskScoreMin / riskScoreMax / hasRiskScore query params and page
// through the full result set with real Prev/Next controls.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  adminReturnsService,
  ListReturnsParams,
  ReturnListItem,
} from '@/services/admin-returns.service';

type Bucket = 'HIGH' | 'MEDIUM' | 'LOW' | 'ALL';

const PAGE_LIMIT = 20;

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'ALL', label: 'All scored' },
  { key: 'HIGH', label: 'High (≥ 60)' },
  { key: 'MEDIUM', label: 'Medium (30–59)' },
  { key: 'LOW', label: 'Low (< 30)' },
];

// Bucket → backend risk query params. The server applies these against
// the whole table (not a truncated page) and returns highest-risk-first
// within the chosen window. ALL = "has any score" so unscored intake
// rows stay out of the review queue, matching the old client behaviour.
function bucketParams(bucket: Bucket): Pick<
  ListReturnsParams,
  'riskScoreMin' | 'riskScoreMax' | 'hasRiskScore'
> {
  switch (bucket) {
    case 'HIGH':
      return { riskScoreMin: 60 };
    case 'MEDIUM':
      return { riskScoreMin: 30, riskScoreMax: 59 };
    case 'LOW':
      return { riskScoreMax: 29 };
    case 'ALL':
    default:
      return { hasRiskScore: true };
  }
}

const FLAG_COLOR: Record<string, string> = {
  CUSTOMER_ABUSE: '#b91c1c',
  HIGH_RECENT_RETURN_COUNT: '#d97706',
  HIGH_VALUE_WEAK_EVIDENCE: '#9a3412',
  HIGH_VALUE: '#b45309',
  MISSING_ITEM_CLAIM: '#b91c1c',
  CHARGEBACK_HISTORY: '#7f1d1d',
};

export default function RiskReviewPage() {
  const [bucket, setBucket] = useState<Bucket>('ALL');
  const [rows, setRows] = useState<ReturnListItem[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: PAGE_LIMIT,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchPage = useCallback(
    async (activeBucket: Bucket, page: number) => {
      setLoading(true);
      setError('');
      try {
        const res = await adminReturnsService.listReturns({
          ...bucketParams(activeBucket),
          page,
          limit: PAGE_LIMIT,
        });
        if (res.data) {
          setRows(res.data.returns);
          setPagination(res.data.pagination);
        }
      } catch (err) {
        setRows([]);
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Reset to page 1 whenever the bucket changes; otherwise follow the
  // operator's Prev/Next through the active bucket.
  useEffect(() => {
    fetchPage(bucket, 1);
  }, [bucket, fetchPage]);

  const goToPage = (page: number) => {
    if (page < 1 || page > pagination.totalPages || page === pagination.page) return;
    fetchPage(bucket, page);
  };

  // The backend already returns highest-risk-first; render in the order
  // it sends. (No client-side re-sort — the previous in-browser sort only
  // ordered the truncated page, which is exactly the bug we removed.)
  const visibleRows = useMemo(
    () => rows.filter((r) => typeof r.riskScore === 'number'),
    [rows],
  );

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
        Risk review
      </h1>
      <p style={{ marginTop: 6, fontSize: 13, color: '#525A65' }}>
        Returns scored at intake by the rule-based risk model. HIGH
        bucket returns require explicit admin acknowledgement at QC
        before a cash refund can be issued.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '20px 0 12px' }}>
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => setBucket(b.key)}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 9999,
              border: bucket === b.key ? '1px solid #0F1115' : '1px solid #D2D6DC',
              background: bucket === b.key ? '#0F1115' : '#fff',
              color: bucket === b.key ? '#fff' : '#0F1115',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {b.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: 10, marginBottom: 12, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        {loading && visibleRows.length === 0 ? (
          <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>Loading…</div>
        ) : visibleRows.length === 0 ? (
          <div style={{ padding: 32, color: '#7A828F', textAlign: 'center' }}>
            Nothing in this bucket.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>
                <Th>Return</Th>
                <Th>Score</Th>
                <Th>Flags</Th>
                <Th>Status</Th>
                <Th>Refund amount</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const flags = (r.riskFlags ?? []) as string[];
                const score = r.riskScore ?? 0;
                const scoreColor =
                  score >= 60 ? '#b91c1c' : score >= 30 ? '#d97706' : '#15803d';
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <Td>
                      <Link
                        href={`/dashboard/returns/${r.id}`}
                        style={{ color: '#2A8595', fontWeight: 600 }}
                      >
                        {r.returnNumber}
                      </Link>
                    </Td>
                    <Td>
                      <span style={{
                        fontSize: 14, fontWeight: 700, color: scoreColor,
                      }}>
                        {score}
                      </span>
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {flags.length === 0
                          ? <span style={{ color: '#9ca3af', fontSize: 11 }}>—</span>
                          : flags.map((f) => (
                            <span key={f} style={{
                              fontSize: 10, padding: '2px 7px', borderRadius: 4,
                              background: (FLAG_COLOR[f] ?? '#525A65') + '20',
                              color: FLAG_COLOR[f] ?? '#525A65',
                              fontWeight: 600,
                            }}>
                              {f}
                            </span>
                          ))}
                      </div>
                    </Td>
                    <Td>{r.status.replace(/_/g, ' ').toLowerCase()}</Td>
                    <Td>
                      {r.refundAmount != null
                        ? `₹${Number(r.refundAmount).toLocaleString('en-IN')}`
                        : '—'}
                    </Td>
                    <Td style={{ color: '#525A65' }}>
                      {new Date(r.createdAt).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pagination.totalPages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, marginTop: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, color: '#7A828F' }}>
            Showing{' '}
            <strong>{(pagination.page - 1) * pagination.limit + 1}</strong>–
            <strong>
              {Math.min(pagination.page * pagination.limit, pagination.total)}
            </strong>{' '}
            of <strong>{pagination.total.toLocaleString('en-IN')}</strong>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              disabled={pagination.page <= 1 || loading}
              onClick={() => goToPage(pagination.page - 1)}
              style={pageBtnStyle(pagination.page <= 1 || loading)}
            >
              Prev
            </button>
            <span style={{ fontSize: 12, color: '#525A65', fontWeight: 600 }}>
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages || loading}
              onClick={() => goToPage(pagination.page + 1)}
              style={pageBtnStyle(pagination.page >= pagination.totalPages || loading)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      <p style={{ marginTop: 8, fontSize: 11, color: '#7A828F' }}>
        {pagination.total.toLocaleString('en-IN')} matches · sorted by score descending
      </p>
    </div>
  );
}

function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 30,
    padding: '0 14px',
    borderRadius: 8,
    border: '1px solid #D2D6DC',
    background: '#fff',
    color: disabled ? '#B0B6BE' : '#0F1115',
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '12px 14px', verticalAlign: 'top', ...style }}>{children}</td>;
}
