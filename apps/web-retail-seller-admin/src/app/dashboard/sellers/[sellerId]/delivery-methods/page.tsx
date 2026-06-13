'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import {
  adminDeliveryMethodsService,
  type SellerDeliveryMethodSettings,
} from '@/services/admin-delivery-methods.service';
import { validatePincode } from '@/lib/validators';

/**
 * Per-seller delivery-method entitlements page in the seller admin.
 * The marketplace admin toggles Self Delivery for the seller from
 * here and sets the service-area pincodes.
 */
export default function SellerDeliveryMethodsPage() {
  const params = useParams();
  const router = useRouter();
  const sellerId = String(params?.sellerId ?? '');

  const [settings, setSettings] = useState<SellerDeliveryMethodSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Split error state: load errors collapse the page, action errors
  // stay inline as a dismissible banner so the admin can correct and
  // retry without losing the rest of the screen.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pincodeInput, setPincodeInput] = useState('');

  useEffect(() => {
    if (!sellerId) return;
    setLoading(true);
    adminDeliveryMethodsService
      .getSellerSettings(sellerId)
      .then((res) => {
        if (res.data) {
          setSettings(res.data);
          setPincodeInput((res.data.selfDeliveryPincodes ?? []).join(', '));
        } else {
          setLoadError(res.message ?? 'Failed to load delivery settings');
        }
      })
      .catch((e) => setLoadError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [sellerId]);

  const save = async (
    patch: Parameters<typeof adminDeliveryMethodsService.updateSellerSettings>[1],
  ) => {
    setSaving(true);
    setActionError(null);
    try {
      const res = await adminDeliveryMethodsService.updateSellerSettings(sellerId, patch);
      if (res.data) setSettings(res.data);
      else setActionError(res.message ?? 'Save failed');
    } catch (e: any) {
      setActionError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const onPincodesBlur = () => {
    if (!settings) return;
    const raw = pincodeInput.trim();
    const pincodes = raw
      ? raw
          .split(/[,\s]+/)
          .map((p) => p.trim())
          .filter(Boolean)
      : null;
    // Every service-area pincode must be a valid 6-digit Indian pincode.
    if (pincodes) {
      const invalid = pincodes.find((p) => validatePincode(p) !== null);
      if (invalid) {
        setActionError(`"${invalid}" is not a valid 6-digit pincode`);
        return;
      }
    }
    setActionError(null);
    save({ selfDeliveryPincodes: pincodes });
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#6b7280' }}>Loading...</div>;
  }
  if (loadError || !settings) {
    return (
      <div style={{ padding: 24, color: '#b91c1c' }}>
        {loadError ?? 'Settings not available'}
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px', background: '#f8fafc', minHeight: 'calc(100vh - 56px)' }}>
      <button
        onClick={() => router.push(`/dashboard/sellers/${sellerId}`)}
        style={{
          marginBottom: 12,
          background: 'transparent',
          border: 'none',
          color: '#2563eb',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        ← Back to seller
      </button>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Delivery Methods</h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 24 }}>
        {settings.sellerShopName} · {settings.sellerName}
      </div>

      {actionError && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <span style={{ flex: 1 }}>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#b91c1c',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 0,
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, maxWidth: 560 }}>
        <Card title="Self Delivery" disabled={saving}>
          <Toggle
            checked={settings.selfDeliveryEnabled}
            onChange={(checked) => save({ selfDeliveryEnabled: checked })}
            disabled={saving}
            label={settings.selfDeliveryEnabled ? 'Enabled' : 'Disabled'}
          />
          <div style={{ marginTop: 14 }}>
            <label
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#374151',
                display: 'block',
                marginBottom: 6,
              }}
            >
              Service-area pincodes (optional)
            </label>
            <textarea
              value={pincodeInput}
              onChange={(e) => setPincodeInput(e.target.value)}
              onBlur={onPincodesBlur}
              placeholder="Comma-separated, e.g. 560001, 560002, ..."
              disabled={saving || !settings.selfDeliveryEnabled}
              style={{
                width: '100%',
                minHeight: 80,
                padding: 8,
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: 13,
                fontFamily: 'monospace',
                resize: 'vertical',
              }}
            />
            <p style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
              Leave empty to serve everywhere the seller operates. Pincodes
              must be 6 digits.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Card({
  title,
  disabled,
  children,
}: {
  title: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 20,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, marginBottom: 14 }}>{title}</h2>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 38,
          height: 22,
          borderRadius: 999,
          background: checked ? '#16a34a' : '#cbd5e1',
          position: 'relative',
          transition: 'background 0.15s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.15s',
          }}
        />
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: checked ? '#16a34a' : '#6b7280' }}>
        {label}
      </span>
    </label>
  );
}
