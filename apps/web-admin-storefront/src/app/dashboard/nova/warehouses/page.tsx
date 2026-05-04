'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { NovaTabs } from '../components/nova-tabs';
import {
  adminNovaService,
  OwnBrandWarehouse,
} from '@/services/admin-nova.service';
import { ApiError } from '@/lib/api-client';

interface WarehouseForm {
  code: string;
  name: string;
  pincode: string;
  addressLine: string;
  city: string;
  state: string;
}

const EMPTY: WarehouseForm = {
  code: '',
  name: '',
  pincode: '',
  addressLine: '',
  city: '',
  state: '',
};

export default function NovaWarehousesPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<OwnBrandWarehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<WarehouseForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminNovaService.listWarehouses();
      if (res.data) setWarehouses(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.code.trim() || !form.name.trim()) return setError('Code and name are required');
    if (!/^\d{6}$/.test(form.pincode)) return setError('Pincode must be 6 digits');
    setSaving(true);
    try {
      await adminNovaService.createWarehouse(form);
      setModalOpen(false);
      setForm(EMPTY);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create warehouse');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (w: OwnBrandWarehouse) => {
    try {
      await adminNovaService.updateWarehouse(w.id, { isActive: !w.isActive });
      fetchData();
    } catch {}
  };

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>NOVA</h1>
      <p style={{ marginTop: 4, marginBottom: 16, fontSize: 14, color: '#525A65' }}>
        Sportsmart's own-brand warehouses, products, stocks, and procurement.
      </p>

      <NovaTabs />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0, color: '#0F1115' }}>Warehouses</h2>
        <button type="button" onClick={() => setModalOpen(true)} style={primaryBtn}>+ New warehouse</button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              <th style={th}>Code</th><th style={th}>Name</th><th style={th}>Location</th>
              <th style={th}>Pincode</th><th style={th}>Status</th><th style={{ ...th, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>Loading…</td></tr>
            ) : warehouses.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>
                No warehouses yet. Create one to start receiving stock.
              </td></tr>
            ) : (
              warehouses.map((w) => (
                <tr key={w.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#525A65' }}>{w.code}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#0F1115' }}>{w.name}</td>
                  <td style={{ ...td, color: '#525A65' }}>{w.city}, {w.state}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', color: '#525A65' }}>{w.pincode}</td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px',
                      borderRadius: 9999, background: w.isActive ? '#dcfce7' : '#F3F4F6',
                      color: w.isActive ? '#15803d' : '#7A828F',
                      fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>
                      {w.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button type="button" onClick={() => toggleActive(w)} style={linkBtn}>
                      {w.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal onClose={() => setModalOpen(false)} title="New warehouse">
          <form onSubmit={submit}>
            <Field label="Code">
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="NV-WH-MUM-01" disabled={saving} style={input} />
            </Field>
            <Field label="Name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mumbai Central Hub" disabled={saving} style={input} />
            </Field>
            <Field label="Address line">
              <input value={form.addressLine} onChange={(e) => setForm({ ...form, addressLine: e.target.value })} placeholder="123 Industrial Estate" disabled={saving} style={input} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="City">
                <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} disabled={saving} style={input} />
              </Field>
              <Field label="State">
                <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} disabled={saving} style={input} />
              </Field>
              <Field label="Pincode">
                <input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} disabled={saving} style={input} />
              </Field>
            </div>
            {error && <div style={alertBox}>{error}</div>}
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setModalOpen(false)} disabled={saving} style={secondaryBtn}>Cancel</button>
              <button type="submit" disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.5 : 1 }}>
                {saving ? 'Creating…' : 'Create warehouse'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,17,21,0.45)', display: 'grid', placeItems: 'center', zIndex: 50 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 540, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, marginBottom: 16, color: '#0F1115' }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#525A65', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#525A65' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: 14 };
const input: React.CSSProperties = { width: '100%', height: 40, padding: '0 12px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 14, outline: 'none', boxSizing: 'border-box' };
const primaryBtn: React.CSSProperties = { height: 40, padding: '0 20px', background: '#0F1115', color: '#fff', border: 'none', borderRadius: 9999, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { height: 40, padding: '0 16px', background: '#fff', color: '#0F1115', border: '1px solid #D2D6DC', borderRadius: 9999, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { color: '#2A8595', fontWeight: 600, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', padding: 0 };
const alertBox: React.CSSProperties = { marginTop: 8, padding: 10, border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', borderRadius: 12, fontSize: 13 };
