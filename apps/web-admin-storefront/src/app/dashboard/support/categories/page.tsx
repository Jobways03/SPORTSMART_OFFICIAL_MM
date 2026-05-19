'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminSupportService,
  TicketCategory,
  TicketActorType,
} from '@/services/admin-support.service';
import { ApiError } from '@/lib/api-client';

const SCOPE_OPTIONS: Array<TicketActorType | ''> = [
  '',
  'CUSTOMER',
  'SELLER',
  'FRANCHISE',
  'AFFILIATE',
];

const SCOPE_LABEL = (s: TicketActorType | null) => (s ? s : 'Any');

export default function SupportCategoriesPage() {
  const [items, setItems] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchCategories = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminSupportService.listCategories();
      setItems(res.data ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleSave = async (
    id: string | null,
    payload: {
      name: string;
      description: string;
      scopedTo: TicketActorType | '';
      sortOrder: number;
    },
  ) => {
    setBusyId(id ?? 'new');
    setError(null);
    try {
      if (id) {
        await adminSupportService.updateCategory(id, {
          name: payload.name,
          description: payload.description || null,
          scopedTo: payload.scopedTo || null,
          sortOrder: payload.sortOrder,
        });
      } else {
        await adminSupportService.createCategory({
          name: payload.name,
          description: payload.description || undefined,
          scopedTo: payload.scopedTo || null,
          sortOrder: payload.sortOrder,
        });
      }
      setEditingId(null);
      setShowNew(false);
      await fetchCategories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!window.confirm('Deactivate this category? Existing tickets keep their reference.')) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await adminSupportService.deactivateCategory(id);
      await fetchCategories();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Deactivate failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100 }}>
      <Link
        href="/dashboard/support"
        style={{
          color: '#525A65',
          fontSize: 13,
          textDecoration: 'none',
          display: 'inline-block',
          marginBottom: 8,
        }}
      >
        ← Back to support
      </Link>

      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#0f172a' }}>
            Ticket categories
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>
            Categorise inbound tickets to drive routing and reporting. Scoping
            restricts a category to one actor type (e.g. seller-only).
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowNew(true);
            setEditingId(null);
          }}
          disabled={showNew}
          style={{
            height: 36,
            padding: '0 16px',
            border: 'none',
            background: '#0F1115',
            color: '#fff',
            borderRadius: 9999,
            fontWeight: 600,
            fontSize: 13,
            cursor: showNew ? 'not-allowed' : 'pointer',
            opacity: showNew ? 0.6 : 1,
          }}
        >
          + New category
        </button>
      </header>

      {error && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {showNew && (
        <CategoryForm
          key="new"
          initial={null}
          onCancel={() => setShowNew(false)}
          onSave={(payload) => handleSave(null, payload)}
          busy={busyId === 'new'}
        />
      )}

      {loading && (
        <div style={{ color: '#64748b', fontSize: 13, padding: 24 }}>Loading…</div>
      )}

      {!loading && items.length === 0 && !showNew && (
        <div
          style={{
            padding: 32,
            background: '#fff',
            border: '1px dashed #cbd5e1',
            borderRadius: 12,
            textAlign: 'center',
            color: '#64748b',
            fontSize: 14,
          }}
        >
          No categories yet — click <strong>New category</strong> to add one.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafa', textAlign: 'left' }}>
                <th style={th}>Name</th>
                <th style={th}>Scope</th>
                <th style={{ ...th, textAlign: 'right' }}>Sort</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) =>
                editingId === c.id ? (
                  <tr key={c.id}>
                    <td colSpan={5} style={{ padding: 0 }}>
                      <CategoryForm
                        initial={c}
                        onCancel={() => setEditingId(null)}
                        onSave={(payload) => handleSave(c.id, payload)}
                        busy={busyId === c.id}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>{c.name}</div>
                      {c.description && (
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                          {c.description}
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          padding: '2px 10px',
                          borderRadius: 9999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: c.scopedTo ? '#e0e7ff' : '#f1f5f9',
                          color: c.scopedTo ? '#3730a3' : '#475569',
                        }}
                      >
                        {SCOPE_LABEL(c.scopedTo)}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: '#64748b' }}>
                      {c.sortOrder}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          padding: '2px 10px',
                          borderRadius: 9999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: c.active ? '#dcfce7' : '#fee2e2',
                          color: c.active ? '#166534' : '#991b1b',
                        }}
                      >
                        {c.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(c.id);
                          setShowNew(false);
                        }}
                        disabled={busyId === c.id}
                        style={actionBtn}
                      >
                        Edit
                      </button>
                      {c.active && (
                        <button
                          type="button"
                          onClick={() => handleDeactivate(c.id)}
                          disabled={busyId === c.id}
                          style={{
                            ...actionBtn,
                            borderColor: '#fecaca',
                            color: '#991b1b',
                            marginLeft: 6,
                          }}
                        >
                          {busyId === c.id ? '…' : 'Deactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CategoryForm({
  initial,
  onCancel,
  onSave,
  busy,
}: {
  initial: TicketCategory | null;
  onCancel: () => void;
  onSave: (payload: {
    name: string;
    description: string;
    scopedTo: TicketActorType | '';
    sortOrder: number;
  }) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [scopedTo, setScopedTo] = useState<TicketActorType | ''>(
    initial?.scopedTo ?? '',
  );
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      scopedTo,
      sortOrder: Number(sortOrder) || 0,
    });
  };

  return (
    <form
      onSubmit={submit}
      style={{
        background: '#fafafa',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: 16,
        marginBottom: 14,
        display: 'grid',
        gridTemplateColumns: '2fr 1fr 80px auto',
        gap: 12,
        alignItems: 'end',
      }}
    >
      <div>
        <label style={lbl}>Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus={initial === null}
          style={inp}
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ ...inp, marginTop: 6 }}
        />
      </div>
      <div>
        <label style={lbl}>Scope</label>
        <select
          value={scopedTo}
          onChange={(e) => setScopedTo(e.target.value as TicketActorType | '')}
          style={inp}
        >
          {SCOPE_OPTIONS.map((s) => (
            <option key={s || 'any'} value={s}>
              {s || 'Any'}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label style={lbl}>Sort</label>
        <input
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          style={inp}
        />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            ...actionBtn,
            background: '#fff',
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          style={{
            height: 32,
            padding: '0 14px',
            border: 'none',
            background: '#0F1115',
            color: '#fff',
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy || !name.trim() ? 0.5 : 1,
          }}
        >
          {busy ? 'Saving…' : initial ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  );
}

const th: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const td: React.CSSProperties = {
  padding: '12px 14px',
  verticalAlign: 'top',
};

const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: '#525A65',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
};

const inp: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  fontSize: 13,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const actionBtn: React.CSSProperties = {
  height: 32,
  padding: '0 12px',
  border: '1px solid #D2D6DC',
  background: '#fff',
  color: '#0F1115',
  borderRadius: 9999,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
