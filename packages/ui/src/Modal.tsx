'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ModalKind = 'info' | 'success' | 'warning' | 'error' | 'confirm';

interface NotifyInput {
  message: string;
  title?: string;
  kind?: ModalKind;
}

interface ConfirmInput {
  message: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ModalState {
  id: number;
  kind: ModalKind;
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  danger: boolean;
  resolve: (value: boolean) => void;
}

interface ModalContextValue {
  notify: (input: NotifyInput | string) => Promise<void>;
  confirmDialog: (input: ConfirmInput | string) => Promise<boolean>;
}

const ModalContext = createContext<ModalContextValue | null>(null);

const defaultTitle = (kind: ModalKind): string => {
  switch (kind) {
    case 'success': return 'Success';
    case 'warning': return 'Warning';
    case 'error': return 'Error';
    case 'confirm': return 'Please confirm';
    default: return 'Notice';
  }
};

const inferKind = (message: string | null | undefined): ModalKind => {
  if (!message) return 'info';
  const m = String(message).toLowerCase();
  if (/fail|error|cannot|invalid|not found|denied|forbidden|unauthori/.test(m)) return 'error';
  if (/success|updated|created|saved|approved|confirm/.test(m)) return 'success';
  if (/warn|expire/.test(m)) return 'warning';
  return 'info';
};

export function ModalProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ModalState[]>([]);
  const idRef = useRef(0);

  const push = useCallback((m: Omit<ModalState, 'id'>) => {
    const id = ++idRef.current;
    setStack((prev) => [...prev, { ...m, id }]);
  }, []);

  const pop = useCallback((id: number, value: boolean) => {
    setStack((prev) => {
      const found = prev.find((m) => m.id === id);
      found?.resolve(value);
      return prev.filter((m) => m.id !== id);
    });
  }, []);

  const notify = useCallback((input: NotifyInput | string | null | undefined): Promise<void> => {
    return new Promise<void>((resolve) => {
      const raw =
        input == null
          ? { message: 'Something went wrong.' }
          : typeof input === 'string'
            ? { message: input }
            : input;
      const message = raw.message == null || raw.message === '' ? 'Something went wrong.' : String(raw.message);
      const kind: ModalKind = raw.kind ?? inferKind(message);
      push({
        kind,
        title: raw.title ?? defaultTitle(kind),
        message,
        confirmText: 'OK',
        danger: false,
        resolve: () => resolve(),
      });
    });
  }, [push]);

  const confirmDialog = useCallback((input: ConfirmInput | string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const data: ConfirmInput =
        typeof input === 'string' ? { message: input } : input;
      push({
        kind: 'confirm',
        title: data.title ?? 'Please confirm',
        message: data.message,
        confirmText: data.confirmText ?? 'Confirm',
        cancelText: data.cancelText ?? 'Cancel',
        danger: !!data.danger,
        resolve,
      });
    });
  }, [push]);

  const value = useMemo(() => ({ notify, confirmDialog }), [notify, confirmDialog]);

  const top = stack[stack.length - 1];

  useEffect(() => {
    if (!top) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') pop(top.id, false);
      if (e.key === 'Enter') pop(top.id, true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [top, pop]);

  return (
    <ModalContext.Provider value={value}>
      {children}
      {top && (
        <ModalShell
          state={top}
          onCancel={() => pop(top.id, false)}
          onConfirm={() => pop(top.id, true)}
        />
      )}
    </ModalContext.Provider>
  );
}

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used inside <ModalProvider>');
  return ctx;
}

const ACCENT: Record<ModalKind, string> = {
  info: '#2563eb',
  success: '#16a34a',
  warning: '#d97706',
  error: '#dc2626',
  confirm: '#111827',
};

const ICON: Record<ModalKind, string> = {
  info: 'i',
  success: '✓',
  warning: '!',
  error: '✕',
  confirm: '?',
};

function ModalShell({
  state,
  onCancel,
  onConfirm,
}: {
  state: ModalState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { kind, title, message, confirmText, cancelText, danger } = state;
  const accent = ACCENT[kind];
  const confirmBg = danger ? '#dc2626' : accent;
  const isConfirm = kind === 'confirm';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sm-modal-title"
      aria-describedby="sm-modal-message"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(17, 24, 39, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          width: '100%',
          maxWidth: 420,
          overflow: 'hidden',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '18px 20px 12px',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              background: `${accent}1A`,
              color: accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 18,
              flex: '0 0 auto',
            }}
          >
            {ICON[kind]}
          </div>
          <h3
            id="sm-modal-title"
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: '#111827',
            }}
          >
            {title}
          </h3>
        </div>
        <div
          id="sm-modal-message"
          style={{
            padding: '0 20px 20px',
            color: '#374151',
            fontSize: 14,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 16px 16px',
            borderTop: '1px solid #f3f4f6',
            background: '#fafafa',
          }}
        >
          {isConfirm && (
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '8px 16px',
                background: '#fff',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            style={{
              padding: '8px 16px',
              background: confirmBg,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
