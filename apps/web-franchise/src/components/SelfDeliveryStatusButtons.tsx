'use client';

import { useState } from 'react';
import { useModal } from '@sportsmart/ui';

import {
  franchiseDeliveryMethodsService,
  type SelfDeliveryStatus,
} from '@/services/delivery-methods.service';

/**
 * Franchise version of the self-delivery progress controls. Same UX
 * as the seller version; backed by /franchise/* routes.
 */
export interface SelfDeliveryStatusButtonsProps {
  subOrderId: string;
  currentStatus: SelfDeliveryStatus | null;
  onChanged?: (status: SelfDeliveryStatus) => void;
}

const FORWARD_ORDER: SelfDeliveryStatus[] = [
  'PENDING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

const STATUS_META: Record<
  SelfDeliveryStatus,
  { label: string; color: string; bg: string }
> = {
  PENDING: { label: 'Pending', color: '#6b7280', bg: '#f3f4f6' },
  READY_FOR_PICKUP: { label: 'Ready for pickup', color: '#92400e', bg: '#fef3c7' },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', color: '#1e3a8a', bg: '#dbeafe' },
  DELIVERED: { label: 'Delivered', color: '#166534', bg: '#dcfce7' },
  FAILED: { label: 'Delivery failed', color: '#b91c1c', bg: '#fee2e2' },
  CANCELLED: { label: 'Cancelled', color: '#6b7280', bg: '#f3f4f6' },
};

export function SelfDeliveryStatusButtons({
  subOrderId,
  currentStatus,
  onChanged,
}: SelfDeliveryStatusButtonsProps) {
  const { confirmDialog } = useModal();
  const [status, setStatus] = useState<SelfDeliveryStatus | null>(currentStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transition = async (next: SelfDeliveryStatus, notes?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await franchiseDeliveryMethodsService.transitionSelfDelivery(
        subOrderId,
        next,
        notes,
      );
      if (res.data) {
        setStatus(res.data.selfDeliveryStatus);
        onChanged?.(res.data.selfDeliveryStatus);
      } else {
        setError(res.message ?? 'Transition failed');
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const currentIdx = status ? FORWARD_ORDER.indexOf(status) : 0;
  const nextForward = FORWARD_ORDER[currentIdx + 1];
  const terminal = status === 'DELIVERED' || status === 'CANCELLED';

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <strong style={{ fontSize: 14 }}>Self-delivery progress</strong>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 10px',
            borderRadius: 999,
            background: STATUS_META[status ?? 'PENDING'].bg,
            color: STATUS_META[status ?? 'PENDING'].color,
          }}
        >
          {STATUS_META[status ?? 'PENDING'].label}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {FORWARD_ORDER.map((step, i) => {
          const active = i <= currentIdx;
          return (
            <div
              key={step}
              title={STATUS_META[step].label}
              style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                background: active ? '#2563eb' : '#e5e7eb',
                transition: 'background 0.15s',
              }}
            />
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {nextForward && !terminal && (
          <button
            disabled={busy}
            onClick={() => transition(nextForward)}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: busy ? '#93c5fd' : '#2563eb',
              color: '#fff',
            }}
          >
            Mark {STATUS_META[nextForward].label}
          </button>
        )}
        {!terminal && status !== 'FAILED' && (
          <button
            disabled={busy}
            onClick={() => {
              const note = prompt('Reason for delivery failure?');
              if (note !== null) transition('FAILED', note || undefined);
            }}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              background: '#fff',
              color: '#374151',
              border: '1px solid #d1d5db',
            }}
          >
            Mark failed
          </button>
        )}
        {!terminal && (
          <button
            disabled={busy}
            onClick={async () => {
              const ok = await confirmDialog({
                title: 'Cancel this shipment?',
                message: 'This will mark the self-delivery shipment as CANCELLED and notify the customer.',
                confirmText: 'Cancel shipment',
                cancelText: 'Keep',
                danger: true,
              });
              if (ok) transition('CANCELLED');
            }}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              background: '#fff',
              color: '#b91c1c',
              border: '1px solid #fecaca',
            }}
          >
            Cancel
          </button>
        )}
        {terminal && (
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            This shipment is in a terminal state.
          </span>
        )}
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
