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
      // A previous load attempt may have failed and left the <script>
      // tag in the DOM. Remove it so the fresh attempt below starts
      // clean — otherwise the stale tag can re-fire its `error` event
      // during hydration and surface as "[object Event]" in the dev
      // overlay.
      existing.remove();
    }
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_URL;
    script.async = true;
    // `{ once: true }` guards against multiple resolutions if the
    // browser fires `error` after `load` (rare but documented).
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => {
        // Reset loaderPromise so a subsequent retry can attempt a
        // fresh load instead of getting the cached failure.
        loaderPromise = null;
        reject(new Error('Failed to load Razorpay script'));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });
  return loaderPromise;
}

export interface RazorpayHandoffOptions {
  razorpayOrderId: string;
  amountInPaise: number;
  currency: string;
  // Optional: for Option B (deferred order creation) there is NO order number
  // yet at modal-open time — verify materializes the order and returns it.
  orderNumber?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
}

export interface RazorpayHandoffResult {
  // 'success'        — verify confirmed; orderNumber is the materialized order.
  // 'order_pending'  — payment captured, but the order is still being created
  //                    asynchronously (a concurrent webhook); show "being
  //                    created" and send the customer to My Orders.
  // 'dismissed'      — customer closed the modal before paying.
  // 'error'          — declined / verify rejected (error carries the message,
  //                    which for the deferred refund case already reads
  //                    "payment succeeded but the order could not be created…").
  status: 'success' | 'order_pending' | 'dismissed' | 'error';
  orderNumber?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
  error?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  } catch {
    return {
      status: 'error',
      error:
        "Couldn't load the secure payment window — please check your connection " +
        'and try again, or choose Cash on Delivery.',
    };
  }

  return new Promise<RazorpayHandoffResult>((resolve) => {
    let resolved = false;
    // Guards the verify call from running twice if Razorpay fires the success
    // handler more than once for a single capture.
    let verifying = false;
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
      description: opts.orderNumber ? `Order ${opts.orderNumber}` : 'SPORTSMART order',
      order_id: opts.razorpayOrderId,
      // Pre-fill what we know so the customer doesn't have to retype.
      prefill: {
        name: opts.customerName ?? undefined,
        email: opts.customerEmail ?? undefined,
        contact: opts.customerPhone ?? undefined,
      },
      theme: { color: '#3FA1AE' },
      modal: {
        // Customer hit ✕ — treat as dismissed (not an error). The caller
        // decides recovery by flow: legacy create-first leaves a PENDING_PAYMENT
        // order whose detail page has "Retry payment"; Option B (deferred) has
        // NO order yet (created only on capture), so the caller offers a retry.
        ondismiss: () => finish({ status: 'dismissed' }),
        confirm_close: true,
      },
      handler: async (resp: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => {
        // The Razorpay SDK can fire this handler more than once for a single
        // capture (flaky network, duplicate events). Run verify at most once.
        if (verifying) return;
        verifying = true;
        const ids = {
          razorpayOrderId: resp.razorpay_order_id,
          razorpayPaymentId: resp.razorpay_payment_id,
          razorpaySignature: resp.razorpay_signature,
        };
        const callVerify = () =>
          apiClient<{ orderNumber?: string }>(
            '/customer/checkout/payment/verify',
            {
              method: 'POST',
              // The verify endpoint is @Idempotent(): when idempotency is enabled
              // it REQUIRES this header (a missing key is a 400, which would break
              // every online payment). Key off the unique razorpay_payment_id so a
              // retried verify replays the original result instead of
              // double-processing the capture (duplicate events / loyalty / audit).
              // A THROWN verify (409/400) releases the idempotency claim server-
              // side, so polling with the SAME key safely re-executes until the
              // order materializes (then the 2xx result is what gets cached).
              headers: {
                'X-Idempotency-Key': `verify-${resp.razorpay_payment_id}`,
              },
              body: JSON.stringify({
                razorpayOrderId: resp.razorpay_order_id,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpaySignature: resp.razorpay_signature,
              }),
            },
          );

        // Option B — verify may 409 ("payment received, your order is being
        // created") while a concurrent webhook materializes the order. Poll the
        // SAME verify (its fast-path returns success once the order exists) with
        // backoff. Legacy (order already exists) succeeds on the first attempt.
        const MAX_ATTEMPTS = 8;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          try {
            const res = await callVerify();
            finish({ status: 'success', orderNumber: res?.data?.orderNumber, ...ids });
            return;
          } catch (e: any) {
            if (e?.status === 409) {
              if (attempt < MAX_ATTEMPTS - 1) {
                await sleep(Math.min(800 * Math.pow(1.5, attempt), 4000));
                continue;
              }
              // Still being created after polling — payment is safe; the webhook/
              // reconciler will finish it. Route the customer to My Orders.
              finish({ status: 'order_pending', ...ids });
              return;
            }
            // 400 (incl. the deferred "refund will be issued" case) or any other
            // non-2xx — surface the backend's customer-facing message as-is.
            finish({
              status: 'error',
              error: e?.body?.message || e?.message || 'Payment verification failed',
              ...ids,
            });
            return;
          }
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
