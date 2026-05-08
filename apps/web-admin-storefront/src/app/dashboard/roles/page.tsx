'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminRolesService,
  PermissionEntry,
  RoleSummary,
  groupPermissionsByModule,
} from '@/services/admin-roles.service';
import { RequirePermission } from '@/lib/permissions';

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

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Roles</h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            Define what each admin user can do. System roles ship pre-configured and can be edited only by description.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={btnPrimary}
        >
          + New role
        </button>
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b' }}>Loading roles…</div>
      ) : (
        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr style={trHead}>
                <th style={th}>Name</th>
                <th style={th}>Description</th>
                <th style={th}>Permissions</th>
                <th style={th}>Type</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id} style={tr}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                  <td style={{ ...td, color: '#475569' }}>{r.description ?? '—'}</td>
                  <td style={td}>{r.permissions.length}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {r.isSystem ? (
                        <span style={{ ...badge, background: '#dbeafe', color: '#1d4ed8' }}>System</span>
                      ) : (
                        <span style={{ ...badge, background: '#f1f5f9', color: '#475569' }}>Custom</span>
                      )}
                      {!r.isActive && (
                        <span style={{ ...badge, background: '#fef3c7', color: '#92400e' }}>Disabled</span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => setEditing(r)} style={btnGhost}>
                      Edit
                    </button>
                    {(() => {
                      const isSuperAdminRole = r.isSystem && r.name === 'Super Admin';
                      const disabled = isSuperAdminRole;
                      const next = !r.isActive;
                      return (
                        <button
                          onClick={() => handleToggleActive(r)}
                          disabled={disabled}
                          style={{
                            ...(next ? btnPrimary : btnDanger),
                            padding: '6px 12px',
                            fontSize: 12,
                            opacity: disabled ? 0.4 : 1,
                            cursor: disabled ? 'not-allowed' : 'pointer',
                          }}
                          title={isSuperAdminRole ? 'Super Admin role cannot be disabled' : ''}
                        >
                          {next ? 'Enable' : 'Disable'}
                        </button>
                      );
                    })()}
                  </td>
                </tr>
              ))}
              {roles.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 30 }}>
                    No roles yet. Click "+ New role" to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

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
    if (mode === 'create' && !name.trim()) {
      setErr('Name is required');
      return;
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
                onChange={(e) => setName(e.target.value)}
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
