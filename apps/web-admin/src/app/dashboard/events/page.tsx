'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminEventsService,
  SportEvent,
  CreateSportEventInput,
} from '@/services/admin-events.service';
import { ApiError } from '@/lib/api-client';
// Reuses the flash-sales stylesheet — same table / drawer grammar,
// different content. Class names are generic enough (.fs-page,
// .fs-table) that this works without extra ceremony.
import '../flash-sales/flash-sales.css';

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function fromLocalInput(localStr: string): string {
  if (!localStr) return '';
  return new Date(localStr).toISOString();
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function eventStatus(
  startsAt: string,
  isActive: boolean,
): { label: string; cls: string } {
  if (!isActive) return { label: 'Hidden', cls: 'inactive' };
  if (new Date(startsAt).getTime() < Date.now()) {
    return { label: 'Past', cls: 'expired' };
  }
  return { label: 'Upcoming', cls: 'upcoming' };
}

type DraftState = {
  title: string;
  category: string;
  startsAt: string;
  endsAt: string;
  city: string;
  description: string;
  url: string;
  isMemberFree: boolean;
  isActive: boolean;
};

const EMPTY_DRAFT: DraftState = {
  title: '',
  category: '',
  startsAt: '',
  endsAt: '',
  city: '',
  description: '',
  url: '',
  isMemberFree: false,
  isActive: true,
};

function draftFromRow(row: SportEvent): DraftState {
  return {
    title: row.title,
    category: row.category,
    startsAt: toLocalInput(row.startsAt),
    endsAt: toLocalInput(row.endsAt),
    city: row.city ?? '',
    description: row.description ?? '',
    url: row.url ?? '',
    isMemberFree: row.isMemberFree,
    isActive: row.isActive,
  };
}

export default function EventsPage() {
  const [rows, setRows] = useState<SportEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEventsService.list({ limit: 100 });
      setRows(res.data?.items ?? []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[events] list failed', err);
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

  const openEdit = (row: SportEvent) => {
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
    if (!draft.category.trim()) {
      setError('Category is required (e.g. RUNNING, PADEL).');
      return;
    }
    if (!draft.startsAt) {
      setError('Start time is required.');
      return;
    }
    if (
      draft.endsAt &&
      new Date(draft.endsAt) <= new Date(draft.startsAt)
    ) {
      setError('End time must be after start time.');
      return;
    }

    const payload: CreateSportEventInput = {
      title: draft.title.trim(),
      category: draft.category.trim().toUpperCase(),
      startsAt: fromLocalInput(draft.startsAt),
      endsAt: draft.endsAt ? fromLocalInput(draft.endsAt) : undefined,
      city: draft.city.trim() || undefined,
      description: draft.description.trim() || undefined,
      url: draft.url.trim() || undefined,
      isMemberFree: draft.isMemberFree,
      isActive: draft.isActive,
    };

    setSubmitting(true);
    try {
      if (editingId) {
        await adminEventsService.update(editingId, payload);
      } else {
        await adminEventsService.create(payload);
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

  const onDelete = async (row: SportEvent) => {
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete "${row.title}"? This can't be undone.`)) return;
    try {
      await adminEventsService.remove(row.id);
      await reload();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(
        err instanceof Error ? err.message : 'Delete failed — try again.',
      );
    }
  };

  const drawerTitle = useMemo(
    () => (editingId ? 'Edit event' : 'New event'),
    [editingId],
  );

  return (
    <div className="fs-page">
      <div className="fs-header">
        <div>
          <h1>Events</h1>
          <p className="sub">
            Marathons, tournaments and meetups surfaced on the
            storefront home "Events near you" rail.
          </p>
        </div>
        <button className="fs-new-btn" onClick={openNew}>
          + New event
        </button>
      </div>

      <div className="fs-table-wrap">
        {loading ? (
          <div className="fs-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="fs-empty">
            No events yet. Click <strong>+ New event</strong> to add
            one to the calendar.
          </div>
        ) : (
          <table className="fs-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>When</th>
                <th>City</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const status = eventStatus(row.startsAt, row.isActive);
                return (
                  <tr key={row.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: '#111827' }}>
                        {row.title}
                      </div>
                      {row.isMemberFree ? (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#a8855a',
                            marginTop: 2,
                            fontWeight: 600,
                          }}>
                          Free entry for members
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: 0.5,
                          color: '#5b21b6',
                        }}>
                        {row.category}
                      </span>
                    </td>
                    <td style={{ color: '#374151', fontSize: 12 }}>
                      {formatDateOnly(row.startsAt)}
                    </td>
                    <td style={{ color: '#374151', fontSize: 12 }}>
                      {row.city ?? '—'}
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
                  placeholder="Mumbai Half Marathon"
                  maxLength={120}
                />
              </div>

              <div className="fs-row-2">
                <div className="fs-field">
                  <label>Category</label>
                  <input
                    type="text"
                    value={draft.category}
                    onChange={e =>
                      setDraft(d => ({ ...d, category: e.target.value }))
                    }
                    placeholder="RUNNING"
                    maxLength={40}
                  />
                  <div className="hint">
                    Renders as the eyebrow tag. Uppercased on save.
                  </div>
                </div>
                <div className="fs-field">
                  <label>City</label>
                  <input
                    type="text"
                    value={draft.city}
                    onChange={e =>
                      setDraft(d => ({ ...d, city: e.target.value }))
                    }
                    placeholder="Mumbai"
                  />
                </div>
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
                  <label>Ends at (optional)</label>
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
                <label>Description (optional)</label>
                <textarea
                  value={draft.description}
                  onChange={e =>
                    setDraft(d => ({ ...d, description: e.target.value }))
                  }
                  placeholder="5K · 10K · 21K · Free water stations"
                  maxLength={300}
                />
              </div>

              <div className="fs-field">
                <label>External URL (optional)</label>
                <input
                  type="text"
                  value={draft.url}
                  onChange={e =>
                    setDraft(d => ({ ...d, url: e.target.value }))
                  }
                  placeholder="https://example.com/register"
                />
              </div>

              <label
                className={`fs-checkbox${draft.isMemberFree ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={draft.isMemberFree}
                  onChange={e =>
                    setDraft(d => ({ ...d, isMemberFree: e.target.checked }))
                  }
                />
                Free entry for Sportsmart+ members
              </label>

              <label className={`fs-checkbox${draft.isActive ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={e =>
                    setDraft(d => ({ ...d, isActive: e.target.checked }))
                  }
                />
                Active — uncheck to hide from the storefront without
                deleting
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
                    : 'Create event'}
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
