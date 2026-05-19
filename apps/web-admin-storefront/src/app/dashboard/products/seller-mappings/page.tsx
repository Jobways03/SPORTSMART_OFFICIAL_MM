'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminSellerMappingsService,
  SellerMapping,
  MappingApprovalStatus,
  MappingDisplayStatus,
} from '@/services/admin-seller-mappings.service';
import { ApiError } from '@/lib/api-client';

const DISPLAY_COLOR: Record<MappingDisplayStatus, { bg: string; fg: string }> = {
  ACTIVE: { bg: '#dcfce7', fg: '#166534' },
  PENDING_APPROVAL: { bg: '#fef3c7', fg: '#92400e' },
  INACTIVE: { bg: '#f1f5f9', fg: '#475569' },
  LOW_STOCK: { bg: '#fed7aa', fg: '#9a3412' },
  OUT_OF_STOCK: { bg: '#fee2e2', fg: '#991b1b' },
};

export default function SellerMappingsPage() {
  const [items, setItems] = useState<SellerMapping[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  const [search, setSearch] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<MappingApprovalStatus | ''>(
    '',
  );
  const [activeFilter, setActiveFilter] = useState<'true' | 'false' | ''>('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SellerMapping | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminSellerMappingsService.list({
        page,
        limit,
        search: search.trim() || undefined,
        sellerId: sellerFilter.trim() || undefined,
        productId: productFilter.trim() || undefined,
        approvalStatus: statusFilter || undefined,
        isActive: activeFilter || undefined,
      });
      setItems(res.data?.mappings ?? []);
      setTotal(res.data?.pagination.total ?? 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, search, sellerFilter, productFilter, statusFilter, activeFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    setPage(1);
  }, [search, sellerFilter, productFilter, statusFilter, activeFilter]);

  const handleApprove = async (mappingId: string) => {
    setActionBusy(mappingId);
    try {
      await adminSellerMappingsService.approve(mappingId);
      await fetchItems();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approve failed');
    } finally {
      setActionBusy(null);
    }
  };

  const handleStop = async (mappingId: string) => {
    if (!window.confirm('Stop this seller mapping? It will be deactivated.')) {
      return;
    }
    setActionBusy(mappingId);
    try {
      await adminSellerMappingsService.stop(mappingId);
      await fetchItems();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Stop failed');
    } finally {
      setActionBusy(null);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400 }}>
      <Link
        href="/dashboard/products"
        style={{
          color: '#525A65',
          fontSize: 13,
          textDecoration: 'none',
          display: 'inline-block',
          marginBottom: 8,
        }}
      >
        ← Back to products
      </Link>

      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#0f172a' }}>
          Seller mappings
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>
          Every seller-product mapping across the catalog. Edit stock, SLA,
          priority, or pricing without leaving this page.
        </p>
      </header>

      {/* Filters */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
          gap: 10,
          padding: 12,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          marginBottom: 14,
        }}
      >
        <input
          type="search"
          placeholder="Search by seller name, product, SKU"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={inp}
        />
        <input
          type="text"
          placeholder="Seller ID"
          value={sellerFilter}
          onChange={(e) => setSellerFilter(e.target.value)}
          style={{ ...inp, fontFamily: 'ui-monospace, monospace' }}
        />
        <input
          type="text"
          placeholder="Product ID"
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
          style={{ ...inp, fontFamily: 'ui-monospace, monospace' }}
        />
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as MappingApprovalStatus | '')
          }
          style={inp}
        >
          <option value="">Any approval status</option>
          <option value="PENDING_APPROVAL">Pending approval</option>
          <option value="APPROVED">Approved</option>
          <option value="STOPPED">Stopped</option>
        </select>
        <select
          value={activeFilter}
          onChange={(e) =>
            setActiveFilter(e.target.value as 'true' | 'false' | '')
          }
          style={inp}
        >
          <option value="">Any active state</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
      </div>

      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        {loading ? 'Loading…' : `${total} mapping${total === 1 ? '' : 's'}`}
      </div>

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

      <section
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
              <th style={th}>Seller</th>
              <th style={th}>Product / Variant</th>
              <th style={{ ...th, textAlign: 'right' }}>Stock</th>
              <th style={{ ...th, textAlign: 'right' }}>SLA (d)</th>
              <th style={{ ...th, textAlign: 'right' }}>Priority</th>
              <th style={{ ...th, textAlign: 'right' }}>Settle ₹</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
                  No mappings match these filters.
                </td>
              </tr>
            )}
            {items.map((m) => {
              const c = DISPLAY_COLOR[m.mappingDisplayStatus];
              return (
                <tr key={m.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>
                      {m.seller?.sellerShopName || m.seller?.sellerName || '—'}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>
                      {m.sellerId.slice(0, 8)}…
                    </div>
                  </td>
                  <td style={td}>
                    <Link
                      href={`/dashboard/products/${m.productId}/edit`}
                      style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: 600 }}
                    >
                      {m.product?.title || m.productId}
                    </Link>
                    {m.variant && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        {m.variant.title || m.variant.sku || m.variantId}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                    {m.availableQty}/{m.stockQty}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: '#64748b' }}>{m.dispatchSla}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#64748b' }}>
                    {m.operationalPriority}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                    {m.settlementPrice != null
                      ? Number(m.settlementPrice).toFixed(2)
                      : '—'}
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        padding: '2px 10px',
                        borderRadius: 9999,
                        fontSize: 11,
                        fontWeight: 700,
                        background: c.bg,
                        color: c.fg,
                      }}
                    >
                      {m.mappingDisplayStatus.replace('_', ' ').toLowerCase()}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => setEditing(m)}
                      style={actionBtn}
                    >
                      Edit
                    </button>
                    {m.approvalStatus === 'PENDING_APPROVAL' && (
                      <button
                        type="button"
                        onClick={() => handleApprove(m.id)}
                        disabled={actionBusy === m.id}
                        style={{
                          ...actionBtn,
                          marginLeft: 6,
                          background: '#16a34a',
                          color: '#fff',
                          borderColor: '#16a34a',
                        }}
                      >
                        Approve
                      </button>
                    )}
                    {m.approvalStatus === 'APPROVED' && m.isActive && (
                      <button
                        type="button"
                        onClick={() => handleStop(m.id)}
                        disabled={actionBusy === m.id}
                        style={{
                          ...actionBtn,
                          marginLeft: 6,
                          borderColor: '#fecaca',
                          color: '#991b1b',
                        }}
                      >
                        Stop
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {pageCount > 1 && (
          <footer
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderTop: '1px solid #f1f5f9',
              background: '#fafafa',
            }}
          >
            <span style={{ fontSize: 12, color: '#64748b' }}>
              Page {page} of {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              style={pagerBtn}
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || loading}
              style={pagerBtn}
            >
              Next →
            </button>
          </footer>
        )}
      </section>

      {editing && (
        <EditMappingModal
          mapping={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            fetchItems();
          }}
        />
      )}
    </div>
  );
}

function EditMappingModal({
  mapping,
  onClose,
  onSaved,
}: {
  mapping: SellerMapping;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [stockQty, setStockQty] = useState(String(mapping.stockQty));
  const [dispatchSla, setDispatchSla] = useState(String(mapping.dispatchSla));
  const [operationalPriority, setOperationalPriority] = useState(
    String(mapping.operationalPriority),
  );
  const [lowStockThreshold, setLowStockThreshold] = useState(
    String(mapping.lowStockThreshold),
  );
  const [settlementPrice, setSettlementPrice] = useState(
    mapping.settlementPrice == null ? '' : String(mapping.settlementPrice),
  );
  const [procurementCost, setProcurementCost] = useState(
    mapping.procurementCost == null ? '' : String(mapping.procurementCost),
  );
  const [pickupPincode, setPickupPincode] = useState(mapping.pickupPincode ?? '');
  const [pickupAddress, setPickupAddress] = useState(mapping.pickupAddress ?? '');
  const [sellerInternalSku, setSellerInternalSku] = useState(
    mapping.sellerInternalSku ?? '',
  );
  const [isActive, setIsActive] = useState(mapping.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminSellerMappingsService.update(mapping.id, {
        stockQty: Number(stockQty),
        dispatchSla: Number(dispatchSla),
        operationalPriority: Number(operationalPriority),
        lowStockThreshold: Number(lowStockThreshold),
        settlementPrice: settlementPrice === '' ? null : Number(settlementPrice),
        procurementCost: procurementCost === '' ? null : Number(procurementCost),
        pickupPincode: pickupPincode || null,
        pickupAddress: pickupAddress || null,
        sellerInternalSku: sellerInternalSku || null,
        isActive,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={() => !busy && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,17,21,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 16,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
          Edit mapping
        </h2>
        <p style={{ margin: '6px 0 16px', fontSize: 12, color: '#64748b' }}>
          {mapping.seller?.sellerShopName || mapping.sellerId} ·{' '}
          {mapping.product?.title || mapping.productId}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Stock qty">
            <input type="number" min={0} value={stockQty} onChange={(e) => setStockQty(e.target.value)} style={inp} />
          </Field>
          <Field label="Low-stock threshold">
            <input type="number" min={0} value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} style={inp} />
          </Field>
          <Field label="Dispatch SLA (days)">
            <input type="number" min={0} value={dispatchSla} onChange={(e) => setDispatchSla(e.target.value)} style={inp} />
          </Field>
          <Field label="Operational priority">
            <input type="number" value={operationalPriority} onChange={(e) => setOperationalPriority(e.target.value)} style={inp} />
          </Field>
          <Field label="Settlement price">
            <input type="number" step="0.01" value={settlementPrice} onChange={(e) => setSettlementPrice(e.target.value)} placeholder="—" style={inp} />
          </Field>
          <Field label="Procurement cost">
            <input type="number" step="0.01" value={procurementCost} onChange={(e) => setProcurementCost(e.target.value)} placeholder="—" style={inp} />
          </Field>
          <Field label="Pickup pincode">
            <input type="text" value={pickupPincode} onChange={(e) => setPickupPincode(e.target.value)} style={inp} />
          </Field>
          <Field label="Seller internal SKU">
            <input type="text" value={sellerInternalSku} onChange={(e) => setSellerInternalSku(e.target.value)} style={inp} />
          </Field>
        </div>
        <Field label="Pickup address">
          <textarea
            value={pickupAddress}
            onChange={(e) => setPickupAddress(e.target.value)}
            rows={2}
            style={{ ...inp, resize: 'vertical' }}
          />
        </Field>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 12,
            fontSize: 13,
            color: '#0f172a',
          }}
        >
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active (uncheck to hide from allocation)
        </label>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              height: 36,
              padding: '0 16px',
              border: '1px solid #D2D6DC',
              background: '#fff',
              color: '#0F1115',
              borderRadius: 9999,
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            style={{
              height: 36,
              padding: '0 16px',
              border: 'none',
              background: '#0F1115',
              color: '#fff',
              borderRadius: 9999,
              fontWeight: 700,
              fontSize: 13,
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block', marginTop: 8 }}>
      <span
        style={{
          display: 'block',
          fontSize: 11,
          color: '#525A65',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      {children}
    </label>
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
};

const inp: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #D2D6DC',
  borderRadius: 8,
  fontSize: 13,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const actionBtn: React.CSSProperties = {
  height: 28,
  padding: '0 10px',
  border: '1px solid #D2D6DC',
  background: '#fff',
  color: '#0F1115',
  borderRadius: 9999,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const pagerBtn: React.CSSProperties = {
  height: 28,
  padding: '0 10px',
  border: '1px solid #d1d5db',
  background: '#fff',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
};
