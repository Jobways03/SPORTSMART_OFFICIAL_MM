'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useModal } from '@sportsmart/ui';
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
import {
  validatePersonName,
  validateEmail,
  validateStrongPassword,
} from '@/lib/validators';

// Admin names are PERSON names — letters only (plus space/period/apostrophe/
// hyphen). Strip anything else as the admin types/pastes; submit still runs
// validatePersonName.
const filterPersonName = (v: string) => v.replace(/[^A-Za-z .'-]/g, '').slice(0, 100);

export default function AdminUsersPage() {
  return (
    <RequirePermission superAdminOnly fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <UsersInner />
    </RequirePermission>
  );
}

function UsersInner() {
  const { me } = usePermissions();
  const { confirmDialog, notify } = useModal();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resettingPwd, setResettingPwd] = useState<AdminUser | null>(null);
  const [invitingMfa, setInvitingMfa] = useState<AdminUser | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | AdminAccountStatus>('ALL');

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
    const ok = await confirmDialog({
      title: `${next === 'ACTIVE' ? 'Reactivate' : 'Suspend'} ${u.name}?`,
      message:
        next === 'ACTIVE'
          ? 'They will be able to sign in again immediately.'
          : 'They will be signed out of all sessions and blocked from new logins until reactivated.',
      confirmText: next === 'ACTIVE' ? 'Reactivate' : 'Suspend',
      cancelText: 'Cancel',
      danger: next === 'SUSPENDED',
    });
    if (!ok) return;
    try {
      await adminUsersService.update(u.id, { status: next });
      await refresh();
    } catch (err) {
      await notify({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to update status' });
    }
  };

  const remove = async (u: AdminUser) => {
    const ok = await confirmDialog({
      title: `Deactivate ${u.name}?`,
      message: 'They will no longer be able to log in. Their audit history is preserved.',
      confirmText: 'Deactivate',
      cancelText: 'Keep active',
      danger: true,
    });
    if (!ok) return;
    try {
      await adminUsersService.remove(u.id);
      await refresh();
    } catch (err) {
      await notify({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to deactivate' });
    }
  };

  const counts = useMemo(() => {
    const acc = { ALL: users.length, ACTIVE: 0, SUSPENDED: 0, INACTIVE: 0 };
    for (const u of users) acc[u.status]++;
    return acc;
  }, [users]);

  const filteredUsers = useMemo(() => {
    if (statusFilter === 'ALL') return users;
    return users.filter((u) => u.status === statusFilter);
  }, [users, statusFilter]);

  return (
    <div style={{ padding: '28px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={eyebrow}>ACCESS</div>
          <h1 style={pageTitle}>Admin users</h1>
          <p style={pageSubtitle}>
            Manage who can sign in to the admin panel and what they can access.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={btnPrimary}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> New admin
        </button>
      </div>

      <div style={toolbar}>
        <div style={tabsBar} role="tablist" aria-label="Filter by status">
          {(
            [
              { key: 'ALL', label: `All ${counts.ALL}` },
              { key: 'ACTIVE', label: `Active ${counts.ACTIVE}` },
              { key: 'SUSPENDED', label: `Suspended ${counts.SUSPENDED}` },
              { key: 'INACTIVE', label: `Inactive ${counts.INACTIVE}` },
            ] as { key: 'ALL' | AdminAccountStatus; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={statusFilter === t.key}
              onClick={() => setStatusFilter(t.key)}
              style={{ ...tabBtn, ...(statusFilter === t.key ? tabBtnActive : {}) }}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={searchWrap}>
          <span style={searchIconSlot}>
            <SearchIcon />
          </span>
          <input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={searchInput}
          />
        </div>
      </div>

      {error && (
        <div style={errorBox}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 24 }}>Loading admins…</div>
      ) : (
        <div style={tableWrap}>
          <table style={tableStyle}>
            <colgroup>
              <col style={{ width: '15%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '56px' }} />
            </colgroup>
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
              {filteredUsers.map((u) => (
                <tr key={u.id} style={tr}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={u.name} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {u.name}
                      </span>
                    </div>
                  </td>
                  <td style={{ ...td, color: '#475569' }}>{u.email}</td>
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
                  <td style={{ ...td, color: '#64748b', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {u.lastLoginAt ? (
                      <span title={formatLastLoginAbsolute(u.lastLoginAt)}>
                        {formatLastLogin(u.lastLoginAt)}
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>Never</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right', overflow: 'visible' }}>
                    <RowActions
                      user={u}
                      isSelf={u.id === me?.adminId}
                      onEdit={() => setEditing(u)}
                      onResetPassword={() => setResettingPwd(u)}
                      onMfaInvite={() => setInvitingMfa(u)}
                      onToggleStatus={() => toggleStatus(u)}
                      onDeactivate={() => remove(u)}
                    />
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 30 }}>
                    {users.length === 0
                      ? 'No admin users found.'
                      : `No ${statusFilter === 'ALL' ? '' : statusFilter.toLowerCase() + ' '}admins match your filters.`}
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
      {invitingMfa && (
        <MfaInviteModal
          user={invitingMfa}
          onClose={() => setInvitingMfa(null)}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AdminAccountStatus }) {
  const map: Record<AdminAccountStatus, { bg: string; fg: string; dot: string; border: string }> = {
    ACTIVE: { bg: '#F0FDF4', fg: '#15803D', dot: '#22C55E', border: '#BBF7D0' },
    SUSPENDED: { bg: '#FFFBEB', fg: '#B45309', dot: '#F59E0B', border: '#FDE68A' },
    INACTIVE: { bg: '#F8FAFC', fg: '#475569', dot: '#94A3B8', border: '#E2E8F0' },
  };
  const { bg, fg, dot, border } = map[status];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '3px 10px 3px 8px',
      borderRadius: 999,
      fontSize: 11.5,
      fontWeight: 600,
      background: bg,
      color: fg,
      border: `1px solid ${border}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
      {status === 'ACTIVE' ? 'Active' : status === 'SUSPENDED' ? 'Suspended' : 'Inactive'}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2) || '?';
  const palette = [
    { bg: '#E0F2FE', fg: '#075985' },
    { bg: '#FCE7F3', fg: '#9D174D' },
    { bg: '#FEF3C7', fg: '#92400E' },
    { bg: '#DCFCE7', fg: '#166534' },
    { bg: '#EDE9FE', fg: '#5B21B6' },
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const c = palette[h % palette.length];
  return (
    <span
      style={{
        flexShrink: 0,
        width: 28,
        height: 28,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        fontSize: 11,
        fontWeight: 700,
        background: c.bg,
        color: c.fg,
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function RowActions({
  user,
  isSelf,
  onEdit,
  onResetPassword,
  onMfaInvite,
  onToggleStatus,
  onDeactivate,
}: {
  user: AdminUser;
  isSelf: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onMfaInvite: () => void;
  onToggleStatus: () => void;
  onDeactivate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={kebabBtn}
        aria-label="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <KebabIcon />
      </button>
      {open && (
        <div role="menu" style={menuPanel}>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onEdit(); }}
            style={menuItem}
          >
            <PencilIcon /> Edit admin
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onResetPassword(); }}
            style={menuItem}
          >
            <KeyIcon /> Reset password
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onMfaInvite(); }}
            style={menuItem}
          >
            <ShieldIcon /> Send MFA invite
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onToggleStatus(); }}
            disabled={isSelf}
            style={{ ...menuItem, opacity: isSelf ? 0.45 : 1, cursor: isSelf ? 'not-allowed' : 'pointer' }}
            title={isSelf ? 'You can\'t change your own status here' : undefined}
          >
            {user.status === 'ACTIVE' ? <PauseIcon /> : <PlayIcon />}
            {user.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
          </button>
          <div style={menuDivider} />
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onDeactivate(); }}
            disabled={isSelf}
            style={{ ...menuItem, color: '#B91C1C', opacity: isSelf ? 0.45 : 1, cursor: isSelf ? 'not-allowed' : 'pointer' }}
            title={isSelf ? 'You can\'t deactivate yourself' : undefined}
          >
            <TrashIcon /> Deactivate
          </button>
        </div>
      )}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function formatLastLogin(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 5) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;
  return `${years}y ago`;
}

function formatLastLoginAbsolute(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function KebabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="m10 13 9-9 3 3" />
      <path d="m18 6 3 3" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
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
    const nameErr = validatePersonName(name, 'Name');
    if (nameErr) return setErr(nameErr);
    const emailErr = validateEmail(email);
    if (emailErr) return setErr(emailErr);
    const passwordErr = validateStrongPassword(password);
    if (passwordErr) return setErr(passwordErr);
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
              <input value={name} maxLength={100} onChange={(e) => setName(filterPersonName(e.target.value))} style={inputStyle} />
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
    const nameErr = validatePersonName(name, 'Name');
    if (nameErr) return setErr(nameErr);
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
              <input value={name} maxLength={100} onChange={(e) => setName(filterPersonName(e.target.value))} style={inputStyle} />
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

function MfaInviteModal({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [link, setLink] = useState('');
  const [portalLabel, setPortalLabel] = useState('');
  const [expiresMins, setExpiresMins] = useState(0);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await adminUsersService.createMfaInvite(user.id);
      // The backend builds the link against the invitee's HOME portal
      // (D2C / Retail / Franchise / Affiliate / Super) so they enroll and
      // sign in where their role is accepted — not always localhost:4000.
      if (!res.data?.enrollUrl) throw new Error('No invite link returned');
      setLink(res.data.enrollUrl);
      setPortalLabel(res.data.portalLabel ?? '');
      setExpiresMins(Math.round((res.data?.expiresInSeconds ?? 0) / 60));
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create invite');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    generate();
  }, [generate]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the input is selectable as a fallback.
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalBody} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>MFA enrollment invite</h2>
          <button onClick={onClose} style={btnClose}>×</button>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
            Send this single-use link to <strong>{user.email}</strong>. They open it
            (no login needed), scan the QR / setup key into their authenticator app,
            and confirm a 6-digit code — after which they can sign in.
          </p>

          {loading && (
            <div style={{ fontSize: 13, color: '#64748b', padding: '8px 0' }}>
              Generating secure link…
            </div>
          )}

          {err && (
            <>
              <div style={errorBox}>{err}</div>
              <button onClick={generate} style={{ ...btnGhost, marginTop: 10 }}>
                Try again
              </button>
            </>
          )}

          {!loading && !err && link && (
            <>
              {portalLabel && (
                <p style={{ fontSize: 12.5, color: '#334155', margin: '0 0 10px' }}>
                  Signs in at: <strong>{portalLabel}</strong> portal — this link points there.
                </p>
              )}
              <Field label="Enrollment link">
                <input
                  type="text"
                  value={link}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
                />
              </Field>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <button onClick={copy} style={btnPrimary}>
                  {copied ? 'Copied ✓' : 'Copy link'}
                </button>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  Single-use · expires in {expiresMins} min
                </span>
              </div>
              <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 0 }}>
                Share it over a secure channel. It stops working once used or after it expires.
              </p>
            </>
          )}
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={btnGhost}>Done</button>
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

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.2,
  color: '#64748B',
  marginBottom: 4,
};
const pageTitle: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 700,
  margin: 0,
  color: '#0F172A',
  letterSpacing: '-0.02em',
};
const pageSubtitle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 13.5,
  color: '#64748B',
  lineHeight: 1.55,
  maxWidth: 560,
};
const toolbar: React.CSSProperties = {
  marginBottom: 14,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
  flexWrap: 'wrap',
};
const tabsBar: React.CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  borderBottom: '1px solid #e2e8f0',
  flex: 1,
  minWidth: 0,
};
const tabBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 38,
  padding: '0 14px',
  fontSize: 13,
  fontWeight: 500,
  color: '#64748b',
  background: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  marginBottom: -1,
  cursor: 'pointer',
  transition: 'color 0.12s, border-color 0.12s',
  fontFamily: 'inherit',
};
const tabBtnActive: React.CSSProperties = {
  color: '#0f172a',
  // Full shorthand to avoid mixing shorthand+longhand (React warns
  // about borderBottom + borderBottomColor on the same element).
  borderBottom: '2px solid #0f172a',
  fontWeight: 600,
};
const searchWrap: React.CSSProperties = {
  position: 'relative',
  width: 280,
  flexShrink: 0,
};
const searchIconSlot: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  color: '#94A3B8',
  pointerEvents: 'none',
  display: 'inline-flex',
};
const searchInput: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px 9px 34px',
  border: '1px solid #D2D6DC',
  borderRadius: 10,
  fontSize: 13,
  background: '#fff',
  outline: 'none',
};
const countPill: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 12.5,
  color: '#64748B',
  padding: '6px 12px',
  background: '#F1F5F9',
  borderRadius: 8,
  fontVariantNumeric: 'tabular-nums',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit',
};
const btnPrimary: React.CSSProperties = {
  padding: '9px 16px', background: '#0F1115', color: '#fff', border: '1px solid #0F1115',
  borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
  boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 4px 12px -4px rgba(15,17,21,0.25)',
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
const btnEdit: React.CSSProperties = {
  padding: '6px 14px',
  background: '#fff',
  color: '#0F172A',
  border: '1px solid #CBD5E1',
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};
const kebabBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  display: 'inline-grid',
  placeItems: 'center',
  background: '#fff',
  color: '#64748B',
  border: '1px solid #CBD5E1',
  borderRadius: 8,
  cursor: 'pointer',
};
const menuPanel: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  zIndex: 50,
  minWidth: 200,
  background: '#fff',
  border: '1px solid #E2E8F0',
  borderRadius: 10,
  boxShadow: '0 12px 30px -8px rgba(15, 23, 42, 0.18), 0 4px 10px -2px rgba(15, 23, 42, 0.08)',
  padding: 4,
  textAlign: 'left',
};
const menuItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '8px 12px',
  background: 'transparent',
  border: 'none',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  color: '#0F172A',
  textAlign: 'left',
  cursor: 'pointer',
};
const menuDivider: React.CSSProperties = {
  height: 1,
  background: '#F1F5F9',
  margin: '4px 6px',
};
const btnClose: React.CSSProperties = {
  width: 28, height: 28, border: 'none', background: 'transparent',
  fontSize: 22, cursor: 'pointer', color: '#64748b', lineHeight: 1,
};
const tableWrap: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #E5E7EB',
  borderRadius: 12,
  overflow: 'visible',
  boxShadow: '0 1px 0 rgba(15,23,42,0.02)',
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' };
const trHead: React.CSSProperties = { background: '#F8FAFC', borderBottom: '1px solid #E5E7EB' };
const tr: React.CSSProperties = { borderBottom: '1px solid #F1F5F9' };
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 14px',
  fontSize: 10.5,
  fontWeight: 700,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
};
const td: React.CSSProperties = {
  padding: '14px 14px',
  fontSize: 13,
  color: '#0F172A',
  verticalAlign: 'middle',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const chip: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 9px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  background: '#EEF2FF',
  color: '#3730A3',
  border: '1px solid #C7D2FE',
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
