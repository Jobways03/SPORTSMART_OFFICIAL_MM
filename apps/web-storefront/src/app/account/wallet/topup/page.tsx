'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Wallet, AlertCircle } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useAuthGuard } from '@/lib/useAuthGuard';
import { walletService } from '@/services/wallet.service';
import { profileService, CustomerProfile } from '@/services/profile.service';

const QUICK_AMOUNTS = [100, 500, 1000, 2000, 5000];
const RAZORPAY_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayResponse) => void;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(false);
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function TopupPage() {
  const router = useRouter();
  const authStatus = useAuthGuard();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [amountInRupees, setAmountInRupees] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    profileService
      .getProfile()
      .then((res) => res.data && setProfile(res.data))
      .catch(() => {});
    // Pre-warm the Razorpay script so the modal opens instantly on submit
    loadRazorpayScript();
  }, [authStatus]);

  const setQuickAmount = (rupees: number) => {
    setAmountInRupees(String(rupees));
    setError(null);
  };

  const onAmountChange = (v: string) => {
    // Allow only digits + one optional decimal point
    if (v === '' || /^\d{0,7}(\.\d{0,2})?$/.test(v)) {
      setAmountInRupees(v);
      setError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const rupees = Number(amountInRupees);
    if (!Number.isFinite(rupees) || rupees < 1) {
      setError('Enter an amount of ₹1 or more');
      return;
    }
    if (rupees > 100000) {
      setError('Maximum single top-up is ₹1,00,000');
      return;
    }
    const amountInPaise = Math.round(rupees * 100);

    const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    if (!keyId) {
      setError(
        'Payments are not configured. Set NEXT_PUBLIC_RAZORPAY_KEY_ID and reload.',
      );
      return;
    }

    setSubmitting(true);
    try {
      const ready = await loadRazorpayScript();
      if (!ready || !window.Razorpay) {
        throw new Error('Could not load the payment SDK. Check your network.');
      }

      const initRes = await walletService.initiateTopup(amountInPaise);
      if (!initRes.data) throw new Error('Failed to start top-up');

      const { walletTransactionId, razorpayOrderId } = initRes.data;

      const rzp = new window.Razorpay({
        key: keyId,
        amount: amountInPaise,
        currency: 'INR',
        name: 'Sportsmart',
        description: 'Wallet top-up',
        order_id: razorpayOrderId,
        prefill: {
          name: profile ? `${profile.firstName} ${profile.lastName}`.trim() : undefined,
          email: profile?.email,
          contact: profile?.phone ?? undefined,
        },
        theme: { color: '#DC2626' },
        modal: {
          ondismiss: () => {
            setSubmitting(false);
            setError('Top-up cancelled. Your money was not charged.');
          },
        },
        handler: async (response) => {
          try {
            const verifyRes = await walletService.verifyTopup({
              walletTransactionId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            if (verifyRes.data) {
              router.push('/account/wallet?topup=success');
            } else {
              setError('Payment verification failed. Contact support.');
              setSubmitting(false);
            }
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : 'Payment verification failed. Contact support.',
            );
            setSubmitting(false);
          }
        },
      });

      rzp.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start top-up');
      setSubmitting(false);
    }
  };

  if (authStatus === 'checking') {
    return (
      <StorefrontShell>
        <div className="container-x py-16 text-center text-ink-600">Loading…</div>
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell>
      <div className="container-x py-8 sm:py-12 max-w-xl">
        <Link
          href="/account/wallet"
          className="inline-flex items-center gap-1.5 text-body text-ink-600 hover:text-ink-900 mb-4"
        >
          <ArrowLeft className="size-4" />
          Back to wallet
        </Link>

        <h1 className="font-display text-h1 text-ink-900">Add money</h1>
        <p className="mt-2 text-body-lg text-ink-600">
          Top up your Sportsmart wallet. Funds are usable for any future order or
          credited back from refunds.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div>
            <label
              htmlFor="amount"
              className="block text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2"
            >
              Amount (₹)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-body-lg text-ink-500 pointer-events-none">
                ₹
              </span>
              <input
                id="amount"
                inputMode="decimal"
                value={amountInRupees}
                onChange={(e) => onAmountChange(e.target.value)}
                placeholder="0"
                disabled={submitting}
                aria-invalid={!!error}
                className="w-full h-14 pl-9 pr-4 border border-ink-300 hover:border-ink-500 focus:border-ink-900 bg-white text-2xl font-display tabular focus:outline-none transition-colors rounded-full"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((rupees) => (
              <button
                key={rupees}
                type="button"
                onClick={() => setQuickAmount(rupees)}
                disabled={submitting}
                className="inline-flex items-center h-9 px-4 border border-ink-300 hover:border-ink-900 hover:bg-ink-50 text-body font-medium text-ink-900 transition-colors rounded-full disabled:opacity-50"
              >
                ₹{rupees.toLocaleString('en-IN')}
              </button>
            ))}
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 border border-danger/30 bg-red-50 text-danger text-body rounded-2xl"
            >
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !amountInRupees}
            aria-busy={submitting}
            className="w-full h-12 inline-flex items-center justify-center gap-2 bg-ink-900 text-white font-semibold hover:bg-ink-800 disabled:opacity-50 transition-colors rounded-full"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Opening payment…
              </>
            ) : (
              <>
                <Wallet className="size-4" />
                Continue to payment
              </>
            )}
          </button>

          <p className="text-caption text-ink-500 text-center">
            Powered by Razorpay · Secure checkout · Min ₹1 / Max ₹1,00,000
          </p>
        </form>
      </div>
    </StorefrontShell>
  );
}
