import RazorpayCheckout from 'react-native-razorpay';
import {RAZORPAY_KEY_ID} from '@env';

// Mirrors apps/web-storefront/src/lib/razorpay.ts — same RazorpayHandoff*
// shape, same outcomes, so screen code reads the same. Difference: the web
// flavour loads a remote checkout.js into a DOM <script>; we use the
// native SDK via the react-native-razorpay autolinked module.

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

// The native SDK's TS definitions are loose — keep our handler typed
// against this minimal subset of what it actually returns.
interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayError {
  // Razorpay codes: 0 = user cancelled, 2 = payment failed (declined / OTP / etc.)
  code?: number;
  description?: string;
}

const USER_CANCEL_CODE = 0;

/**
 * Open the native Razorpay checkout sheet and resolve with a uniform
 * result shape regardless of platform. Caller is responsible for
 * POST /customer/checkout/payment/verify on success — we DO NOT trust
 * the in-sheet handler alone (a compromised client could forge a
 * success without a real charge).
 */
export async function openRazorpayCheckout(
  opts: RazorpayHandoffOptions,
): Promise<RazorpayHandoffResult> {
  if (!RAZORPAY_KEY_ID) {
    return {
      status: 'error',
      error:
        'Razorpay is not configured. Set RAZORPAY_KEY_ID in apps/mobile-storefront/.env and restart Metro with --reset-cache.',
    };
  }

  const options = {
    key: RAZORPAY_KEY_ID,
    amount: opts.amountInPaise,
    currency: opts.currency || 'INR',
    name: 'SPORTSMART',
    description: `Order ${opts.orderNumber}`,
    order_id: opts.razorpayOrderId,
    prefill: {
      name: opts.customerName ?? undefined,
      email: opts.customerEmail ?? undefined,
      contact: opts.customerPhone ?? undefined,
    },
    theme: {color: '#2563eb'},
  };

  try {
    const result = (await RazorpayCheckout.open(options)) as RazorpaySuccess;
    return {
      status: 'success',
      razorpayOrderId: result.razorpay_order_id,
      razorpayPaymentId: result.razorpay_payment_id,
      razorpaySignature: result.razorpay_signature,
    };
  } catch (e) {
    const err = e as RazorpayError;
    // Native SDK throws on both cancel and payment-failed; distinguish via code.
    if (err?.code === USER_CANCEL_CODE) {
      return {status: 'dismissed'};
    }
    return {
      status: 'error',
      error: err?.description || 'Payment failed',
    };
  }
}
