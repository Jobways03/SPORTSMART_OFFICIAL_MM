'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, usePermissions } from '@/lib/permissions';
import {
  adminUsersService,
  AdminUser,
  AdminPrimaryRole,
  AdminAccountStatus,
  ADMIN_PRIMARY_ROLES,
  CreateAdminUserPayload,
} from '@/services/admin-users.service';
import { adminRolesService, RoleSummary } from '@/services/admin-roles.service';

export default function AdminUsersPage() {
  return (
    <RequirePermission superAdminOnly fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <UsersInner />
    </RequirePermission>
  );
}

function UsersInner() {
  const { me } = usePermissions();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resettingPwd, setResettingPwd] = useState<AdminUser | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [usersRes, rolesRes] = await Promise.all([
        adminUsersService.list({ search: search.trim() || undefined, limit: 100 }),
        adminRolesService.listRoles(),
      ]);
      if (usersRes.data) setUsers(usersRes.data.items);
      if (rolesRes.data) setRoles(rolesRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admins');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleStatus = async (u: AdminUser) => {
    const next: AdminAccountStatus = u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    if (!confirm(`${next === 'ACTIVE' ? 'Reactivate' : 'Suspend'} ${u.name}?`)) return;
    try {
      await adminUsersService.update(u.id, { status: next });
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const remove = async (u: AdminUser) => {
    if (!confirm(`Deactivate ${u.name}? They will no longer be able to log in.`)) return;
    try {
      await adminUsersService.remove(u.id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deactivate');
    }
  };

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Admin users</h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            Manage who can sign in to the admin panel and what they can access.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={btnPrimary}>
          + New admin
        </button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <input
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, maxWidth: 320 }}
        />
      </div>

      {error && (
        <div style={errorBox}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: '#64748b' }}>Loading admins…</div>
      ) : (
        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr style={trHead}>
                <th style={th}>Name</th>
                <th style={th}>Email</th>
                <th style={th}>Primary role</th>
                <th style={th}>Custom roles</th>
                <th style={th}>Status</th>
                <th style={th}>Last login</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={tr}>
                  <td style={{ ...td, fontWeight: 600 }}>{u.name}</td>
                  <td style={td}>{u.email}</td>
                  <td style={td}>
                    {ADMIN_PRIMARY_ROLES.find((r) => r.value === u.role)?.label ?? u.role}
                  </td>
                  <td style={td}>
                    {u.customRoles.length === 0 ? (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {u.customRoles.map((r) => (
                          <span key={r.id} style={chip}>{r.name}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    <StatusBadge status={u.status} />
                  </td>
                  <td style={{ ...td, color: '#64748b', fontSize: 12 }}>
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-IN') : 'Never'}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => setEditing(u)} style={btnGhost}>Edit</button>
                    <button onClick={() => setResettingPwd(u)} style={btnGhost}>Reset password</button>
                    <button onClick={() => toggleStatus(u)} style={btnGhost} disabled={u.id === me?.adminId}>
                      {u.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                    </button>
                    <button onClick={() => remove(u)} style={btnDanger} disabled={u.id === me?.adminId}>
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 30 }}>
                    No admin users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateAdminModal
          roles={roles}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      )}
      {editing && (
        <EditAdminModal
          user={editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {resettingPwd && (
        <ResetPasswordModal
          user={resettingPwd}
          onClose={() => setResettingPwd(null)}
          onSaved={() => setResettingPwd(null)}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AdminAccountStatus }) {
  const map: Record<AdminAccountStatus, { bg: string; fg: string }> = {
    ACTIVE: { bg: '#dcfce7', fg: '#166534' },
    SUSPENDED: { bg: '#fef3c7', fg: '#92400e' },
    INACTIVE: { bg: '#f1f5f9', fg: '#475569' },
  };
  const { bg, fg } = map[status];
  return <span style={{ ...chip, background: bg, color: fg }}>{status}</span>;
}

function CreateAdminModal({
  roles,
  onClose,
  onSaved,
}: {
  roles: RoleSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [primaryRole, setPrimaryRole] = useState<AdminPrimaryRole>('SELLER_OPERATIONS');
  const [customRoleIds, setCustomRoleIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!name.trim()) return setErr('Name is required');
    if (!email.trim()) return setErr('Email is required');
    if (password.length < 8) return setErr('Password must be at least 8 characters');
    setSubmitting(true);
    try {
      const payload: CreateAdminUserPayload = {
        name: name.trim(),
        email: email.trim(),
        password,
        role: primaryRole,
        customRoleIds: customRoleIds.size > 0 ? Array.from(customRoleIds) : undefined,
      };
      await adminUsersService.create(payload);
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create admin');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalBody} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Create admin user</h2>
          <button onClick={onClose} style={btnClose}>×</button>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Email">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
                placeholder="user@sportsmart.com"
                type="email"
                autoComplete="off"
              />
            </Field>
            <Field label="Initial password">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
                type="text"
                autoComplete="new-password"
                placeholder="Min 8 characters"
              />
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                Share this with the user; they can change it via "Forgot password" later.
              </div>
            </Field>
            <Field label="Primary role">
              <select
                value={primaryRole}
                onChange={(e) => setPrimaryRole(e.target.value as AdminPrimaryRole)}
                style={inputStyle}
              >
                {ADMIN_PRIMARY_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Additional custom roles (optional)">
              <CustomRolesPicker
                roles={roles}
                selected={customRoleIds}
                onChange={setCustomRoleIds}
              />
            </Field>
          </div>
          {err && <div style={errorBox}>{err}</div>}
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={submitting} style={btnPrimary}>
            {submitting ? 'Creating…' : 'Create admin'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditAdminModal({
  user,
  roles,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  roles: RoleSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { me } = usePermissions();
  const [name, setName] = useState(user.name);
  const [primaryRole, setPrimaryRole] = useState<AdminPrimaryRole>(user.role);
  const [status, setStatus] = useState<AdminAccountStatus>(user.status);
  const [customRoleIds, setCustomRoleIds] = useState<Set<string>>(
    new Set(user.customRoles.map((r) => r.id)),
  );
  const initialIds = new Set(user.customRoles.map((r) => r.id));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const isSelf = me?.adminId === user.id;

  const submit = async () => {
    setErr('');
    setSubmitting(true);
    try {
      // Update profile fields.
      await adminUsersService.update(user.id, {
        name: name.trim() || undefined,
        role: isSelf ? undefined : primaryRole,
        status: isSelf ? undefined : status,
      });
      // Diff custom roles → assign added, revoke removed.
      const toAdd = Array.from(customRoleIds).filter((id) => !initialIds.has(id));
      const toRemove = Array.from(initialIds).filter((id) => !customRoleIds.has(id));
      for (const roleId of toAdd) await adminUsersService.assignRole(user.id, roleId);
      for (const roleId of toRemove) await adminUsersService.revokeRole(user.id, roleId);
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalBody} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Edit admin user</h2>
          <button onClick={onClose} style={btnClose}>×</button>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Email">
              <input value={user.email} disabled style={{ ...inputStyle, background: '#f8fafc' }} />
            </Field>
            <Field label="Primary role">
              <select
                value={primaryRole}
                onChange={(e) => setPrimaryRole(e.target.value as AdminPrimaryRole)}
                style={inputStyle}
                disabled={isSelf}
              >
                {ADMIN_PRIMARY_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              {isSelf && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                  You can&apos;t change your own role.
                </div>
              )}
            </Field>
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AdminAccountStatus)}
                style={inputStyle}
                disabled={isSelf}
              >
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="INACTIVE">Inactive</option>
              </select>
              {isSelf && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                  You can&apos;t change your own status.
                </div>
              )}
            </Field>
            <Field label="Custom roles">
              <CustomRolesPicker
                roles={roles}
                selected={customRoleIds}
                onChange={setCustomRoleIds}
              />
            </Field>
          </div>
          {err && <div style={errorBox}>{err}</div>}
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={submitting} style={btnPrimary}>
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pwd, setPwd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (pwd.length < 8) return setErr('Password must be at least 8 characters');
    setSubmitting(true);
    try {
      await adminUsersService.resetPassword(user.id, pwd);
      alert('Password updated. Share the new password with the user.');
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalBody} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Reset password</h2>
          <button onClick={onClose} style={btnClose}>×</button>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
            Set a new password for <strong>{user.email}</strong>. They&apos;ll log in with this until they change it.
          </p>
          <Field label="New password">
            <input
              type="text"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              autoComplete="new-password"
              style={inputStyle}
              placeholder="Min 8 characters"
            />
          </Field>
          {err && <div style={errorBox}>{err}</div>}
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={submitting} style={btnPrimary}>
            {submitting ? 'Saving…' : 'Update password'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CustomRolesPicker({
  roles,
  selected,
  onChange,
}: {
  roles: RoleSummary[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, padding: 8 }}>
      {roles.map((r) => (
        <label key={r.id} style={{ display: 'flex', gap: 8, padding: '6px 4px', fontSize: 12, alignItems: 'center', cursor: 'pointer', opacity: r.isActive ? 1 : 0.6 }}>
          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
          <span style={{ fontWeight: 600 }}>{r.name}</span>
          {r.isSystem && <span style={{ ...chip, background: '#dbeafe', color: '#1d4ed8' }}>System</span>}
          {!r.isActive && <span style={{ ...chip, background: '#fef3c7', color: '#92400e' }}>Disabled</span>}
          <span style={{ color: '#94a3b8' }}>· {r.permissions.length} perms</span>
        </label>
      ))}
      {roles.length === 0 && (
        <div style={{ fontSize: 12, color: '#94a3b8', padding: 8 }}>No custom roles. Create one on the Roles page.</div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none',
  borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  padding: '6px 12px', background: '#fff', color: '#475569',
  border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, fontWeight: 500,
  cursor: 'pointer', marginRight: 6,
};
const btnDanger: React.CSSProperties = {
  padding: '6px 12px', background: '#fff', color: '#dc2626',
  border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, fontWeight: 500,
  cursor: 'pointer',
};
const btnClose: React.CSSProperties = {
  width: 28, height: 28, border: 'none', background: 'transparent',
  fontSize: 22, cursor: 'pointer', color: '#64748b', lineHeight: 1,
};
const tableWrap: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const trHead: React.CSSProperties = { background: '#f8fafc', borderBottom: '1px solid #e2e8f0' };
const tr: React.CSSProperties = { borderBottom: '1px solid #f1f5f9' };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: '#1e293b' };
const chip: React.CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 12,
  fontSize: 11, fontWeight: 600, background: '#f1f5f9', color: '#475569',
};
const errorBox: React.CSSProperties = {
  marginTop: 12, padding: 10, background: '#fef2f2', border: '1px solid #fecaca',
  borderRadius: 6, color: '#991b1b', fontSize: 12,
};
const modalBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const modalBody: React.CSSProperties = {
  background: '#fff', borderRadius: 12, width: '92%', maxWidth: 560,
  boxShadow: '0 20px 60px rgba(0,0,0,0.20)',
};
const modalHeader: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '14px 20px', borderBottom: '1px solid #e2e8f0',
};
const modalFooter: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 8,
  padding: '12px 20px', borderTop: '1px solid #e2e8f0',
};
