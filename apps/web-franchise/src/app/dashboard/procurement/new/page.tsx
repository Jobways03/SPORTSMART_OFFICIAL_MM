'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  franchiseCatalogService,
  CatalogMapping,
} from '@/services/catalog.service';
import { useModal } from '@sportsmart/ui';
import {
  franchiseProcurementService,
  CreateProcurementPayload,
  formatProcurementCurrency,
} from '@/services/procurement.service';
import { ApiError } from '@/lib/api-client';

type Step = 1 | 2;

interface SelectedItem {
  mappingId: string;
  productId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  globalSku: string;
  basePrice: number | null;
  quantity: number;
  imageUrl?: string;
}

export default function NewProcurementPage() {
  const { notify, confirmDialog } = useModal();
const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  const [mappings, setMappings] = useState<CatalogMapping[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(true);
  const [mappingsError, setMappingsError] = useState('');
  const [search, setSearch] = useState('');

  // mappingId -> SelectedItem
  const [selection, setSelection] = useState<Record<string, SelectedItem>>({});
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [submitMode, setSubmitMode] = useState<'draft' | 'submit' | null>(null);

  const loadMappings = useCallback(async () => {
    setLoadingMappings(true);
    setMappingsError('');
    try {
      const res = await franchiseCatalogService.listMappings({
        page: 1,
        limit: 200,
        isActive: true,
        approvalStatus: 'APPROVED',
      });
      if (res.data) {
        setMappings(res.data.mappings);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setMappingsError('Failed to load catalog mappings. Please try again.');
    } finally {
      setLoadingMappings(false);
    }
  }, [router]);

  useEffect(() => {
    loadMappings();
  }, [loadMappings]);

  const filteredMappings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mappings;
    return mappings.filter((m) => {
      const title = m.product?.title?.toLowerCase() || '';
      const sku = m.globalSku?.toLowerCase() || '';
      const fSku = m.franchiseSku?.toLowerCase() || '';
      const vTitle = m.variant?.title?.toLowerCase() || '';
      return (
        title.includes(q) || sku.includes(q) || fSku.includes(q) || vTitle.includes(q)
      );
    });
  }, [mappings, search]);

  const selectedItems = useMemo(() => Object.values(selection), [selection]);
  const selectedCount = selectedItems.length;

  const handleQuantityChange = (mapping: CatalogMapping, rawValue: string) => {
    const qty = Math.max(0, Math.floor(Number(rawValue) || 0));
    setSelection((prev) => {
      const next = { ...prev };
      if (qty <= 0) {
        delete next[mapping.id];
      } else {
        next[mapping.id] = {
          mappingId: mapping.id,
          productId: mapping.productId,
          variantId: mapping.variantId,
          productTitle: mapping.product?.title || 'Untitled product',
          variantTitle: mapping.variant?.title || null,
          globalSku: mapping.globalSku,
          basePrice: mapping.product?.basePrice ?? null,
          imageUrl: mapping.product?.images?.find((i) => i.isPrimary)?.url,
          quantity: qty,
        };
      }
      return next;
    });
  };

  const handleRemoveSelected = (mappingId: string) => {
    setSelection((prev) => {
      const next = { ...prev };
      delete next[mappingId];
      return next;
    });
  };

  const estimatedTotal = useMemo(
    () =>
      selectedItems.reduce(
        (sum, it) => sum + (it.basePrice || 0) * it.quantity,
        0,
      ),
    [selectedItems],
  );

  const buildPayload = (): CreateProcurementPayload => ({
    items: selectedItems.map((it) => ({
      productId: it.productId,
      variantId: it.variantId || undefined,
      quantity: it.quantity,
    })),
    notes: notes.trim() || undefined,
  });

  const handleSaveDraft = async () => {if (selectedCount === 0) {
      void notify('Please select at least one item.');
      return;
    }
    setSaving(true);
    setSubmitMode('draft');
    try {
      const res = await franchiseProcurementService.create(buildPayload());
      if (res.data) {
        router.replace('/dashboard/procurement');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        void notify(err.body.message || 'Failed to save draft.');
      } else {
        void notify('Failed to save draft.');
      }
    } finally {
      setSaving(false);
      setSubmitMode(null);
    }
  };

  const handleSubmitForApproval = async () => {if (selectedCount === 0) {
      void notify('Please select at least one item.');
      return;
    }
    setSaving(true);
    setSubmitMode('submit');
    try {
      const createRes = await franchiseProcurementService.create(buildPayload());
      const created = createRes.data;
      if (created) {
        try {
          await franchiseProcurementService.submit(created.id);
        } catch (err) {
          if (err instanceof ApiError) {
            void notify(
              `Request created but failed to submit: ${err.body.message || 'Unknown error'}`,
            );
          } else {
            void notify('Request created but failed to submit.');
          }
          router.replace(`/dashboard/procurement/${created.id}`);
          return;
        }
        router.replace(`/dashboard/procurement/${created.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        void notify(err.body.message || 'Failed to create request.');
      } else {
        void notify('Failed to create request.');
      }
    } finally {
      setSaving(false);
      setSubmitMode(null);
    }
  };

  const renderStepIndicator = () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 24,
      }}
    >
      {[
        { n: 1, label: 'Select Products' },
        { n: 2, label: 'Review & Submit' },
      ].map((s, idx) => {
        const isActive = step === s.n;
        const isDone = step > s.n;
        return (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 16px',
                borderRadius: 999,
                background: isActive || isDone ? '#eff6ff' : '#f3f4f6',
                border: `1px solid ${isActive ? '#2563eb' : isDone ? '#93c5fd' : '#e5e7eb'}`,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: isActive || isDone ? '#2563eb' : '#d1d5db',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {s.n}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: isActive || isDone ? '#1d4ed8' : '#6b7280',
                }}
              >
                {s.label}
              </span>
            </div>
            {idx === 0 && (
              <span style={{ color: '#d1d5db', fontSize: 16 }}>&#8594;</span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>New Procurement Request</h1>
          <p>Select items from your catalog and submit a request for stock</p>
        </div>
        <Link
          href="/dashboard/procurement"
          className="btn btn-secondary"
          style={{ textDecoration: 'none' }}
        >
          Cancel
        </Link>
      </div>

      {renderStepIndicator()}

      {step === 1 && (
        <>
          <div
            className="card"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <input
              type="text"
              placeholder="Search mapped products by name, SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: '1 1 260px',
                padding: '10px 12px',
                fontSize: 14,
                border: '1px solid #d1d5db',
                borderRadius: 8,
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: 14,
                fontWeight: 600,
                color: '#111827',
              }}
            >
              <span
                style={{
                  background: '#eff6ff',
                  color: '#1d4ed8',
                  padding: '6px 12px',
                  borderRadius: 999,
                  fontSize: 13,
                }}
              >
                Selected: {selectedCount} item{selectedCount === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={selectedCount === 0}
                onClick={() => setStep(2)}
              >
                Continue &#8594;
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loadingMappings ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
                Loading...
              </div>
            ) : mappingsError ? (
              <div style={{ padding: 32, textAlign: 'center' }}>
                <p style={{ color: '#dc2626', marginBottom: 12 }}>{mappingsError}</p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={loadMappings}
                >
                  Retry
                </button>
              </div>
            ) : filteredMappings.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>&#128269;</div>
                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: '#111827',
                    marginBottom: 6,
                  }}
                >
                  {mappings.length === 0
                    ? 'No approved catalog mappings'
                    : 'No products match your search'}
                </h3>
                <p style={{ fontSize: 13, color: '#6b7280' }}>
                  {mappings.length === 0
                    ? 'Map products to your franchise catalog to order stock.'
                    : 'Try a different search term.'}
                </p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 14,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: '#f9fafb',
                        borderBottom: '1px solid #e5e7eb',
                      }}
                    >
                      {['Product', 'SKU', 'Base Price', 'Quantity'].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: '12px 16px',
                            textAlign: 'left',
                            fontSize: 12,
                            fontWeight: 600,
                            color: '#6b7280',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMappings.map((m) => {
                      const img = m.product?.images?.find((i) => i.isPrimary)?.url;
                      const selected = selection[m.id];
                      return (
                        <tr
                          key={m.id}
                          style={{
                            borderBottom: '1px solid #f3f4f6',
                            background: selected ? '#eff6ff' : 'transparent',
                          }}
                        >
                          <td style={{ padding: '12px 16px' }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                              }}
                            >
                              {img ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={img}
                                  alt={m.product?.title || ''}
                                  style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 6,
                                    objectFit: 'cover',
                                    background: '#f3f4f6',
                                  }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 6,
                                    background: '#f3f4f6',
                                  }}
                                />
                              )}
                              <div>
                                <div style={{ fontWeight: 600, color: '#111827' }}>
                                  {m.product?.title || 'Untitled'}
                                </div>
                                {m.variant?.title && (
                                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                                    {m.variant.title}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td
                            style={{
                              padding: '12px 16px',
                              fontFamily:
                                'ui-monospace, SFMono-Regular, Menlo, monospace',
                              fontSize: 12,
                              color: '#374151',
                            }}
                          >
                            {m.globalSku}
                          </td>
                          <td style={{ padding: '12px 16px', color: '#374151' }}>
                            {m.product?.basePrice != null
                              ? formatProcurementCurrency(m.product.basePrice)
                              : '—'}
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <input
                              type="number"
                              min={0}
                              value={selected?.quantity ?? 0}
                              onChange={(e) =>
                                handleQuantityChange(m, e.target.value)
                              }
                              style={{
                                width: 90,
                                padding: '8px 10px',
                                fontSize: 14,
                                border: '1px solid #d1d5db',
                                borderRadius: 6,
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <h2 style={{ margin: 0 }}>Review Items ({selectedCount})</h2>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep(1)}
                disabled={saving}
              >
                Edit Quantities
              </button>
            </div>

            {selectedItems.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                No items selected. Go back and pick some products.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 14,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        background: '#f9fafb',
                        borderBottom: '1px solid #e5e7eb',
                      }}
                    >
                      {['Product', 'SKU', 'Qty', 'Est. Price', 'Est. Subtotal', ''].map(
                        (h) => (
                          <th
                            key={h}
                            style={{
                              padding: '10px 14px',
                              textAlign: 'left',
                              fontSize: 11,
                              fontWeight: 600,
                              color: '#6b7280',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedItems.map((it) => {
                      const subtotal = (it.basePrice || 0) * it.quantity;
                      return (
                        <tr
                          key={it.mappingId}
                          style={{ borderBottom: '1px solid #f3f4f6' }}
                        >
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ fontWeight: 600, color: '#111827' }}>
                              {it.productTitle}
                            </div>
                            {it.variantTitle && (
                              <div style={{ fontSize: 12, color: '#6b7280' }}>
                                {it.variantTitle}
                              </div>
                            )}
                          </td>
                          <td
                            style={{
                              padding: '12px 14px',
                              fontFamily:
                                'ui-monospace, SFMono-Regular, Menlo, monospace',
                              fontSize: 12,
                              color: '#374151',
                            }}
                          >
                            {it.globalSku}
                          </td>
                          <td style={{ padding: '12px 14px', color: '#111827' }}>
                            {it.quantity}
                          </td>
                          <td style={{ padding: '12px 14px', color: '#374151' }}>
                            {it.basePrice != null
                              ? formatProcurementCurrency(it.basePrice)
                              : '—'}
                          </td>
                          <td style={{ padding: '12px 14px', color: '#111827' }}>
                            {it.basePrice != null
                              ? formatProcurementCurrency(subtotal)
                              : '—'}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <button
                              type="button"
                              onClick={() => handleRemoveSelected(it.mappingId)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#dc2626',
                                fontSize: 13,
                                cursor: 'pointer',
                                fontWeight: 600,
                              }}
                              disabled={saving}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f9fafb' }}>
                      <td
                        colSpan={4}
                        style={{
                          padding: '12px 14px',
                          textAlign: 'right',
                          fontWeight: 600,
                          color: '#374151',
                          fontSize: 13,
                        }}
                      >
                        Estimated Total
                      </td>
                      <td
                        colSpan={2}
                        style={{
                          padding: '12px 14px',
                          fontWeight: 700,
                          color: '#111827',
                          fontSize: 14,
                        }}
                      >
                        {formatProcurementCurrency(estimatedTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <label
                htmlFor="notes"
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: 6,
                }}
              >
                Notes (optional)
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Add any special instructions or context for this request..."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 14,
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
                disabled={saving}
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: 12,
                justifyContent: 'flex-end',
                marginTop: 24,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep(1)}
                disabled={saving}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSaveDraft}
                disabled={saving || selectedCount === 0}
              >
                {saving && submitMode === 'draft' ? 'Saving...' : 'Save as Draft'}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmitForApproval}
                disabled={saving || selectedCount === 0}
              >
                {saving && submitMode === 'submit'
                  ? 'Submitting...'
                  : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
