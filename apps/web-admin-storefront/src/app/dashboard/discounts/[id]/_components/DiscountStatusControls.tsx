// Phase 243 (#status / #pause) — discount lifecycle controls.
//
// Pause / Resume / Archive call the dedicated FSM endpoint
//   PUT /api/v1/admin/discounts/:id/status   body { status, reason? }
// (the generic update path forbids `status`). We render the action set off
// the current *stored* status and reuse the list page's STATUS color map so
// the badge here matches everywhere else.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useModal } from '@sportsmart/ui';
import { apiClient, ApiError } from '@/lib/api-client';
import { STATUS } from '../../status';

type SettableStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DRAFT';

export function DiscountStatusControls({ discountId }: { discountId: string }) {
  const router = useRouter();
  const { confirmDialog, notify } = useModal();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiClient<{ status: string }>(`/admin/discounts/${discountId}`)
      .then((r) => {
        if (r.data?.status) setStatus(r.data.status);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load status'));
  }, [discountId]);

  useEffect(() => {
    if (!discountId) return;
    load();
  }, [discountId, load]);

  const setLifecycle = async (next: SettableStatus, label: string, danger = false) => {
    const ok = await confirmDialog({
      title: `${label} discount?`,
      message:
        next === 'ARCHIVED'
          ? 'Archiving takes this discount out of circulation. Existing redemptions are unaffected.'
          : next === 'PAUSED'
            ? 'Pausing immediately stops this discount from applying at checkout. You can resume it later.'
            : `${label} makes this discount available at checkout (subject to its date window).`,
      confirmText: label,
      cancelText: 'Cancel',
      danger,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await apiClient<{ status: string }>(
        `/admin/discounts/${discountId}/status`,
        { method: 'PUT', body: JSON.stringify({ status: next }) },
      );
      if (res.data?.status) setStatus(res.data.status);
      await notify({ kind: 'success', message: `Discount ${label.toLowerCase()}d.` });
      // Re-read so the form (which loads its own copy) reflects the new status
      // and a fresh version for the next OCC-guarded edit.
      router.refresh();
      load();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message || `Status change failed (HTTP ${e.status}).`
          : e instanceof Error
            ? e.message
            : 'Status change failed.';
      await notify({ kind: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  if (!discountId) return null;

  const s = status ? STATUS[status] || STATUS.DRAFT : null;
  // PAUSED → "Resume"; DRAFT → "Activate" (so a Save-as-draft can be published
  // — otherwise a draft is a dead end). ACTIVE/SCHEDULED can be paused; anything
  // not already archived can be archived. The server still re-validates the
  // transition and the date window.
  const canPause = status === 'ACTIVE' || status === 'SCHEDULED';
  const canResume = status === 'PAUSED';
  const canActivate = status === 'DRAFT';
  const canArchive = status != null && status !== 'ARCHIVED';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '14px 18px',
        marginTop: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 'auto' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Status</span>
        {s && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: 20,
              background: s.bg,
              color: s.fg,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />
            {status}
          </span>
        )}
        {!status && !loadError && <span style={{ fontSize: 12, color: '#9ca3af' }}>Loading…</span>}
        {loadError && <span style={{ fontSize: 12, color: '#991b1b' }}>{loadError}</span>}
      </div>

      {canActivate && (
        <button onClick={() => setLifecycle('ACTIVE', 'Activate')} disabled={busy} style={btnPrimary(busy)}>
          Activate
        </button>
      )}
      {canResume && (
        <button onClick={() => setLifecycle('ACTIVE', 'Resume')} disabled={busy} style={btnPrimary(busy)}>
          Resume
        </button>
      )}
      {canPause && (
        <button onClick={() => setLifecycle('PAUSED', 'Pause')} disabled={busy} style={btnSecondary(busy)}>
          Pause
        </button>
      )}
      {canArchive && (
        <button onClick={() => setLifecycle('ARCHIVED', 'Archive', true)} disabled={busy} style={btnDanger(busy)}>
          Archive
        </button>
      )}
    </div>
  );
}

const btnBase = (busy: boolean): React.CSSProperties => ({
  padding: '9px 18px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 8,
  cursor: busy ? 'default' : 'pointer',
  opacity: busy ? 0.6 : 1,
});

const btnPrimary = (busy: boolean): React.CSSProperties => ({
  ...btnBase(busy),
  background: '#303030',
  color: '#fff',
  border: 'none',
});

const btnSecondary = (busy: boolean): React.CSSProperties => ({
  ...btnBase(busy),
  background: '#fff',
  color: '#303030',
  border: '1px solid #c9cccf',
});

const btnDanger = (busy: boolean): React.CSSProperties => ({
  ...btnBase(busy),
  background: '#fff',
  color: '#b42318',
  border: '1px solid #fda29b',
});
