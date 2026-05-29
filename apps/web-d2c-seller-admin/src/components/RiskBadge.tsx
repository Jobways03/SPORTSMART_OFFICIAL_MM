'use client';

import type { RiskBand } from '@/services/admin-verification.service';

const BAND_STYLE: Record<
  'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN',
  { color: string; bg: string; label: string }
> = {
  GREEN:   { color: 'var(--color-success)', bg: 'var(--color-success-bg)', label: 'Low risk'    },
  YELLOW:  { color: 'var(--color-warning)', bg: 'var(--color-warning-bg)', label: 'Review'      },
  RED:     { color: 'var(--color-error)',   bg: 'var(--color-error-bg)',   label: 'High risk'   },
  UNKNOWN: { color: 'var(--color-text-secondary)', bg: 'var(--color-bg-page)', label: 'Not scored' },
};

export function RiskBadge({
  band,
  score,
  size = 'sm',
}: {
  band: RiskBand | null | undefined;
  score?: number | null;
  size?: 'sm' | 'md';
}) {
  const key = band ?? 'UNKNOWN';
  const style = BAND_STYLE[key];
  const fontSize = size === 'md' ? 13 : 11;
  const padding = size === 'md' ? '5px 12px' : '3px 9px';
  return (
    <span
      title={score == null ? undefined : `Score ${score}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize,
        fontWeight: 600,
        padding,
        borderRadius: 999,
        color: style.color,
        background: style.bg,
        whiteSpace: 'nowrap',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'currentColor',
          display: 'inline-block',
        }}
      />
      {style.label}
    </span>
  );
}
