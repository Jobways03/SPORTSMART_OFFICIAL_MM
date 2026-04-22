'use client';

import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react';
import {
  franchiseInventoryService,
  StockItem,
  LedgerEntry,
  AdjustStockPayload,
} from '@/services/inventory.service';
import { useModal } from '@sportsmart/ui';
import { ApiError } from '@/lib/api-client';

type TabKey = 'stock' | 'low-stock' | 'ledger';

const MOVEMENT_COLORS: Record<string, string> = {
  PROCUREMENT_IN: '#16a34a',
  ORDER_RETURN: '#16a34a',
  POS_RETURN: '#16a34a',
  ORDER_RESERVE: '#d97706',
  ORDER_UNRESERVE: '#0891b2',
  ORDER_SHIP: '#dc2626',
  ORDER_CANCEL: '#0891b2',
  POS_SALE: '#dc2626',
  DAMAGE: '#92400e',
  LOSS: '#991b1b',
  ADJUSTMENT: '#6b7280',
  AUDIT_CORRECTION: '#6b7280',
};

const MOVEMENT_TYPES = [
  'PROCUREMENT_IN',
  'ORDER_RESERVE',
  'ORDER_UNRESERVE',
  'ORDER_SHIP',
  'ORDER_RETURN',
  'ORDER_CANCEL',
  'POS_SALE',
  'POS_RETURN',
  'DAMAGE',
  'LOSS',
  'ADJUSTMENT',
  'AUDIT_CORRECTION',
];

const ADJUSTMENT_TYPE_OPTIONS: Array<{
  value: AdjustStockPayload['adjustmentType'];
  label: string;
  hint: string;
}> = [
  { value: 'DAMAGE', label: 'Damage', hint: 'Adds to damagedQty' },
  { value: 'LOSS', label: 'Loss', hint: 'Removes from on-hand permanently' },
  { value: 'ADJUSTMENT', label: 'Adjustment', hint: 'Generic correction' },
  { value: 'AUDIT_CORRECTION', label: 'Audit Correction', hint: 'For stock count audits' },
];

const PAGE_LIMIT = 20;

function formatQty(qty: number): string {
  return Number(qty || 0).toLocaleString('en-IN');
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function getPrimaryImage(item: StockItem): string | null {
  const images = item.product?.images || [];
  if (images.length === 0) return null;
  const primary = images.find((img) => img.isPrimary);
  return (primary || images[0]).url || null;
}

function getProductLabel(item: StockItem): string {
  const title = item.product?.title || 'Unknown Product';
  const variantTitle = item.variant?.title;
  return variantTitle ? `${title} — ${variantTitle}` : title;
}

function handleError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.body.errors && err.body.errors.length > 0) {
      return err.body.errors.map((e) => `${e.field}: ${e.message}`).join(', ');
    }
    return err.body.message || fallback;
  }
  return fallback;
}

export default function InventoryPage() {
  const { notify, confirmDialog } = useModal();
const [activeTab, setActiveTab] = useState<TabKey>('stock');

  // Stock tab state
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [stockTotal, setStockTotal] = useState(0);
  const [stockPage, setStockPage] = useState(1);
  const [stockTotalPages, setStockTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  // Low stock tab
  const [lowStockItems, setLowStockItems] = useState<StockItem[]>([]);
  const [lowStockLoading, setLowStockLoading] = useState(false);

  // Ledger tab
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotalPages, setLedgerTotalPages] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerProductId, setLedgerProductId] = useState('');
  const [ledgerMovementType, setLedgerMovementType] = useState('');
  const [ledgerFromDate, setLedgerFromDate] = useState('');
  const [ledgerToDate, setLedgerToDate] = useState('');

  // Adjust modal
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<StockItem | null>(null);
  const [adjustForm, setAdjustForm] = useState<{
    productId: string;
    variantId: string;
    adjustmentType: AdjustStockPayload['adjustmentType'];
    quantity: string;
    reason: string;
  }>({
    productId: '',
    variantId: '',
    adjustmentType: 'ADJUSTMENT',
    quantity: '',
    reason: '',
  });
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Load stock list
  const loadStocks = useCallback(async () => {
    setStockLoading(true);
    try {
      const res = await franchiseInventoryService.listStock({
        page: stockPage,
        limit: PAGE_LIMIT,
        search: search || undefined,
        lowStockOnly,
      });
      if (res.data) {
        setStocks(res.data.stocks || []);
        setStockTotal(res.data.total || 0);
        setStockTotalPages(res.data.totalPages || 1);
      }
    } catch (err) {
      void notify(handleError(err, 'Failed to load inventory'));
    } finally {
      setStockLoading(false);
    }
  }, [stockPage, search, lowStockOnly]);

  // Load low stock
  const loadLowStock = useCallback(async () => {
    setLowStockLoading(true);
    try {
      const res = await franchiseInventoryService.getLowStock();
      if (res.data) {
        setLowStockItems(res.data || []);
      }
    } catch (err) {
      void notify(handleError(err, 'Failed to load low stock alerts'));
    } finally {
      setLowStockLoading(false);
    }
  }, []);

  // Load ledger
  const loadLedger = useCallback(async () => {
    setLedgerLoading(true);
    try {
      const res = await franchiseInventoryService.getLedger({
        page: ledgerPage,
        limit: PAGE_LIMIT,
        productId: ledgerProductId || undefined,
        movementType: ledgerMovementType || undefined,
        fromDate: ledgerFromDate || undefined,
        toDate: ledgerToDate || undefined,
      });
      if (res.data) {
        setLedger(res.data.entries || []);
        setLedgerTotal(res.data.total || 0);
        setLedgerTotalPages(res.data.totalPages || 1);
      }
    } catch (err) {
      void notify(handleError(err, 'Failed to load ledger'));
    } finally {
      setLedgerLoading(false);
    }
  }, [ledgerPage, ledgerProductId, ledgerMovementType, ledgerFromDate, ledgerToDate]);

  useEffect(() => {
    loadStocks();
  }, [loadStocks]);

  useEffect(() => {
    if (activeTab === 'low-stock') {
      loadLowStock();
    }
  }, [activeTab, loadLowStock]);

  useEffect(() => {
    if (activeTab === 'ledger') {
      loadLedger();
    }
  }, [activeTab, loadLedger]);

  // KPI calculations
  const kpis = useMemo(() => {
    const totalSkus = stockTotal;
    const lowStockCount = stocks.filter(
      (s) => s.availableQty <= s.lowStockThreshold && s.availableQty > 0,
    ).length;
    const outOfStockCount = stocks.filter((s) => s.availableQty <= 0).length;
    const totalOnHand = stocks.reduce((sum, s) => sum + (s.onHandQty || 0), 0);
    return { totalSkus, lowStockCount, outOfStockCount, totalOnHand };
  }, [stocks, stockTotal]);

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setStockPage(1);
    setSearch(searchInput.trim());
  };

  const openAdjustModal = (item?: StockItem) => {
    setSuccessMessage('');
    if (item) {
      setAdjustTarget(item);
      setAdjustForm({
        productId: item.productId,
        variantId: item.variantId || '',
        adjustmentType: 'ADJUSTMENT',
        quantity: '',
        reason: '',
      });
    } else {
      setAdjustTarget(null);
      setAdjustForm({
        productId: '',
        variantId: '',
        adjustmentType: 'ADJUSTMENT',
        quantity: '',
        reason: '',
      });
    }
    setAdjustOpen(true);
  };

  const closeAdjustModal = () => {
    if (adjustSubmitting) return;
    setAdjustOpen(false);
    setAdjustTarget(null);
  };

  const handleAdjustSubmit = async (e: FormEvent) => {e.preventDefault();
    const productId = adjustForm.productId.trim();
    const reason = adjustForm.reason.trim();
    const quantity = Number(adjustForm.quantity);

    if (!productId) {
      void notify('Product ID is required');
      return;
    }
    if (!quantity || quantity <= 0 || !Number.isFinite(quantity)) {
      void notify('Quantity must be a positive number');
      return;
    }
    if (reason.length < 3 || reason.length > 500) {
      void notify('Reason must be between 3 and 500 characters');
      return;
    }

    setAdjustSubmitting(true);
    try {
      const payload: AdjustStockPayload = {
        productId,
        adjustmentType: adjustForm.adjustmentType,
        quantity,
        reason,
      };
      if (adjustForm.variantId.trim()) {
        payload.variantId = adjustForm.variantId.trim();
      }
      await franchiseInventoryService.adjustStock(payload);
      setSuccessMessage('Stock adjusted successfully');
      setAdjustOpen(false);
      setAdjustTarget(null);
      await loadStocks();
      if (activeTab === 'low-stock') await loadLowStock();
      if (activeTab === 'ledger') await loadLedger();
    } catch (err) {
      void notify(handleError(err, 'Failed to adjust stock'));
    } finally {
      setAdjustSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Inventory</h1>
          <p>Track stock levels, movements, and adjustments across your franchise</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => openAdjustModal()}>
          Adjust Stock
        </button>
      </div>

      {successMessage && (
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #86efac',
            color: '#166534',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 16,
          }}
          role="status"
        >
          {successMessage}
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid #e5e7eb',
          marginBottom: 20,
        }}
      >
        {[
          { key: 'stock' as TabKey, label: 'Stock Overview' },
          { key: 'low-stock' as TabKey, label: 'Low Stock Alerts' },
          { key: 'ledger' as TabKey, label: 'Movement History' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            style={{
              background: 'none',
              border: 'none',
              padding: '12px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              color: activeTab === tab.key ? '#2563eb' : '#6b7280',
              borderBottom:
                activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'stock' && (
        <StockOverviewTab
          stocks={stocks}
          loading={stockLoading}
          total={stockTotal}
          page={stockPage}
          totalPages={stockTotalPages}
          setPage={setStockPage}
          kpis={kpis}
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          onSearchSubmit={handleSearchSubmit}
          lowStockOnly={lowStockOnly}
          setLowStockOnly={(v) => {
            setStockPage(1);
            setLowStockOnly(v);
          }}
          onAdjust={openAdjustModal}
        />
      )}

      {activeTab === 'low-stock' && (
        <LowStockTab
          items={lowStockItems}
          loading={lowStockLoading}
          onAdjust={openAdjustModal}
        />
      )}

      {activeTab === 'ledger' && (
        <LedgerTab
          entries={ledger}
          loading={ledgerLoading}
          total={ledgerTotal}
          page={ledgerPage}
          totalPages={ledgerTotalPages}
          setPage={setLedgerPage}
          productId={ledgerProductId}
          setProductId={(v) => {
            setLedgerPage(1);
            setLedgerProductId(v);
          }}
          movementType={ledgerMovementType}
          setMovementType={(v) => {
            setLedgerPage(1);
            setLedgerMovementType(v);
          }}
          fromDate={ledgerFromDate}
          setFromDate={(v) => {
            setLedgerPage(1);
            setLedgerFromDate(v);
          }}
          toDate={ledgerToDate}
          setToDate={(v) => {
            setLedgerPage(1);
            setLedgerToDate(v);
          }}
        />
      )}

      {adjustOpen && (
        <AdjustStockModal
          target={adjustTarget}
          form={adjustForm}
          setForm={setAdjustForm}
          submitting={adjustSubmitting}
          onClose={closeAdjustModal}
          onSubmit={handleAdjustSubmit}
        />
      )}
    </div>
  );
}

/* =============================================================
   Stock Overview Tab
============================================================= */
function StockOverviewTab({
  stocks,
  loading,
  total,
  page,
  totalPages,
  setPage,
  kpis,
  searchInput,
  setSearchInput,
  onSearchSubmit,
  lowStockOnly,
  setLowStockOnly,
  onAdjust,
}: {
  stocks: StockItem[];
  loading: boolean;
  total: number;
  page: number;
  totalPages: number;
  setPage: (p: number) => void;
  kpis: {
    totalSkus: number;
    lowStockCount: number;
    outOfStockCount: number;
    totalOnHand: number;
  };
  searchInput: string;
  setSearchInput: (v: string) => void;
  onSearchSubmit: (e: FormEvent) => void;
  lowStockOnly: boolean;
  setLowStockOnly: (v: boolean) => void;
  onAdjust: (item: StockItem) => void;
}) {
  return (
    <>
      {/* KPI cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <KpiCard label="Total SKUs" value={formatQty(kpis.totalSkus)} />
        <KpiCard
          label="Low Stock Items"
          value={formatQty(kpis.lowStockCount)}
          valueColor={kpis.lowStockCount > 0 ? '#dc2626' : undefined}
        />
        <KpiCard label="Out of Stock" value={formatQty(kpis.outOfStockCount)} />
        <KpiCard label="Total On Hand" value={formatQty(kpis.totalOnHand)} />
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: 16 }}>
        <form
          onSubmit={onSearchSubmit}
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            placeholder="Search product name or SKU..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{
              flex: '1 1 260px',
              padding: '10px 12px',
              fontSize: 14,
              border: '1px solid #d1d5db',
              borderRadius: 8,
              outline: 'none',
              minHeight: 40,
            }}
          />
          <button type="submit" className="btn btn-secondary">
            Search
          </button>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: '#374151',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
            />
            Show Low Stock Only
          </label>
        </form>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Loading...</div>
        ) : stocks.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#6b7280' }}>
            No products in your inventory yet. Add catalog mappings to start tracking stock.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <StockTable stocks={stocks} onAdjust={onAdjust} showWarningRows={false} />
          </div>
        )}
      </div>

      {stocks.length > 0 && !loading && (
        <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      )}
    </>
  );
}

/* =============================================================
   Low Stock Tab
============================================================= */
function LowStockTab({
  items,
  loading,
  onAdjust,
}: {
  items: StockItem[];
  loading: boolean;
  onAdjust: (item: StockItem) => void;
}) {
  return (
    <>
      <div
        style={{
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: 10,
          padding: '12px 16px',
          color: '#92400e',
          fontSize: 13,
          marginBottom: 16,
        }}
      >
        Products where available quantity is at or below the configured low-stock threshold.
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Loading...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#6b7280' }}>
            No low stock items. You&apos;re all stocked up!
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <StockTable stocks={items} onAdjust={onAdjust} showWarningRows />
          </div>
        )}
      </div>
    </>
  );
}

/* =============================================================
   Ledger Tab
============================================================= */
function LedgerTab({
  entries,
  loading,
  total,
  page,
  totalPages,
  setPage,
  productId,
  setProductId,
  movementType,
  setMovementType,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
}: {
  entries: LedgerEntry[];
  loading: boolean;
  total: number;
  page: number;
  totalPages: number;
  setPage: (p: number) => void;
  productId: string;
  setProductId: (v: string) => void;
  movementType: string;
  setMovementType: (v: string) => void;
  fromDate: string;
  setFromDate: (v: string) => void;
  toDate: string;
  setToDate: (v: string) => void;
}) {
  const [productIdInput, setProductIdInput] = useState(productId);

  useEffect(() => {
    setProductIdInput(productId);
  }, [productId]);

  const handleProductSearch = (e: FormEvent) => {
    e.preventDefault();
    setProductId(productIdInput.trim());
  };

  return (
    <>
      <div className="card" style={{ padding: 16 }}>
        <form
          onSubmit={handleProductSearch}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            alignItems: 'end',
          }}
        >
          <div className="field">
            <label>Product ID</label>
            <input
              type="text"
              placeholder="Product ID..."
              value={productIdInput}
              onChange={(e) => setProductIdInput(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Movement Type</label>
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value)}
              style={{
                padding: '10px 12px',
                fontSize: 14,
                border: '1px solid #d1d5db',
                borderRadius: 8,
                minHeight: 40,
                background: '#fff',
              }}
            >
              <option value="">All Types</option>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>To Date</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary">
              Apply
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setProductIdInput('');
                setProductId('');
                setMovementType('');
                setFromDate('');
                setToDate('');
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Loading...</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#6b7280' }}>
            No movement history yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <Th>Date/Time</Th>
                  <Th>Product</Th>
                  <Th>Movement</Th>
                  <Th align="right">Qty Delta</Th>
                  <Th align="right">Before → After</Th>
                  <Th>Reference</Th>
                  <Th>Remarks</Th>
                  <Th>Actor</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const color = MOVEMENT_COLORS[entry.movementType] || '#6b7280';
                  const isPositive = entry.quantityDelta > 0;
                  return (
                    <tr
                      key={entry.id}
                      style={{ borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' }}
                    >
                      <Td>
                        <span style={{ whiteSpace: 'nowrap' }}>
                          {formatDateTime(entry.createdAt)}
                        </span>
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 500, color: '#111827' }}>
                          {entry.globalSku}
                        </div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>
                          Product: {entry.productId.slice(0, 8)}...
                        </div>
                      </Td>
                      <Td>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 999,
                            background: `${color}15`,
                            color,
                            fontSize: 11,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {entry.movementType.replace(/_/g, ' ')}
                        </span>
                      </Td>
                      <Td align="right">
                        <span
                          style={{
                            color: isPositive ? '#16a34a' : '#dc2626',
                            fontWeight: 600,
                          }}
                        >
                          {isPositive ? '+' : ''}
                          {formatQty(entry.quantityDelta)}
                        </span>
                      </Td>
                      <Td align="right">
                        <span style={{ color: '#6b7280' }}>
                          {formatQty(entry.beforeQty)} → {formatQty(entry.afterQty)}
                        </span>
                      </Td>
                      <Td>
                        <div style={{ fontSize: 12 }}>{entry.referenceType}</div>
                        {entry.referenceId && (
                          <div style={{ fontSize: 11, color: '#6b7280' }}>
                            {entry.referenceId.slice(0, 8)}...
                          </div>
                        )}
                      </Td>
                      <Td>
                        <span
                          style={{
                            color: entry.remarks ? '#374151' : '#9ca3af',
                            fontStyle: entry.remarks ? 'normal' : 'italic',
                          }}
                        >
                          {entry.remarks || '-'}
                        </span>
                      </Td>
                      <Td>
                        <div style={{ fontSize: 12 }}>{entry.actorType}</div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {entries.length > 0 && !loading && (
        <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      )}
    </>
  );
}

/* =============================================================
   Shared: Stock Table
============================================================= */
function StockTable({
  stocks,
  onAdjust,
  showWarningRows,
}: {
  stocks: StockItem[];
  onAdjust: (item: StockItem) => void;
  showWarningRows: boolean;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
          <Th>Product</Th>
          <Th>Global SKU</Th>
          <Th>Franchise SKU</Th>
          <Th align="right">On Hand</Th>
          <Th align="right">Reserved</Th>
          <Th align="right">Available</Th>
          <Th align="right">Damaged</Th>
          <Th align="right">In Transit</Th>
          <Th>Last Restocked</Th>
          <Th align="right">Action</Th>
        </tr>
      </thead>
      <tbody>
        {stocks.map((item) => {
          const img = getPrimaryImage(item);
          const isLow = item.availableQty <= item.lowStockThreshold;
          const rowBg = showWarningRows ? '#fffbeb' : undefined;
          return (
            <tr
              key={item.id}
              style={{
                borderBottom: '1px solid #f3f4f6',
                verticalAlign: 'middle',
                background: rowBg,
              }}
            >
              <Td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 8,
                      background: '#f3f4f6',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontSize: 10,
                      color: '#9ca3af',
                    }}
                  >
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img}
                        alt={getProductLabel(item)}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      'No img'
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        color: '#111827',
                        maxWidth: 240,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={getProductLabel(item)}
                    >
                      {getProductLabel(item)}
                    </div>
                    {item.lowStockThreshold > 0 && (
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        Threshold: {formatQty(item.lowStockThreshold)}
                      </div>
                    )}
                  </div>
                </div>
              </Td>
              <Td>
                <code
                  style={{
                    fontSize: 11,
                    background: '#f3f4f6',
                    padding: '2px 6px',
                    borderRadius: 4,
                    color: '#374151',
                  }}
                >
                  {item.globalSku}
                </code>
              </Td>
              <Td>
                {item.franchiseSku ? (
                  <code
                    style={{
                      fontSize: 11,
                      background: '#f3f4f6',
                      padding: '2px 6px',
                      borderRadius: 4,
                      color: '#374151',
                    }}
                  >
                    {item.franchiseSku}
                  </code>
                ) : (
                  <span style={{ color: '#9ca3af' }}>-</span>
                )}
              </Td>
              <Td align="right">{formatQty(item.onHandQty)}</Td>
              <Td align="right">{formatQty(item.reservedQty)}</Td>
              <Td align="right">
                <span
                  style={{
                    color: isLow ? '#dc2626' : '#111827',
                    fontWeight: isLow ? 700 : 500,
                  }}
                >
                  {formatQty(item.availableQty)}
                </span>
              </Td>
              <Td align="right">
                <span style={{ color: item.damagedQty > 0 ? '#92400e' : '#6b7280' }}>
                  {formatQty(item.damagedQty)}
                </span>
              </Td>
              <Td align="right">{formatQty(item.inTransitQty)}</Td>
              <Td>
                <span style={{ whiteSpace: 'nowrap', color: '#6b7280', fontSize: 12 }}>
                  {formatDateTime(item.lastRestockedAt)}
                </span>
              </Td>
              <Td align="right">
                <button
                  type="button"
                  onClick={() => onAdjust(item)}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: '#fff',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: '#2563eb',
                  }}
                >
                  Adjust
                </button>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* =============================================================
   Shared: KPI Card
============================================================= */
function KpiCard({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 18,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: valueColor || '#111827',
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* =============================================================
   Shared: Pagination
============================================================= */
function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 4px',
        marginTop: 4,
        fontSize: 13,
        color: '#6b7280',
      }}
    >
      <div>
        Page {page} of {totalPages} ({formatQty(total)} total)
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '6px 14px', minHeight: 34 }}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '6px 14px', minHeight: 34 }}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/* =============================================================
   Shared: Table cells
============================================================= */
function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: '12px 14px',
        fontSize: 11,
        fontWeight: 600,
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: '12px 14px',
        color: '#374151',
      }}
    >
      {children}
    </td>
  );
}

/* =============================================================
   Adjust Stock Modal
============================================================= */
function AdjustStockModal({
  target,
  form,
  setForm,
  submitting,
  onClose,
  onSubmit,
}: {
  target: StockItem | null;
  form: {
    productId: string;
    variantId: string;
    adjustmentType: AdjustStockPayload['adjustmentType'];
    quantity: string;
    reason: string;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      productId: string;
      variantId: string;
      adjustmentType: AdjustStockPayload['adjustmentType'];
      quantity: string;
      reason: string;
    }>
  >;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const currentHint = ADJUSTMENT_TYPE_OPTIONS.find((o) => o.value === form.adjustmentType)?.hint;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(17, 24, 39, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          width: '100%',
          maxWidth: 520,
          maxHeight: '92vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111827' }}>
            Adjust Stock
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 22,
              cursor: 'pointer',
              color: '#6b7280',
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} style={{ padding: 22 }}>
          {target && (
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 4 }}>
                SELECTED PRODUCT
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
                {getProductLabel(target)}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                SKU: {target.globalSku} · Available: {formatQty(target.availableQty)} · On Hand:{' '}
                {formatQty(target.onHandQty)}
              </div>
            </div>
          )}

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="adjust-productId">
              Product ID <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              id="adjust-productId"
              type="text"
              value={form.productId}
              onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
              disabled={submitting || !!target}
              placeholder="Enter product ID"
              required
            />
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="adjust-variantId">Variant ID (optional)</label>
            <input
              id="adjust-variantId"
              type="text"
              value={form.variantId}
              onChange={(e) => setForm((f) => ({ ...f, variantId: e.target.value }))}
              disabled={submitting || !!target}
              placeholder="Leave blank if no variant"
            />
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="adjust-type">
              Adjustment Type <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <select
              id="adjust-type"
              value={form.adjustmentType}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  adjustmentType: e.target.value as AdjustStockPayload['adjustmentType'],
                }))
              }
              disabled={submitting}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 14,
                border: '1px solid #d1d5db',
                borderRadius: 8,
                minHeight: 40,
                background: '#fff',
              }}
            >
              {ADJUSTMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {currentHint && (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{currentHint}</div>
            )}
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="adjust-quantity">
              Quantity <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              id="adjust-quantity"
              type="number"
              min={1}
              step={1}
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              disabled={submitting}
              placeholder="Positive integer"
              required
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Enter a positive number. The sign is determined by the adjustment type.
            </div>
          </div>

          <div className="field" style={{ marginBottom: 18 }}>
            <label htmlFor="adjust-reason">
              Reason <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea
              id="adjust-reason"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              disabled={submitting}
              placeholder="Explain why this adjustment is needed (3-500 chars)"
              maxLength={500}
              required
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              {form.reason.trim().length}/500 characters
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Submit Adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
