'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  adminFranchisesService,
  FranchiseInventoryItem,
} from '@/services/admin-franchises.service';

type StockStatus = 'OUT' | 'LOW' | 'OK';

function stockStatus(item: FranchiseInventoryItem): StockStatus {
  if (item.availableQty <= 0) return 'OUT';
  if (item.availableQty <= item.lowStockThreshold) return 'LOW';
  return 'OK';
}

export default function FranchiseInventoryPage() {
  const [franchises, setFranchises] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [inventory, setInventory] = useState<FranchiseInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [invLoading, setInvLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    adminFranchisesService
      .listFranchises({ limit: 100 })
      .then((res) => {
        setFranchises(res.data?.franchises || []);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load franchises.');
        setLoading(false);
      });
  }, []);

  const loadInventory = async (id: string) => {
    setSelected(id);
    setInvLoading(true);
    setError(null);
    setSearch('');
    try {
      // `limit: 200` pulls the franchise's full catalogue in one shot so the
      // KPIs + search reflect every SKU (franchise inventories are modest).
      const res = await adminFranchisesService.getInventory(id, { limit: 200 });
      setInventory(res.data?.stocks ?? []);
    } catch {
      setInventory([]);
      setError('Could not load inventory for this franchise.');
    } finally {
      setInvLoading(false);
    }
  };

  const selectedFranchise = franchises.find((f) => f.id === selected);
  const selectedName =
    selectedFranchise?.businessName || selectedFranchise?.ownerName || '';

  const kpis = useMemo(() => {
    let ok = 0;
    let low = 0;
    let out = 0;
    let units = 0;
    for (const it of inventory) {
      units += it.onHandQty ?? 0;
      const s = stockStatus(it);
      if (s === 'OUT') out += 1;
      else if (s === 'LOW') low += 1;
      else ok += 1;
    }
    return { total: inventory.length, ok, low, out, units };
  }, [inventory]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inventory;
    return inventory.filter((it) => {
      const hay = [
        it.product?.title,
        it.product?.productCode,
        it.product?.baseSku,
        it.franchiseSku,
        it.globalSku,
        it.variant?.title,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [inventory, search]);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4, color: '#0f172a' }}>
        Franchise Inventory
      </h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        View stock levels across franchise locations.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, alignItems: 'start' }}>
        {/* ── Franchise selector ─────────────────────────────────────── */}
        <div style={card}>
          <div style={cardHeader}>
            <span style={cardHeaderLabel}>Select Franchise</span>
            {!loading && (
              <span style={pill}>{franchises.length}</span>
            )}
          </div>
          <div style={{ padding: 8 }}>
            {loading ? (
              <p style={{ color: '#9ca3af', fontSize: 13, padding: 8 }}>Loading…</p>
            ) : franchises.length === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: 13, padding: 8 }}>No franchises found.</p>
            ) : (
              franchises.map((f) => {
                const active = selected === f.id;
                const primary = f.businessName || f.ownerName || 'Unnamed';
                const sub = f.businessName && f.ownerName && f.ownerName !== f.businessName ? f.ownerName : null;
                return (
                  <button
                    key={f.id}
                    onClick={() => loadInventory(f.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '9px 12px',
                      border: '1px solid',
                      borderColor: active ? '#bfdbfe' : 'transparent',
                      borderRadius: 8,
                      marginBottom: 4,
                      cursor: 'pointer',
                      background: active ? '#eff6ff' : 'transparent',
                      transition: 'background 120ms',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: active ? '#1d4ed8' : '#111827' }}>
                      {primary}
                    </div>
                    {sub && (
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{sub}</div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Inventory panel ────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!selected ? (
            <div style={{ ...card, ...emptyWrap }}>
              <EmptyState
                title="Select a franchise"
                subtitle="Pick a location on the left to view its stock levels."
              />
            </div>
          ) : invLoading ? (
            <div style={{ ...card, ...emptyWrap }}>
              <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading inventory…</p>
            </div>
          ) : error ? (
            <div style={{ ...card, ...emptyWrap }}>
              <EmptyState title="Couldn’t load inventory" subtitle={error} tone="error" />
            </div>
          ) : inventory.length === 0 ? (
            <div style={{ ...card, ...emptyWrap }}>
              <EmptyState
                title="No inventory records"
                subtitle={`${selectedName || 'This franchise'} has no stock on file yet.`}
              />
            </div>
          ) : (
            <>
              {/* KPI cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                <StatCard label="Total SKUs" value={kpis.total} />
                <StatCard label="In stock" value={kpis.ok} color="#15803d" />
                <StatCard label="Low stock" value={kpis.low} color="#b45309" />
                <StatCard label="Out of stock" value={kpis.out} color="#b91c1c" />
                <StatCard label="Units on hand" value={kpis.units} />
              </div>

              {/* Table card */}
              <div style={card}>
                <div style={{ ...cardHeader, gap: 12 }}>
                  <span style={cardHeaderLabel}>
                    {selectedName} · {filtered.length}
                    {filtered.length !== inventory.length ? ` of ${inventory.length}` : ''} SKU
                    {inventory.length === 1 ? '' : 's'}
                  </span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search product or SKU…"
                    style={searchInput}
                  />
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f9fafb' }}>
                        <th style={th}>Product</th>
                        <th style={th}>SKU</th>
                        <th style={thNum}>On hand</th>
                        <th style={thNum}>Reserved</th>
                        <th style={thNum}>Available</th>
                        <th style={thNum}>Damaged</th>
                        <th style={th}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>
                            No SKUs match “{search}”.
                          </td>
                        </tr>
                      ) : (
                        filtered.map((item) => {
                          const status = stockStatus(item);
                          const title = item.product?.title || item.globalSku || '—';
                          const variant = item.variant?.title;
                          const code = item.product?.productCode;
                          return (
                            <tr key={item.id} style={{ borderTop: '1px solid #f1f3f5' }}>
                              <td style={td}>
                                <div style={{ fontWeight: 600, color: '#111827' }}>
                                  {title}
                                  {variant && (
                                    <span style={{ color: '#6b7280', fontWeight: 400 }}> — {variant}</span>
                                  )}
                                </div>
                                {code && (
                                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{code}</div>
                                )}
                              </td>
                              <td style={{ ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#374151' }}>
                                {item.franchiseSku || item.globalSku || '—'}
                              </td>
                              <td style={tdNum}>{item.onHandQty}</td>
                              <td style={{ ...tdNum, color: item.reservedQty > 0 ? '#b45309' : '#6b7280' }}>
                                {item.reservedQty}
                              </td>
                              <td style={{ ...tdNum, fontWeight: 700, color: availableColor(status) }}>
                                {item.availableQty}
                              </td>
                              <td style={{ ...tdNum, color: item.damagedQty > 0 ? '#b91c1c' : '#9ca3af' }}>
                                {item.damagedQty}
                              </td>
                              <td style={td}>
                                <StatusBadge status={status} />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Small presentational helpers ─────────────────────────────────── */

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ ...card, padding: '14px 16px' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#0f172a' }}>
        {value.toLocaleString('en-IN')}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: StockStatus }) {
  const map: Record<StockStatus, { label: string; bg: string; fg: string }> = {
    OK: { label: 'In stock', bg: '#dcfce7', fg: '#15803d' },
    LOW: { label: 'Low', bg: '#fef3c7', fg: '#b45309' },
    OUT: { label: 'Out of stock', bg: '#fee2e2', fg: '#b91c1c' },
  };
  const s = map[status];
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

function EmptyState({ title, subtitle, tone = 'muted' }: { title: string; subtitle: string; tone?: 'muted' | 'error' }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: tone === 'error' ? '#b91c1c' : '#374151' }}>{title}</div>
      <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>{subtitle}</div>
    </div>
  );
}

function availableColor(status: StockStatus): string {
  if (status === 'OUT') return '#b91c1c';
  if (status === 'LOW') return '#b45309';
  return '#15803d';
}

/* ── Styles ───────────────────────────────────────────────────────── */

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  overflow: 'hidden',
};
const cardHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid #f1f3f5',
  background: '#fff',
};
const cardHeaderLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const pill: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#475569',
  background: '#f1f5f9',
  borderRadius: 999,
  padding: '1px 8px',
};
const emptyWrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 220,
  padding: 32,
};
const searchInput: React.CSSProperties = {
  height: 32,
  width: 240,
  maxWidth: '50%',
  padding: '0 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 8,
  background: '#fff',
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};
const thNum: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '11px 14px', color: '#111827', verticalAlign: 'top' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
