'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useModal } from '@sportsmart/ui';

import {
  franchiseAdminDeliveryMethodsService,
  type FranchiseDeliveryMethodSettings,
  type IThinkWarehouseApprovalStatus,
} from '@/services/admin-delivery-methods.service';

/**
 * Franchise-admin delivery-method settings page. Same UX as the
 * marketplace-admin seller version. The franchise admin uses this
 * screen to toggle which delivery methods each franchise can use,
 * register their warehouse with iThink, and set self-delivery
 * service-area pincodes.
 */
export default function FranchiseDeliveryMethodsPage() {
  const params = useParams();
  const router = useRouter();
  const { confirmDialog } = useModal();
  const franchiseId = String(params?.id ?? '');

  const [settings, setSettings] = useState<FranchiseDeliveryMethodSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Two error channels:
  //   - loadError: the initial GET failed. Collapse the page to an
  //     error message because we have nothing to render.
  //   - actionError: a button action (register/refresh/re-register/
  //     toggle/pincodes) failed. Keep the page visible and surface
  //     the error inline as a banner so the admin can correct and
  //     retry without losing context.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pincodeInput, setPincodeInput] = useState('');
  const [orphanedWarehouseId, setOrphanedWarehouseId] = useState<string | null>(null);

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

  /**
   * Add Warehouse with iThink using the franchise's stored warehouse
   * address. Decoupled from the toggle so it's retryable when iThink
   * is unreachable or rejects credentials.
   */
  const registerWithIThink = async () => {
    if (!settings) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await franchiseAdminDeliveryMethodsService.registerWithIThink(franchiseId);
      if (res.data) {
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

  /** Re-register at the current address (STALE recovery). */
  const reregisterWithIThink = async () => {
    if (!settings) return;
    const ok = await confirmDialog({
      title: 'Re-register iThink warehouse?',
      message:
        "Create a new iThink warehouse for the franchise's current address?\n\nThe old iThink warehouse_id will be replaced — deactivate it manually in iThink's panel.",
      confirmText: 'Re-register',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await franchiseAdminDeliveryMethodsService.reregisterWithIThink(franchiseId);
      if (res.data) {
        setSettings({
          ...settings,
          ithinkPickupAddressId: res.data.ithinkPickupAddressId,
          ithinkWarehouseStatus: res.data.ithinkWarehouseStatus,
          ithinkRegisteredAt: res.data.ithinkRegisteredAt,
        });
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

  /** Pull current approval state from iThink (Get Warehouse). */
  const refreshStatus = async () => {
    if (!settings) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await franchiseAdminDeliveryMethodsService.refreshWithIThink(franchiseId);
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
          <Detail label="Warehouse pincode" value={settings.warehousePincode} />
          <Detail label="Warehouse address" value={settings.warehouseAddress} />
          <Detail
            label="City / state"
            value={[settings.city, settings.state].filter(Boolean).join(', ') || null}
          />
          <Detail
            label="Registered with iThink"
            value={
              settings.ithinkRegisteredAt
                ? new Date(settings.ithinkRegisteredAt).toLocaleString('en-IN')
                : '—'
            }
          />

          {/* Register button — shown when iThink is enabled but no pickup
              has been registered yet (or registration was rejected). */}
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
              <strong>Address out of sync.</strong> The franchise updated
              its profile after iThink registration. Click{' '}
              <strong>Re-register</strong> to point iThink at the current
              address. In-flight AWBs are unaffected.
            </div>
          )}

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

          {/* Refresh status — appears once registered. Pulls the
              current approval state from iThink without waiting for
              the daily reconciliation cron. */}
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
            Toggle controls whether the franchise can <em>choose</em>{' '}
            iThink at fulfilment time. Registration is a separate step
            — click "Register pickup with iThink" once the warehouse
            address is complete. iThink ops approves within ~24h;
            click <strong>Refresh status</strong> to pull the current
            approval state.
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
    <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
