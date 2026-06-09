'use client';

// Shared create/edit form for flash sales. Used by the `new` and `[id]` routes.
// Converts between the API's ISO timestamps and the <input type="datetime-local">
// local-time value, validates client-side (title + a valid window), and exposes
// a guarded delete in edit mode.

import { useState } from 'react';
import Link from 'next/link';
import { FlashSale, FlashSaleWriteInput } from '@/services/flash-sales.service';

function isoToLocalInput(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  } catch {
    return '';
  }
}
const localInputToIso = (v: string): string => new Date(v).toISOString();

export function FlashSaleForm({
  mode,
  initial,
  onSubmit,
  onDelete,
  submitting,
  error,
}: {
  mode: 'create' | 'edit';
  initial?: FlashSale | null;
  onSubmit: (input: FlashSaleWriteInput) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  submitting?: boolean;
  error?: string | null;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? '');
  const [startsAt, setStartsAt] = useState(isoToLocalInput(initial?.startsAt));
  const [endsAt, setEndsAt] = useState(isoToLocalInput(initial?.endsAt));
  const [membersOnly, setMembersOnly] = useState(initial?.membersOnly ?? false);
  const [collectionSlug, setCollectionSlug] = useState(initial?.collectionSlug ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalErr(null);
    if (!title.trim()) return setLocalErr('Title is required.');
    if (!startsAt) return setLocalErr('Start date/time is required.');
    if (!endsAt) return setLocalErr('End date/time is required.');
    if (new Date(endsAt) <= new Date(startsAt))
      return setLocalErr('End must be after start.');
    void onSubmit({
      title: title.trim(),
      subtitle: subtitle.trim() ? subtitle.trim() : null,
      startsAt: localInputToIso(startsAt),
      endsAt: localInputToIso(endsAt),
      membersOnly,
      collectionSlug: collectionSlug.trim() ? collectionSlug.trim() : null,
      isActive,
    });
  };

  return (
    <form onSubmit={handleSubmit} style={st.page}>
      <header style={st.header}>
        <Link href="/dashboard/marketing" style={st.back}>← Marketing</Link>
        <h1 style={st.h1}>{mode === 'create' ? 'New flash sale' : 'Edit flash sale'}</h1>
      </header>

      {(localErr || error) && <div style={st.err}>{localErr || error}</div>}

      <div style={st.card}>
        <Field label="Title" required>
          <input style={st.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Monsoon Mega Sale" maxLength={120} />
        </Field>
        <Field label="Subtitle">
          <textarea style={{ ...st.input, minHeight: 64, resize: 'vertical' }} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Optional tagline shown on the storefront" maxLength={300} />
        </Field>
        <div style={st.row2}>
          <Field label="Starts at" required>
            <input type="datetime-local" style={st.input} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label="Ends at" required>
            <input type="datetime-local" style={st.input} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </Field>
        </div>
        <Field label="Collection slug" hint="Links the sale to a storefront collection (optional).">
          <input style={st.input} value={collectionSlug} onChange={(e) => setCollectionSlug(e.target.value)} placeholder="e.g. monsoon-essentials" />
        </Field>
        <div style={st.checks}>
          <label style={st.check}>
            <input type="checkbox" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} />
            <span>Members only</span>
          </label>
          <label style={st.check}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span>Active (visible on storefront)</span>
          </label>
        </div>
      </div>

      <div style={st.actions}>
        <button type="submit" disabled={submitting} style={{ ...st.primary, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Saving…' : mode === 'create' ? 'Create flash sale' : 'Save changes'}
        </button>
        <Link href="/dashboard/marketing" style={st.cancel}>Cancel</Link>
        {mode === 'edit' && onDelete && (
          <div style={{ marginLeft: 'auto' }}>
            {confirmDelete ? (
              <span style={st.confirmWrap}>
                <span style={st.muted}>Delete this sale?</span>
                <button type="button" onClick={() => void onDelete()} disabled={submitting} style={st.danger}>Yes, delete</button>
                <button type="button" onClick={() => setConfirmDelete(false)} style={st.cancel}>No</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} style={st.dangerOutline}>Delete</button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label style={st.field}>
      <span style={st.label}>
        {label}
        {required && <span style={{ color: '#dc2626' }}> *</span>}
      </span>
      {children}
      {hint && <span style={st.hint}>{hint}</span>}
    </label>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { padding: '8px 0 40px', maxWidth: 720 },
  header: { marginBottom: 20 },
  back: { fontSize: 12, color: '#6b7280', textDecoration: 'none' },
  h1: { fontSize: 22, fontWeight: 700, margin: '6px 0 0', color: '#0f1115' },
  err: { padding: '10px 14px', borderRadius: 8, marginBottom: 16, background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', fontSize: 13 },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: 600, color: '#374151' },
  hint: { fontSize: 12, color: '#9ca3af' },
  input: { padding: '9px 11px', fontSize: 14, border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#0f1115', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  checks: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 },
  check: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151', cursor: 'pointer' },
  actions: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 },
  primary: { padding: '10px 18px', fontSize: 14, fontWeight: 600, color: '#fff', background: '#2563eb', border: 'none', borderRadius: 8, cursor: 'pointer' },
  cancel: { padding: '10px 14px', fontSize: 14, color: '#374151', textDecoration: 'none', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer' },
  dangerOutline: { padding: '10px 14px', fontSize: 14, fontWeight: 600, color: '#dc2626', background: '#fff', border: '1px solid #fca5a5', borderRadius: 8, cursor: 'pointer' },
  danger: { padding: '10px 14px', fontSize: 14, fontWeight: 600, color: '#fff', background: '#dc2626', border: 'none', borderRadius: 8, cursor: 'pointer' },
  confirmWrap: { display: 'flex', alignItems: 'center', gap: 8 },
  muted: { fontSize: 13, color: '#6b7280' },
};
