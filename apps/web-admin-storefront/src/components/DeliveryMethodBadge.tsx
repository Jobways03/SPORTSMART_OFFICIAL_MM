'use client';

import React from 'react';

export type DeliveryMethod = 'ITHINK_LOGISTICS' | 'SELF_DELIVERY' | null | undefined;

/**
 * Single-source badge for "how is this order being delivered?".
 *
 * Renders distinct visual styling for each method so admins can scan
 * an order list and tell apart courier-routed (iThink) from
 * in-house-delivered (self) shipments. NULL means the seller /
 * franchise hasn't picked a method yet — show "Not chosen" in muted
 * grey rather than hiding the column.
 *
 * Kept inline (no shared package) so each app can ship without
 * crossing the workspace boundary for a one-line badge. The colour
 * scheme is identical across apps so customers / sellers / admins
 * see the same visual language.
 */
export interface DeliveryMethodBadgeProps {
  method: DeliveryMethod;
  awb?: string | null;
  courier?: string | null;
  size?: 'sm' | 'md';
  showAwb?: boolean;
}

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
    case 'ITHINK_LOGISTICS':
      return {
        label: 'iThink',
        icon: '\u{1F69A}', // delivery truck
        bg: '#eff6ff',
        fg: '#1e3a8a',
        border: '#bfdbfe',
      };
    case 'SELF_DELIVERY':
      return {
        label: 'Self Delivery',
        icon: '\u{1F3EC}', // shop
        bg: '#f0fdf4',
        fg: '#166534',
        border: '#bbf7d0',
      };
    default:
      return {
        label: 'Not chosen',
        icon: '—', // em dash
        bg: '#f3f4f6',
        fg: '#6b7280',
        border: '#e5e7eb',
      };
  }
}
