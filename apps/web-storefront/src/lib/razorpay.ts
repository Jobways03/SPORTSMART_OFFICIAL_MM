import { apiClient } from './api-client';

// Lazy-loaded Razorpay checkout. Avoids shipping the ~80kB script in
// the initial bundle — only pulled in when the customer actually
// reaches the pay step. Loader is idempotent: subsequent calls reuse
// the same <script> tag instead of re-injecting.
const RAZORPAY_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
let loaderPromise: Promise<void> | null = null;

// `window.Razorpay` is declared with a narrower shape in
// account/wallet/topup/page.tsx. We avoid `declare global` here so
// the two declarations don't collide; instead we cast at the use
// sites below to a permissive any-shape since we only touch the
// constructor + `.on` + `.open`.

// Helper so the lib doesn't need to either redeclare or import the
// narrower window.Razorpay type from the wallet/topup file.
function getRazorpayCtor(): unknown {
  if (typeof window === 'undefined') return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).Razorpay;
}

function loadRazorpayScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay can only load in the browser'));
  }
  if (getRazorpayCtor()) return Promise.resolve();
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${RAZORPAY_SCRIPT_URL}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      if (getRazorpayCtor()) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error('Failed to load Razorpay script')),
      );
      return;
    }
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Failed to load Razorpay script'));
    document.head.appendChild(script);
  });
  return loaderPromise;
}

export interface RazorpayHandoffOptions {
  razorpayOrderId: string;
  amountInPaise: number;
  currency: string;
  orderNumber: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}

export interface RazorpayHandoffResult {
  status: 'success' | 'dismissed' | 'error';
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
  error?: string;
}

/**
 * Open the Razorpay checkout modal and resolve when the customer
 * either completes payment, dismisses the modal, or hits an error.
 *
 * On success, we POST the (orderId, paymentId, signature) to
 * /customer/checkout/payment/verify; the backend re-checks the
 * HMAC-SHA256 signature against the Razorpay secret before flipping
 * payment status. We do NOT trust the in-page handler alone — a
 * compromised browser could forge a "success" without a real charge.
 */
export async function openRazorpayCheckout(
  opts: RazorpayHandoffOptions,
): Promise<RazorpayHandoffResult> {
  const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  if (!keyId) {
    return {
      status: 'error',
      error:
        'Razorpay is not configured (NEXT_PUBLIC_RAZORPAY_KEY_ID missing). Use Cash on Delivery instead.',
    };
  }

  try {
    await loadRazorpayScript();
  } catch (e: any) {
    return {
      status: 'error',
      error: e?.message || 'Razorpay failed to load',
    };
  }

  return new Promise<RazorpayHandoffResult>((resolve) => {
    let resolved = false;
    const finish = (r: RazorpayHandoffResult) => {
      if (resolved) return;
      resolved = true;
      resolve(r);
    };

    const options = {
      key: keyId,
      amount: opts.amountInPaise,
      currency: opts.currency || 'INR',
      name: 'SPORTSMART',
      description: `Order ${opts.orderNumber}`,
      order_id: opts.razorpayOrderId,
      // Pre-fill what we know so the customer doesn't have to retype.
      prefill: {
        name: opts.customerName ?? undefined,
        email: opts.customerEmail ?? undefined,
        contact: opts.customerPhone ?? undefined,
      },
      theme: { color: '#3FA1AE' },
      modal: {
        // Customer hit ✕ — treat as dismissed (not an error). The
        // order shell already exists on the server in PENDING_VERIFICATION;
        // the order detail page's "Retry payment" button is the recovery
        // path.
        ondismiss: () => finish({ status: 'dismissed' }),
        confirm_close: true,
      },
      handler: async (resp: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => {
        try {
          await apiClient('/customer/checkout/payment/verify', {
            method: 'POST',
            body: JSON.stringify({
              razorpayOrderId: resp.razorpay_order_id,
              razorpayPaymentId: resp.razorpay_payment_id,
              razorpaySignature: resp.razorpay_signature,
            }),
          });
          finish({
            status: 'success',
            razorpayOrderId: resp.razorpay_order_id,
            razorpayPaymentId: resp.razorpay_payment_id,
            razorpaySignature: resp.razorpay_signature,
          });
        } catch (e: any) {
          finish({
            status: 'error',
            error: e?.body?.message || e?.message || 'Payment verification failed',
          });
        }
      },
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RzpCtor = getRazorpayCtor() as any;
      if (!RzpCtor) {
        finish({ status: 'error', error: 'Razorpay script not available' });
        return;
      }
      const rzp = new RzpCtor(options);
      // payment.failed fires for declined cards / OTP timeouts etc.
      // Razorpay still leaves the modal open so the customer can
      // retry inside it — we resolve only when the customer ultimately
      // dismisses. Recording the failure here means the FE knows the
      // exact reason without a second API roundtrip.
      rzp.on?.('payment.failed', (resp: any) => {
        finish({
          status: 'error',
          error: resp?.error?.description || 'Payment failed',
        });
      });
      rzp.open();
    } catch (e: any) {
      finish({
        status: 'error',
        error: e?.message || 'Razorpay modal failed to open',
      });
    }
  });
}
