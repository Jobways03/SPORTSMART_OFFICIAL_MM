'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useModal } from '@sportsmart/ui';

import {
  adminDeliveryMethodsService,
  type IThinkWarehouseApprovalStatus,
  type SellerDeliveryMethodSettings,
} from '@/services/admin-delivery-methods.service';

/**
 * Per-seller delivery-method entitlements page in the seller admin.
 * The marketplace admin toggles iThink and Self Delivery for the
 * seller from here. Enabling iThink the first time triggers a
 * server-side Add Warehouse call which returns PENDING until iThink
 * ops approves (~24h).
 */
export default function SellerDeliveryMethodsPage() {
  const { confirmDialog } = useModal();
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
  /**
   * Sticky banner shown after a successful re-register, surfacing the
   * old iThink warehouse_id that's now orphaned on their side. iThink
   * doesn't expose deactivation via API, so the admin must remove it
   * manually from the iThink panel.
   */
  const [orphanedWarehouseId, setOrphanedWarehouseId] = useState<string | null>(null);

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
    save({ selfDeliveryPincodes: pincodes });
  };

  const registerWithIThink = async () => {
    if (!settings) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await adminDeliveryMethodsService.registerSellerWithIThink(sellerId);
      if (res.data) {
        // Patch the registration fields back into settings without
        // refetching everything (smoother UX).
        setSettings({
          ...settings,
          ithinkPickupAddressId: res.data.ithinkPickupAddressId,
          ithinkWarehouseStatus: res.data.ithinkWarehouseStatus,
          ithinkRegisteredAt: res.data.ithinkRegisteredAt,
        });
      } else {
        setActionError(res.message ?? 'Registration failed');
      }
    } catch (e: any) {
      setActionError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Pulls the latest approval state from iThink (Get Warehouse) and
   * updates our row. Useful after iThink ops approves the warehouse —
   * a daily cron would do this automatically in production.
   */
  const refreshStatus = async () => {
    if (!settings) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await adminDeliveryMethodsService.refreshSellerIThinkStatus(sellerId);
      if (res.data) {
        setSettings({
          ...settings,
          ithinkPickupAddressId: res.data.ithinkPickupAddressId,
          ithinkWarehouseStatus: res.data.ithinkWarehouseStatus,
          ithinkRegisteredAt: res.data.ithinkRegisteredAt,
        });
      } else {
        setActionError(res.message ?? 'Refresh failed');
      }
    } catch (e: any) {
      setActionError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  /** Re-register the pickup at the current address (STALE recovery). */
  const reregisterWithIThink = async () => {
    if (!settings) return;
    const ok = await confirmDialog({
      title: 'Re-register iThink warehouse?',
      message:
        "Create a new iThink warehouse for the seller's current address?\n\nThe old iThink warehouse_id will be replaced — deactivate it manually in iThink's panel.",
      confirmText: 'Re-register',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await adminDeliveryMethodsService.reregisterSellerWithIThink(sellerId);
      if (res.data) {
        setSettings({
          ...settings,
          ithinkPickupAddressId: res.data.ithinkPickupAddressId,
          ithinkWarehouseStatus: res.data.ithinkWarehouseStatus,
          ithinkRegisteredAt: res.data.ithinkRegisteredAt,
        });
        // iThink's API has no Delete Warehouse endpoint, so the
        // previous warehouse_id stays ACTIVE on their side until ops
        // manually deactivates it from the iThink panel. Surface the
        // id with a direct link so the cleanup is impossible to miss.
        if (res.data.previousIThinkPickupAddressId) {
          setOrphanedWarehouseId(res.data.previousIThinkPickupAddressId);
        }
      } else {
        setActionError(res.message ?? 'Re-registration failed');
      }
    } catch (e: any) {
      setActionError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
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

      {/* Orphan banner — iThink doesn't expose a delete endpoint, so
          the previous warehouse stays ACTIVE on their side and is
          eligible for shipment bookings unless manually deactivated. */}
      {orphanedWarehouseId && (
        <div
          style={{
            background: '#fef3c7',
            border: '1px solid #fde68a',
            color: '#78350f',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <span style={{ flex: 1 }}>
            <strong>Orphaned warehouse on iThink:</strong>{' '}
            <code style={{ background: '#fff', padding: '1px 6px', borderRadius: 4 }}>
              ID {orphanedWarehouseId}
            </code>{' '}
            is still ACTIVE on iThink. Their API has no delete endpoint —
            open the{' '}
            <a
              href="https://my.ithinklogistics.com/v4/account-setting/6"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#1e3a8a', textDecoration: 'underline' }}
            >
              iThink Pickup Address panel
            </a>{' '}
            and deactivate it manually to avoid duplicate bookings.
          </span>
          <button
            type="button"
            onClick={() => setOrphanedWarehouseId(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#78350f',
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="iThink Logistics" disabled={saving}>
          <Toggle
            checked={settings.ithinkEnabled}
            onChange={(checked) => save({ ithinkEnabled: checked })}
            disabled={saving}
            label={settings.ithinkEnabled ? 'Enabled' : 'Disabled'}
          />
          <WarehouseRow
            status={settings.ithinkWarehouseStatus}
            pickup={settings.ithinkPickupAddressId}
          />
          <Detail label="Pickup pincode" value={settings.sellerZipCode} />
          <Detail label="Address" value={settings.storeAddress} />
          <Detail label="City / state" value={[settings.city, settings.state].filter(Boolean).join(', ') || null} />
          <Detail
            label="Registered with iThink"
            value={
              settings.ithinkRegisteredAt
                ? new Date(settings.ithinkRegisteredAt).toLocaleString('en-IN')
                : '—'
            }
          />

          {/* Register button — shown only when iThink is ON and there's
              no pickup_address_id yet (or registration was rejected).
              Decoupled from the toggle so it's retryable on its own. */}
          {settings.ithinkEnabled &&
            (settings.ithinkWarehouseStatus === 'NOT_REGISTERED' ||
              settings.ithinkWarehouseStatus === 'REJECTED') && (
              <button
                type="button"
                onClick={registerWithIThink}
                disabled={saving}
                style={{
                  marginTop: 14,
                  padding: '8px 14px',
                  background: '#1e3a8a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Registering…' : 'Register pickup with iThink'}
              </button>
            )}

          {/* STALE banner — seller updated their profile after iThink
              registration, so the registered warehouse address no
              longer matches what we'd send on Add Order. Admin must
              re-register before any new shipment will route correctly. */}
          {settings.ithinkWarehouseStatus === 'STALE' && (
            <div
              style={{
                marginTop: 14,
                padding: '10px 12px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                fontSize: 12,
                color: '#991b1b',
              }}
            >
              <strong>Address out of sync.</strong> The seller updated their
              profile after iThink registration. New shipments would book
              the old address. Click <strong>Re-register</strong> to point
              iThink at the current address. In-flight AWBs already pinned
              to the old warehouse are unaffected.
            </div>
          )}

          {/* Re-register — appears only when there's actually something
              to fix: STALE (drift detected on read) or REJECTED. When
              the warehouse is in sync (APPROVED / PENDING), no button
              shows to avoid cluttering the happy-path UI. Drift
              detection runs on every page load, so an out-of-band
              address edit will surface here automatically. */}
          {(settings.ithinkWarehouseStatus === 'STALE' ||
            settings.ithinkWarehouseStatus === 'REJECTED') && (
            <button
              type="button"
              onClick={reregisterWithIThink}
              disabled={saving}
              style={{
                marginTop: 14,
                padding: '8px 14px',
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Re-registering…' : 'Re-register pickup with iThink'}
            </button>
          )}

          {/* Refresh status — shown once the warehouse is registered.
              Lets admin pull the current approval state from iThink
              rather than waiting on the daily reconciliation cron. */}
          {settings.ithinkPickupAddressId &&
            settings.ithinkWarehouseStatus !== 'NOT_REGISTERED' && (
              <button
                type="button"
                onClick={refreshStatus}
                disabled={saving}
                style={{
                  marginTop: 14,
                  marginLeft: 8,
                  padding: '8px 14px',
                  background: '#fff',
                  color: '#1e3a8a',
                  border: '1px solid #bfdbfe',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Refreshing…' : 'Refresh status from iThink'}
              </button>
            )}

          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 12 }}>
            Toggle controls whether the seller can <em>choose</em> iThink at
            fulfilment time. Registration is a separate step — click
            "Register pickup with iThink" once the seller's profile address
            is complete. iThink ops then approves the warehouse within ~24h
            (status flips from <strong>Pending</strong> to{' '}
            <strong>Approved</strong>).
          </p>
        </Card>

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

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ color: '#111827', fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );
}

function WarehouseRow({
  status,
  pickup,
}: {
  status: IThinkWarehouseApprovalStatus;
  pickup: string | null;
}) {
  const labels: Record<IThinkWarehouseApprovalStatus, { text: string; color: string; bg: string }> = {
    NOT_REGISTERED: { text: 'Not registered', color: '#6b7280', bg: '#f3f4f6' },
    PENDING: { text: 'Pending iThink approval', color: '#92400e', bg: '#fef3c7' },
    APPROVED: { text: 'Approved', color: '#166534', bg: '#dcfce7' },
    REJECTED: { text: 'Rejected', color: '#b91c1c', bg: '#fee2e2' },
    STALE: { text: 'Address out of sync', color: '#991b1b', bg: '#fee2e2' },
  };
  const meta = labels[status];
  return (
    <div
      style={{
        marginTop: 14,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <span style={{ fontSize: 12, color: '#6b7280' }}>iThink warehouse</span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          padding: '2px 10px',
          borderRadius: 999,
          background: meta.bg,
          color: meta.color,
        }}
        title={pickup ? `pickup_address_id = ${pickup}` : ''}
      >
        {meta.text}
      </span>
    </div>
  );
}
