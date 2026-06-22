'use client';

// COD Rules console — view + manage the Cash-on-Delivery eligibility rules
// the checkout engine evaluates (pincode allow/deny, value caps, seller deny,
// customer-risk gates). Read needs cod.read; create/toggle/delete need
// cod.write (enforced again at the backend). Added so a granular COD role
// has a real landing page instead of an empty dashboard.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePermissions } from '@/lib/permissions';
import {
  adminCodService,
  CodRule,
  CodDecision,
  CodRuleKind,
  COD_RULE_KINDS,
} from '@/services/admin-cod.service';

const KIND_LABEL: Record<CodRuleKind, string> = {
  PINCODE_ALLOW: 'Pincode allow',
  PINCODE_DENY: 'Pincode deny',
  VALUE_LIMIT: 'Value limit',
  SELLER_DENY: 'Seller deny',
  CUSTOMER_RISK: 'Customer risk',
};

export default function CodRulesPage() {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('cod.write');

  const [rules, setRules] = useState<CodRule[]>([]);
  const [decisions, setDecisions] = useState<CodDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // New-rule form
  const [showForm, setShowForm] = useState(false);
  const [formKind, setFormKind] = useState<CodRuleKind>('PINCODE_DENY');
  const [formPriority, setFormPriority] = useState('100');
  const [formConditions, setFormConditions] = useState('{"pincodes":["110001"]}');
  const [formDescription, setFormDescription] = useState('');
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [r, d] = await Promise.all([
        adminCodService.listRules(),
        adminCodService.listDecisions(50).catch(() => ({ data: [] as CodDecision[] }) as any),
      ]);
      setRules(r.data ?? []);
      setDecisions(d.data ?? []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load COD rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeRuleKindHint = useMemo(
    () => COD_RULE_KINDS.find((k) => k.value === formKind)?.hint ?? '',
    [formKind],
  );

  const handleCreate = async () => {
    setFormError('');
    let conditions: unknown;
    try {
      conditions = JSON.parse(formConditions);
    } catch {
      setFormError('Conditions must be valid JSON');
      return;
    }
    const priority = parseInt(formPriority, 10);
    if (Number.isNaN(priority) || priority < 1 || priority > 1000) {
      setFormError('Priority must be a number between 1 and 1000');
      return;
    }
    try {
      await adminCodService.createRule({
        kind: formKind,
        priority,
        conditions,
        description: formDescription.trim() || undefined,
      });
      setShowForm(false);
      setFormDescription('');
      await load();
    } catch (e: any) {
      setFormError(e?.message || 'Failed to create rule');
    }
  };

  const handleToggle = async (rule: CodRule) => {
    setBusyId(rule.id);
    try {
      await adminCodService.updateRule(rule.id, { active: !rule.active });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to update rule');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (rule: CodRule) => {
    if (!window.confirm(`Delete this ${KIND_LABEL[rule.kind]} rule? This cannot be undone.`)) return;
    setBusyId(rule.id);
    try {
      await adminCodService.deleteRule(rule.id);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete rule');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: '#6b7280', textTransform: 'uppercase' }}>Finance</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 4px' }}>COD Rules</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>
            Eligibility rules the checkout evaluates to decide whether Cash on Delivery is offered. Lower priority runs first.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowForm((s) => !s)}
            style={{ padding: '8px 14px', background: '#111827', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            {showForm ? 'Cancel' : '+ New rule'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, fontSize: 13, margin: '14px 0' }}>
          {error}
        </div>
      )}

      {showForm && canWrite && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, margin: '16px 0', background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
              Kind
              <select value={formKind} onChange={(e) => setFormKind(e.target.value as CodRuleKind)} style={inputStyle}>
                {COD_RULE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
              Priority (1–1000)
              <input value={formPriority} onChange={(e) => setFormPriority(e.target.value)} style={{ ...inputStyle, width: 110 }} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', flex: 1, minWidth: 260 }}>
              Description (optional)
              <input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="e.g. Block COD for high-risk pincodes" style={{ ...inputStyle, width: '100%' }} />
            </label>
          </div>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginTop: 12 }}>
            Conditions (JSON) — e.g. <code style={{ color: '#6b7280' }}>{activeRuleKindHint}</code>
            <textarea value={formConditions} onChange={(e) => setFormConditions(e.target.value)} rows={3} style={{ ...inputStyle, width: '100%', fontFamily: 'monospace' }} />
          </label>
          {formError && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>{formError}</div>}
          <button onClick={handleCreate} style={{ marginTop: 12, padding: '8px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Create rule
          </button>
        </div>
      )}

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '20px 0 8px' }}>Rules</h2>
      {loading ? (
        <div style={{ color: '#6b7280', fontSize: 13, padding: 20 }}>Loading…</div>
      ) : rules.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: 13, padding: 20, border: '1px dashed #e5e7eb', borderRadius: 8 }}>
          No COD rules configured. {canWrite ? 'Create one above.' : ''} With no rules, COD falls back to the default policy.
        </div>
      ) : (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                <th style={thStyle}>Priority</th>
                <th style={thStyle}>Kind</th>
                <th style={thStyle}>Conditions</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Status</th>
                {canWrite && <th style={thStyle}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={tdStyle}>{r.priority}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{KIND_LABEL[r.kind]}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, color: '#374151' }}>{JSON.stringify(r.conditions)}</td>
                  <td style={tdStyle}>{r.description || <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: r.active ? '#dcfce7' : '#f3f4f6', color: r.active ? '#15803d' : '#6b7280' }}>
                      {r.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canWrite && (
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => handleToggle(r)} disabled={busyId === r.id} style={smallBtn('#2563eb')}>
                          {r.active ? 'Disable' : 'Enable'}
                        </button>
                        <button onClick={() => handleDelete(r)} disabled={busyId === r.id} style={smallBtn('#dc2626')}>
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '28px 0 8px' }}>Recent decisions</h2>
      {decisions.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: 13, padding: 16, border: '1px dashed #e5e7eb', borderRadius: 8 }}>No COD decisions logged yet.</div>
      ) : (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                <th style={thStyle}>When</th>
                <th style={thStyle}>Pincode</th>
                <th style={thStyle}>Eligible</th>
                <th style={thStyle}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={tdStyle}>{new Date(d.createdAt).toLocaleString()}</td>
                  <td style={tdStyle}>{d.pincode || '—'}</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: d.eligible ? '#15803d' : '#b91c1c' }}>
                      {d.eligible ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: '#6b7280' }}>{d.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  padding: '7px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 400,
};

const thStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 };
const tdStyle: React.CSSProperties = { padding: '10px 14px', verticalAlign: 'middle' };
const smallBtn = (bg: string): React.CSSProperties => ({ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: 'none', background: bg, color: '#fff', borderRadius: 4, cursor: 'pointer' });
