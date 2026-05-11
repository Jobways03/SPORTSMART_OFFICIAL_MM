'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface ShippingOption {
  id: string;
  name: string;
  deliveryDetails: string | null;
  rateType: 'FLAT' | 'FREE';
  priceInPaise: string;
  freeShippingMinCartPaise: string | null;
  transitMinDays: number | null;
  transitMaxDays: number | null;
  isActive: boolean;
}

interface Props {
  option: ShippingOption | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function ShippingOptionForm({ option, onClose, onSaved }: Props) {
  const isEdit = !!option;

  const [name, setName] = useState(option?.name ?? '');
  const [deliveryDetails, setDeliveryDetails] = useState(option?.deliveryDetails ?? '');
  const [rateType, setRateType] = useState<'FLAT' | 'FREE'>(option?.rateType ?? 'FLAT');
  const [priceRupees, setPriceRupees] = useState(
    option ? String(Number(option.priceInPaise) / 100) : '10',
  );
  const [transitMin, setTransitMin] = useState(
    option?.transitMinDays != null ? String(option.transitMinDays) : '',
  );
  const [transitMax, setTransitMax] = useState(
    option?.transitMaxDays != null ? String(option.transitMaxDays) : '',
  );
  const [offerFreeShipping, setOfferFreeShipping] = useState(
    !!option?.freeShippingMinCartPaise,
  );
  const [freeShippingMinRupees, setFreeShippingMinRupees] = useState(
    option?.freeShippingMinCartPaise
      ? String(Number(option.freeShippingMinCartPaise) / 100)
      : '500',
  );
  const [isActive, setIsActive] = useState(option?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      deliveryDetails: deliveryDetails.trim() || null,
      rateType,
      priceInPaise:
        rateType === 'FREE'
          ? 0
          : Math.round(parseFloat(priceRupees || '0') * 100),
      transitMinDays: transitMin.trim() ? parseInt(transitMin, 10) : null,
      transitMaxDays: transitMax.trim() ? parseInt(transitMax, 10) : null,
      freeShippingMinCartPaise:
        offerFreeShipping && rateType === 'FLAT'
          ? Math.round(parseFloat(freeShippingMinRupees || '0') * 100)
          : null,
      isActive,
    };
    try {
      if (isEdit) {
        await apiClient(`/admin/shipping-options/${option!.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiClient('/admin/shipping-options', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (e: any) {
      setError(e?.body?.message?.[0] ?? e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Live preview of what the customer will see at checkout
  const previewPrice = rateType === 'FREE' ? 0 : parseFloat(priceRupees || '0');
  const previewTransit =
    transitMin.trim() && transitMax.trim()
      ? `${transitMin}–${transitMax} business days`
      : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 60,
        zIndex: 1000,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          width: 720,
          maxWidth: '90vw',
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #e5e7eb' }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
            {isEdit ? 'Edit shipping option' : 'Create shipping option'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#6b7280' }}>
            Close
          </button>
        </div>

        <div style={{ padding: 24 }}>
          {/* Name + description */}
          <section style={card}>
            <label style={label}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Shipping Fee"
              style={input}
            />
            <label style={{ ...label, marginTop: 14 }}>Delivery details (optional)</label>
            <input
              value={deliveryDetails}
              onChange={(e) => setDeliveryDetails(e.target.value)}
              placeholder="Standard delivery via Bluedart"
              style={input}
            />
          </section>

          {/* Rate + price + transit */}
          <section style={card}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: '0 0 200px' }}>
                <label style={label}>Rate type</label>
                <select
                  value={rateType}
                  onChange={(e) => setRateType(e.target.value as 'FLAT' | 'FREE')}
                  style={input}
                >
                  <option value="FLAT">Flat</option>
                  <option value="FREE">Free</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={label}>Price</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#6b7280' }}>₹</span>
                  <input
                    type="number"
                    value={rateType === 'FREE' ? '0' : priceRupees}
                    onChange={(e) => setPriceRupees(e.target.value)}
                    disabled={rateType === 'FREE'}
                    min={0}
                    step={0.01}
                    style={{ ...input, paddingLeft: 28, opacity: rateType === 'FREE' ? 0.5 : 1 }}
                  />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={label}>Transit time</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="number"
                    value={transitMin}
                    onChange={(e) => setTransitMin(e.target.value)}
                    placeholder="Min"
                    min={0}
                    style={input}
                  />
                  <span style={{ color: '#9ca3af' }}>–</span>
                  <input
                    type="number"
                    value={transitMax}
                    onChange={(e) => setTransitMax(e.target.value)}
                    placeholder="Max"
                    min={0}
                    style={input}
                  />
                </div>
              </div>
            </div>

            {/* Preview */}
            <div style={{ marginTop: 16, fontSize: 12, color: '#6b7280' }}>Example at checkout</div>
            <div
              style={{
                marginTop: 6,
                padding: '14px 16px',
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: '#2563eb',
                    border: '3px solid #fff',
                    outline: '2px solid #2563eb',
                  }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{name || 'Shipping Fee'}</div>
                  {previewTransit && (
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{previewTransit}</div>
                  )}
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {previewPrice === 0 ? 'FREE' : `₹${previewPrice.toFixed(2)}`}
              </div>
            </div>

            {!previewTransit && (
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  background: '#fef3c7',
                  borderRadius: 6,
                  fontSize: 12,
                  color: '#78350f',
                }}
              >
                Not showing transit time may impact conversion at checkout
              </div>
            )}
          </section>

          {/* Free shipping toggle */}
          {rateType === 'FLAT' && (
            <section style={card}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={offerFreeShipping}
                  onChange={(e) => setOfferFreeShipping(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: '#303030' }}
                />
                <span style={{ fontSize: 14, fontWeight: 500 }}>Offer free shipping above a minimum order</span>
              </label>
              {offerFreeShipping && (
                <div style={{ marginTop: 12, marginLeft: 26 }}>
                  <label style={label}>Minimum order amount (₹)</label>
                  <input
                    type="number"
                    value={freeShippingMinRupees}
                    onChange={(e) => setFreeShippingMinRupees(e.target.value)}
                    min={0}
                    step={1}
                    style={{ ...input, width: 240 }}
                  />
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    Customers whose cart subtotal (after coupon discount) is at or
                    above this amount get this shipping option for free.
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Status */}
          <section style={card}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: '#303030' }}
              />
              <span style={{ fontSize: 14, fontWeight: 500 }}>
                Active — show at checkout
              </span>
            </label>
          </section>

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 14px',
                background: '#fee2e2',
                color: '#991b1b',
                border: '1px solid #fca5a5',
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={btnPrimary}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#fafbfc',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: 18,
  marginBottom: 14,
};
const label: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 6,
};
const input: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 8,
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
};
const btnPrimary: React.CSSProperties = {
  padding: '9px 20px',
  fontSize: 13,
  fontWeight: 600,
  background: '#303030',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '9px 20px',
  fontSize: 13,
  fontWeight: 600,
  background: '#fff',
  color: '#303030',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  cursor: 'pointer',
};
