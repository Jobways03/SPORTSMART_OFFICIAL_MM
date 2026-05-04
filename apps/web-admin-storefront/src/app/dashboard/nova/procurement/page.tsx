'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NovaTabs } from '../components/nova-tabs';
import {
  adminNovaService,
  ProcurementOrder,
  OwnBrandWarehouse,
  OwnBrandProcurementStatus,
  PROCUREMENT_STATUS_COLOR,
  inr,
} from '@/services/admin-nova.service';
import { ApiError } from '@/lib/api-client';

const PAGE_SIZE = 20;
const STATUSES: Array<{ value: OwnBrandProcurementStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PLACED', label: 'Placed' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export default function NovaProcurementListPage() {
  const router = useRouter();
  const [pos, setPos] = useState<ProcurementOrder[]>([]);
  const [warehouses, setWarehouses] = useState<OwnBrandWarehouse[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<OwnBrandProcurementStatus | ''>('');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [poRes, whRes] = await Promise.all([
        adminNovaService.listProcurement({
          page, limit: PAGE_SIZE,
          warehouseId: warehouseFilter || undefined,
          status: statusFilter || undefined,
        }),
        warehouses.length === 0 ? adminNovaService.listWarehouses() : Promise.resolve({ data: warehouses } as any),
      ]);
      if (poRes.data) {
        setPos(poRes.data.items);
        setTotal(poRes.data.total);
      }
      if (whRes.data) setWarehouses(whRes.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
    } finally {
      setLoading(false);
    }
  }, [page, warehouseFilter, statusFilter, warehouses, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.code ?? '—';

  return (
    <div style={{ padding: '24px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>NOVA</h1>
      <p style={{ marginTop: 4, marginBottom: 16, fontSize: 14, color: '#525A65' }}>
        Sportsmart's own-brand warehouses, products, stocks, and procurement.
      </p>
      <NovaTabs />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0, color: '#0F1115' }}>Procurement orders</h2>
        <Link href="/dashboard/nova/procurement/new" style={{ ...primaryBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
          + New PO
        </Link>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <select value={warehouseFilter} onChange={(e) => { setWarehouseFilter(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All warehouses</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as any); setPage(1); }} style={selectStyle}>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
              <th style={th}>PO #</th><th style={th}>Warehouse</th><th style={th}>Supplier</th>
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
              <th style={th}>Status</th><th style={th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && pos.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>Loading…</td></tr>
            ) : pos.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#7A828F', padding: 32 }}>
                No procurement orders match these filters.
              </td></tr>
            ) : (
              pos.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }} onClick={() => router.push(`/dashboard/nova/procurement/${p.id}`)}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#525A65' }}>{p.poNumber}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#525A65' }}>{warehouseName(p.warehouseId)}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#0F1115' }}>{p.supplierName}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{inr(p.totalAmount)}</td>
                  <td style={td}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px',
                      borderRadius: 9999, background: PROCUREMENT_STATUS_COLOR[p.status] + '22',
                      color: PROCUREMENT_STATUS_COLOR[p.status],
                      fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>
                      {p.status}
                    </span>
                  </td>
                  <td style={{ ...td, color: '#525A65', whiteSpace: 'nowrap' }}>
                    {new Date(p.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={pgBtn(page <= 1)}>‹ Prev</button>
          <span style={{ fontSize: 14, color: '#525A65', padding: '0 8px' }}>{page} / {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={pgBtn(page >= totalPages)}>Next ›</button>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#525A65' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: 14 };
const selectStyle: React.CSSProperties = { height: 40, padding: '0 14px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 14, outline: 'none' };
const primaryBtn: React.CSSProperties = { height: 40, padding: '0 20px', background: '#0F1115', color: '#fff', border: 'none', borderRadius: 9999, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const pgBtn = (disabled: boolean): React.CSSProperties => ({
  height: 36, padding: '0 14px', border: '1px solid #D2D6DC', background: '#fff',
  borderRadius: 9999, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
});
