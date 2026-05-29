'use client';

import React from 'react';

export type DeliveryMethod = 'SELF_DELIVERY' | null | undefined;

export interface DeliveryMethodBadgeProps {
  method: DeliveryMethod;
  awb?: string | null;
  courier?: string | null;
  size?: 'sm' | 'md';
  showAwb?: boolean;
}

/**
 * Seller admin (`web-d2c-seller-admin`) variant. Identical visual to the
 * other apps; duplicated here rather than hoisted to packages/ui to
 * keep frontend builds independent.
 */
export function DeliveryMethodBadge({
  method,
  awb,
  courier,
  size = 'sm',
  showAwb = false,
}: DeliveryMethodBadgeProps) {
  const config = configFor(method);
  const padding = size === 'md' ? '4px 10px' : '2px 8px';
  const fontSize = size === 'md' ? 12 : 11;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding,
        borderRadius: 999,
        background: config.bg,
        color: config.fg,
        border: `1px solid ${config.border}`,
        fontWeight: 600,
        fontSize,
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
      }}
      title={
        awb
          ? `${config.label} · AWB ${awb}${courier ? ` · ${courier}` : ''}`
          : config.label
      }
    >
      <span aria-hidden="true">{config.icon}</span>
      <span>{config.label}</span>
      {showAwb && awb && (
        <span
          style={{
            marginLeft: 4,
            paddingLeft: 6,
            borderLeft: `1px solid ${config.border}`,
            fontWeight: 500,
            opacity: 0.85,
          }}
        >
          {awb}
        </span>
      )}
    </span>
  );
}

function configFor(method: DeliveryMethod) {
  switch (method) {
    case 'SELF_DELIVERY':
      return {
        label: 'Self Delivery',
        icon: '\u{1F3EC}',
        bg: '#f0fdf4',
        fg: '#166534',
        border: '#bbf7d0',
      };
    default:
      return {
        label: 'Not chosen',
        icon: '—',
        bg: '#f3f4f6',
        fg: '#6b7280',
        border: '#e5e7eb',
      };
  }
}
