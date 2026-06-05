// Web replacement for react-native-razorpay. The native package opens
// Razorpay's iOS/Android SDK; on web we lazy-load Razorpay's checkout.js
// (the same script the web-storefront app uses). The promise resolves
// on payment success and throws with {code, description} on cancel /
// failure — matching the native API exactly so the lib/razorpay.ts
// wrapper code doesn't need to change.

const RAZORPAY_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
let loaderPromise: Promise<void> | null = null;

function loadRazorpay(): Promise<void> {
  if ((window as any).Razorpay) return Promise.resolve();
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${RAZORPAY_SCRIPT_URL}"]`,
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), {once: true});
      existing.addEventListener(
        'error',
        () => {
          loaderPromise = null;
          reject(new Error('Failed to load Razorpay'));
        },
        {once: true},
      );
      return;
    }
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_URL;
    script.async = true;
    script.addEventListener('load', () => resolve(), {once: true});
    script.addEventListener(
      'error',
      () => {
        loaderPromise = null;
        reject(new Error('Failed to load Razorpay'));
      },
      {once: true},
    );
    document.head.appendChild(script);
  });
  return loaderPromise;
}

interface RazorpayOptions {
  key: string | undefined;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id?: string;
  prefill?: {name?: string; email?: string; contact?: string};
  theme?: {color?: string};
}

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

const RazorpayCheckout = {
  async open(options: RazorpayOptions): Promise<RazorpaySuccess> {
    await loadRazorpay();
    return new Promise<RazorpaySuccess>((resolve, reject) => {
      const Razorpay = (window as any).Razorpay;
      if (!Razorpay) {
        reject({code: 2, description: 'Razorpay failed to load'});
        return;
      }
      const rzp = new Razorpay({
        ...options,
        modal: {
          // Code 0 = user cancelled — match the native SDK's error
          // convention so lib/razorpay.ts treats it as dismissed.
          ondismiss: () =>
            reject({code: 0, description: 'Payment cancelled by user'}),
        },
        handler: (resp: RazorpaySuccess) => resolve(resp),
      });
      rzp.on?.('payment.failed', (resp: any) => {
        reject({
          code: 2,
          description: resp?.error?.description ?? 'Payment failed',
        });
      });
      rzp.open();
    });
  },
};

export default RazorpayCheckout;
