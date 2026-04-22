'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  franchiseStaffService,
  AddStaffPayload,
  FranchiseStaff,
  FranchiseStaffRole,
  UpdateStaffPayload,
} from '@/services/staff.service';
import { useModal } from '@sportsmart/ui';
import { ApiError } from '@/lib/api-client';

const ASSIGNABLE_ROLES: FranchiseStaffRole[] = [
  'MANAGER',
  'POS_OPERATOR',
  'WAREHOUSE_STAFF',
];

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case 'OWNER':
      return 'Owner';
    case 'MANAGER':
      return 'Manager';
    case 'POS_OPERATOR':
      return 'POS Operator';
    case 'WAREHOUSE_STAFF':
      return 'Warehouse Staff';
    default:
      return role;
  }
}

function roleBadgeStyle(role: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  };
  switch (role) {
    case 'OWNER':
      return { ...base, background: '#ede9fe', color: '#5b21b6' };
    case 'MANAGER':
      return { ...base, background: '#dbeafe', color: '#1e40af' };
    case 'POS_OPERATOR':
      return { ...base, background: '#d1fae5', color: '#065f46' };
    case 'WAREHOUSE_STAFF':
      return { ...base, background: '#fef3c7', color: '#92400e' };
    default:
      return { ...base, background: '#e5e7eb', color: '#374151' };
  }
}

export default function StaffPage() {
  const { notify, confirmDialog } = useModal();
  const [staff, setStaff] = useState<FranchiseStaff[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<FranchiseStaff | null>(null);
  const [deactivating, setDeactivating] = useState<FranchiseStaff | null>(
    null,
  );

  const load = async () => {setIsLoading(true);
    try {
      const res = await franchiseStaffService.listStaff();
      if (res.data) setStaff(res.data);
    } catch (err) {
      if (err instanceof ApiError) {
        void notify(err.body.message || 'Failed to load staff');
      } else {
        void notify('Failed to load staff');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const kpis = useMemo(() => {
    const active = staff.filter((s) => s.isActive);
    return {
      total: active.length,
      managers: active.filter((s) => s.role === 'MANAGER').length,
      posOperators: active.filter((s) => s.role === 'POS_OPERATOR').length,
      warehouse: active.filter((s) => s.role === 'WAREHOUSE_STAFF').length,
    };
  }, [staff]);

  const totalPages = Math.max(1, Math.ceil(staff.length / limit));
  const pageStaff = staff.slice((page - 1) * limit, page * limit);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Staff Members</h1>
          <p>Invite and manage your team's access to the franchise</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowAdd(true)}
        >
          Add Staff
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <KpiCard
          label="Active Staff"
          value={String(kpis.total)}
          color="#2563eb"
        />
        <KpiCard
          label="Managers"
          value={String(kpis.managers)}
          color="#1e40af"
        />
        <KpiCard
          label="POS Operators"
          value={String(kpis.posOperators)}
          color="#059669"
        />
        <KpiCard
          label="Warehouse Staff"
          value={String(kpis.warehouse)}
          color="#d97706"
        />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>Loading...</div>
        ) : staff.length === 0 ? (
          <div
            style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}
          >
            No staff members yet. Click "Add Staff" to get started.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Phone</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Joined</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageStaff.map((s) => (
                  <tr
                    key={s.id}
                    style={{ borderTop: '1px solid #f3f4f6' }}
                  >
                    <td style={tdStyle}>
                      <strong>{s.name}</strong>
                    </td>
                    <td style={tdStyle}>{s.email}</td>
                    <td style={tdStyle}>{s.phone || '—'}</td>
                    <td style={tdStyle}>
                      <span style={roleBadgeStyle(s.role as string)}>
                        {roleLabel(s.role as string)}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 10px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: s.isActive ? '#d1fae5' : '#e5e7eb',
                          color: s.isActive ? '#065f46' : '#6b7280',
                        }}
                      >
                        {s.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={tdStyle}>{formatDate(s.createdAt)}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => setEditing(s)}
                          style={actionBtnStyle}
                        >
                          Edit
                        </button>
                        {s.isActive ? (
                          <button
                            type="button"
                            onClick={() => setDeactivating(s)}
                            style={{
                              ...actionBtnStyle,
                              color: '#991b1b',
                            }}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await franchiseStaffService.updateStaff(s.id, {
                                  isActive: true,
                                });
                                load();
                              } catch (err) {
                                if (err instanceof ApiError)
                                  void notify(err.body.message || (err.body.errors && err.body.errors[0] && err.body.errors[0].message) || 'Request failed.');
                                else void notify('Failed to activate');
                              }
                            }}
                            style={{
                              ...actionBtnStyle,
                              color: '#065f46',
                            }}
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {staff.length > limit && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 12,
          }}
        >
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            Page {page} of {totalPages} · {staff.length} total
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {showAdd && (
        <AddStaffModal
          onClose={() => setShowAdd(false)}
          onDone={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}

      {editing && (
        <EditStaffModal
          staff={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {deactivating && (
        <ConfirmDeactivateModal
          staff={deactivating}
          onClose={() => setDeactivating(null)}
          onDone={() => {
            setDeactivating(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════════

function Modal({
  children,
  onClose,
  width = 480,
}: {
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          width: '100%',
          maxWidth: width,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function AddStaffModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify, confirmDialog } = useModal();
  const [form, setForm] = useState<AddStaffPayload>({
    name: '',
    email: '',
    phone: '',
    role: 'POS_OPERATOR',
    password: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
if (!form.name.trim()) return void notify('Name is required');
    if (!form.email.trim() || !form.email.includes('@'))
      return void notify('Valid email is required');
    if (!form.password || form.password.length < 8)
      return void notify('Password must be at least 8 characters');

    setIsSaving(true);
    try {
      await franchiseStaffService.addStaff({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone?.trim() || undefined,
        role: form.role,
        password: form.password,
      });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) void notify(err.body.message || (err.body.errors && err.body.errors[0] && err.body.errors[0].message) || 'Request failed.');
      else void notify('Failed to add staff');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: 0, fontSize: 18, marginBottom: 16 }}>
        Add Staff Member
      </h2>

      <div style={{ display: 'grid', gap: 12 }}>
        <FieldInput
          label="Name"
          value={form.name}
          onChange={(v) => setForm({ ...form, name: v })}
          required
          disabled={isSaving}
        />
        <FieldInput
          label="Email"
          type="email"
          value={form.email}
          onChange={(v) => setForm({ ...form, email: v })}
          required
          disabled={isSaving}
        />
        <FieldInput
          label="Phone (optional)"
          value={form.phone || ''}
          onChange={(v) => setForm({ ...form, phone: v })}
          disabled={isSaving}
        />
        <div>
          <div style={labelStyle}>Role</div>
          <select
            value={form.role}
            onChange={(e) =>
              setForm({
                ...form,
                role: e.target.value as FranchiseStaffRole,
              })
            }
            disabled={isSaving}
            style={{
              ...fieldInputStyle,
              marginTop: 6,
              background: '#fff',
            }}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </div>
        <FieldInput
          label="Password (min 8 chars)"
          type="password"
          value={form.password}
          onChange={(v) => setForm({ ...form, password: v })}
          required
          disabled={isSaving}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          marginTop: 20,
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Add Staff'}
        </button>
      </div>
    </Modal>
  );
}

function EditStaffModal({
  staff,
  onClose,
  onDone,
}: {
  staff: FranchiseStaff;
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify, confirmDialog } = useModal();
  const [form, setForm] = useState<UpdateStaffPayload>({
    name: staff.name,
    phone: staff.phone || '',
    role: staff.role,
    isActive: staff.isActive,
  });
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
if (!form.name?.trim()) return void notify('Name is required');

    setIsSaving(true);
    try {
      await franchiseStaffService.updateStaff(staff.id, {
        name: form.name.trim(),
        phone: form.phone?.trim() || undefined,
        role: form.role,
        isActive: form.isActive,
      });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) void notify(err.body.message || (err.body.errors && err.body.errors[0] && err.body.errors[0].message) || 'Request failed.');
      else void notify('Failed to update staff');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: 0, fontSize: 18, marginBottom: 16 }}>
        Edit Staff Member
      </h2>

      <div style={{ display: 'grid', gap: 12 }}>
        <FieldInput
          label="Name"
          value={form.name || ''}
          onChange={(v) => setForm({ ...form, name: v })}
          required
          disabled={isSaving}
        />
        <div>
          <div style={labelStyle}>Email</div>
          <div
            style={{
              ...fieldInputStyle,
              marginTop: 6,
              background: '#f3f4f6',
              color: '#6b7280',
            }}
          >
            {staff.email}
          </div>
        </div>
        <FieldInput
          label="Phone"
          value={form.phone || ''}
          onChange={(v) => setForm({ ...form, phone: v })}
          disabled={isSaving}
        />
        <div>
          <div style={labelStyle}>Role</div>
          <select
            value={form.role || staff.role}
            onChange={(e) =>
              setForm({
                ...form,
                role: e.target.value as FranchiseStaffRole,
              })
            }
            disabled={isSaving}
            style={{
              ...fieldInputStyle,
              marginTop: 6,
              background: '#fff',
            }}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            fontWeight: 600,
            color: '#374151',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={form.isActive ?? false}
            onChange={(e) =>
              setForm({ ...form, isActive: e.target.checked })
            }
            disabled={isSaving}
          />
          Active
        </label>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          marginTop: 20,
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </Modal>
  );
}

function ConfirmDeactivateModal({
  staff,
  onClose,
  onDone,
}: {
  staff: FranchiseStaff;
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify, confirmDialog } = useModal();
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    setIsSaving(true);
    try {
      await franchiseStaffService.updateStaff(staff.id, { isActive: false });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) void notify(err.body.message || (err.body.errors && err.body.errors[0] && err.body.errors[0].message) || 'Request failed.');
      else void notify('Failed to deactivate');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Deactivate Staff Member</h2>
      <p style={{ fontSize: 14, color: '#374151', marginTop: 12 }}>
        Are you sure you want to deactivate <strong>{staff.name}</strong>?
        They will no longer be able to access the franchise dashboard.
      </p>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          marginTop: 20,
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={isSaving}
          style={{ background: '#dc2626', borderColor: '#dc2626' }}
        >
          {isSaving ? 'Deactivating...' : 'Confirm Deactivate'}
        </button>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════
// SHARED COMPONENTS/STYLES
// ══════════════════════════════════════════════════════════════

function FieldInput({
  label,
  value,
  onChange,
  type = 'text',
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  const effectiveType = isPassword && revealed ? 'text' : type;
  return (
    <div>
      <div style={labelStyle}>
        {label}
        {required && <span style={{ color: '#dc2626' }}> *</span>}
      </div>
      <div style={{ position: 'relative', marginTop: 6 }}>
        <input
          type={effectiveType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={{
            ...fieldInputStyle,
            marginTop: 0,
            paddingRight: isPassword ? 64 : undefined,
          }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            disabled={disabled}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            tabIndex={-1}
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              color: '#2563eb',
              fontSize: 12,
              fontWeight: 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
              padding: '4px 8px',
            }}
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div style={labelStyle}>{label}</div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color,
          marginTop: 6,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  background: '#f9fafb',
  fontSize: 11,
  fontWeight: 700,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  borderBottom: '1px solid #e5e7eb',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: '#374151',
  verticalAlign: 'middle',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const fieldInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 14,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  outline: 'none',
  fontFamily: 'inherit',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  color: '#374151',
};
