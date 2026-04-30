import type { ReactNode } from 'react';

type Tone = 'accent' | 'sale' | 'ink' | 'success' | 'warning' | 'neutral';
type Size = 'sm' | 'md';

const toneClass: Record<Tone, string> = {
  accent:  'bg-accent text-white',
  sale:    'bg-sale text-white',
  ink:     'bg-ink-900 text-white',
  success: 'bg-success text-white',
  warning: 'bg-warning text-white',
  neutral: 'bg-ink-100 text-ink-900',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-5 px-1.5 text-[10px] tracking-wider',
  md: 'h-6 px-2 text-[11px] tracking-wider',
};

export function Badge({
  tone = 'accent',
  size = 'md',
  children,
}: {
  tone?: Tone;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center font-semibold uppercase ${toneClass[tone]} ${sizeClass[size]}`}
    >
      {children}
    </span>
  );
}
