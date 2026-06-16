'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  franchisePosService,
  PosCashReconciliation,
  PosDailyReconciliation,
  PosPaymentMethod,
  PosRecordSaleItemPayload,
  PosRefundMethod,
  PosReturnCondition,
  PosSale,
  PosSaleItem,
  PosSaleType,
} from '@/services/pos.service';
import { useModal } from '@sportsmart/ui';
import {
  franchiseCatalogService,
  CatalogMapping,
} from '@/services/catalog.service';
import { ApiError } from '@/lib/api-client';
import {
  validateAmount,
  validateIndianMobile,
  validatePersonName,
} from '@/lib/validators';
import {
  mountBarcodeScanner,
  openCashDrawer,
  printReceipt,
  requestUsbPrinterPairing,
  type OpenDrawerResult,
} from '@/lib/pos-hardware';

type TabKey = 'new-sale' | 'history' | 'daily-report';

interface CartLine {
  key: string;
  productId: string;
  variantId: string | null;
  title: string;
  variantTitle: string | null;
  sku: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineDiscount: number;
}

const SALE_TYPES: PosSaleType[] = ['WALK_IN', 'PHONE_ORDER', 'LOCAL_DELIVERY'];
const PAYMENT_METHODS: PosPaymentMethod[] = ['CASH', 'UPI', 'CARD'];
const SALE_STATUSES = [
  'COMPLETED',
  'VOIDED',
  'RETURNED',
  'PARTIALLY_RETURNED',
];

function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

function formatInr(value: number | string | null | undefined): string {
  const n = toNumber(value);
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
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

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getPrimaryImage(
  m: CatalogMapping | undefined,
): string | null {
  if (!m?.product?.images || m.product.images.length === 0) return null;
  const primary = m.product.images.find((i) => i.isPrimary);
  return (primary ?? m.product.images[0]).url;
}

function statusBadgeStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  };
  switch (status) {
    case 'COMPLETED':
      return { ...base, background: '#d1fae5', color: '#065f46' };
    case 'VOIDED':
      return { ...base, background: '#fee2e2', color: '#991b1b' };
    case 'RETURNED':
      return { ...base, background: '#e0e7ff', color: '#3730a3' };
    case 'PARTIALLY_RETURNED':
      return { ...base, background: '#fef3c7', color: '#92400e' };
    default:
      return { ...base, background: '#e5e7eb', color: '#374151' };
  }
}

export default function PosPage() {
const [activeTab, setActiveTab] = useState<TabKey>('new-sale');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Point of Sale</h1>
          <p>Ring up in-store sales, view history, and close the day</p>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid #e5e7eb',
          marginBottom: 24,
        }}
      >
        {(
          [
            { key: 'new-sale', label: 'New Sale' },
            { key: 'history', label: 'Sale History' },
            { key: 'daily-report', label: 'Daily Report' },
          ] as Array<{ key: TabKey; label: string }>
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '12px 20px',
              border: 'none',
              background: 'transparent',
              fontSize: 14,
              fontWeight: 600,
              color:
                activeTab === tab.key ? 'var(--color-primary)' : '#6b7280',
              borderBottom:
                activeTab === tab.key
                  ? '2px solid var(--color-primary)'
                  : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'new-sale' && <NewSaleTab />}
      {activeTab === 'history' && <SaleHistoryTab />}
      {activeTab === 'daily-report' && <DailyReportTab />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB 1: NEW SALE (Terminal)
// ══════════════════════════════════════════════════════════════

function NewSaleTab() {
  const { notify, confirmDialog } = useModal();
  const [products, setProducts] = useState<CatalogMapping[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [saleType, setSaleType] = useState<PosSaleType>('WALK_IN');
  const [paymentMethod, setPaymentMethod] =
    useState<PosPaymentMethod>('CASH');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successSale, setSuccessSale] = useState<PosSale | null>(null);
  // Follow-up #H44 — POS hardware flags. Auto-print + auto-drawer
  // default ON because that's the muscle memory at the counter; the
  // cashier can toggle them off (e.g. customer doesn't want a receipt).
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(true);
  const [autoOpenDrawer, setAutoOpenDrawer] = useState(true);
  const [drawerStatus, setDrawerStatus] = useState<OpenDrawerResult | 'idle'>(
    'idle',
  );
  const searchRef = useRef<HTMLInputElement | null>(null);

  const loadProducts = async (searchTerm: string) => {
setProductsLoading(true);
    try {
      const res = await franchiseCatalogService.listMappings({
        page: 1,
        limit: 48,
        search: searchTerm || undefined,
        isActive: true,
        approvalStatus: 'APPROVED',
      });
      setProducts(res.data?.mappings ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        void notify(err.body.message || 'Failed to load products');
      } else {
        void notify('Failed to load products');
      }
    } finally {
      setProductsLoading(false);
    }
  };

  useEffect(() => {
    loadProducts('');
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const h = setTimeout(() => {
      loadProducts(search);
    }, 250);
    return () => clearTimeout(h);
  }, [search]);

  // Follow-up #H44 — mount the keystroke-buffer barcode scanner. A USB
  // / HID scanner that emits `<digits><Enter>` at >20 chars/sec hits
  // `onScan`; a human typing or single Enter keypress does not. The
  // scanner is paused while the success modal is open so a stray
  // scan doesn't try to add to a closed cart.
  useEffect(() => {
    const handle = mountBarcodeScanner({
      enabled: !successSale,
      onScan: async (code) => {
        try {
          const res = await franchiseCatalogService.listMappings({
            page: 1,
            limit: 1,
            search: code,
            isActive: true,
            approvalStatus: 'APPROVED',
          });
          const mapping = res.data?.mappings?.find(
            (m) => m.barcode === code || m.globalSku === code,
          );
          if (mapping) {
            addToCart(mapping);
          } else {
            void notify(`No product found for barcode ${code}`);
          }
        } catch {
          // Best-effort: a transient API failure during a scan
          // shouldn't crash the POS page. The cashier can manually
          // search instead.
        }
      },
    });
    return handle.cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successSale]);

  const addToCart = (m: CatalogMapping) => {
    if (!m.product) return;
    const key = `${m.productId}::${m.variantId ?? ''}`;
    setCart((prev) => {
      const existing = prev.find((c) => c.key === key);
      if (existing) {
        return prev.map((c) =>
          c.key === key ? { ...c, quantity: c.quantity + 1 } : c,
        );
      }
      return [
        ...prev,
        {
          key,
          productId: m.productId,
          variantId: m.variantId,
          title: m.product?.title ?? 'Unknown',
          variantTitle: m.variant?.title ?? null,
          sku: m.globalSku,
          imageUrl: getPrimaryImage(m),
          unitPrice: toNumber(m.product?.basePrice),
          quantity: 1,
          lineDiscount: 0,
        },
      ];
    });
  };

  const updateLine = (key: string, patch: Partial<CartLine>) => {
    // Phase 4 / H45 — clamp every patched field to a sane range
    // before persisting to state. Cashiers can otherwise type a
    // negative unit price (free goods accidentally) or a discount
    // that exceeds line total (negative net amount → the backend
    // throws but only after the cashier saw a misleading total in
    // the UI). The server-side guard in franchise-pos.service is
    // the authority; this is the customer-empathy layer.
    setCart((prev) =>
      prev.map((c) => {
        if (c.key !== key) return c;
        const merged: CartLine = { ...c, ...patch };
        if (patch.unitPrice !== undefined && merged.unitPrice < 0) {
          merged.unitPrice = 0;
        }
        if (patch.quantity !== undefined && merged.quantity < 1) {
          merged.quantity = 1;
        }
        if (patch.lineDiscount !== undefined) {
          const lineGross = merged.unitPrice * merged.quantity;
          if (merged.lineDiscount < 0) {
            merged.lineDiscount = 0;
          } else if (merged.lineDiscount > lineGross) {
            // Cap at line gross so net never goes negative.
            merged.lineDiscount = lineGross;
          }
        }
        return merged;
      }),
    );
  };

  const removeLine = (key: string) => {
    setCart((prev) => prev.filter((c) => c.key !== key));
  };

  const subtotal = useMemo(
    () => cart.reduce((sum, c) => sum + c.unitPrice * c.quantity, 0),
    [cart],
  );
  const totalDiscount = useMemo(
    () => cart.reduce((sum, c) => sum + c.lineDiscount, 0),
    [cart],
  );
  const netTotal = useMemo(
    () => Math.max(0, subtotal - totalDiscount),
    [subtotal, totalDiscount],
  );

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && products.length > 0) {
      e.preventDefault();
      addToCart(products[0]);
      setSearch('');
    }
  };

  const handleSubmit = async () => {
if (cart.length === 0) {
      void notify('Cart is empty. Add at least one product.');
      return;
    }
    for (const line of cart) {
      if (line.quantity <= 0) {
        void notify(`Quantity must be greater than 0 for ${line.title}`);
        return;
      }
      if (line.unitPrice <= 0) {
        void notify(`Unit price must be greater than 0 for ${line.title}`);
        return;
      }
    }

    // Customer name is optional, but if entered it is a PERSON name and must
    // be alphabets only (no digits / special characters).
    const trimmedName = customerName.trim();
    if (trimmedName) {
      const nameError = validatePersonName(trimmedName, 'Customer name');
      if (nameError) {
        void notify(nameError);
        return;
      }
    }

    // Customer phone is optional, but if entered it must be a valid Indian
    // mobile so the receipt SMS / follow-up actually reaches the customer.
    const trimmedPhone = customerPhone.trim();
    if (trimmedPhone) {
      const phoneError = validateIndianMobile(trimmedPhone);
      if (phoneError) {
        void notify(phoneError);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const items: PosRecordSaleItemPayload[] = cart.map((c) => ({
        productId: c.productId,
        variantId: c.variantId ?? undefined,
        quantity: c.quantity,
        unitPrice: c.unitPrice,
        lineDiscount: c.lineDiscount || undefined,
      }));

      const res = await franchisePosService.recordSale({
        saleType,
        paymentMethod,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        items,
      });

      if (res.data) {
        setSuccessSale(res.data);

        // Follow-up #H44 — auto-print receipt + auto-open cash drawer.
        // Both run after the sale is committed so a hardware failure
        // never blocks the sale itself. Errors are surfaced as a
        // soft notify so the cashier knows to handle manually.
        if (autoPrintReceipt) {
          try {
            await printReceipt({
              saleNumber: res.data.saleNumber,
              franchiseName: 'SportsMart',
              customerName: customerName.trim() || null,
              customerPhone: customerPhone.trim() || null,
              items: cart.map((c) => ({
                productTitle: c.title,
                variantTitle: c.variantTitle,
                quantity: c.quantity,
                unitPrice: c.unitPrice,
                lineDiscount: c.lineDiscount,
              })),
              subtotalInr: subtotal,
              discountInr: totalDiscount,
              netInr: netTotal,
              paymentMethod,
              soldAt: new Date(),
            });
          } catch {
            void notify(
              'Sale recorded but receipt print failed — print from history if needed',
            );
          }
        }
        if (autoOpenDrawer && paymentMethod === 'CASH') {
          const result = await openCashDrawer();
          setDrawerStatus(result);
          if (result === 'no-printer' || result === 'error') {
            void notify(
              'Cash drawer did not open — pair the printer from POS settings or open manually',
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        void notify(err.body.message || 'Failed to record sale');
      } else {
        void notify('Failed to record sale');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForNewSale = () => {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setSaleType('WALK_IN');
    setPaymentMethod('CASH');
    setSuccessSale(null);
    searchRef.current?.focus();
  };

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 420px',
          gap: 20,
          alignItems: 'start',
        }}
      >
        {/* Product picker */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ marginBottom: 16 }}>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search products (press Enter to add first match)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKey}
              style={{
                width: '100%',
                padding: '12px 14px',
                fontSize: 15,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                outline: 'none',
              }}
            />
          </div>
          {productsLoading ? (
            <div style={{ padding: 24, textAlign: 'center' }}>Loading...</div>
          ) : products.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: 'center',
                color: '#6b7280',
                fontSize: 14,
              }}
            >
              No products found.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 12,
              }}
            >
              {products.map((m) => {
                const img = getPrimaryImage(m);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => addToCart(m)}
                    style={{
                      padding: 10,
                      border: '1px solid #e5e7eb',
                      borderRadius: 10,
                      background: '#fff',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        aspectRatio: '1',
                        background: '#f3f4f6',
                        borderRadius: 8,
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={img}
                          alt={m.product?.title ?? ''}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      ) : (
                        <span style={{ fontSize: 24, color: '#9ca3af' }}>
                          📦
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#111827',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        minHeight: 32,
                      }}
                    >
                      {m.product?.title ?? 'Unknown'}
                    </div>
                    {/* Variant subtitle + SKU. Without these, a franchise
                         that has mapped 3 size-variants of the same product
                         sees 3 identical tiles and can't tell them apart
                         until after clicking. */}
                    {m.variant?.title && (
                      <div
                        style={{
                          fontSize: 11,
                          color: '#6b7280',
                          fontWeight: 500,
                          marginTop: -4,
                        }}
                      >
                        {m.variant.title}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: 10,
                        color: '#9ca3af',
                        fontFamily: 'monospace',
                      }}
                    >
                      {m.globalSku || m.variant?.sku || '\u2014'}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: 'var(--color-primary)',
                      }}
                    >
                      {formatInr(m.product?.basePrice)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Cart sidebar */}
        <div style={{ position: 'sticky', top: 80 }}>
          <div className="card" style={{ marginBottom: 0 }}>
            <h2 style={{ marginBottom: 12 }}>Current Sale</h2>
            {cart.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  color: '#9ca3af',
                  fontSize: 13,
                  border: '1px dashed #e5e7eb',
                  borderRadius: 8,
                  marginBottom: 16,
                }}
              >
                Cart is empty.
                <br />
                Click a product to add it.
              </div>
            ) : (
              <div
                style={{
                  maxHeight: 360,
                  overflowY: 'auto',
                  marginBottom: 12,
                }}
              >
                {cart.map((line) => (
                  <div
                    key={line.key}
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: '10px 0',
                      borderBottom: '1px solid #f3f4f6',
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        background: '#f3f4f6',
                        borderRadius: 6,
                        flexShrink: 0,
                        overflow: 'hidden',
                      }}
                    >
                      {line.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={line.imageUrl}
                          alt=""
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                        />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#111827',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {line.title}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          marginTop: 6,
                          alignItems: 'center',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            updateLine(line.key, {
                              quantity: Math.max(1, line.quantity - 1),
                            })
                          }
                          style={{
                            width: 24,
                            height: 24,
                            border: '1px solid #d1d5db',
                            borderRadius: 4,
                            background: '#fff',
                            cursor: 'pointer',
                            fontSize: 14,
                          }}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(line.key, {
                              quantity: Math.max(
                                1,
                                parseInt(e.target.value, 10) || 1,
                              ),
                            })
                          }
                          style={{
                            width: 44,
                            padding: 4,
                            border: '1px solid #d1d5db',
                            borderRadius: 4,
                            fontSize: 12,
                            textAlign: 'center',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateLine(line.key, {
                              quantity: line.quantity + 1,
                            })
                          }
                          style={{
                            width: 24,
                            height: 24,
                            border: '1px solid #d1d5db',
                            borderRadius: 4,
                            background: '#fff',
                            cursor: 'pointer',
                            fontSize: 14,
                          }}
                        >
                          +
                        </button>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) =>
                            updateLine(line.key, {
                              unitPrice:
                                parseFloat(e.target.value) || 0,
                            })
                          }
                          style={{
                            flex: 1,
                            padding: 4,
                            border: '1px solid #d1d5db',
                            borderRadius: 4,
                            fontSize: 12,
                            textAlign: 'right',
                          }}
                          placeholder="Price"
                        />
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          marginTop: 4,
                          alignItems: 'center',
                        }}
                      >
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.lineDiscount}
                          onChange={(e) =>
                            updateLine(line.key, {
                              lineDiscount: parseFloat(e.target.value) || 0,
                            })
                          }
                          placeholder="Discount"
                          style={{
                            flex: 1,
                            padding: 4,
                            border: '1px solid #d1d5db',
                            borderRadius: 4,
                            fontSize: 11,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: '#111827',
                          }}
                        >
                          {formatInr(
                            line.unitPrice * line.quantity - line.lineDiscount,
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#dc2626',
                            cursor: 'pointer',
                            fontSize: 14,
                            padding: '0 4px',
                          }}
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                borderTop: '1px solid #e5e7eb',
                paddingTop: 12,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                  fontSize: 13,
                }}
              >
                <span>Subtotal</span>
                <span>{formatInr(subtotal)}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                  fontSize: 13,
                  color: '#6b7280',
                }}
              >
                <span>Discount</span>
                <span>− {formatInr(totalDiscount)}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 18,
                  fontWeight: 700,
                  paddingTop: 6,
                  borderTop: '1px solid #f3f4f6',
                  marginTop: 6,
                }}
              >
                <span>Net Total</span>
                <span>{formatInr(netTotal)}</span>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 8,
                marginBottom: 12,
              }}
            >
              <input
                type="text"
                placeholder="Customer name (optional)"
                value={customerName}
                maxLength={100}
                onChange={(e) =>
                  // PERSON name — strip digits/specials so only a real name
                  // can be typed/pasted. Submit re-checks via validatePersonName.
                  setCustomerName(e.target.value.replace(/[^A-Za-z .'-]/g, ''))
                }
                style={{
                  padding: '8px 10px',
                  fontSize: 13,
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                }}
              />
              <input
                type="text"
                inputMode="numeric"
                placeholder="Customer phone (optional)"
                value={customerPhone}
                maxLength={10}
                onChange={(e) =>
                  // Indian mobile — digits only, max 10. Submit re-checks
                  // via validateIndianMobile.
                  setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
                }
                style={{
                  padding: '8px 10px',
                  fontSize: 13,
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={saleType}
                  onChange={(e) => setSaleType(e.target.value as PosSaleType)}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    fontSize: 13,
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    background: '#fff',
                  }}
                >
                  {SALE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace('_', ' ')}
                    </option>
                  ))}
                </select>
                <select
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(e.target.value as PosPaymentMethod)
                  }
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    fontSize: 13,
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    background: '#fff',
                  }}
                >
                  {PAYMENT_METHODS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Follow-up #H44 — POS hardware toggles + printer pairing */}
            <div
              style={{
                marginBottom: 14,
                padding: 12,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: '#f9fafb',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: '#6b7280',
                  marginBottom: 8,
                }}
              >
                Hardware
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  marginBottom: 4,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={autoPrintReceipt}
                  onChange={(e) => setAutoPrintReceipt(e.target.checked)}
                />
                Auto-print receipt
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  marginBottom: 8,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={autoOpenDrawer}
                  onChange={(e) => setAutoOpenDrawer(e.target.checked)}
                />
                Auto-open cash drawer (CASH sales)
              </label>
              <button
                type="button"
                onClick={async () => {
                  const ok = await requestUsbPrinterPairing();
                  if (ok) {
                    void notify('Printer paired. Cash drawer is now ready.');
                  } else {
                    void notify(
                      'Pairing cancelled or Web USB not supported in this browser.',
                    );
                  }
                }}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: '#fff',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: '#374151',
                }}
              >
                Pair USB printer / drawer
              </button>
              {drawerStatus !== 'idle' && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    color:
                      drawerStatus === 'ok'
                        ? '#059669'
                        : drawerStatus === 'unsupported'
                        ? '#6b7280'
                        : '#dc2626',
                  }}
                >
                  Last drawer pulse:{' '}
                  {drawerStatus === 'ok'
                    ? 'sent successfully'
                    : drawerStatus === 'no-printer'
                    ? 'no paired printer'
                    : drawerStatus === 'unsupported'
                    ? 'Web USB not available in this browser'
                    : 'failed (check printer connection)'}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || cart.length === 0}
              style={{
                width: '100%',
                padding: '16px',
                fontSize: 16,
                fontWeight: 700,
                border: 'none',
                borderRadius: 10,
                background:
                  cart.length === 0 ? '#9ca3af' : '#059669',
                color: '#fff',
                cursor:
                  isSubmitting || cart.length === 0
                    ? 'not-allowed'
                    : 'pointer',
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting
                ? 'Processing...'
                : `Complete Sale · ${formatInr(netTotal)}`}
            </button>
          </div>
        </div>
      </div>

      {successSale && (
        <Modal onClose={resetForNewSale}>
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: '#d1fae5',
                color: '#065f46',
                margin: '0 auto 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 28,
              }}
            >
              ✓
            </div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Sale Completed</h2>
            <p style={{ color: '#6b7280', marginTop: 8 }}>
              Sale Number:{' '}
              <strong style={{ color: '#111827' }}>
                {successSale.saleNumber}
              </strong>
            </p>
            <p style={{ fontSize: 22, fontWeight: 700, marginTop: 16 }}>
              {formatInr(successSale.netAmount)}
            </p>
            {/* GST breakdown on the confirmation modal — the staff
                shows this screen to the customer or prints it. CGST
                Act §31 requires the breakdown to be visible. */}
            {toNumber(successSale.taxAmount) > 0 && (
              <div
                style={{
                  margin: '16px auto 0',
                  maxWidth: 280,
                  padding: 12,
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#6b7280' }}>Taxable value</span>
                  <span>{formatInr(toNumber(successSale.netAmount) - toNumber(successSale.taxAmount))}</span>
                </div>
                {toNumber(successSale.cgstAmount) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#6b7280' }}>CGST</span>
                    <span>{formatInr(successSale.cgstAmount)}</span>
                  </div>
                )}
                {toNumber(successSale.sgstAmount) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#6b7280' }}>SGST</span>
                    <span>{formatInr(successSale.sgstAmount)}</span>
                  </div>
                )}
                {toNumber(successSale.igstAmount) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: '#6b7280' }}>IGST</span>
                    <span>{formatInr(successSale.igstAmount)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, paddingTop: 6, borderTop: '1px solid #e5e7eb' }}>
                  <span>Total GST</span>
                  <span>{formatInr(successSale.taxAmount)}</span>
                </div>
              </div>
            )}
            <div
              style={{
                display: 'flex',
                gap: 12,
                justifyContent: 'center',
                marginTop: 24,
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => window.print()}
              >
                Print Receipt
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={resetForNewSale}
              >
                New Sale
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB 2: SALE HISTORY
// ══════════════════════════════════════════════════════════════

function SaleHistoryTab() {
  const { notify, confirmDialog } = useModal();
const [sales, setSales] = useState<PosSale[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [isLoading, setIsLoading] = useState(false);
  const [filters, setFilters] = useState({
    status: '',
    saleType: '',
    fromDate: '',
    toDate: '',
    search: '',
  });
  const [viewSale, setViewSale] = useState<PosSale | null>(null);
  const [voidSale, setVoidSale] = useState<PosSale | null>(null);
  const [returnSale, setReturnSale] = useState<PosSale | null>(null);

  const load = async () => {
setIsLoading(true);
    try {
      const res = await franchisePosService.listSales({
        page,
        limit,
        status: filters.status || undefined,
        saleType: filters.saleType || undefined,
        fromDate: filters.fromDate || undefined,
        toDate: filters.toDate || undefined,
        search: filters.search || undefined,
      });
      if (res.data) {
        setSales(res.data.sales);
        setTotal(res.data.total);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        void notify(err.body.message || 'Failed to load sales');
      } else {
        void notify('Failed to load sales');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const handleSearch = () => {
    setPage(1);
    load();
  };

  const openView = async (sale: PosSale) => {
try {
      const res = await franchisePosService.getSale(sale.id);
      if (res.data) setViewSale(res.data);
    } catch (err) {
      if (err instanceof ApiError) void notify(err.body.message || (err.body.errors && err.body.errors[0] && err.body.errors[0].message) || 'Request failed.');
      else void notify('Failed to load sale detail');
    }
  };

  const openReturn = async (sale: PosSale) => {
try {
      const res = await franchisePosService.getSale(sale.id);
      if (res.data) setReturnSale(res.data);
    } catch (err) {
      if (err instanceof ApiError) void notify(err.body.message || (err.body.errors && err.body.errors[0] && err.body.errors[0].message) || 'Request failed.');
      else void notify('Failed to load sale detail');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <div className="card">
        <h2>Filters</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <select
            value={filters.status}
            onChange={(e) =>
              setFilters({ ...filters, status: e.target.value })
            }
            style={selectStyle}
          >
            <option value="">All Statuses</option>
            {SALE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
          <select
            value={filters.saleType}
            onChange={(e) =>
              setFilters({ ...filters, saleType: e.target.value })
            }
            style={selectStyle}
          >
            <option value="">All Sale Types</option>
            {SALE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filters.fromDate}
            onChange={(e) =>
              setFilters({ ...filters, fromDate: e.target.value })
            }
            style={selectStyle}
          />
          <input
            type="date"
            value={filters.toDate}
            onChange={(e) =>
              setFilters({ ...filters, toDate: e.target.value })
            }
            style={selectStyle}
          />
          <input
            type="text"
            placeholder="Search sale number / customer..."
            value={filters.search}
            onChange={(e) =>
              setFilters({ ...filters, search: e.target.value })
            }
            style={selectStyle}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSearch}
        >
          Apply Filters
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>Loading...</div>
        ) : sales.length === 0 ? (
          <div
            style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}
          >
            No sales found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Sale No.</th>
                  <th style={thStyle}>Date/Time</th>
                  <th style={thStyle}>Customer</th>
                  <th style={thStyle}>Items</th>
                  <th style={thStyle}>Net</th>
                  <th style={thStyle}>Payment</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr
                    key={s.id}
                    style={{ borderTop: '1px solid #f3f4f6' }}
                  >
                    <td style={tdStyle}>
                      <span
                        style={{
                          color: 'var(--color-primary)',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                        onClick={() => openView(s)}
                      >
                        {s.saleNumber}
                      </span>
                    </td>
                    <td style={tdStyle}>{formatDateTime(s.soldAt)}</td>
                    <td style={tdStyle}>
                      {s.customerName || (
                        <span style={{ color: '#9ca3af' }}>Walk-in</span>
                      )}
                    </td>
                    <td style={tdStyle}>{s._count?.items ?? '—'}</td>
                    <td style={tdStyle}>
                      <strong>{formatInr(s.netAmount)}</strong>
                    </td>
                    <td style={tdStyle}>{s.paymentMethod}</td>
                    <td style={tdStyle}>
                      <span style={statusBadgeStyle(s.status as string)}>
                        {(s.status as string).replace('_', ' ')}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => openView(s)}
                          style={actionBtnStyle}
                        >
                          View
                        </button>
                        {/* Void only for COMPLETED — you can't void a sale
                            that's already partly returned. */}
                        {s.status === 'COMPLETED' && (
                          <button
                            type="button"
                            onClick={() => setVoidSale(s)}
                            style={{
                              ...actionBtnStyle,
                              color: '#991b1b',
                            }}
                          >
                            Void
                          </button>
                        )}
                        {/* Return supports cumulative returns, so it stays
                            available from PARTIALLY_RETURNED too. */}
                        {(s.status === 'COMPLETED' ||
                          s.status === 'PARTIALLY_RETURNED') && (
                          <button
                            type="button"
                            onClick={() => openReturn(s)}
                            style={{
                              ...actionBtnStyle,
                              color: '#92400e',
                            }}
                          >
                            Return
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 12,
        }}
      >
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          Page {page} of {totalPages} · {total} total
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {viewSale && (
        <ViewSaleModal sale={viewSale} onClose={() => setViewSale(null)} />
      )}
      {voidSale && (
        <VoidSaleModal
          sale={voidSale}
          onClose={() => setVoidSale(null)}
          onDone={() => {
            setVoidSale(null);
            load();
          }}
        />
      )}
      {returnSale && (
        <ReturnSaleModal
          sale={returnSale}
          onClose={() => setReturnSale(null)}
          onDone={() => {
            setReturnSale(null);
            load();
          }}
        />
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB 3: DAILY REPORT
// ══════════════════════════════════════════════════════════════

function DailyReportTab() {
  const { notify } = useModal();
  const [date, setDate] = useState(todayIso());
  const [report, setReport] = useState<PosDailyReconciliation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const load = async () => {
setIsLoading(true);
    try {
      const res = await franchisePosService.getReconciliation(date);
      if (res.data) setReport(res.data);
    } catch (err) {
      if (err instanceof ApiError) {
        void notify(err.body.message || 'Failed to load report');
      } else {
        void notify('Failed to load report');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Phase 159s — fetch the server-rendered CSV (raw text/csv, not a JSON
  // envelope) and trigger a browser download.
  const downloadCsv = async () => {
    setIsDownloading(true);
    try {
      const blob = await franchisePosService.getDailyReportCsv(date);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pos-report-${date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof ApiError) {
        void notify(err.body.message || 'Failed to download CSV');
      } else {
        void notify('Failed to download CSV');
      }
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const avgSale = report && report.totalSales > 0
    ? report.totalNetAmount / report.totalSales
    : 0;

  return (
    <>
      <div className="card">
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <label style={{ fontSize: 13, fontWeight: 600 }}>Report Date:</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ ...selectStyle, width: 'auto' }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={load}
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : 'Load Report'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.print()}
            disabled={!report}
          >
            Generate Closure Report
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={downloadCsv}
            disabled={!report || isDownloading}
          >
            {isDownloading ? 'Downloading...' : 'Download CSV'}
          </button>
        </div>
      </div>

      {isLoading && !report ? (
        <div className="card">Loading...</div>
      ) : report ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 16,
              marginBottom: 16,
            }}
          >
            <KpiCard
              label="Total Sales"
              value={String(report.totalSales)}
              color="#2563eb"
            />
            <KpiCard
              label="Net (after refunds)"
              value={formatInr(report.totalNetAmount)}
              color="#059669"
            />
            <KpiCard
              label="Average Sale Value"
              value={formatInr(avgSale)}
              color="#7c3aed"
            />
            <KpiCard
              label="Total Discount"
              value={formatInr(report.totalDiscountAmount)}
              color="#d97706"
            />
          </div>

          {/* Phase 159s — refund / void / return KPIs the backend now returns. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 16,
              marginBottom: 16,
            }}
          >
            <KpiCard
              label="Refund Total"
              value={formatInr(report.refundTotal)}
              color="#dc2626"
            />
            <KpiCard
              label="Voided Sales"
              value={`${report.voidedSales.count} · ${formatInr(report.voidedSales.amount)}`}
              color="#991b1b"
            />
            <KpiCard
              label="Returned Sales"
              value={String(report.returnedSales.count)}
              color="#92400e"
            />
            <KpiCard
              label="Total GST"
              value={formatInr(report.tax.total)}
              color="#0f766e"
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div className="card" style={{ marginBottom: 0 }}>
              <h2>By Payment Method</h2>
              {Object.keys(report.salesByPaymentMethod).length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 13 }}>
                  No data
                </div>
              ) : (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Method</th>
                      <th style={thStyle}>Count</th>
                      <th style={thStyle}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(report.salesByPaymentMethod).map(
                      ([k, v]) => (
                        <tr
                          key={k}
                          style={{ borderTop: '1px solid #f3f4f6' }}
                        >
                          <td style={tdStyle}>{k}</td>
                          <td style={tdStyle}>{v.count}</td>
                          <td style={tdStyle}>{formatInr(v.amount)}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card" style={{ marginBottom: 0 }}>
              <h2>By Sale Type</h2>
              {Object.keys(report.salesByType).length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 13 }}>
                  No data
                </div>
              ) : (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Count</th>
                      <th style={thStyle}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(report.salesByType).map(([k, v]) => (
                      <tr
                        key={k}
                        style={{ borderTop: '1px solid #f3f4f6' }}
                      >
                        <td style={tdStyle}>{k.replace('_', ' ')}</td>
                        <td style={tdStyle}>{v.count}</td>
                        <td style={tdStyle}>{formatInr(v.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Phase 159s — GST breakdown (CGST/SGST/IGST/Total). POS sales are
              intra-state so CGST+SGST populate and IGST is usually 0. */}
          <div className="card">
            <h2>GST Breakdown</h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 16,
              }}
            >
              {(
                [
                  { label: 'CGST', value: report.tax.cgst },
                  { label: 'SGST', value: report.tax.sgst },
                  { label: 'IGST', value: report.tax.igst },
                  { label: 'Total GST', value: report.tax.total },
                ] as Array<{ label: string; value: number }>
              ).map((row) => (
                <div key={row.label}>
                  <div style={labelStyle}>{row.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
                    {formatInr(row.value)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Inventory Reconciliation</h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 16,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#6b7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Items Sold
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
                  {report.inventoryReconciliation.totalItemsSold}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#6b7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Items Returned
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
                  {report.inventoryReconciliation.totalItemsReturned}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#6b7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Items Voided
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
                  {report.inventoryReconciliation.totalItemsVoided}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#6b7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Net Movement
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
                  {report.inventoryReconciliation.netItemsMovement}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#6b7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Closure Status
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>
                  {report.closureStatus}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  Generated: {formatDateTime(report.generatedAt)}
                </div>
              </div>
            </div>
          </div>

          {/* Phase 242 — cash-vs-bank reconciliation. Expected cash is
              server-computed; a previously-submitted row pre-renders. */}
          <CashReconciliationForm
            key={`${date}:${report.cashReconciliation?.id ?? 'new'}`}
            businessDate={date}
            expectedCashInPaise={report.expectedCashInPaise}
            existing={report.cashReconciliation}
            onSubmitted={load}
          />
        </>
      ) : (
        <div className="card">No report data available.</div>
      )}
    </>
  );
}

// Paise (as a numeric string from the API) → a "₹X,XXX.XX" display string.
function formatPaise(paise: string | null | undefined): string {
  if (paise == null) return formatInr(0);
  const n = Number(paise);
  return formatInr(isNaN(n) ? 0 : n / 100);
}

// Phase 242 — cash reconciliation form. The server recomputes expected cash
// authoritatively, so we only ever SEND actual/bank/reference/notes. Variance
// is previewed client-side (actual − expected) for immediate feedback, but the
// authoritative variance + MATCHED/VARIANCE verdict come back from the server.
function CashReconciliationForm({
  businessDate,
  expectedCashInPaise,
  existing,
  onSubmitted,
}: {
  businessDate: string;
  expectedCashInPaise: string;
  existing: PosCashReconciliation | null;
  onSubmitted: () => void;
}) {
  const { notify } = useModal();
  const expectedRupees = Number(expectedCashInPaise || '0') / 100;

  // Pre-fill from a prior submission (rupee strings for the ₹ inputs).
  const [actualCash, setActualCash] = useState(
    existing ? String(Number(existing.actualCashInPaise) / 100) : '',
  );
  const [bankDeposit, setBankDeposit] = useState(
    existing ? String(Number(existing.bankDepositInPaise) / 100) : '',
  );
  const [bankReference, setBankReference] = useState(
    existing?.bankDepositReference ?? '',
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<PosCashReconciliation | null>(existing);

  const actualRupees = actualCash.trim() === '' ? null : Number(actualCash);
  const previewVariance =
    actualRupees == null || isNaN(actualRupees)
      ? null
      : actualRupees - expectedRupees;

  const submit = async () => {
    // Actual cash is required money INTO the reconciliation: non-negative,
    // finite, at most 2 decimal places, within a sane ledger ceiling.
    const actualCashError = validateAmount(actualCash, {
      label: 'Actual cash counted',
    });
    if (actualCashError) {
      void notify(actualCashError);
      return;
    }
    // Bank deposit is optional — blank means 0 — but if entered it must be a
    // valid non-negative money amount.
    if (bankDeposit.trim() !== '') {
      const bankError = validateAmount(bankDeposit, {
        label: 'Bank deposit',
      });
      if (bankError) {
        void notify(bankError);
        return;
      }
    }
    const actualRupeesValue = Number(actualCash);
    const bankRupees =
      bankDeposit.trim() === '' ? 0 : Number(bankDeposit);
    setIsSaving(true);
    try {
      const res = await franchisePosService.submitReconciliation({
        businessDate,
        actualCashInPaise: Math.round(actualRupeesValue * 100),
        bankDepositInPaise: Math.round(bankRupees * 100),
        bankDepositReference: bankReference.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (res.data) {
        setResult(res.data);
        // Refresh the parent report so the persisted row + expected cash stay
        // in sync.
        onSubmitted();
      }
    } catch (err) {
      if (err instanceof ApiError) void notify(err.body.message || (err.body.errors && err.body.errors[0] && err.body.errors[0].message) || 'Request failed.');
      else void notify('Failed to submit reconciliation');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="card">
      <h2>Cash Reconciliation</h2>
      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 16 }}>
        Count the drawer and record the bank deposit. Expected cash is computed
        by the system from the day&apos;s cash sales less cash refunds.
      </p>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 12,
          background: '#f9fafb',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
          Expected Cash (system)
        </span>
        <span style={{ fontSize: 18, fontWeight: 700 }}>
          {formatInr(expectedRupees)}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <label style={labelStyle}>Actual Cash Counted (₹) *</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={actualCash}
            onChange={(e) => setActualCash(e.target.value)}
            placeholder="0.00"
            style={{ ...selectStyle, width: '100%', marginTop: 6 }}
          />
        </div>
        <div>
          <label style={labelStyle}>Bank Deposit (₹)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={bankDeposit}
            onChange={(e) => setBankDeposit(e.target.value)}
            placeholder="0.00"
            style={{ ...selectStyle, width: '100%', marginTop: 6 }}
          />
        </div>
        <div>
          <label style={labelStyle}>Bank Reference (optional)</label>
          <input
            type="text"
            value={bankReference}
            maxLength={64}
            onChange={(e) => setBankReference(e.target.value)}
            placeholder="UTR / deposit-slip no."
            style={{ ...selectStyle, width: '100%', marginTop: 6 }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Notes (optional)</label>
        <textarea
          value={notes}
          maxLength={500}
          rows={2}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any explanation for a variance..."
          style={{
            width: '100%',
            padding: 10,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 13,
            marginTop: 6,
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
      </div>

      {/* Live variance preview (actual − expected). */}
      {previewVariance != null && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
            background: Math.abs(previewVariance) < 0.005 ? '#f0fdf4' : '#fef2f2',
            border:
              Math.abs(previewVariance) < 0.005
                ? '1px solid #bbf7d0'
                : '1px solid #fecaca',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            Variance (counted − expected)
          </span>
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: Math.abs(previewVariance) < 0.005 ? '#166534' : '#991b1b',
            }}
          >
            {previewVariance >= 0 ? '+' : '−'}
            {formatInr(Math.abs(previewVariance))}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={isSaving}
        >
          {isSaving
            ? 'Submitting...'
            : existing
            ? 'Update Reconciliation'
            : 'Submit Reconciliation'}
        </button>
      </div>

      {/* Server verdict — status badge + authoritative variance. */}
      {result && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            background: result.status === 'MATCHED' ? '#f0fdf4' : '#fef2f2',
            border:
              result.status === 'MATCHED'
                ? '1px solid #bbf7d0'
                : '1px solid #fecaca',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                ...statusBadgeStyle(
                  result.status === 'MATCHED' ? 'COMPLETED' : 'VOIDED',
                ),
              }}
            >
              {result.status}
            </span>
            <span style={{ fontSize: 13, color: '#374151' }}>
              Variance:{' '}
              <strong>{formatPaise(result.varianceInPaise)}</strong>
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 8,
              marginTop: 10,
              fontSize: 12,
              color: '#6b7280',
            }}
          >
            <div>
              Expected: <strong style={{ color: '#111827' }}>{formatPaise(result.expectedCashInPaise)}</strong>
            </div>
            <div>
              Counted: <strong style={{ color: '#111827' }}>{formatPaise(result.actualCashInPaise)}</strong>
            </div>
            <div>
              Deposited: <strong style={{ color: '#111827' }}>{formatPaise(result.bankDepositInPaise)}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════════

function Modal({
  children,
  onClose,
  width = 560,
}: {
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          width: '100%',
          maxWidth: width,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ViewSaleModal({
  sale,
  onClose,
}: {
  sale: PosSale;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} width={720}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>{sale.saleNumber}</h2>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            {formatDateTime(sale.soldAt)}
          </div>
        </div>
        <span style={statusBadgeStyle(sale.status as string)}>
          {(sale.status as string).replace('_', ' ')}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 16,
          padding: 12,
          background: '#f9fafb',
          borderRadius: 8,
        }}
      >
        <div>
          <div style={labelStyle}>Customer</div>
          <div style={valueStyle}>{sale.customerName || 'Walk-in'}</div>
        </div>
        <div>
          <div style={labelStyle}>Phone</div>
          <div style={valueStyle}>{sale.customerPhone || '—'}</div>
        </div>
        <div>
          <div style={labelStyle}>Sale Type</div>
          <div style={valueStyle}>
            {(sale.saleType as string).replace('_', ' ')}
          </div>
        </div>
        <div>
          <div style={labelStyle}>Payment</div>
          <div style={valueStyle}>{sale.paymentMethod}</div>
        </div>
      </div>

      <h3 style={{ fontSize: 14, marginBottom: 8 }}>Items</h3>
      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>HSN</th>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>Qty</th>
              <th style={thStyle}>Unit Price</th>
              <th style={thStyle}>Discount</th>
              <th style={thStyle}>Taxable</th>
              <th style={thStyle}>GST</th>
              <th style={thStyle}>Total</th>
            </tr>
          </thead>
          <tbody>
            {(sale.items ?? []).map((item) => {
              const rate = (item.gstRateBps ?? 0) / 100;
              const cgst = toNumber(item.cgstAmount);
              const sgst = toNumber(item.sgstAmount);
              const igst = toNumber(item.igstAmount);
              const totalTax = cgst + sgst + igst;
              return (
                <tr key={item.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={tdStyle}>
                    {item.productTitle}
                    {item.variantTitle && (
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        {item.variantTitle}
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>
                    {item.hsnCode ?? <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>
                  <td style={tdStyle}>{item.globalSku}</td>
                  <td style={tdStyle}>{item.quantity}</td>
                  <td style={tdStyle}>{formatInr(item.unitPrice)}</td>
                  <td style={tdStyle}>{formatInr(item.lineDiscount)}</td>
                  <td style={tdStyle}>{formatInr(item.taxableAmount ?? 0)}</td>
                  <td style={tdStyle}>
                    <div style={{ fontSize: 12 }}>{rate > 0 ? `${rate}%` : '—'}</div>
                    {totalTax > 0 && (
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        {formatInr(totalTax)}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <strong>{formatInr(item.lineTotal)}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        style={{
          borderTop: '1px solid #e5e7eb',
          paddingTop: 12,
          maxWidth: 320,
          marginLeft: 'auto',
        }}
      >
        <Totals label="Gross" value={formatInr(sale.grossAmount)} />
        {toNumber(sale.discountAmount) > 0 && (
          <Totals label="Discount" value={`− ${formatInr(sale.discountAmount)}`} muted />
        )}
        {/* Phase 26 GST (POS) — Section 31 CGST Act requires every tax
            invoice to display the breakdown. We show taxable + CGST/SGST/
            IGST (only when non-zero) above the net. POS sales are
            inclusive-priced — the net already contains the tax. */}
        <Totals label="Taxable value" value={formatInr(toNumber(sale.netAmount) - toNumber(sale.taxAmount))} />
        {toNumber(sale.cgstAmount) > 0 && (
          <Totals label="CGST" value={formatInr(sale.cgstAmount)} />
        )}
        {toNumber(sale.sgstAmount) > 0 && (
          <Totals label="SGST" value={formatInr(sale.sgstAmount)} />
        )}
        {toNumber(sale.igstAmount) > 0 && (
          <Totals label="IGST" value={formatInr(sale.igstAmount)} />
        )}
        {toNumber(sale.taxAmount) > 0 && (
          <Totals label="Total GST" value={formatInr(sale.taxAmount)} bold />
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 16,
            fontWeight: 700,
            paddingTop: 6,
            marginTop: 4,
            borderTop: '1px solid #f3f4f6',
          }}
        >
          <span>Net payable</span>
          <span>{formatInr(sale.netAmount)}</span>
        </div>
        {sale.placeOfSupplyState && (
          <div style={{ fontSize: 10, color: '#6b7280', textAlign: 'right', marginTop: 4 }}>
            Place of supply: state code {sale.placeOfSupplyState}
          </div>
        )}
      </div>

      {sale.voidReason && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          <strong>Void reason:</strong> {sale.voidReason}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: 20,
        }}
      >
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function VoidSaleModal({
  sale,
  onClose,
  onDone,
}: {
  sale: PosSale;
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify, confirmDialog } = useModal();
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
if (reason.trim().length < 5 || reason.trim().length > 500) {
      void notify('Reason must be between 5 and 500 characters');
      return;
    }
    setIsSaving(true);
    try {
      await franchisePosService.voidSale(sale.id, { reason: reason.trim() });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) void notify(err.body.message || (err.body.errors && err.body.errors[0] && err.body.errors[0].message) || 'Request failed.');
      else void notify('Failed to void sale');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: 0, fontSize: 18 }}>
        Void Sale {sale.saleNumber}
      </h2>
      <p
        style={{
          fontSize: 13,
          color: '#6b7280',
          marginTop: 4,
          marginBottom: 16,
        }}
      >
        Net Amount: {formatInr(sale.netAmount)}
      </p>

      <div
        style={{
          padding: 12,
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 13,
          color: '#991b1b',
        }}
      >
        Warning: This will return all items to inventory and cannot be undone.
      </div>

      <label style={labelStyle}>Reason (5-500 chars)</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={isSaving}
        rows={4}
        style={{
          width: '100%',
          padding: 10,
          border: '1px solid #d1d5db',
          borderRadius: 6,
          fontSize: 13,
          marginTop: 6,
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
        placeholder="Enter reason for voiding this sale..."
      />
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
        {reason.length} characters
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          marginTop: 20,
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={isSaving}
          style={{ background: '#dc2626', borderColor: '#dc2626' }}
        >
          {isSaving ? 'Voiding...' : 'Confirm Void'}
        </button>
      </div>
    </Modal>
  );
}

const REFUND_METHODS: PosRefundMethod[] = ['CASH', 'UPI', 'CARD', 'MANUAL'];

function ReturnSaleModal({
  sale,
  onClose,
  onDone,
}: {
  sale: PosSale;
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify, confirmDialog } = useModal();
  // `remaining` per item = quantity − already-returned (cumulative). A fully
  // returned line (remaining 0) is shown disabled.
  const remainingFor = (item: PosSaleItem) =>
    Math.max(0, item.quantity - (item.returnedQty ?? 0));

  const [selected, setSelected] = useState<
    Record<string, { checked: boolean; qty: number; condition: PosReturnCondition }>
  >(() => {
    const init: Record<
      string,
      { checked: boolean; qty: number; condition: PosReturnCondition }
    > = {};
    (sale.items ?? []).forEach((item) => {
      const remaining = Math.max(0, item.quantity - (item.returnedQty ?? 0));
      init[item.id] = {
        checked: false,
        qty: Math.max(1, remaining),
        condition: 'SALEABLE',
      };
    });
    return init;
  });
  const [refundMethod, setRefundMethod] = useState<PosRefundMethod>('CASH');
  const [returnReason, setReturnReason] = useState('');
  const [refundReference, setRefundReference] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const toggleItem = (id: string, checked: boolean) => {
    setSelected((prev) => ({
      ...prev,
      [id]: { ...prev[id], checked },
    }));
  };

  const updateQty = (id: string, qty: number, max: number) => {
    const clamped = Math.max(1, Math.min(max, qty));
    setSelected((prev) => ({
      ...prev,
      [id]: { ...prev[id], qty: clamped },
    }));
  };

  const updateCondition = (id: string, condition: PosReturnCondition) => {
    setSelected((prev) => ({
      ...prev,
      [id]: { ...prev[id], condition },
    }));
  };

  // Live refund preview: per item, unitNet = lineTotal / quantity, summed over
  // the selected return quantities. Mirrors how the backend refunds (net per
  // unit, refunds are inclusive of GST).
  const refundPreview = useMemo(() => {
    let total = 0;
    for (const item of sale.items ?? []) {
      const s = selected[item.id];
      if (!s?.checked) continue;
      const qty = Math.max(1, item.quantity || 1);
      const unitNet = toNumber(item.lineTotal) / qty;
      total += unitNet * s.qty;
    }
    return Math.max(0, total);
  }, [sale.items, selected]);

  const submit = async () => {
    const items = Object.entries(selected)
      .filter(([, v]) => v.checked)
      .map(([id, v]) => ({
        itemId: id,
        returnQty: v.qty,
        condition: v.condition,
      }));

    if (items.length === 0) {
      void notify('Select at least one item to return');
      return;
    }
    if (!refundMethod) {
      void notify('Select a refund method');
      return;
    }

    const ok = await confirmDialog(
      `Refund ${formatInr(refundPreview)} to customer?`,
    );
    if (!ok) return;

    setIsSaving(true);
    try {
      await franchisePosService.returnSale(sale.id, {
        items,
        refundMethod,
        returnReason: returnReason.trim() || undefined,
        refundReference: refundReference.trim() || undefined,
      });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) void notify(err.body.message || (err.body.errors && err.body.errors[0] && err.body.errors[0].message) || 'Request failed.');
      else void notify('Failed to process return');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} width={680}>
      <h2 style={{ margin: 0, fontSize: 18 }}>
        Return items from {sale.saleNumber}
      </h2>
      <p
        style={{
          fontSize: 13,
          color: '#6b7280',
          marginTop: 4,
          marginBottom: 16,
        }}
      >
        Select items and enter the return quantity. Saleable items are added
        back to sellable stock; damaged items are routed to damaged stock.
      </p>

      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Select</th>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>Sold</th>
              <th style={thStyle}>Returnable</th>
              <th style={thStyle}>Return Qty</th>
              <th style={thStyle}>Condition</th>
            </tr>
          </thead>
          <tbody>
            {(sale.items ?? []).map((item) => {
              const s = selected[item.id];
              const remaining = remainingFor(item);
              const exhausted = remaining <= 0;
              return (
                <tr
                  key={item.id}
                  style={{ borderTop: '1px solid #f3f4f6' }}
                >
                  <td style={tdStyle}>
                    <input
                      type="checkbox"
                      checked={s?.checked ?? false}
                      disabled={exhausted}
                      onChange={(e) =>
                        toggleItem(item.id, e.target.checked)
                      }
                    />
                  </td>
                  <td style={tdStyle}>
                    {item.productTitle}
                    {item.variantTitle && (
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        {item.variantTitle}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>{item.quantity}</td>
                  <td style={tdStyle}>
                    {exhausted ? (
                      <span style={{ color: '#9ca3af', fontSize: 12 }}>
                        Fully returned
                      </span>
                    ) : (
                      remaining
                    )}
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      min={1}
                      max={remaining}
                      value={s?.qty ?? remaining}
                      disabled={!s?.checked || exhausted}
                      onChange={(e) =>
                        updateQty(
                          item.id,
                          parseInt(e.target.value, 10) || 1,
                          remaining,
                        )
                      }
                      style={{
                        width: 64,
                        padding: 4,
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        fontSize: 13,
                      }}
                    />
                  </td>
                  <td style={tdStyle}>
                    <select
                      value={s?.condition ?? 'SALEABLE'}
                      disabled={!s?.checked || exhausted}
                      onChange={(e) =>
                        updateCondition(
                          item.id,
                          e.target.value as PosReturnCondition,
                        )
                      }
                      style={{
                        padding: 4,
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        fontSize: 12,
                        background: '#fff',
                      }}
                    >
                      <option value="SALEABLE">Saleable</option>
                      <option value="DAMAGED">Damaged</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Refund details — refundMethod is REQUIRED by the backend. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div>
          <label style={labelStyle}>Refund Method *</label>
          <select
            value={refundMethod}
            onChange={(e) =>
              setRefundMethod(e.target.value as PosRefundMethod)
            }
            style={{ ...selectStyle, width: '100%', marginTop: 6 }}
          >
            {REFUND_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Refund Reference (optional)</label>
          <input
            type="text"
            value={refundReference}
            maxLength={120}
            onChange={(e) => setRefundReference(e.target.value)}
            placeholder="UPI ref / reversal id / note"
            style={{ ...selectStyle, width: '100%', marginTop: 6 }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Return Reason (optional)</label>
        <textarea
          value={returnReason}
          maxLength={500}
          rows={2}
          onChange={(e) => setReturnReason(e.target.value)}
          placeholder="Reason for the return..."
          style={{
            width: '100%',
            padding: 10,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 13,
            marginTop: 6,
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
          {returnReason.length}/500 characters
        </div>
      </div>

      {/* Live refund preview. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 12,
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>
          Customer will be refunded
        </span>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#166534' }}>
          {formatInr(refundPreview)}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={isSaving}
        >
          {isSaving ? 'Processing...' : 'Confirm Return'}
        </button>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════
// SHARED STYLES & HELPERS
// ══════════════════════════════════════════════════════════════

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  outline: 'none',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  background: '#f9fafb',
  fontSize: 11,
  fontWeight: 700,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  borderBottom: '1px solid #e5e7eb',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: '#374151',
  verticalAlign: 'middle',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
};

const valueStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: '#111827',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  color: '#374151',
};

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div style={labelStyle}>{label}</div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color,
          marginTop: 6,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// One row of the totals strip shown on the ViewSaleModal. Keeps the
// JSX above readable by hiding the inline-style boilerplate.
function Totals({
  label,
  value,
  muted,
  bold,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 13,
        marginBottom: 4,
        color: muted ? '#6b7280' : '#111827',
        fontWeight: bold ? 600 : 400,
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

