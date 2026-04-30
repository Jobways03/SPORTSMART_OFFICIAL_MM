'use client';

import Link from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variantClass: Record<Variant, string> = {
  primary:
    'bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-700 disabled:bg-ink-300 disabled:text-ink-500',
  secondary:
    'bg-white text-ink-900 border border-ink-300 hover:border-ink-900 hover:bg-ink-50 active:bg-ink-100 disabled:text-ink-400 disabled:border-ink-200 disabled:hover:bg-white',
  ghost:
    'bg-transparent text-ink-900 hover:bg-ink-100 active:bg-ink-200 disabled:text-ink-400 disabled:hover:bg-transparent',
  danger:
    'bg-danger text-white hover:bg-red-700 active:bg-red-800 disabled:bg-ink-300',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-9 px-3 text-body',
  md: 'h-11 px-5 text-body-lg',
  lg: 'h-12 px-6 text-body-lg font-semibold',
};

interface BaseProps {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
  children: ReactNode;
  className?: string;
}

type ButtonProps = BaseProps & ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    loading = false,
    disabled,
    className = '',
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-full font-medium transition disabled:cursor-not-allowed',
        variantClass[variant],
        sizeClass[size],
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <span className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});

interface ButtonLinkProps extends Omit<BaseProps, 'children'> {
  href: string;
  children: ReactNode;
  external?: boolean;
}

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  external = false,
  className = '',
  children,
}: ButtonLinkProps) {
  const cls = [
    'inline-flex items-center justify-center gap-2 rounded-full font-medium transition',
    variantClass[variant],
    sizeClass[size],
    fullWidth ? 'w-full' : '',
    className,
  ].join(' ');

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {leadingIcon}
        {children}
        {trailingIcon}
      </a>
    );
  }

  return (
    <Link href={href} className={cls}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </Link>
  );
}
