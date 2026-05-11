'use client';

import { useEffect, useState } from 'react';

import {
  franchiseDeliveryMethodsService,
  type DeliveryMethod,
  type FranchiseDeliveryEntitlements,
} from '@/services/delivery-methods.service';

/**
 * Franchise version of the per-shipment delivery-method picker.
 * Identical UX to the seller picker; backed by /franchise/* routes.
 */
export interface DeliveryMethodPickerProps {
  subOrderId: string;
  onChosen?: (method: DeliveryMethod) => void;
  initialEntitlements?: FranchiseDeliveryEntitlements | null;
  compact?: boolean;
}

export function DeliveryMethodPicker({
  subOrderId,
  onChosen,
  initialEntitlements,
  compact,
}: DeliveryMethodPickerProps) {
  const [entitlements, setEntitlements] = useState<FranchiseDeliveryEntitlements | null>(
    initialEntitlements ?? null,
  );
  const [loading, setLoading] = useState(!initialEntitlements);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialEntitlements) return;
    franchiseDeliveryMethodsService
      .getEntitlements()
      .then((res) => {
        if (res.data) setEntitlements(res.data);
        else setError(res.message ?? 'Unable to load delivery methods');
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [initialEntitlements]);

  const handleChoose = async (method: DeliveryMethod) => {
    if (!method) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await franchiseDeliveryMethodsService.chooseMethod(subOrderId, method);
      if (res.data) onChosen?.(res.data.deliveryMethod);
      else setError(res.message ?? 'Could not save delivery method');
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div style={{ color: '#6b7280', fontSize: 13 }}>Loading delivery options…</div>;
  }
  if (
    !entitlements ||
    (!entitlements.ithinkEnabled && !entitlements.selfDeliveryEnabled && !entitlements.ithinkPending)
  ) {
    return (
      <div
        style={{
          background: '#fef3c7',
          border: '1px solid #fde68a',
          padding: 12,
          borderRadius: 8,
          fontSize: 13,
          color: '#92400e',
        }}
      >
        Your franchise admin has not enabled any delivery method yet. Contact
        them to enable iThink or Self Delivery.
      </div>
    );
  }

  const containerStyle: React.CSSProperties = compact
    ? { display: 'flex', gap: 10 }
    : { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

  return (
    <div>
      <div style={containerStyle}>
        <Option
          label="iThink Logistics"
          description="Book via iThink (Delhivery / Bluedart / etc.). AWB auto-generated."
          icon="\u{1F69A}"
          enabled={entitlements.ithinkEnabled}
          pending={entitlements.ithinkPending}
          disabledReason={
            entitlements.ithinkPending
              ? 'iThink approval is pending'
              : 'iThink is not enabled for your franchise'
          }
          loading={submitting}
          onClick={() => handleChoose('ITHINK_LOGISTICS')}
        />
        <Option
          label="Self Delivery"
          description="You deliver yourself. Manual status updates from this dashboard."
          icon="\u{1F3EC}"
          enabled={entitlements.selfDeliveryEnabled}
          disabledReason="Self delivery is not enabled for your franchise"
          loading={submitting}
          onClick={() => handleChoose('SELF_DELIVERY')}
        />
      </div>

      {error && (
        <div
          style={{
            marginTop: 10,
            color: '#b91c1c',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            padding: '6px 10px',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function Option({
  label,
  description,
  icon,
  enabled,
  pending,
  disabledReason,
  loading,
  onClick,
}: {
  label: string;
  description: string;
  icon: string;
  enabled: boolean;
  pending?: boolean;
  disabledReason: string;
  loading: boolean;
  onClick: () => void;
}) {
  const disabled = !enabled || loading;
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={!enabled ? disabledReason : undefined}
      style={{
        textAlign: 'left',
        background: enabled ? '#fff' : '#f9fafb',
        border: `2px solid ${enabled ? '#bfdbfe' : '#e5e7eb'}`,
        borderRadius: 10,
        padding: '14px 16px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'border 0.15s, box-shadow 0.15s',
        boxShadow: enabled ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.borderColor = '#2563eb';
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.borderColor = '#bfdbfe';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }} aria-hidden="true">{icon}</span>
        <strong style={{ fontSize: 14 }}>{label}</strong>
        {pending && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 8px',
              borderRadius: 999,
              background: '#fef3c7',
              color: '#92400e',
            }}
          >
            PENDING APPROVAL
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.4 }}>{description}</div>
    </button>
  );
}
