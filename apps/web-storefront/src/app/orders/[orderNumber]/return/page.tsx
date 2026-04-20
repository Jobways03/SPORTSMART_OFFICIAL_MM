'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { apiClient } from '@/lib/api-client';
import {
  returnsService,
  ReturnEligibility,
  REASON_CATEGORIES,
  CreateReturnPayload,
} from '@/services/returns.service';

interface OrderLookup {
  id: string;
  orderNumber: string;
}

interface SelectedItemState {
  orderItemId: string;
  selected: boolean;
  quantity: number;
  reasonCategory: string;
  reasonDetail: string;
}

type Step = 'subOrder' | 'items' | 'reasons' | 'review';

export default function InitiateReturnPage() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [eligibility, setEligibility] = useState<ReturnEligibility | null>(null);

  const [step, setStep] = useState<Step>('subOrder');
  const [selectedSubOrderId, setSelectedSubOrderId] = useState<string>('');
  const [itemStates, setItemStates] = useState<Record<string, SelectedItemState>>({});
  const [customerNotes, setCustomerNotes] = useState('');

  const loadEligibility = useCallback(async () => {
    setLoading(true);
    try {
      // First look up masterOrderId from orderNumber
      const orderRes = await apiClient<OrderLookup>(`/customer/orders/${orderNumber}`);
      if (!orderRes.data) {
        alert('Order not found');
        router.push('/orders');
        return;
      }
      const masterOrderId = orderRes.data.id;
      const res = await returnsService.checkEligibility(masterOrderId);
      if (res.data) {
        setEligibility(res.data);
        // If only one sub-order is eligible, auto-select it
        const validSubOrders = res.data.eligibleSubOrders.filter(
          (so) => !so.windowExpired && so.items.some((it) => it.eligible),
        );
        if (validSubOrders.length === 1) {
          selectSubOrder(validSubOrders[0].subOrderId, res.data);
        }
      }
    } catch {
      alert('Failed to load return eligibility');
    } finally {
      setLoading(false);
    }
  }, [orderNumber, router]);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('accessToken')) {
        router.push('/login');
        return;
      }
    } catch {
      router.push('/login');
      return;
    }
    loadEligibility();
  }, [loadEligibility]);

  const selectSubOrder = (subOrderId: string, elig?: ReturnEligibility) => {
    const source = elig || eligibility;
    if (!source) return;
    const so = source.eligibleSubOrders.find((s) => s.subOrderId === subOrderId);
    if (!so) return;
    const states: Record<string, SelectedItemState> = {};
    for (const item of so.items) {
      if (item.eligible && item.availableForReturn > 0) {
        states[item.orderItemId] = {
          orderItemId: item.orderItemId,
          selected: false,
          quantity: 1,
          reasonCategory: '',
          reasonDetail: '',
        };
      }
    }
    setSelectedSubOrderId(subOrderId);
    setItemStates(states);
    setStep('items');
  };

  const toggleItem = (orderItemId: string) => {
    setItemStates((prev) => ({
      ...prev,
      [orderItemId]: {
        ...prev[orderItemId],
        selected: !prev[orderItemId].selected,
      },
    }));
  };

  const updateItemQty = (orderItemId: string, quantity: number) => {
    setItemStates((prev) => ({
      ...prev,
      [orderItemId]: { ...prev[orderItemId], quantity },
    }));
  };

  const updateItemReason = (orderItemId: string, reasonCategory: string) => {
    setItemStates((prev) => ({
      ...prev,
      [orderItemId]: { ...prev[orderItemId], reasonCategory },
    }));
  };

  const updateItemDetail = (orderItemId: string, reasonDetail: string) => {
    setItemStates((prev) => ({
      ...prev,
      [orderItemId]: { ...prev[orderItemId], reasonDetail },
    }));
  };

  const selectedItems = Object.values(itemStates).filter((s) => s.selected);

  const handleItemsNext = () => {
    if (selectedItems.length === 0) {
      alert('Select at least one item to return');
      return;
    }
    setStep('reasons');
  };

  const handleReasonsNext = () => {
    for (const item of selectedItems) {
      if (!item.reasonCategory) {
        alert('Please select a reason for all items');
        return;
      }
    }
    setStep('review');
  };

  const handleSubmit = async () => {
    if (!selectedSubOrderId) return;
    setSubmitting(true);
    try {
      const payload: CreateReturnPayload = {
        subOrderId: selectedSubOrderId,
        items: selectedItems.map((it) => ({
          orderItemId: it.orderItemId,
          quantity: it.quantity,
          reasonCategory: it.reasonCategory,
          reasonDetail: it.reasonDetail || undefined,
        })),
        customerNotes: customerNotes || undefined,
      };
      const res = await returnsService.create(payload);
      if (res.success && res.data) {
        router.push(`/returns/${res.data.id}`);
      } else {
        alert(res.message || 'Failed to create return');
      }
    } catch (e: any) {
      alert(e?.body?.message || e?.message || 'Failed to create return');
    } finally {
      setSubmitting(false);
    }
  };

  const formatPrice = (price: number) =>
    `\u20B9${Number(price).toLocaleString('en-IN')}`;
  const formatDate = (d: string | null) =>
    d
      ? new Date(d).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '-';

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="products-loading">Loading return eligibility...</div>
      </>
    );
  }

  if (!eligibility || !eligibility.eligible) {
    return (
      <>
        <Navbar />
        <div
          style={{
            maxWidth: 700,
            margin: '0 auto',
            padding: '60px 16px',
            textAlign: 'center',
          }}
        >
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            Return Not Available
          </h3>
          <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
            {eligibility?.reason || 'This order is not eligible for returns.'}
          </p>
          <Link
            href={`/orders/${orderNumber}`}
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              background: '#2563eb',
              color: '#fff',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Back to Order
          </Link>
        </div>
      </>
    );
  }

  const currentSubOrder = eligibility.eligibleSubOrders.find(
    (so) => so.subOrderId === selectedSubOrderId,
  );
  const eligibleSubOrders = eligibility.eligibleSubOrders.filter(
    (so) => !so.windowExpired && so.items.some((it) => it.eligible),
  );

  const StepIndicator = ({ current }: { current: Step }) => {
    const steps: Array<{ key: Step; label: string }> = [];
    if (eligibleSubOrders.length > 1) {
      steps.push({ key: 'subOrder', label: 'Select Shipment' });
    }
    steps.push({ key: 'items', label: 'Select Items' });
    steps.push({ key: 'reasons', label: 'Reasons' });
    steps.push({ key: 'review', label: 'Review' });

    const currentIdx = steps.findIndex((s) => s.key === current);
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          padding: '16px 0',
          marginBottom: 16,
        }}
      >
        {steps.map((s, idx) => {
          const isActive = idx <= currentIdx;
          const isLast = idx === steps.length - 1;
          return (
            <div
              key={s.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                flex: isLast ? '0 0 auto' : '1 1 0',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  minWidth: 70,
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: isActive ? '#2563eb' : '#e5e7eb',
                    color: isActive ? '#fff' : '#9ca3af',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {idx + 1}
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: isActive ? '#374151' : '#9ca3af',
                    fontWeight: isActive ? 600 : 400,
                    marginTop: 4,
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.label}
                </span>
              </div>
              {!isLast && (
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: idx < currentIdx ? '#2563eb' : '#e5e7eb',
                    marginTop: -16,
                    minWidth: 20,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <Navbar />
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px 60px' }}>
        <Link
          href={`/orders/${orderNumber}`}
          style={{
            fontSize: 14,
            color: '#6b7280',
            textDecoration: 'none',
            marginBottom: 16,
            display: 'inline-block',
          }}
        >
          &#8592; Back to Order
        </Link>

        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Return Items</h1>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
          Order {orderNumber}
        </div>

        <StepIndicator current={step} />

        {/* Step: subOrder */}
        {step === 'subOrder' && (
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
              Select a shipment
            </h3>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              You can return items from one shipment at a time.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {eligibility.eligibleSubOrders.map((so) => {
                const eligibleCount = so.items.filter((i) => i.eligible).length;
                const disabled = so.windowExpired || eligibleCount === 0;
                return (
                  <button
                    key={so.subOrderId}
                    onClick={() => !disabled && selectSubOrder(so.subOrderId)}
                    disabled={disabled}
                    style={{
                      textAlign: 'left',
                      border: '1px solid #e5e7eb',
                      borderRadius: 10,
                      padding: 16,
                      background: disabled ? '#f9fafb' : '#fff',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.6 : 1,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600 }}>
                        Shipment {so.orderNumber}
                      </span>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>
                        Delivered: {formatDate(so.deliveredAt)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {so.items.length} item{so.items.length !== 1 ? 's' : ''} &middot;{' '}
                      {eligibleCount} eligible
                    </div>
                    {so.returnWindowEndsAt && !so.windowExpired && (
                      <div style={{ fontSize: 11, color: '#2563eb', marginTop: 4 }}>
                        Return window ends: {formatDate(so.returnWindowEndsAt)}
                      </div>
                    )}
                    {so.windowExpired && (
                      <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>
                        Return window expired
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step: items */}
        {step === 'items' && currentSubOrder && (
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
              Select items to return
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {currentSubOrder.items.map((item) => {
                const state = itemStates[item.orderItemId];
                if (!state) {
                  return (
                    <div
                      key={item.orderItemId}
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: 10,
                        padding: 12,
                        background: '#f9fafb',
                        opacity: 0.6,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <div
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: 8,
                            background: '#f3f4f6',
                            overflow: 'hidden',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <span style={{ fontSize: 22, color: '#d1d5db' }}>
                              &#128722;
                            </span>
                          )}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, fontSize: 14 }}>
                            {item.productTitle}
                          </div>
                          {item.variantTitle && (
                            <div style={{ fontSize: 12, color: '#6b7280' }}>
                              {item.variantTitle}
                            </div>
                          )}
                          <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>
                            Not eligible for return
                            {item.alreadyReturnedQty > 0 &&
                              ` \u00B7 Already returned: ${item.alreadyReturnedQty}`}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={item.orderItemId}
                    style={{
                      border: state.selected ? '1px solid #2563eb' : '1px solid #e5e7eb',
                      borderRadius: 10,
                      padding: 12,
                      background: state.selected ? '#eff6ff' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <input
                        type="checkbox"
                        checked={state.selected}
                        onChange={() => toggleItem(item.orderItemId)}
                        style={{ marginTop: 4, width: 16, height: 16, cursor: 'pointer' }}
                      />
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 8,
                          background: '#f3f4f6',
                          overflow: 'hidden',
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '1px solid #e5e7eb',
                        }}
                      >
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <span style={{ fontSize: 22, color: '#d1d5db' }}>&#128722;</span>
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>
                          {item.productTitle}
                        </div>
                        {item.variantTitle && (
                          <div style={{ fontSize: 12, color: '#6b7280' }}>
                            {item.variantTitle}
                          </div>
                        )}
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                          Price: {formatPrice(Number(item.unitPrice))} &middot; Available:{' '}
                          {item.availableForReturn}
                        </div>
                        {state.selected && (
                          <div
                            style={{
                              marginTop: 8,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                            }}
                          >
                            <label style={{ fontSize: 12, color: '#374151' }}>
                              Quantity:
                            </label>
                            <select
                              value={state.quantity}
                              onChange={(e) =>
                                updateItemQty(item.orderItemId, Number(e.target.value))
                              }
                              style={{
                                padding: '4px 8px',
                                fontSize: 13,
                                border: '1px solid #e5e7eb',
                                borderRadius: 6,
                              }}
                            >
                              {Array.from(
                                { length: item.availableForReturn },
                                (_, i) => i + 1,
                              ).map((q) => (
                                <option key={q} value={q}>
                                  {q}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 20,
                gap: 12,
              }}
            >
              {eligibleSubOrders.length > 1 ? (
                <button
                  onClick={() => setStep('subOrder')}
                  style={{
                    padding: '10px 20px',
                    fontSize: 14,
                    fontWeight: 600,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    color: '#374151',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  Back
                </button>
              ) : (
                <div />
              )}
              <button
                onClick={handleItemsNext}
                style={{
                  padding: '10px 24px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: '1px solid #2563eb',
                  background: '#2563eb',
                  color: '#fff',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step: reasons */}
        {step === 'reasons' && currentSubOrder && (
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
              Tell us why you&apos;re returning
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {selectedItems.map((state) => {
                const item = currentSubOrder.items.find(
                  (i) => i.orderItemId === state.orderItemId,
                );
                if (!item) return null;
                return (
                  <div
                    key={state.orderItemId}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: 10,
                      padding: 14,
                      background: '#fff',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        gap: 10,
                        marginBottom: 10,
                        alignItems: 'center',
                      }}
                    >
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 6,
                          background: '#f3f4f6',
                          overflow: 'hidden',
                          flexShrink: 0,
                          border: '1px solid #e5e7eb',
                        }}
                      >
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : null}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>
                          {item.productTitle}
                        </div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>
                          Qty: {state.quantity}
                        </div>
                      </div>
                    </div>
                    <label
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#374151',
                        marginBottom: 4,
                        display: 'block',
                      }}
                    >
                      Reason
                    </label>
                    <select
                      value={state.reasonCategory}
                      onChange={(e) =>
                        updateItemReason(state.orderItemId, e.target.value)
                      }
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: 13,
                        border: '1px solid #e5e7eb',
                        borderRadius: 6,
                        marginBottom: 10,
                      }}
                    >
                      <option value="">Select a reason...</option>
                      {REASON_CATEGORIES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <label
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#374151',
                        marginBottom: 4,
                        display: 'block',
                      }}
                    >
                      Additional Details (optional)
                    </label>
                    <textarea
                      value={state.reasonDetail}
                      onChange={(e) =>
                        updateItemDetail(state.orderItemId, e.target.value)
                      }
                      rows={2}
                      placeholder="Tell us more about the issue..."
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: 13,
                        border: '1px solid #e5e7eb',
                        borderRadius: 6,
                        fontFamily: 'inherit',
                        resize: 'vertical',
                      }}
                    />
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 16 }}>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: 4,
                  display: 'block',
                }}
              >
                Overall Notes (optional)
              </label>
              <textarea
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                rows={3}
                placeholder="Any additional information for our team..."
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: 13,
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 20,
                gap: 12,
              }}
            >
              <button
                onClick={() => setStep('items')}
                style={{
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  color: '#374151',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
              <button
                onClick={handleReasonsNext}
                style={{
                  padding: '10px 24px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: '1px solid #2563eb',
                  background: '#2563eb',
                  color: '#fff',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step: review */}
        {step === 'review' && currentSubOrder && (
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
              Review your return
            </h3>

            <div
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                From shipment {currentSubOrder.orderNumber}
              </div>
              {selectedItems.map((state) => {
                const item = currentSubOrder.items.find(
                  (i) => i.orderItemId === state.orderItemId,
                );
                if (!item) return null;
                const reasonLabel = REASON_CATEGORIES.find(
                  (r) => r.value === state.reasonCategory,
                )?.label;
                return (
                  <div
                    key={state.orderItemId}
                    style={{
                      display: 'flex',
                      gap: 12,
                      paddingTop: 10,
                      paddingBottom: 10,
                      borderTop: '1px solid #f3f4f6',
                    }}
                  >
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 8,
                        background: '#f3f4f6',
                        overflow: 'hidden',
                        flexShrink: 0,
                        border: '1px solid #e5e7eb',
                      }}
                    >
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : null}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>
                        {item.productTitle}
                      </div>
                      {item.variantTitle && (
                        <div style={{ fontSize: 12, color: '#6b7280' }}>
                          {item.variantTitle}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        Qty: {state.quantity} x {formatPrice(Number(item.unitPrice))}
                      </div>
                      <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
                        <strong>Reason:</strong> {reasonLabel}
                      </div>
                      {state.reasonDetail && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                          {state.reasonDetail}
                        </div>
                      )}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>
                      {formatPrice(Number(item.unitPrice) * state.quantity)}
                    </div>
                  </div>
                );
              })}
            </div>

            {customerNotes && (
              <div
                style={{
                  background: '#f9fafb',
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                  Notes
                </div>
                <div style={{ fontSize: 13, color: '#374151' }}>{customerNotes}</div>
              </div>
            )}

            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: 10,
                padding: 14,
                marginBottom: 16,
                fontSize: 12,
                color: '#92400e',
              }}
            >
              Your return request will be reviewed by our team. You will be notified
              once it is approved or rejected.
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 20,
                gap: 12,
              }}
            >
              <button
                onClick={() => setStep('reasons')}
                disabled={submitting}
                style={{
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  color: '#374151',
                  borderRadius: 8,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  padding: '10px 24px',
                  fontSize: 14,
                  fontWeight: 600,
                  border: '1px solid #16a34a',
                  background: '#16a34a',
                  color: '#fff',
                  borderRadius: 8,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? 'Submitting...' : 'Submit Return Request'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
