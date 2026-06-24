'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { registerStepUpHandler, type StepUpHandler } from '@sportsmart/shared-utils';
import { stepUp, requestStepUpEmailOtp } from '@/services/admin-mfa.service';

/**
 * Admin step-up recovery UX (mirrors web-admin-storefront).
 *
 * Plugs into the shared api-client's STEP_UP_REQUIRED interceptor.
 * When a destructive route returns 403 with `code: 'STEP_UP_REQUIRED'`,
 * the interceptor calls our handler, which:
 *
 *   1. Opens a modal with a TOTP / backup-code / emailed-code input. If
 *      the modal is already open (a parallel request is also stalled on
 *      step-up), the new caller awaits the same in-flight promise — one
 *      verify satisfies every queued request.
 *   2. POSTs the code to /admin/mfa/step-up. On success, resolves the
 *      handler with `true` so the interceptor retries the original
 *      request(s).
 *   3. On cancel / dismiss, resolves with `false` so the original 403
 *      propagates to the caller (which surfaces the error normally).
 *
 * The "Email me a code" button asks the backend
 * (/admin/mfa/step-up/email/request) to email a 6-digit step-up code;
 * the user types it into the same input and submits — stepUp() accepts it.
 */
interface PendingRequest {
  resolve: (v: boolean) => void;
}

interface ModalState {
  visible: boolean;
  message: string;
  maxAgeMs?: number;
  /** Pending callers waiting on this challenge. */
  queue: PendingRequest[];
}

const INITIAL_STATE: ModalState = {
  visible: false,
  message: '',
  queue: [],
};

export function StepUpHandlerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ModalState>(INITIAL_STATE);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Resolve every queued caller, then reset the modal.
  const resolveAll = useCallback((value: boolean) => {
    const queued = stateRef.current.queue;
    setState(INITIAL_STATE);
    setCode('');
    setErrorText(null);
    setEmailSentTo(null);
    setEmailSending(false);
    for (const r of queued) {
      try {
        r.resolve(value);
      } catch {
        // ignore — caller's handler shouldn't be able to break the chain
      }
    }
  }, []);

  const handler: StepUpHandler = useCallback(
    (meta) =>
      new Promise<boolean>((resolve) => {
        setState((prev) => {
          // Coalesce: if a challenge is already open, just enqueue.
          if (prev.visible) {
            return { ...prev, queue: [...prev.queue, { resolve }] };
          }
          return {
            visible: true,
            // Always show plain-language copy — never the raw backend/developer
            // message (e.g. "POST a TOTP code to /admin/mfa/step-up..."), which
            // means nothing to an admin operating the dashboard.
            message:
              'This is a sensitive action, so we need to confirm it is really you. ' +
              'Enter the 6-digit code from your authenticator app, or click "Email me a code" to get one by email.',
            maxAgeMs: meta.maxAgeMs,
            queue: [{ resolve }],
          };
        });
      }),
    [],
  );

  // Register on mount, unregister on unmount so a hot-reload doesn't
  // leak a dangling handler.
  useEffect(() => {
    registerStepUpHandler(handler);
    return () => registerStepUpHandler(null);
  }, [handler]);

  const onSubmit = useCallback(
    async (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      const trimmed = code.trim();
      if (!trimmed) {
        setErrorText('Enter a 6-digit code from your authenticator app, or a backup code.');
        return;
      }
      setSubmitting(true);
      setErrorText(null);
      try {
        const res = await stepUp(trimmed);
        if (res?.success) {
          resolveAll(true);
        } else {
          setErrorText(res?.message ?? 'Step-up failed. Try again.');
        }
      } catch (err) {
        const msg =
          (err as { body?: { message?: string } })?.body?.message ??
          (err as Error)?.message ??
          'Step-up failed. Try again.';
        setErrorText(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [code, resolveAll],
  );

  // Email-OTP alternative: ask the backend to email a 6-digit step-up code.
  // The user then types it into the same input and submits (stepUp accepts it).
  const onEmailMe = useCallback(async () => {
    setEmailSending(true);
    setErrorText(null);
    try {
      const res = await requestStepUpEmailOtp();
      if (res?.success) {
        setEmailSentTo(res.data?.maskedEmail ?? 'your email');
      } else {
        setErrorText(res?.message ?? 'Could not email a code. Try again.');
      }
    } catch (err) {
      const msg =
        (err as { body?: { message?: string } })?.body?.message ??
        (err as Error)?.message ??
        'Could not email a code. Try again.';
      setErrorText(msg);
    } finally {
      setEmailSending(false);
    }
  }, []);

  const onCancel = useCallback(() => {
    resolveAll(false);
  }, [resolveAll]);

  // Authenticator-first MFA: the step-up modal opens on the authenticator-code
  // entry. The email OTP is sent ONLY when the user clicks "Email me a code"
  // (onEmailMe) — no auto-send.

  // Close on Esc only when not mid-submit so an in-flight network call
  // can't be orphaned by an accidental keypress.
  useEffect(() => {
    if (!state.visible) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !submitting) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.visible, submitting, onCancel]);

  const windowText = useMemo(() => {
    if (!state.maxAgeMs) return null;
    const mins = Math.round(state.maxAgeMs / 60_000);
    return mins <= 1
      ? 'Step-up grants ~1 minute of elevated session.'
      : `Step-up grants ~${mins} minutes of elevated session.`;
  }, [state.maxAgeMs]);

  return (
    <>
      {children}
      {state.visible && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sm-stepup-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17, 24, 39, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10001,
            padding: 16,
          }}
        >
          <form
            onSubmit={onSubmit}
            style={{
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
              width: '100%',
              maxWidth: 420,
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '20px 22px 8px' }}>
              <h3
                id="sm-stepup-title"
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
                Verify your identity
              </h3>
              <p
                style={{
                  margin: '8px 0 0',
                  color: '#4b5563',
                  fontSize: 13,
                  lineHeight: 1.55,
                }}
              >
                {state.message}
              </p>
              {windowText && (
                <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 12 }}>
                  {windowText}
                </p>
              )}
            </div>
            <div style={{ padding: '12px 22px 0' }}>
              <label
                htmlFor="sm-stepup-code"
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: 6,
                }}
              >
                6-digit code
              </label>
              <input
                id="sm-stepup-code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) =>
                  setCode(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^0-9A-Z-]/g, '')
                      .slice(0, 16),
                  )
                }
                placeholder="123456"
                autoFocus
                disabled={submitting}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  fontSize: 14,
                  letterSpacing: '0.02em',
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  outline: 'none',
                }}
              />
              {errorText && (
                <p
                  role="alert"
                  style={{
                    margin: '8px 0 0',
                    color: '#b91c1c',
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  {errorText}
                </p>
              )}
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={onEmailMe}
                  disabled={submitting || emailSending}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: '#2563eb',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: submitting || emailSending ? 'not-allowed' : 'pointer',
                    opacity: submitting || emailSending ? 0.6 : 1,
                  }}
                >
                  {emailSending ? 'Sending…' : emailSentTo ? 'Resend code' : 'Email me a code'}
                </button>
                {emailSentTo && (
                  <p style={{ margin: '6px 0 0', color: '#0b8457', fontSize: 12, lineHeight: 1.4 }}>
                    Code sent to {emailSentTo}. Enter it above (valid 5 minutes).
                  </p>
                )}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                padding: '16px 18px 18px',
                marginTop: 12,
                borderTop: '1px solid #f3f4f6',
                background: '#fafafa',
              }}
            >
              <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                style={{
                  padding: '8px 16px',
                  background: '#fff',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || code.trim().length === 0}
                style={{
                  padding: '8px 16px',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor:
                    submitting || code.trim().length === 0
                      ? 'not-allowed'
                      : 'pointer',
                  opacity: submitting || code.trim().length === 0 ? 0.7 : 1,
                }}
              >
                {submitting ? 'Verifying…' : 'Verify & retry'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
