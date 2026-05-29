'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useModal } from '@sportsmart/ui';

import { ApiError } from '@/lib/api-client';
import {
  franchiseAdminPincodesService,
  type FranchisePincodeMapping,
} from '@/services/admin-franchise-pincodes.service';

// 6 digits, first digit 1-9. Mirrors the backend regex exactly so we
// reject locally before spending a round-trip / a failed bulk batch.
const PINCODE_RE = /^[1-9][0-9]{5}$/;
const PRIORITY_MIN = 0;
const PRIORITY_MAX = 1000;
const PRIORITY_DEFAULT = 100;
const BULK_MAX = 5000;

// Pull a human-readable message out of whatever the api-client threw.
// apiClient throws ApiError (with .status + .body) on non-2xx; fall back
// to a plain Error message or a generic string.
const errMessage = (err: unknown, fallback: string): string => {
  if (err instanceof ApiError) return err.body?.message || err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
};

const isConflict = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 409;

export default function FranchisePincodesPage() {
  const { notify, confirmDialog } = useModal();
  const params = useParams();
  const router = useRouter();
  const franchiseId = String(params?.id ?? '');

  const [rows, setRows] = useState<FranchisePincodeMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Per-row busy flag (priority edit / toggle / remove) keyed by mapping id.
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Add-single form ──────────────────────────────────
  const [singlePincode, setSinglePincode] = useState('');
  const [singlePriority, setSinglePriority] = useState(String(PRIORITY_DEFAULT));
  const [singleReason, setSingleReason] = useState('');
  const [addingSingle, setAddingSingle] = useState(false);

  // ── Bulk-add form ────────────────────────────────────
  const [bulkText, setBulkText] = useState('');
  const [bulkPriority, setBulkPriority] = useState(String(PRIORITY_DEFAULT));
  const [bulkReason, setBulkReason] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [addingBulk, setAddingBulk] = useState(false);

  // Draft priority per row (string while editing). Hydrated from the
  // loaded rows; an entry is "dirty" when it differs from the row value.
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await franchiseAdminPincodesService.list(franchiseId);
      const data = res.data ?? [];
      setRows(data);
      const drafts: Record<string, string> = {};
      for (const r of data) drafts[r.id] = String(r.priority);
      setPriorityDrafts(drafts);
    } catch (err) {
      setLoadError(errMessage(err, 'Failed to load pincode mappings'));
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    if (franchiseId) load();
  }, [franchiseId, load]);

  // Validate + clamp a priority string. Returns the number, or null when
  // empty (meaning "leave unchanged" on update). Throws-by-message via the
  // `onInvalid` callback when out of range / non-numeric.
  const parsePriority = (raw: string, onInvalid: (m: string) => void): number | null | false => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < PRIORITY_MIN || n > PRIORITY_MAX) {
      onInvalid(`Priority must be a whole number between ${PRIORITY_MIN} and ${PRIORITY_MAX}.`);
      return false;
    }
    return n;
  };

  // ── Add single ───────────────────────────────────────
  const handleAddSingle = async () => {
    const pincode = singlePincode.trim();
    if (!PINCODE_RE.test(pincode)) {
      void notify({ message: 'Enter a valid 6-digit pincode (first digit 1-9).', kind: 'error' });
      return;
    }
    let invalid = false;
    const priority = parsePriority(singlePriority, (m) => {
      invalid = true;
      void notify({ message: m, kind: 'error' });
    });
    if (invalid || priority === false) return;

    setAddingSingle(true);
    try {
      await franchiseAdminPincodesService.upsert(franchiseId, {
        pincode,
        priority: priority ?? PRIORITY_DEFAULT,
        reason: singleReason.trim() || undefined,
      });
      void notify({ message: `Pincode ${pincode} saved.`, kind: 'success' });
      setSinglePincode('');
      setSingleReason('');
      setSinglePriority(String(PRIORITY_DEFAULT));
      await load();
    } catch (err) {
      void notify({ message: errMessage(err, 'Failed to save pincode'), kind: 'error' });
    } finally {
      setAddingSingle(false);
    }
  };

  // Parse the bulk textarea: split on comma/space/newline, trim, drop
  // blanks, dedupe (preserving first-seen order). Returns the unique list
  // plus any tokens that fail the pincode format.
  const parsedBulk = useMemo(() => {
    const tokens = bulkText
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        unique.push(t);
      }
    }
    const invalid = unique.filter((p) => !PINCODE_RE.test(p));
    return { unique, invalid, rawCount: tokens.length };
  }, [bulkText]);

  const handleAddBulk = async () => {
    setBulkError('');
    const { unique, invalid } = parsedBulk;
    if (unique.length === 0) {
      setBulkError('Enter at least one pincode.');
      return;
    }
    if (invalid.length > 0) {
      const sample = invalid.slice(0, 10).join(', ');
      setBulkError(
        `${invalid.length} invalid pincode(s) — fix or remove before submitting: ${sample}${invalid.length > 10 ? ', …' : ''}`,
      );
      return;
    }
    if (unique.length > BULK_MAX) {
      setBulkError(`Too many pincodes: ${unique.length}. The maximum per bulk request is ${BULK_MAX}.`);
      return;
    }
    let invalidPriority = false;
    const priority = parsePriority(bulkPriority, (m) => {
      invalidPriority = true;
      setBulkError(m);
    });
    if (invalidPriority || priority === false) return;

    setAddingBulk(true);
    try {
      const res = await franchiseAdminPincodesService.bulkAssign(franchiseId, {
        pincodes: unique,
        priority: priority ?? PRIORITY_DEFAULT,
        reason: bulkReason.trim() || undefined,
      });
      const assigned = res.data?.assigned ?? 0;
      void notify({ message: `Assigned ${assigned} pincode(s) successfully.`, kind: 'success' });
      setBulkText('');
      setBulkReason('');
      setBulkPriority(String(PRIORITY_DEFAULT));
      await load();
    } catch (err) {
      // All-or-nothing: a 400 means some pincodes were invalid and NOTHING
      // was saved. Surface the backend's example list inline.
      setBulkError(errMessage(err, 'Bulk assign failed — nothing was saved.'));
    } finally {
      setAddingBulk(false);
    }
  };

  // ── Per-row: change priority (PUT with expectedVersion) ──
  const handleSavePriority = async (row: FranchisePincodeMapping) => {
    let invalid = false;
    const priority = parsePriority(priorityDrafts[row.id] ?? '', (m) => {
      invalid = true;
      void notify({ message: m, kind: 'error' });
    });
    if (invalid || priority === false || priority === null) {
      if (priority === null) {
        void notify({ message: 'Priority cannot be empty.', kind: 'error' });
      }
      return;
    }
    setBusyId(row.id);
    try {
      await franchiseAdminPincodesService.upsert(franchiseId, {
        pincode: row.pincode,
        priority,
        expectedVersion: row.version,
      });
      void notify({ message: `Priority for ${row.pincode} updated.`, kind: 'success' });
      await load();
    } catch (err) {
      await handleMutationError(err, 'Failed to update priority');
    } finally {
      setBusyId(null);
    }
  };

  // ── Per-row: activate / deactivate (PUT with expectedVersion) ──
  const handleToggleActive = async (row: FranchisePincodeMapping) => {
    setBusyId(row.id);
    try {
      await franchiseAdminPincodesService.upsert(franchiseId, {
        pincode: row.pincode,
        isActive: !row.isActive,
        expectedVersion: row.version,
      });
      void notify({
        message: `Pincode ${row.pincode} ${row.isActive ? 'deactivated' : 'activated'}.`,
        kind: 'success',
      });
      await load();
    } catch (err) {
      await handleMutationError(err, 'Failed to update status');
    } finally {
      setBusyId(null);
    }
  };

  // ── Per-row: remove (DELETE → soft-remove) ──
  const handleRemove = async (row: FranchisePincodeMapping) => {
    const ok = await confirmDialog({
      message: `Remove coverage for pincode ${row.pincode}? This deactivates the mapping.`,
      danger: true,
      confirmText: 'Remove',
    });
    if (!ok) return;
    setBusyId(row.id);
    try {
      await franchiseAdminPincodesService.remove(franchiseId, row.id);
      void notify({ message: `Pincode ${row.pincode} removed.`, kind: 'success' });
      await load();
    } catch (err) {
      await handleMutationError(err, 'Failed to remove pincode');
    } finally {
      setBusyId(null);
    }
  };

  // Shared mutation-error handler. A 409 means the row changed since load
  // (optimistic-concurrency miss) — tell the admin and refetch so they see
  // the current state before retrying.
  const handleMutationError = async (err: unknown, fallback: string) => {
    if (isConflict(err)) {
      await notify({
        message: 'This pincode changed since you loaded the page — reloading the latest state.',
        kind: 'warning',
      });
      await load();
      return;
    }
    void notify({ message: errMessage(err, fallback), kind: 'error' });
  };

  const setDraft = (id: string, value: string) =>
    setPriorityDrafts((prev) => ({ ...prev, [id]: value }));

  const summary = useMemo(() => {
    const active = rows.filter((r) => r.isActive).length;
    const conflicting = rows.filter((r) => r.isActive && r.conflictsWith.length > 0).length;
    return { total: rows.length, active, conflicting };
  }, [rows]);

  return (
    <div style={{ padding: '24px 28px', background: '#f8fafc', minHeight: 'calc(100vh - 56px)' }}>
      <button
        onClick={() => router.push(`/dashboard/franchises/${franchiseId}`)}
        style={{
          marginBottom: 12,
          background: 'transparent',
          border: 'none',
          color: '#2563eb',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        ← Back to franchise
      </button>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Pincode Coverage</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginTop: 4, marginBottom: 24, maxWidth: 720 }}>
        Map the pincodes this franchise serves. When more than one franchise
        covers the same pincode, the higher <strong>priority</strong> wins; a{' '}
        <strong>conflict</strong> badge flags overlaps so you can resolve them.
      </p>

      {/* ── Add forms ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {/* Add single */}
        <Card title="Add a pincode">
          <Field label="Pincode">
            <input
              value={singlePincode}
              onChange={(e) => setSinglePincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="560001"
              inputMode="numeric"
              disabled={addingSingle}
              style={inputStyle}
            />
          </Field>
          <Field label={`Priority (${PRIORITY_MIN}-${PRIORITY_MAX})`}>
            <input
              type="number"
              min={PRIORITY_MIN}
              max={PRIORITY_MAX}
              value={singlePriority}
              onChange={(e) => setSinglePriority(e.target.value)}
              disabled={addingSingle}
              style={inputStyle}
            />
          </Field>
          <Field label="Reason (optional)">
            <input
              value={singleReason}
              onChange={(e) => setSingleReason(e.target.value)}
              placeholder="e.g. new service area"
              disabled={addingSingle}
              style={inputStyle}
            />
          </Field>
          <button
            onClick={handleAddSingle}
            disabled={addingSingle || !singlePincode.trim()}
            style={primaryBtn(addingSingle || !singlePincode.trim())}
          >
            {addingSingle ? 'Saving…' : 'Add pincode'}
          </button>
        </Card>

        {/* Bulk add */}
        <Card title="Bulk add">
          <Field label="Pincodes (comma / space / newline separated)">
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder="560001, 560002&#10;560003 560004"
              disabled={addingBulk}
              style={{ ...inputStyle, minHeight: 92, fontFamily: 'monospace', resize: 'vertical' }}
            />
          </Field>
          {parsedBulk.unique.length > 0 && (
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: -6, marginBottom: 8 }}>
              {parsedBulk.unique.length} unique pincode(s)
              {parsedBulk.rawCount !== parsedBulk.unique.length &&
                ` (${parsedBulk.rawCount - parsedBulk.unique.length} duplicate(s) removed)`}
              {parsedBulk.invalid.length > 0 && (
                <span style={{ color: '#b91c1c' }}> · {parsedBulk.invalid.length} invalid</span>
              )}
            </div>
          )}
          <Field label={`Priority (${PRIORITY_MIN}-${PRIORITY_MAX})`}>
            <input
              type="number"
              min={PRIORITY_MIN}
              max={PRIORITY_MAX}
              value={bulkPriority}
              onChange={(e) => setBulkPriority(e.target.value)}
              disabled={addingBulk}
              style={inputStyle}
            />
          </Field>
          <Field label="Reason (optional)">
            <input
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder="e.g. zone expansion"
              disabled={addingBulk}
              style={inputStyle}
            />
          </Field>
          {bulkError && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 12,
                marginBottom: 10,
                whiteSpace: 'pre-wrap',
              }}
            >
              {bulkError}
            </div>
          )}
          <button
            onClick={handleAddBulk}
            disabled={addingBulk || parsedBulk.unique.length === 0}
            style={primaryBtn(addingBulk || parsedBulk.unique.length === 0)}
          >
            {addingBulk ? 'Assigning…' : `Assign ${parsedBulk.unique.length || ''} pincode(s)`.trim()}
          </button>
          <p style={{ fontSize: 11, color: '#6b7280', marginTop: 8, marginBottom: 0 }}>
            All-or-nothing: if any pincode is invalid, nothing is saved.
          </p>
        </Card>
      </div>

      {/* ── List ── */}
      {!loading && !loadError && rows.length > 0 && (
        <div style={{ display: 'flex', gap: 20, fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
          <span>
            <strong>{summary.active}</strong> active of <strong>{summary.total}</strong>
          </span>
          {summary.conflicting > 0 && (
            <span style={{ color: '#b45309' }}>
              <strong>{summary.conflicting}</strong> with conflicts
            </span>
          )}
        </div>
      )}

      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>
        ) : loadError ? (
          <div style={{ padding: 24, color: '#b91c1c', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
            <span>{loadError}</span>
            <button onClick={load} style={primaryBtn(false)}>
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
            No pincodes mapped to this franchise yet. Add one above or paste a list
            into bulk add to get started.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Pincode', 'Priority', 'Status', 'Conflicts', 'Actions'].map((h) => (
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
              {rows.map((row) => {
                const busy = busyId === row.id;
                const draft = priorityDrafts[row.id] ?? String(row.priority);
                const dirty = draft.trim() !== String(row.priority);
                const conflicts = row.conflictsWith ?? [];
                return (
                  <tr
                    key={row.id}
                    style={{
                      borderBottom: '1px solid #f3f4f6',
                      // Inactive rows render visually muted.
                      background: row.isActive ? '#fff' : '#f9fafb',
                      opacity: row.isActive ? 1 : 0.7,
                    }}
                  >
                    <td
                      style={{
                        padding: '10px 14px',
                        fontFamily: 'monospace',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#111827',
                        textDecoration: row.isActive ? 'none' : 'line-through',
                      }}
                    >
                      {row.pincode}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="number"
                          min={PRIORITY_MIN}
                          max={PRIORITY_MAX}
                          value={draft}
                          onChange={(e) => setDraft(row.id, e.target.value)}
                          disabled={busy || !row.isActive}
                          style={{ ...inputStyle, width: 80, marginBottom: 0 }}
                        />
                        {row.isActive && (
                          <button
                            onClick={() => handleSavePriority(row)}
                            disabled={!dirty || busy}
                            style={{
                              padding: '6px 10px',
                              border: 'none',
                              borderRadius: 6,
                              background: !dirty || busy ? '#93c5fd' : '#2563eb',
                              color: '#fff',
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: !dirty || busy ? 'default' : 'pointer',
                            }}
                          >
                            {busy ? '…' : 'Save'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 10px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          background: row.isActive ? '#dcfce7' : '#f3f4f6',
                          color: row.isActive ? '#166534' : '#6b7280',
                        }}
                      >
                        {row.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {conflicts.length > 0 ? (
                        <span
                          title={conflicts
                            .map((c) => `Franchise ${c.franchiseId} (priority ${c.priority})`)
                            .join('\n')}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 10px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 600,
                            background: '#fef3c7',
                            color: '#92400e',
                            cursor: 'help',
                          }}
                        >
                          <span aria-hidden="true">⚠</span>
                          also served by {conflicts.length} other franchise(s)
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          onClick={() => handleToggleActive(row)}
                          disabled={busy}
                          style={{
                            padding: '6px 10px',
                            border: '1px solid #d1d5db',
                            background: '#fff',
                            color: row.isActive ? '#92400e' : '#166534',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: busy ? 'default' : 'pointer',
                          }}
                        >
                          {row.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        {row.isActive && (
                          <button
                            onClick={() => handleRemove(row)}
                            disabled={busy}
                            style={{
                              padding: '6px 10px',
                              border: '1px solid #d1d5db',
                              background: '#fff',
                              color: '#991b1b',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: busy ? 'default' : 'pointer',
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Small presentational helpers (match delivery-methods Card/Toggle style) ──

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  marginBottom: 12,
  boxSizing: 'border-box',
};

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  border: 'none',
  borderRadius: 8,
  background: disabled ? '#93c5fd' : '#2563eb',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? 'default' : 'pointer',
});

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 20,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, marginBottom: 14 }}>{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: '#374151',
          display: 'block',
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
