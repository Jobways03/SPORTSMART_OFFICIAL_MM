'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import {
  franchiseAdminDeliveryMethodsService,
  type FranchiseDeliveryMethodSettings,
} from '@/services/admin-delivery-methods.service';

/**
 * Franchise-admin delivery-method settings page. Same UX as the
 * marketplace-admin seller version. The franchise admin uses this
 * screen to toggle Self Delivery for each franchise and set the
 * service-area pincodes.
 */
export default function FranchiseDeliveryMethodsPage() {
  const params = useParams();
  const router = useRouter();
  const franchiseId = String(params?.id ?? '');

  const [settings, setSettings] = useState<FranchiseDeliveryMethodSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Two error channels:
  //   - loadError: the initial GET failed. Collapse the page to an
  //     error message because we have nothing to render.
  //   - actionError: a save action (toggle / pincodes) failed. Keep
  //     the page visible and surface the error inline as a banner so
  //     the admin can correct and retry without losing context.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pincodeInput, setPincodeInput] = useState('');

  useEffect(() => {
    if (!franchiseId) return;
    setLoading(true);
    franchiseAdminDeliveryMethodsService
      .get(franchiseId)
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
  }, [franchiseId]);

  const save = async (
    patch: Parameters<typeof franchiseAdminDeliveryMethodsService.update>[1],
  ) => {
    setSaving(true);
    setActionError(null);
    try {
      const res = await franchiseAdminDeliveryMethodsService.update(franchiseId, patch);
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
    save({ selfDeliveryPincodes: pincodes });
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#6b7280' }}>Loading...</div>;
  }
  // Only collapse the page on initial-load failure (loadError). An
  // action error keeps the page visible so the admin can fix the
  // underlying issue and retry from the same screen.
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
        onClick={() => router.push(`/dashboard/franchises/${franchiseId}`)}
        style={{
          marginBottom: 12,
          background: 'transparent',
          border: 'none',
          color: '#2563eb',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        ← Back to franchise
      </button>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Delivery Methods</h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 24 }}>
        {settings.businessName}
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
              Leave empty to serve everywhere. Pincodes must be 6 digits.
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
