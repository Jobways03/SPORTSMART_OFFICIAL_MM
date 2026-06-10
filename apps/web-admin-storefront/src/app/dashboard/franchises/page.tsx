'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RequirePermission } from '@/lib/permissions';
import {
  adminFranchisesService,
  FranchiseListItem,
} from '@/services/admin-franchises.service';

const LIMIT = 20;

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: '#16a34a',
  APPROVED: '#16a34a',
  PENDING: '#d97706',
  UNDER_REVIEW: '#d97706',
  NOT_VERIFIED: '#7A828F',
  VERIFIED: '#16a34a',
  SUSPENDED: '#b91c1c',
  REJECTED: '#b91c1c',
  DEACTIVATED: '#b91c1c',
};

export function Pill({ value }: { value?: string }) {
  const color = STATUS_COLOR[value ?? ''] ?? '#525A65';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        padding: '0 8px',
        borderRadius: 9999,
        background: color + '22',
        color,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
      }}
    >
      {(value ?? '—').replace(/_/g, ' ')}
    </span>
  );
}

function FranchisesInner() {
  const [items, setItems] = useState<FranchiseListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [status, setStatus] = useState('');
  const [verification, setVerification] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminFranchisesService.list({
        page,
        limit: LIMIT,
        search: applied || undefined,
        status: status || undefined,
        verificationStatus: verification || undefined,
      });
      if (res.data) {
        setItems(res.data.franchises ?? []);
        setTotal(res.data.pagination?.total ?? 0);
      } else {
        setErr(res.message || 'Failed to load franchises');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load franchises');
    } finally {
      setLoading(false);
    }
  }, [page, applied, status, verification]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F1115', margin: 0 }}>Franchises</h1>
        <span style={{ fontSize: 13, color: '#7A828F' }}>{total} total</span>
      </div>
      <p style={{ fontSize: 13, color: '#7A828F', margin: '0 0 18px' }}>
        Manage franchise partners — KYC verification, status, inventory, territories, catalog &amp; POS.
      </p>

      {/* Filters */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied(search.trim());
        }}
        style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name / code / email…"
          style={{ ...inputStyle, minWidth: 240, flex: 1 }}
        />
        <select
          value={status}
          onChange={(e) => { setPage(1); setStatus(e.target.value); }}
          style={inputStyle}
        >
          <option value="">All statuses</option>
          {['PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={verification}
          onChange={(e) => { setPage(1); setVerification(e.target.value); }}
          style={inputStyle}
        >
          <option value="">All KYC</option>
          {['NOT_VERIFIED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <button type="submit" style={primaryBtn}>Search</button>
      </form>

      {err && (
        <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{err}</div>
      )}

      <div style={{ border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#F9FAFB' }}>
            <tr>
              <th style={th}>Code</th>
              <th style={th}>Business</th>
              <th style={th}>Owner</th>
              <th style={th}>Status</th>
              <th style={th}>KYC</th>
              <th style={th}>Zone</th>
              <th style={th}>Profile</th>
            </tr>
          </thead>
          <tbody>
            {loading && !items.length ? (
              <tr><td style={td} colSpan={7}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td style={{ ...td, color: '#7A828F' }} colSpan={7}>No franchises found.</td></tr>
            ) : (
              items.map((f) => (
                <tr key={f.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <td style={td}>
                    <Link href={`/dashboard/franchises/${f.id}`} style={{ color: '#0F1115', fontWeight: 600, textDecoration: 'none' }}>
                      {f.franchiseCode || f.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td style={td}>{f.businessName}</td>
                  <td style={{ ...td, color: '#525A65' }}>{f.ownerName || '—'}</td>
                  <td style={td}><Pill value={f.status} /></td>
                  <td style={td}><Pill value={f.verificationStatus} /></td>
                  <td style={{ ...td, color: '#525A65' }}>{f.assignedZone || '—'}</td>
                  <td style={{ ...td, color: '#525A65' }}>{f.profileCompletionPercentage ?? 0}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <span style={{ fontSize: 13, color: '#7A828F' }}>Page {page} of {totalPages}</span>
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} style={pageBtn}>Prev</button>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} style={pageBtn}>Next</button>
      </div>
    </div>
  );
}

export default function FranchisesPage() {
  return (
    <RequirePermission anyOf={['franchise.read']} fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <FranchisesInner />
    </RequirePermission>
  );
}

const th: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '12px 14px', fontSize: 13, color: '#0F1115' };
const inputStyle: React.CSSProperties = {
  border: '1px solid #D2D6DC', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#0F1115', background: '#fff',
};
const pageBtn: React.CSSProperties = {
  background: '#fff', border: '1px solid #D2D6DC', borderRadius: 6, padding: '6px 14px',
  fontSize: 13, cursor: 'pointer', color: '#0F1115',
};
const primaryBtn: React.CSSProperties = {
  ...pageBtn, background: '#0F1115', color: '#fff', border: '1px solid #0F1115', fontWeight: 600,
};
