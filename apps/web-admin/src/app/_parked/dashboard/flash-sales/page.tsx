'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminFlashSalesService,
  FlashSale,
  CreateFlashSaleInput,
} from '@/services/admin-flash-sales.service';
import { ApiError } from '@/lib/api-client';
import './flash-sales.css';

// HTML <input type="datetime-local"> wants the local-time string in
// `YYYY-MM-DDTHH:mm` form, with no zone suffix. The backend speaks ISO
// 8601 UTC. These two helpers translate between them so the picker
// matches what an operator typed regardless of how the DB stores it.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(localStr: string): string {
  if (!localStr) return '';
  return new Date(localStr).toISOString();
}

function formatRange(startsAt: string, endsAt: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  return `${fmt(startsAt)} → ${fmt(endsAt)}`;
}

// Status pill: derived from the start/end window + isActive flag, so
// the column reads at a glance whether the campaign is currently live
// vs. scheduled vs. ended.
function campaignStatus(
  startsAt: string,
  endsAt: string,
  isActive: boolean,
): { label: string; cls: string } {
  if (!isActive) return { label: 'Disabled', cls: 'inactive' };
  const now = Date.now();
  const s = new Date(startsAt).getTime();
  const e = new Date(endsAt).getTime();
  if (now < s) return { label: 'Upcoming', cls: 'upcoming' };
  if (now > e) return { label: 'Ended', cls: 'expired' };
  return { label: 'Live', cls: 'live' };
}

type DraftState = {
  title: string;
  subtitle: string;
  startsAt: string;
  endsAt: string;
  membersOnly: boolean;
  collectionSlug: string;
  waitlistCount: string;
  isActive: boolean;
};

const EMPTY_DRAFT: DraftState = {
  title: '',
  subtitle: '',
  startsAt: '',
  endsAt: '',
  membersOnly: false,
  collectionSlug: '',
  waitlistCount: '0',
  isActive: true,
};

function draftFromRow(row: FlashSale): DraftState {
  return {
    title: row.title,
    subtitle: row.subtitle ?? '',
    startsAt: toLocalInput(row.startsAt),
    endsAt: toLocalInput(row.endsAt),
    membersOnly: row.membersOnly,
    collectionSlug: row.collectionSlug ?? '',
    waitlistCount: String(row.waitlistCount ?? 0),
    isActive: row.isActive,
  };
}

export default function FlashSalesPage() {
  const [rows, setRows] = useState<FlashSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFlashSalesService.list({ limit: 100 });
      setRows(res.data?.items ?? []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[flash-sales] list failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const openNew = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
    setDrawerOpen(true);
  };

  const openEdit = (row: FlashSale) => {
    setEditingId(row.id);
    setDraft(draftFromRow(row));
    setError(null);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (submitting) return;
    setDrawerOpen(false);
  };

  const onSubmit = async () => {
    setError(null);
    if (!draft.title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!draft.startsAt || !draft.endsAt) {
      setError('Start and end dates are required.');
      return;
    }
    if (new Date(draft.endsAt) <= new Date(draft.startsAt)) {
      setError('End time must be after start time.');
      return;
    }

    const payload: CreateFlashSaleInput = {
      title: draft.title.trim(),
      subtitle: draft.subtitle.trim() || undefined,
      startsAt: fromLocalInput(draft.startsAt),
      endsAt: fromLocalInput(draft.endsAt),
      membersOnly: draft.membersOnly,
      collectionSlug: draft.collectionSlug.trim() || undefined,
      waitlistCount: Number(draft.waitlistCount) || 0,
      isActive: draft.isActive,
    };

    setSubmitting(true);
    try {
      if (editingId) {
        await adminFlashSalesService.update(editingId, payload);
      } else {
        await adminFlashSalesService.create(payload);
      }
      setDrawerOpen(false);
      await reload();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Save failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (row: FlashSale) => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete "${row.title}"? This can't be undone.`)) return;
    try {
      await adminFlashSalesService.remove(row.id);
      await reload();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(
        err instanceof Error ? err.message : 'Delete failed — try again.',
      );
    }
  };

  const drawerTitle = useMemo(
    () => (editingId ? 'Edit flash sale' : 'New flash sale'),
    [editingId],
  );

  return (
    <div className="fs-page">
      <div className="fs-header">
        <div>
          <h1>Flash sales</h1>
          <p className="sub">
            Time-boxed campaigns surfaced on the storefront home flash
            strip and members-only card.
          </p>
        </div>
        <button className="fs-new-btn" onClick={openNew}>
          + New flash sale
        </button>
      </div>

      <div className="fs-table-wrap">
        {loading ? (
          <div className="fs-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="fs-empty">
            No flash sales yet. Click <strong>+ New flash sale</strong>{' '}
            to schedule one.
          </div>
        ) : (
          <table className="fs-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Window</th>
                <th>Type</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const status = campaignStatus(
                  row.startsAt,
                  row.endsAt,
                  row.isActive,
                );
                return (
                  <tr key={row.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: '#111827' }}>
                        {row.title}
                      </div>
                      {row.subtitle ? (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#6b7280',
                            marginTop: 2,
                          }}>
                          {row.subtitle}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ color: '#374151', fontSize: 12 }}>
                      {formatRange(row.startsAt, row.endsAt)}
                    </td>
                    <td>
                      {row.membersOnly ? (
                        <span className="fs-badge member">Members</span>
                      ) : (
                        <span style={{ color: '#6b7280', fontSize: 12 }}>
                          Public
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`fs-badge ${status.cls}`}>
                        {status.label}
                      </span>
                    </td>
                    <td>
                      <div className="fs-row-actions">
                        <button
                          className="fs-icon-btn"
                          onClick={() => openEdit(row)}>
                          Edit
                        </button>
                        <button
                          className="fs-icon-btn danger"
                          onClick={() => onDelete(row)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {drawerOpen ? (
        <>
          <div className="fs-drawer-backdrop" onClick={closeDrawer} />
          <aside className="fs-drawer" role="dialog" aria-label={drawerTitle}>
            <div className="fs-drawer-header">
              <h2>{drawerTitle}</h2>
              <button
                className="fs-drawer-close"
                onClick={closeDrawer}
                aria-label="Close">
                ×
              </button>
            </div>

            <div className="fs-drawer-body">
              {error ? <div className="fs-error">{error}</div> : null}

              <div className="fs-field">
                <label>Title</label>
                <input
                  type="text"
                  value={draft.title}
                  onChange={e =>
                    setDraft(d => ({ ...d, title: e.target.value }))
                  }
                  placeholder="Today's deals"
                  maxLength={120}
                />
              </div>

              <div className="fs-field">
                <label>Subtitle (optional)</label>
                <textarea
                  value={draft.subtitle}
                  onChange={e =>
                    setDraft(d => ({ ...d, subtitle: e.target.value }))
                  }
                  placeholder="Up to 40% off cricket gear — ends midnight"
                  maxLength={200}
                />
              </div>

              <div className="fs-row-2">
                <div className="fs-field">
                  <label>Starts at</label>
                  <input
                    type="datetime-local"
                    value={draft.startsAt}
                    onChange={e =>
                      setDraft(d => ({ ...d, startsAt: e.target.value }))
                    }
                  />
                </div>
                <div className="fs-field">
                  <label>Ends at</label>
                  <input
                    type="datetime-local"
                    value={draft.endsAt}
                    onChange={e =>
                      setDraft(d => ({ ...d, endsAt: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="fs-field">
                <label>Collection slug (optional)</label>
                <input
                  type="text"
                  value={draft.collectionSlug}
                  onChange={e =>
                    setDraft(d => ({ ...d, collectionSlug: e.target.value }))
                  }
                  placeholder="e.g. cricket-essentials"
                />
                <div className="hint">
                  Where the "Shop the sale" tap takes customers — leave
                  blank to send them to the global Browse screen.
                </div>
              </div>

              <div className="fs-field">
                <label>Waitlist count (display only)</label>
                <input
                  type="number"
                  min={0}
                  value={draft.waitlistCount}
                  onChange={e =>
                    setDraft(d => ({ ...d, waitlistCount: e.target.value }))
                  }
                />
                <div className="hint">
                  Shows as "1,200+ waiting" on the members-only card. 0
                  hides the line.
                </div>
              </div>

              <label
                className={`fs-checkbox${draft.membersOnly ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={draft.membersOnly}
                  onChange={e =>
                    setDraft(d => ({ ...d, membersOnly: e.target.checked }))
                  }
                />
                Members only (shown on the gold "Exclusive drops" card
                instead of the flash strip)
              </label>

              <label className={`fs-checkbox${draft.isActive ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={e =>
                    setDraft(d => ({ ...d, isActive: e.target.checked }))
                  }
                />
                Active — uncheck to pull from the storefront without
                deleting the row
              </label>
            </div>

            <div className="fs-drawer-footer">
              <button className="fs-cancel" onClick={closeDrawer}>
                Cancel
              </button>
              <button
                className="fs-submit"
                onClick={onSubmit}
                disabled={submitting}>
                {submitting
                  ? 'Saving…'
                  : editingId
                    ? 'Save changes'
                    : 'Create flash sale'}
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
