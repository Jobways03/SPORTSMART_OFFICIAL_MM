'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { adminFranchisesService } from '@/services/admin-franchises.service';

type SettlementStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'FAILED';

interface Settlement {
  id: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  totalAmount?: number | string | null;
  amount?: number | string | null;
  status: SettlementStatus;
  franchise?: {
    id?: string;
    businessName?: string | null;
    franchiseCode?: string | null;
  } | null;
}

const STATUS_LABELS: Record<SettlementStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  PAID: 'Paid',
  FAILED: 'Failed',
};

const STATUS_COLORS: Record<SettlementStatus, { bg: string; fg: string }> = {
  PENDING: { bg: '#fef3c7', fg: '#92400e' },
  APPROVED: { bg: '#dbeafe', fg: '#1d4ed8' },
  PAID: { bg: '#dcfce7', fg: '#15803d' },
  FAILED: { bg: '#fee2e2', fg: '#991b1b' },
};

const fmt = (v: number | string | null | undefined) =>
  `\u20B9${Number(v ?? 0).toLocaleString('en-IN')}`;

const toYmd = (d: Date) => d.toISOString().slice(0, 10);

export default function FranchiseSettlementsPage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [rowAction, setRowAction] = useState<string | null>(null);

  // Create-cycle modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<{ periodStart: string; periodEnd: string }>(() => {
    // Default to the most recent full week ending yesterday.
    const today = new Date();
    const end = new Date(today);
    end.setDate(today.getDate() - 1);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return { periodStart: toYmd(start), periodEnd: toYmd(end) };
  });
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await adminFranchisesService.listSettlements({ limit: 50 });
      const d = res.data as any;
      const list: Settlement[] =
        d?.settlements ?? (Array.isArray(d) ? d : []);
      setSettlements(list);
    } catch (err) {
      // Surface the failure instead of silently showing "no settlements
      // yet" — the prior empty catch hid every network / auth error.
      setLoadError(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to load settlements',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError('');

    if (!createForm.periodStart || !createForm.periodEnd) {
      setCreateError('Pick both a start and end date');
      return;
    }
    // Inline range validation. Without this the backend accepts an
    // inverted range and returns an empty cycle, which looks like a
    // silent no-op to the admin.
    if (createForm.periodStart > createForm.periodEnd) {
      setCreateError('End date must be on or after start date');
      return;
    }

    setCreateSaving(true);
    try {
      await adminFranchisesService.createSettlementCycle(
        createForm.periodStart,
        createForm.periodEnd,
      );
      setShowCreate(false);
      await load();
    } catch (err) {
      setCreateError(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to create cycle',
      );
    } finally {
      setCreateSaving(false);
    }
  };

  const handleApprove = async (id: string) => {
    setRowAction(id);
    try {
      await adminFranchisesService.approveSettlement(id);
      await load();
    } catch {
      /* row stays; admin can retry */
    } finally {
      setRowAction(null);
    }
  };

  const handleMarkPaid = async (id: string) => {
    setRowAction(id);
    try {
      await adminFranchisesService.markSettlementPaid(id);
      await load();
    } catch {
      /* row stays; admin can retry */
    } finally {
      setRowAction(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Franchise Settlements</h1>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            Manage payout cycles and settlement history for franchise partners.
          </p>
        </div>
        <button
          onClick={() => {
            setCreateError('');
            setShowCreate(true);
          }}
          style={{
            padding: '8px 14px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + Create cycle
        </button>
      </div>

      {loadError && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{loadError}</span>
          <button
            onClick={load}
            style={{
              background: 'transparent',
              color: '#991b1b',
              border: '1px solid #991b1b',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
        ) : settlements.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
            {loadError ? 'Could not load settlements' : 'No settlements yet. Click \u201cCreate cycle\u201d to start one.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Period', 'Franchise', 'Amount', 'Status', 'Actions'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 14px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => {
                const color = STATUS_COLORS[s.status] ?? STATUS_COLORS.PENDING;
                const busy = rowAction === s.id;
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 14px' }}>
                      {s.periodStart ? new Date(s.periodStart).toLocaleDateString() : '\u2014'}{' '}
                      &mdash;{' '}
                      {s.periodEnd ? new Date(s.periodEnd).toLocaleDateString() : '\u2014'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {s.franchise?.businessName || '\u2014'}
                      {s.franchise?.franchiseCode && (
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>{s.franchise.franchiseCode}</div>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600 }}>
                      {fmt(s.totalAmount ?? s.amount)}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: color.bg,
                          color: color.fg,
                        }}
                      >
                        {STATUS_LABELS[s.status] ?? s.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {s.status === 'PENDING' && (
                        <button
                          disabled={busy}
                          onClick={() => handleApprove(s.id)}
                          style={{
                            fontSize: 11,
                            padding: '4px 10px',
                            border: '1px solid #d1d5db',
                            borderRadius: 6,
                            background: '#fff',
                            cursor: busy ? 'default' : 'pointer',
                          }}
                        >
                          {busy ? '...' : 'Approve'}
                        </button>
                      )}
                      {s.status === 'APPROVED' && (
                        <button
                          disabled={busy}
                          onClick={() => handleMarkPaid(s.id)}
                          style={{
                            fontSize: 11,
                            padding: '4px 10px',
                            border: 'none',
                            borderRadius: 6,
                            background: busy ? '#93c5fd' : '#2563eb',
                            color: '#fff',
                            cursor: busy ? 'default' : 'pointer',
                          }}
                        >
                          {busy ? '...' : 'Mark Paid'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div
          onClick={() => !createSaving && setShowCreate(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17, 24, 39, 0.5)',
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
              borderRadius: 10,
              padding: 24,
              width: 420,
              maxWidth: '90vw',
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Create settlement cycle</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Creates one settlement per franchise whose PENDING ledger entries fall within the selected
              period. The cycle starts in PENDING and can then be Approved, then Marked Paid.
            </p>

            <form onSubmit={handleCreate} noValidate>
              <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4, color: '#374151' }}>
                    Period start
                  </label>
                  <input
                    type="date"
                    value={createForm.periodStart}
                    max={createForm.periodEnd || undefined}
                    onChange={(e) => setCreateForm((f) => ({ ...f, periodStart: e.target.value }))}
                    disabled={createSaving}
                    required
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4, color: '#374151' }}>
                    Period end
                  </label>
                  <input
                    type="date"
                    value={createForm.periodEnd}
                    min={createForm.periodStart || undefined}
                    onChange={(e) => setCreateForm((f) => ({ ...f, periodEnd: e.target.value }))}
                    disabled={createSaving}
                    required
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  />
                </div>
              </div>

              {createError && (
                <div
                  style={{
                    background: '#fee2e2',
                    color: '#991b1b',
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  {createError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  disabled={createSaving}
                  style={{
                    padding: '8px 14px',
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    borderRadius: 6,
                    fontSize: 13,
                    cursor: createSaving ? 'default' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSaving}
                  style={{
                    padding: '8px 14px',
                    background: createSaving ? '#93c5fd' : '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: createSaving ? 'default' : 'pointer',
                  }}
                >
                  {createSaving ? 'Creating...' : 'Create cycle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
