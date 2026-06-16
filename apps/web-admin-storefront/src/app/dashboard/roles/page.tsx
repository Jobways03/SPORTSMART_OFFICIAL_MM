'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminRolesService,
  PermissionEntry,
  RoleSummary,
  groupPermissionsByModule,
} from '@/services/admin-roles.service';
import { RequirePermission } from '@/lib/permissions';
import { validateBusinessName } from '@/lib/validators';

// Role names are BUSINESS-style labels — letters AND digits plus a few
// punctuation marks are legitimate (e.g. "Tier 2 Support", "Finance (RO)").
const filterRoleName = (v: string) =>
  v.replace(/[^A-Za-z0-9 &.,\-/()']/g, '').slice(0, 150);

export default function RolesPage() {
  return (
    <RequirePermission superAdminOnly fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <RolesPageInner />
    </RequirePermission>
  );
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  variant: 'primary' | 'danger';
  onConfirm: () => void | Promise<void>;
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'DISABLED';

function RolesPageInner() {
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<RoleSummary | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /* Filters + per-row actions menu */
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rolesRes, permsRes] = await Promise.all([
        adminRolesService.listRoles(),
        adminRolesService.listPermissions(),
      ]);
      if (rolesRes.data) setRoles(rolesRes.data);
      if (permsRes.data) setPermissionCatalog(permsRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /* Click-anywhere to close the row menu */
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [openMenuId]);

  const handleToggleActive = (role: RoleSummary) => {
    const next = !role.isActive;
    const verb = next ? 'enable' : 'disable';
    setConfirmState({
      title: next ? `Enable "${role.name}"?` : `Disable "${role.name}"?`,
      message: next
        ? 'Admins assigned to this role will regain its permissions on their next request.'
        : 'Admins assigned to this role will lose its permissions on their next request, but assignments are preserved so you can re-enable it later.',
      confirmLabel: next ? 'Enable role' : 'Disable role',
      variant: next ? 'primary' : 'danger',
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          await adminRolesService.setActive(role.id, next);
          await refresh();
          setConfirmState(null);
        } catch (err) {
          setConfirmState(null);
          setErrorMessage(err instanceof Error ? err.message : `Failed to ${verb} role`);
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  };

  const counts = useMemo(() => {
    const total = roles.length;
    const active = roles.filter((r) => r.isActive).length;
    return { total, active, disabled: total - active };
  }, [roles]);

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roles.filter((r) => {
      if (statusFilter === 'ACTIVE' && !r.isActive) return false;
      if (statusFilter === 'DISABLED' && r.isActive) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [roles, statusFilter, search]);

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={{ minWidth: 0 }}>
          <h1 style={styles.h1}>Roles</h1>
          <p style={styles.headerSub}>
            Define what each admin user can do. System roles ship pre-configured.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={styles.btnPrimaryNew}>
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              d="M10 4v12M4 10h12"
            />
          </svg>
          New role
        </button>
      </header>

      {/* Toolbar: tabs + search */}
      <div style={styles.toolbar}>
        <div style={styles.tabs} role="tablist" aria-label="Filter roles by status">
          {(
            [
              { key: 'ALL', label: `All ${counts.total}` },
              { key: 'ACTIVE', label: `Active ${counts.active}` },
              { key: 'DISABLED', label: `Disabled ${counts.disabled}` },
            ] as { key: StatusFilter; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={statusFilter === t.key}
              onClick={() => setStatusFilter(t.key)}
              style={{
                ...styles.tab,
                ...(statusFilter === t.key ? styles.tabActive : {}),
              }}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={styles.searchWrap}>
          <svg viewBox="0 0 20 20" style={styles.searchIcon} aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              d="M9 3a6 6 0 104.472 10.03L17 17M9 15A6 6 0 109 3a6 6 0 000 12z"
            />
          </svg>
          <input
            type="search"
            placeholder="Search roles"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
            aria-label="Search roles"
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={styles.errorBanner}>
          {error}
        </div>
      )}

      {/* Body */}
      <div style={styles.card}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Loading roles…
          </div>
        ) : filteredRoles.length === 0 ? (
          <div style={styles.emptyBody}>
            {roles.length === 0
              ? 'No roles yet. Click "New role" to create one.'
              : 'No roles match your filters.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Role</th>
                  <th style={styles.th}>Description</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Permissions</th>
                  <th style={styles.th}>Status</th>
                  <th style={{ ...styles.th, width: 36 }} aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {filteredRoles.map((r) => (
                  <tr
                    key={r.id}
                    style={styles.tr}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = '#fafbfc';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = '#fff';
                    }}
                  >
                    <td style={styles.td}>
                      <div style={styles.roleName}>{r.name}</div>
                      <div style={styles.roleType}>
                        {r.isSystem ? 'System role' : 'Custom role'}
                      </div>
                    </td>
                    <td style={{ ...styles.td, color: '#475569', maxWidth: 480 }}>
                      {r.description ?? '—'}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>
                      <span style={styles.permsCount}>
                        {r.permissions.length}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <StatusPill active={r.isActive} />
                    </td>
                    <td style={{ ...styles.td, position: 'relative' }}>
                      <button
                        type="button"
                        aria-label={`Actions for ${r.name}`}
                        aria-expanded={openMenuId === r.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === r.id ? null : r.id);
                        }}
                        style={styles.menuTrigger}
                      >
                        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                          <circle cx="3" cy="8" r="1.4" fill="currentColor" />
                          <circle cx="8" cy="8" r="1.4" fill="currentColor" />
                          <circle cx="13" cy="8" r="1.4" fill="currentColor" />
                        </svg>
                      </button>
                      {openMenuId === r.id && (
                        <RoleActionMenu
                          role={r}
                          onEdit={() => {
                            setOpenMenuId(null);
                            setEditing(r);
                          }}
                          onToggle={() => {
                            setOpenMenuId(null);
                            handleToggleActive(r);
                          }}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <RoleFormModal
          mode="create"
          permissionCatalog={permissionCatalog}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      )}
      {editing && (
        <RoleFormModal
          mode="edit"
          existing={editing}
          permissionCatalog={permissionCatalog}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {confirmState && (
        <ConfirmModal
          state={confirmState}
          busy={confirmBusy}
          onCancel={() => setConfirmState(null)}
        />
      )}
      {errorMessage && (
        <MessageModal
          title="Action failed"
          message={errorMessage}
          onClose={() => setErrorMessage(null)}
        />
      )}
    </div>
  );
}

/* ── Status pill ────────────────────────────────────────────── */

function StatusPill({ active }: { active: boolean }) {
  const p = active
    ? { dot: '#16a34a', bg: '#f0fdf4', fg: '#15803d', label: 'Active' }
    : { dot: '#94a3b8', bg: '#f1f5f9', fg: '#475569', label: 'Disabled' };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px 3px 8px',
        fontSize: 11.5,
        fontWeight: 600,
        borderRadius: 999,
        background: p.bg,
        color: p.fg,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: p.dot,
          flexShrink: 0,
        }}
      />
      {p.label}
    </span>
  );
}

/* ── Row actions menu ───────────────────────────────────────── */

function RoleActionMenu({
  role,
  onEdit,
  onToggle,
}: {
  role: RoleSummary;
  onEdit: () => void;
  onToggle: () => void;
}) {
  // Super Admin role must always stay enabled; the disable item is
  // shown but greyed out with an explanatory title.
  const isSuperAdminRole = role.isSystem && role.name === 'Super Admin';
  const toggleLabel = role.isActive ? 'Disable role' : 'Enable role';
  return (
    <div
      role="menu"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: '100%',
        right: 12,
        marginTop: 4,
        minWidth: 180,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)',
        padding: 4,
        zIndex: 10,
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={onEdit}
        style={menuItemStyle()}
      >
        Edit role
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onToggle}
        disabled={isSuperAdminRole}
        title={
          isSuperAdminRole ? 'Super Admin role cannot be disabled' : undefined
        }
        style={menuItemStyle({
          color: role.isActive ? '#b91c1c' : '#15803d',
          disabled: isSuperAdminRole,
        })}
      >
        {toggleLabel}
      </button>
    </div>
  );
}

function menuItemStyle(opts?: { color?: string; disabled?: boolean }): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    color: opts?.color ?? '#334155',
    cursor: opts?.disabled ? 'not-allowed' : 'pointer',
    opacity: opts?.disabled ? 0.5 : 1,
    fontFamily: 'inherit',
  };
}

/* ── Page styles (scoped to the list view) ───────────────────── */

const styles: Record<string, React.CSSProperties> = {
  page: {
    color: '#0f172a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    padding: '24px 32px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  h1: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: '#0f172a',
  },
  headerSub: {
    margin: '4px 0 0',
    fontSize: 13,
    color: '#64748b',
  },
  btnPrimaryNew: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 38,
    padding: '0 16px',
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
    background: '#0f172a',
    border: '1px solid #0f172a',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },

  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  tabs: {
    display: 'inline-flex',
    gap: 4,
    borderBottom: '1px solid #e2e8f0',
    flex: 1,
    minWidth: 0,
  },
  tab: {
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
  },
  tabActive: {
    color: '#0f172a',
    // Full shorthand — pairs with the base tab's `borderBottom` so
    // React doesn't warn about mixing shorthand and longhand.
    borderBottom: '2px solid #0f172a',
    fontWeight: 600,
  },

  searchWrap: {
    position: 'relative',
    width: 280,
    flexShrink: 0,
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 16,
    height: 16,
    color: '#94a3b8',
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    height: 38,
    padding: '0 12px 0 36px',
    fontSize: 13.5,
    color: '#0f172a',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },

  errorBanner: {
    padding: '10px 14px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    color: '#991b1b',
    marginBottom: 14,
    fontSize: 13,
  },

  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    overflow: 'visible',
  },

  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '10px 16px',
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
    transition: 'background-color 0.08s',
    background: '#fff',
  },
  td: {
    padding: '14px 16px',
    verticalAlign: 'middle',
    color: '#0f172a',
  },
  roleName: {
    fontSize: 13.5,
    fontWeight: 600,
    color: '#0f172a',
    lineHeight: 1.3,
  },
  roleType: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 3,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    fontWeight: 500,
  },
  permsCount: {
    display: 'inline-block',
    fontSize: 12.5,
    fontWeight: 600,
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
    padding: '2px 8px',
    background: '#f1f5f9',
    borderRadius: 999,
    minWidth: 26,
    textAlign: 'center',
  },
  menuTrigger: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
    padding: 0,
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    color: '#94a3b8',
  },

  emptyBody: {
    padding: '56px 24px',
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 13.5,
  },
};

function RoleFormModal({
  mode,
  existing,
  permissionCatalog,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  existing?: RoleSummary;
  permissionCatalog: PermissionEntry[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(existing?.permissions ?? []));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const isSystem = existing?.isSystem === true;
  // Permissions are editable for both custom and system roles. System role
  // names cannot be renamed (would break audit + assignment lookups).
  const permsLocked = false;

  const grouped = useMemo(
    () => groupPermissionsByModule(permissionCatalog),
    [permissionCatalog],
  );

  const toggle = (key: string) => {
    if (permsLocked) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleModule = (items: PermissionEntry[]) => {
    if (permsLocked) return;
    const allSelected = items.every((i) => selected.has(i.key));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        if (allSelected) next.delete(item.key);
        else next.add(item.key);
      }
      return next;
    });
  };

  const submit = async () => {
    setErr('');
    // Role name is a BUSINESS-style label (letters + digits allowed). It is
    // only editable on create; on edit the name input is disabled.
    if (mode === 'create') {
      const nameErr = validateBusinessName(name, 'Name');
      if (nameErr) {
        setErr(nameErr);
        return;
      }
    }
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await adminRolesService.createRole({
          name: name.trim(),
          description: description.trim() || undefined,
          permissions: Array.from(selected),
        });
      } else if (existing) {
        await adminRolesService.updateRole(existing.id, {
          description: description.trim() || undefined,
          permissions: Array.from(selected),
        });
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={{ ...modalBody, maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
            {mode === 'create' ? 'Create role' : 'Edit role'}
          </h2>
          <button onClick={onClose} style={btnClose}>×</button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14, marginBottom: 16 }}>
            <Field label="Name">
              <input
                value={name}
                maxLength={150}
                onChange={(e) => setName(filterRoleName(e.target.value))}
                disabled={mode === 'edit'}
                style={inputStyle}
              />
            </Field>
            <Field label="Description">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>

          {isSystem && (
            <div style={{ marginBottom: 10, padding: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11, color: '#92400e' }}>
              This is a system role. You can edit its permissions, but the role name is locked, and re-running <code>pnpm seed:rbac</code> will not overwrite your changes — it only creates roles that don&apos;t exist yet.
            </div>
          )}

          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Permissions
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {selected.size} of {permissionCatalog.length} selected
            </div>
          </div>

          <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
            {grouped.map(({ module, items }) => {
              const allOn = items.every((i) => selected.has(i.key));
              const someOn = !allOn && items.some((i) => selected.has(i.key));
              return (
                <div key={module} style={{ marginBottom: 14 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>
                    <input
                      type="checkbox"
                      checked={allOn}
                      ref={(el) => { if (el) el.indeterminate = someOn; }}
                      onChange={() => toggleModule(items)}
                      disabled={permsLocked}
                    />
                    {module} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({items.filter((i) => selected.has(i.key)).length}/{items.length})</span>
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, paddingLeft: 22 }}>
                    {items.map((p) => (
                      <label key={p.key} style={{ display: 'flex', gap: 6, fontSize: 12, color: '#334155', cursor: permsLocked ? 'not-allowed' : 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(p.key)}
                          onChange={() => toggle(p.key)}
                          disabled={permsLocked}
                        />
                        <span>
                          <code style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: 3, fontSize: 11 }}>{p.key}</code>
                          <div style={{ color: '#64748b', fontSize: 11, marginTop: 1 }}>{p.description}</div>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {err && (
            <div style={{ marginTop: 12, padding: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: 12 }}>
              {err}
            </div>
          )}
        </div>

        <div style={modalFooter}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={submitting} style={btnPrimary}>
            {submitting ? 'Saving…' : mode === 'create' ? 'Create role' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  padding: '6px 12px',
  background: '#fff',
  color: '#475569',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  marginRight: 6,
};

const btnDanger: React.CSSProperties = {
  padding: '6px 12px',
  background: '#fff',
  color: '#dc2626',
  border: '1px solid #fecaca',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};

const btnClose: React.CSSProperties = {
  width: 28,
  height: 28,
  border: 'none',
  background: 'transparent',
  fontSize: 22,
  cursor: 'pointer',
  color: '#64748b',
  lineHeight: 1,
};

const tableWrap: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  overflow: 'hidden',
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const trHead: React.CSSProperties = { background: '#f8fafc', borderBottom: '1px solid #e2e8f0' };
const tr: React.CSSProperties = { borderBottom: '1px solid #f1f5f9' };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 };
const td: React.CSSProperties = { padding: '11px 14px', fontSize: 13, color: '#1e293b' };

const badge: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 600,
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

function ConfirmModal({
  state,
  busy,
  onCancel,
}: {
  state: ConfirmState;
  busy: boolean;
  onCancel: () => void;
}) {
  const confirmStyle =
    state.variant === 'danger'
      ? { ...btnPrimary, background: '#dc2626' }
      : btnPrimary;
  return (
    <div style={{ ...modalBackdrop, zIndex: 200 }} onClick={busy ? undefined : onCancel}>
      <div style={{ ...modalBody, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{state.title}</h2>
          <button onClick={onCancel} style={btnClose} disabled={busy}>×</button>
        </div>
        <div style={{ padding: '16px 20px', fontSize: 13, color: '#334155', lineHeight: 1.55 }}>
          {state.message}
        </div>
        <div style={modalFooter}>
          <button onClick={onCancel} style={btnGhost} disabled={busy}>Cancel</button>
          <button
            onClick={() => state.onConfirm()}
            style={{ ...confirmStyle, opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}
            disabled={busy}
          >
            {busy ? 'Working…' : state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageModal({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <div style={{ ...modalBackdrop, zIndex: 210 }} onClick={onClose}>
      <div style={{ ...modalBody, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#dc2626' }}>{title}</h2>
          <button onClick={onClose} style={btnClose}>×</button>
        </div>
        <div style={{ padding: '16px 20px', fontSize: 13, color: '#334155', lineHeight: 1.55 }}>
          {message}
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={btnPrimary}>OK</button>
        </div>
      </div>
    </div>
  );
}
