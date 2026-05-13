'use client';

import { useEffect, useState } from 'react';

interface Props {
  title: string;
  message: React.ReactNode;
  /** Defaults to "Delete". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" colours the confirm button red — for destructive actions. */
  tone?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Reusable in-app confirmation modal — replaces window.confirm() so the
 * UX matches the rest of the admin shell.
 *
 * Esc cancels (unless busy), click on overlay cancels, content click is
 * captured so the body doesn't dismiss the dialog. Confirm button
 * autofocuses so a keyboard user can Enter through it.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const [confirmHover, setConfirmHover] = useState(false);
  const [cancelHover, setCancelHover] = useState(false);
  const isDanger = tone === 'danger';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  return (
    <>
      <style>{keyframes}</style>
      <div
        style={overlay}
        onClick={busy ? undefined : onCancel}
        role="presentation"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          style={dialog}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={head}>
            <div style={iconWrap(isDanger)} aria-hidden="true">
              {isDanger ? <WarningIcon /> : <InfoIcon />}
            </div>
            <h2 id="confirm-title" style={titleText}>
              {title}
            </h2>
          </div>

          <div style={body}>{message}</div>

          <footer style={footer}>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              style={ghostBtn(cancelHover, busy)}
              onMouseEnter={() => setCancelHover(true)}
              onMouseLeave={() => setCancelHover(false)}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              autoFocus
              disabled={busy}
              style={
                isDanger
                  ? dangerBtn(confirmHover, busy)
                  : primaryBtn(confirmHover, busy)
              }
              onMouseEnter={() => setConfirmHover(true)}
              onMouseLeave={() => setConfirmHover(false)}
            >
              {busy && <Spinner />}
              {busy ? 'Working…' : confirmLabel}
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}

function WarningIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        border: '2px solid rgba(255,255,255,0.35)',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'cm-spin 0.65s linear infinite',
        marginRight: 8,
      }}
    />
  );
}

const keyframes = `
  @keyframes cm-fade-in { from { opacity: 0 } to { opacity: 1 } }
  @keyframes cm-slide-in {
    from { opacity: 0; transform: translateY(10px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)    scale(1);    }
  }
  @keyframes cm-spin { to { transform: rotate(360deg); } }
`;

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.55)',
  backdropFilter: 'blur(3px)',
  WebkitBackdropFilter: 'blur(3px)',
  zIndex: 70,
  display: 'grid',
  placeItems: 'center',
  padding: 16,
  animation: 'cm-fade-in 140ms ease-out',
};

const dialog: React.CSSProperties = {
  width: '100%',
  maxWidth: 440,
  background: '#fff',
  borderRadius: 14,
  boxShadow:
    '0 24px 50px -12px rgba(15, 23, 42, 0.35), 0 8px 18px -6px rgba(15, 23, 42, 0.12)',
  border: '1px solid rgba(15, 23, 42, 0.06)',
  overflow: 'hidden',
  animation: 'cm-slide-in 180ms cubic-bezier(0.16, 1, 0.3, 1)',
};

const head: React.CSSProperties = {
  padding: '22px 24px 4px',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 14,
};

const iconWrap = (danger: boolean): React.CSSProperties => ({
  flexShrink: 0,
  width: 40,
  height: 40,
  borderRadius: 10,
  display: 'grid',
  placeItems: 'center',
  background: danger ? '#FEE2E2' : '#DBEAFE',
  color: danger ? '#B91C1C' : '#1D4ED8',
});

const titleText: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  margin: 0,
  marginTop: 7,
  color: '#0F172A',
  letterSpacing: '-0.01em',
  lineHeight: 1.3,
};

const body: React.CSSProperties = {
  padding: '12px 24px 22px 78px',
  fontSize: 13.5,
  color: '#475569',
  lineHeight: 1.6,
};

const footer: React.CSSProperties = {
  padding: '14px 20px',
  borderTop: '1px solid #F1F5F9',
  display: 'flex',
  gap: 10,
  justifyContent: 'flex-end',
  background: '#F8FAFC',
};

const ghostBtn = (hover: boolean, disabled: boolean): React.CSSProperties => ({
  background: hover && !disabled ? '#F1F5F9' : '#fff',
  color: '#334155',
  border: '1px solid #CBD5E1',
  padding: '8px 18px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.55 : 1,
  transition: 'background 120ms ease, border-color 120ms ease',
});

const primaryBtn = (hover: boolean, disabled: boolean): React.CSSProperties => ({
  background: hover && !disabled ? '#1E293B' : '#0F1115',
  color: '#fff',
  border: '1px solid transparent',
  padding: '8px 18px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.7 : 1,
  display: 'inline-flex',
  alignItems: 'center',
  transition: 'background 120ms ease, box-shadow 160ms ease',
  boxShadow:
    hover && !disabled ? '0 6px 16px -4px rgba(15, 17, 21, 0.35)' : 'none',
});

const dangerBtn = (hover: boolean, disabled: boolean): React.CSSProperties => ({
  background: hover && !disabled ? '#991B1B' : '#B91C1C',
  color: '#fff',
  border: '1px solid transparent',
  padding: '8px 18px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.7 : 1,
  display: 'inline-flex',
  alignItems: 'center',
  transition: 'background 120ms ease, box-shadow 160ms ease',
  boxShadow:
    hover && !disabled
      ? '0 8px 18px -4px rgba(185, 28, 28, 0.45)'
      : '0 1px 0 rgba(0, 0, 0, 0.04)',
});
