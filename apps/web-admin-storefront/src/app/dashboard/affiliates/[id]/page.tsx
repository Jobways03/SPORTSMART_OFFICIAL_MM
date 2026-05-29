'use client';

// Phase 158 (audit #1) — affiliate detail + coupon-config editor. Before this
// there was NO admin UI to set a coupon's customer-facing discount, caps, or
// schedule — the endpoint existed but was unreachable from the dashboard.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { usePermissions } from '@/lib/permissions';
import {
  adminAffiliatesService as svc,
  AffiliateDetail,
  AffiliateCoupon,
  CouponDiscountType,
  CouponConfigInput,
  CreateCouponInput,
  AFFILIATE_STATUS_COLOR,
} from '@/services/admin-affiliates.service';

// ── datetime-local ⇄ ISO helpers ───────────────────────────────
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
function numStr(v?: string | number | null): string {
  if (v === null || v === undefined || v === '') return '';
  return String(v);
}

interface FormState {
  isActive: boolean;
  customerDiscountType: '' | CouponDiscountType;
  customerDiscountValue: string;
  maxDiscountAmount: string;
  startsAt: string;
  expiresAt: string;
  maxUses: string;
  perUserLimit: string;
  minOrderValue: string;
}

function couponToForm(c: AffiliateCoupon): FormState {
  return {
    isActive: c.isActive,
    customerDiscountType: (c.customerDiscountType ?? '') as '' | CouponDiscountType,
    customerDiscountValue: numStr(c.customerDiscountValue),
    maxDiscountAmount: numStr(c.maxDiscountAmount),
    startsAt: toLocalInput(c.startsAt),
    expiresAt: toLocalInput(c.expiresAt),
    maxUses: numStr(c.maxUses),
    perUserLimit: numStr(c.perUserLimit) || '1',
    minOrderValue: numStr(c.minOrderValue),
  };
}

interface AddFormState {
  codeMode: 'auto' | 'manual';
  code: string;
  customerDiscountType: '' | CouponDiscountType;
  customerDiscountValue: string;
  maxDiscountAmount: string;
  startsAt: string;
  expiresAt: string;
  maxUses: string;
  perUserLimit: string;
  minOrderValue: string;
  isPrimary: boolean;
}

const EMPTY_ADD_FORM: AddFormState = {
  codeMode: 'auto',
  code: '',
  customerDiscountType: '',
  customerDiscountValue: '',
  maxDiscountAmount: '',
  startsAt: '',
  expiresAt: '',
  maxUses: '',
  perUserLimit: '1',
  minOrderValue: '',
  isPrimary: false,
};

function discountSummary(c: AffiliateCoupon): string {
  const t = c.customerDiscountType;
  if (t === 'FREE_SHIPPING') return 'Free shipping';
  if (t === 'PERCENT') {
    const cap = c.maxDiscountAmount != null && c.maxDiscountAmount !== ''
      ? `, max ₹${Number(c.maxDiscountAmount).toLocaleString('en-IN')}`
      : '';
    return `${Number(c.customerDiscountValue ?? 0)}% off${cap}`;
  }
  if (t === 'FIXED') return `₹${Number(c.customerDiscountValue ?? 0).toLocaleString('en-IN')} off`;
  return 'Attribution only';
}

export default function AffiliateDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const { hasPermission } = usePermissions();
  const canConfigure = hasPermission('affiliates.coupons.configure');
  const canCreateCoupon = hasPermission('affiliates.coupons.create');
  // Backend enforces SUPER_ADMIN; the UI gates on the permission (a super-admin
  // holds it). A non-super-admin who somehow holds it sees the server's 403.
  const canEditRate = hasPermission('affiliates.commission');

  const [detail, setDetail] = useState<AffiliateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<AffiliateCoupon | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [modalErr, setModalErr] = useState('');
  const [saving, setSaving] = useState(false);

  // Commission-rate editor.
  const [rateOpen, setRateOpen] = useState(false);
  const [rateClear, setRateClear] = useState(false); // true = clear override → platform default
  const [rateInput, setRateInput] = useState('');
  const [rateReason, setRateReason] = useState('');
  const [rateErr, setRateErr] = useState('');
  const [rateSaving, setRateSaving] = useState(false);

  // Add-coupon editor (null = closed).
  const [addForm, setAddForm] = useState<AddFormState | null>(null);
  const [addErr, setAddErr] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await svc.getOne(id);
      setDetail(res?.data ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load affiliate');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (c: AffiliateCoupon) => {
    setEditing(c);
    setForm(couponToForm(c));
    setModalErr('');
  };

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!editing || !form) return;
    setModalErr('');
    const type = (form.customerDiscountType || null) as CouponDiscountType | null;

    // Client-side guards mirror the server (UX only — the server re-validates).
    if (type === 'PERCENT' || type === 'FIXED') {
      const v = Number(form.customerDiscountValue);
      if (form.customerDiscountValue === '' || !Number.isFinite(v) || v < 0) {
        setModalErr('Enter a discount value (≥ 0).');
        return;
      }
      if (type === 'PERCENT' && v > 100) {
        setModalErr('Percentage cannot exceed 100.');
        return;
      }
    }
    const startsISO = fromLocalInput(form.startsAt);
    const expiresISO = fromLocalInput(form.expiresAt);
    if (startsISO && expiresISO && new Date(startsISO) >= new Date(expiresISO)) {
      setModalErr('Start date must be before the expiry date.');
      return;
    }

    const body: CouponConfigInput = {
      isActive: form.isActive,
      customerDiscountType: type,
      customerDiscountValue:
        type === 'PERCENT' || type === 'FIXED'
          ? Number(form.customerDiscountValue)
          : null,
      // The cap only applies to PERCENT; the server also clears it otherwise.
      maxDiscountAmount:
        type === 'PERCENT' && form.maxDiscountAmount !== ''
          ? Number(form.maxDiscountAmount)
          : null,
      startsAt: startsISO,
      expiresAt: expiresISO,
      maxUses: form.maxUses === '' ? null : Number(form.maxUses),
      perUserLimit: form.perUserLimit === '' ? 1 : Number(form.perUserLimit),
      minOrderValue: form.minOrderValue === '' ? null : Number(form.minOrderValue),
    };

    setSaving(true);
    try {
      await svc.updateCouponConfig(id, editing.id, body);
      setEditing(null);
      setForm(null);
      await load();
    } catch (e: any) {
      setModalErr(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const openRate = () => {
    const cur = detail?.commissionPercentage;
    setRateClear(cur == null);
    setRateInput(cur == null ? '' : String(Number(cur)));
    setRateReason('');
    setRateErr('');
    setRateOpen(true);
  };

  const saveRate = async () => {
    setRateErr('');
    let percentage: number | null;
    if (rateClear) {
      percentage = null;
    } else {
      const v = Number(rateInput);
      if (rateInput.trim() === '' || !Number.isFinite(v) || v < 0 || v > 100) {
        setRateErr('Enter a rate between 0 and 100, or choose "Use platform default".');
        return;
      }
      percentage = Math.round(v * 100) / 100;
    }
    setRateSaving(true);
    try {
      await svc.updateCommissionRate(id, percentage, rateReason.trim() || undefined);
      setRateOpen(false);
      await load();
    } catch (e: any) {
      setRateErr(e?.message ?? 'Save failed');
    } finally {
      setRateSaving(false);
    }
  };

  const setAddField = <K extends keyof AddFormState>(k: K, v: AddFormState[K]) =>
    setAddForm((f) => (f ? { ...f, [k]: v } : f));

  const saveAdd = async () => {
    if (!addForm) return;
    setAddErr('');
    const f = addForm;
    const type = (f.customerDiscountType || undefined) as CouponDiscountType | undefined;

    if (f.codeMode === 'manual') {
      if (!/^[A-Za-z0-9]{4,20}$/.test(f.code.trim())) {
        setAddErr('Code must be 4–20 alphanumeric characters.');
        return;
      }
    }
    if (type === 'PERCENT' || type === 'FIXED') {
      const v = Number(f.customerDiscountValue);
      if (f.customerDiscountValue === '' || !Number.isFinite(v) || v < 0) {
        setAddErr('Enter a discount value (≥ 0).');
        return;
      }
      if (type === 'PERCENT' && v > 100) {
        setAddErr('Percentage cannot exceed 100.');
        return;
      }
    }
    const startsISO = fromLocalInput(f.startsAt);
    const expiresISO = fromLocalInput(f.expiresAt);
    if (startsISO && expiresISO && new Date(startsISO) >= new Date(expiresISO)) {
      setAddErr('Start date must be before the expiry date.');
      return;
    }

    const body: CreateCouponInput = {
      code: f.codeMode === 'manual' && f.code.trim() ? f.code.trim() : undefined,
      customerDiscountType: type,
      customerDiscountValue:
        type === 'PERCENT' || type === 'FIXED' ? Number(f.customerDiscountValue) : undefined,
      maxDiscountAmount:
        type === 'PERCENT' && f.maxDiscountAmount !== '' ? Number(f.maxDiscountAmount) : undefined,
      minOrderValue: f.minOrderValue !== '' ? Number(f.minOrderValue) : undefined,
      maxUses: f.maxUses !== '' ? Number(f.maxUses) : undefined,
      perUserLimit: f.perUserLimit !== '' ? Number(f.perUserLimit) : undefined,
      startsAt: startsISO ?? undefined,
      expiresAt: expiresISO ?? undefined,
      isPrimary: f.isPrimary || undefined,
    };

    setAddSaving(true);
    try {
      await svc.createCoupon(id, body);
      setAddForm(null);
      await load();
    } catch (e: any) {
      setAddErr(e?.message ?? 'Create failed');
    } finally {
      setAddSaving(false);
    }
  };

  const fullName = detail
    ? `${detail.firstName ?? ''} ${detail.lastName ?? ''}`.trim() || detail.email
    : '';
  const statusMeta = detail ? AFFILIATE_STATUS_COLOR[detail.status] : undefined;
  const isPercent = form?.customerDiscountType === 'PERCENT';
  const isValueType = isPercent || form?.customerDiscountType === 'FIXED';

  return (
    <main style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <Link href="/dashboard/affiliates/applications" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>
        ← Affiliates
      </Link>

      {error && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 8, fontSize: 13, margin: '12px 0' }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#64748b' }}>Loading…</p>
      ) : !detail ? (
        <p style={{ color: '#64748b' }}>Affiliate not found.</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{fullName}</h1>
            {statusMeta && (
              <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: statusMeta.bg, color: statusMeta.fg }}>
                {detail.status.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
            {detail.email}
            {detail.phone ? ` · ${detail.phone}` : ''}
          </p>

          {/* Commission rate (Phase 159) */}
          <section style={{ marginTop: 20, border: '1px solid #eef2f7', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Commission rate</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>
                  {detail.commissionPercentage != null ? `${Number(detail.commissionPercentage)}%` : 'Platform default'}
                  {detail.commissionPercentage == null && (
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8', marginLeft: 6 }}>(no override)</span>
                  )}
                </div>
              </div>
              {canEditRate && (
                <button onClick={openRate} style={{ ...btn, background: '#0F1115', color: '#fff', borderColor: '#0F1115' }}>
                  Edit rate
                </button>
              )}
            </div>

            {detail.commissionRateHistory.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  Change history
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
                  {detail.commissionRateHistory.map((h) => (
                    <li key={h.id} style={{ fontSize: 12, color: '#475569', padding: '5px 0', borderTop: '1px solid #f1f5f9' }}>
                      <strong>{rateLabel(h.fromRate)} → {rateLabel(h.toRate)}</strong>
                      <span style={{ color: '#94a3b8' }}>
                        {' · '}{new Date(h.createdAt).toLocaleString('en-IN')}
                        {h.changedByAdminId ? ` · by ${h.changedByAdminId}` : ''}
                      </span>
                      {h.reason && <div style={{ color: '#64748b', marginTop: 2 }}>“{h.reason}”</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Coupon codes</h2>
            {canCreateCoupon && detail.status === 'ACTIVE' && (
              <button
                onClick={() => { setAddForm({ ...EMPTY_ADD_FORM }); setAddErr(''); }}
                style={{ ...btn, background: '#0F1115', color: '#fff', borderColor: '#0F1115' }}
              >
                + Add coupon
              </button>
            )}
          </div>
          {canCreateCoupon && detail.status !== 'ACTIVE' && (
            <p style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', padding: '6px 10px', borderRadius: 8 }}>
              Coupons can only be added to an ACTIVE affiliate.
            </p>
          )}
          {!canConfigure && (
            <p style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', padding: '6px 10px', borderRadius: 8 }}>
              You can view coupons but need the <code>affiliates.coupons.configure</code> permission to edit them.
            </p>
          )}

          {detail.couponCodes.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: 13 }}>No coupon codes yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '2px solid #eee' }}>
                  <th style={th}>Code</th>
                  <th style={th}>Customer discount</th>
                  <th style={th}>Usage</th>
                  <th style={th}>Window</th>
                  <th style={th}>Status</th>
                  <th style={{ ...th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {detail.couponCodes.map((c) => (
                  <tr key={c.id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={td}>
                      <strong style={{ fontFamily: 'monospace' }}>{c.code}</strong>
                      {c.isPrimary && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: '#2563eb', fontWeight: 700 }}>PRIMARY</span>
                      )}
                    </td>
                    <td style={td}>{discountSummary(c)}</td>
                    <td style={{ ...td, color: '#475569' }}>
                      {c.usedCount}
                      {c.maxUses != null ? ` / ${c.maxUses}` : ''}
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>{c.perUserLimit}/user</div>
                    </td>
                    <td style={{ ...td, fontSize: 11, color: '#64748b' }}>
                      {c.startsAt ? new Date(c.startsAt).toLocaleDateString('en-IN') : 'now'}
                      {' → '}
                      {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('en-IN') : 'no end'}
                    </td>
                    <td style={td}>
                      <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: c.isActive ? '#dcfce7' : '#f3f4f6', color: c.isActive ? '#166534' : '#6b7280' }}>
                        {c.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {canConfigure && (
                        <button onClick={() => openEdit(c)} style={btn}>Edit</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {editing && form && (
        <div style={backdrop} onClick={() => !saving && (setEditing(null), setForm(null))}>
          <div style={card} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
              Configure <span style={{ fontFamily: 'monospace' }}>{editing.code}</span>
            </h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '6px 0 14px' }}>
              Changes are recorded in the audit trail. A PERCENT cap protects against
              over-discounting large orders.
            </p>

            <label style={{ ...rowLabel, marginBottom: 12 }}>
              <input type="checkbox" checked={form.isActive} onChange={(e) => setField('isActive', e.target.checked)} />
              <span>Active (customers can redeem this code)</span>
            </label>

            <Field label="Discount type">
              <select
                value={form.customerDiscountType}
                onChange={(e) => setField('customerDiscountType', e.target.value as '' | CouponDiscountType)}
                style={input}
              >
                <option value="">Attribution only (no customer discount)</option>
                <option value="PERCENT">Percentage off</option>
                <option value="FIXED">Fixed amount off</option>
                <option value="FREE_SHIPPING">Free shipping</option>
              </select>
            </Field>

            {isValueType && (
              <Field label={isPercent ? 'Percentage (0–100)' : 'Amount off (₹)'}>
                <input
                  type="number"
                  min={0}
                  max={isPercent ? 100 : undefined}
                  step="0.01"
                  value={form.customerDiscountValue}
                  onChange={(e) => setField('customerDiscountValue', e.target.value)}
                  style={input}
                />
              </Field>
            )}

            {isPercent && (
              <Field label="Max discount cap (₹, optional)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="No cap"
                  value={form.maxDiscountAmount}
                  onChange={(e) => setField('maxDiscountAmount', e.target.value)}
                  style={input}
                />
              </Field>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Starts (optional)">
                <input type="datetime-local" value={form.startsAt} onChange={(e) => setField('startsAt', e.target.value)} style={input} />
              </Field>
              <Field label="Expires (optional)">
                <input type="datetime-local" value={form.expiresAt} onChange={(e) => setField('expiresAt', e.target.value)} style={input} />
              </Field>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Max uses (total)">
                <input type="number" min={0} step="1" placeholder="Unlimited" value={form.maxUses} onChange={(e) => setField('maxUses', e.target.value)} style={input} />
              </Field>
              <Field label="Per-user limit">
                <input type="number" min={1} step="1" value={form.perUserLimit} onChange={(e) => setField('perUserLimit', e.target.value)} style={input} />
              </Field>
              <Field label="Min order (₹)">
                <input type="number" min={0} step="0.01" placeholder="None" value={form.minOrderValue} onChange={(e) => setField('minOrderValue', e.target.value)} style={input} />
              </Field>
            </div>

            {modalErr && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 10 }}>{modalErr}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => { setEditing(null); setForm(null); }} disabled={saving} style={btn}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ ...btn, background: '#0F1115', color: '#fff', borderColor: '#0F1115' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rateOpen && detail && (
        <div style={backdrop} onClick={() => !rateSaving && setRateOpen(false)}>
          <div style={card} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Commission rate</h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '6px 0 14px' }}>
              Applies to future orders only — existing commissions keep their snapshotted rate.
              The change is recorded in the audit trail.
            </p>

            <label style={{ ...rowLabel, marginBottom: 8 }}>
              <input type="radio" checked={!rateClear} onChange={() => setRateClear(false)} />
              <span>Set a custom rate (%)</span>
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={rateInput}
              disabled={rateClear}
              onChange={(e) => setRateInput(e.target.value)}
              placeholder="e.g. 12.5"
              style={{ ...input, opacity: rateClear ? 0.5 : 1, marginBottom: 12 }}
            />
            <label style={{ ...rowLabel, marginBottom: 12 }}>
              <input type="radio" checked={rateClear} onChange={() => setRateClear(true)} />
              <span>Use platform default (clear override)</span>
            </label>

            <Field label="Reason (optional — recorded in audit)">
              <textarea
                value={rateReason}
                onChange={(e) => setRateReason(e.target.value)}
                rows={2}
                style={{ ...input, resize: 'vertical' }}
              />
            </Field>

            <div style={{ fontSize: 13, color: '#334155', background: '#f8fafc', borderRadius: 8, padding: '8px 10px' }}>
              {rateLabel(detail.commissionPercentage)} →{' '}
              <strong>
                {rateClear
                  ? 'platform default'
                  : rateInput.trim() === ''
                  ? '—'
                  : `${Number(rateInput)}%`}
              </strong>
            </div>

            {rateErr && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 10 }}>{rateErr}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setRateOpen(false)} disabled={rateSaving} style={btn}>Cancel</button>
              <button onClick={saveRate} disabled={rateSaving} style={{ ...btn, background: '#0F1115', color: '#fff', borderColor: '#0F1115' }}>
                {rateSaving ? 'Saving…' : 'Save rate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {addForm && detail && (
        <div style={backdrop} onClick={() => !addSaving && setAddForm(null)}>
          <div style={card} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Add coupon code</h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '6px 0 14px' }}>
              A new campaign code for {fullName}. Customers can redeem it just like the primary code.
            </p>

            <Field label="Code">
              <div style={{ display: 'flex', gap: 14, marginBottom: 6 }}>
                <label style={rowLabel}>
                  <input type="radio" checked={addForm.codeMode === 'auto'} onChange={() => setAddField('codeMode', 'auto')} />
                  <span>Auto-generate</span>
                </label>
                <label style={rowLabel}>
                  <input type="radio" checked={addForm.codeMode === 'manual'} onChange={() => setAddField('codeMode', 'manual')} />
                  <span>Enter manually</span>
                </label>
              </div>
              {addForm.codeMode === 'manual' && (
                <input
                  value={addForm.code}
                  onChange={(e) => setAddField('code', e.target.value.toUpperCase())}
                  placeholder="4–20 letters/numbers"
                  style={input}
                />
              )}
            </Field>

            <Field label="Discount type">
              <select
                value={addForm.customerDiscountType}
                onChange={(e) => setAddField('customerDiscountType', e.target.value as '' | CouponDiscountType)}
                style={input}
              >
                <option value="">Attribution only (no customer discount)</option>
                <option value="PERCENT">Percentage off</option>
                <option value="FIXED">Fixed amount off</option>
                <option value="FREE_SHIPPING">Free shipping</option>
              </select>
            </Field>

            {(addForm.customerDiscountType === 'PERCENT' || addForm.customerDiscountType === 'FIXED') && (
              <Field label={addForm.customerDiscountType === 'PERCENT' ? 'Percentage (0–100)' : 'Amount off (₹)'}>
                <input
                  type="number"
                  min={0}
                  max={addForm.customerDiscountType === 'PERCENT' ? 100 : undefined}
                  step="0.01"
                  value={addForm.customerDiscountValue}
                  onChange={(e) => setAddField('customerDiscountValue', e.target.value)}
                  style={input}
                />
              </Field>
            )}
            {addForm.customerDiscountType === 'PERCENT' && (
              <Field label="Max discount cap (₹, optional)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="No cap"
                  value={addForm.maxDiscountAmount}
                  onChange={(e) => setAddField('maxDiscountAmount', e.target.value)}
                  style={input}
                />
              </Field>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Starts (optional)">
                <input type="datetime-local" value={addForm.startsAt} onChange={(e) => setAddField('startsAt', e.target.value)} style={input} />
              </Field>
              <Field label="Expires (optional)">
                <input type="datetime-local" value={addForm.expiresAt} onChange={(e) => setAddField('expiresAt', e.target.value)} style={input} />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Max uses (total)">
                <input type="number" min={0} step="1" placeholder="Unlimited" value={addForm.maxUses} onChange={(e) => setAddField('maxUses', e.target.value)} style={input} />
              </Field>
              <Field label="Per-user limit">
                <input type="number" min={1} step="1" value={addForm.perUserLimit} onChange={(e) => setAddField('perUserLimit', e.target.value)} style={input} />
              </Field>
              <Field label="Min order (₹)">
                <input type="number" min={0} step="0.01" placeholder="None" value={addForm.minOrderValue} onChange={(e) => setAddField('minOrderValue', e.target.value)} style={input} />
              </Field>
            </div>

            <label style={{ ...rowLabel, marginTop: 4 }}>
              <input type="checkbox" checked={addForm.isPrimary} onChange={(e) => setAddField('isPrimary', e.target.checked)} />
              <span>Make this the primary code (demotes the current primary)</span>
            </label>

            {addErr && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 10 }}>{addErr}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setAddForm(null)} disabled={addSaving} style={btn}>Cancel</button>
              <button onClick={saveAdd} disabled={addSaving} style={{ ...btn, background: '#0F1115', color: '#fff', borderColor: '#0F1115' }}>
                {addSaving ? 'Creating…' : 'Create coupon'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// null fromRate/toRate means "platform default" (override absent/cleared).
function rateLabel(v?: string | number | null): string {
  return v == null ? 'default' : `${Number(v)}%`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', flex: 1, marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 12, color: '#475569', fontWeight: 600, marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px', verticalAlign: 'top' };
const rowLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer' };
const btn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#475569',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};
const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,17,21,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
  padding: 16,
};
const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: 14,
  padding: 22,
  width: '100%',
  maxWidth: 520,
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
};
const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  fontSize: 13,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};
