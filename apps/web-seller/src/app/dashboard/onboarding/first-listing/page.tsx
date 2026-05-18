'use client';

/**
 * First-listing wizard.
 *
 * Lands here after the seller's account flips to ACTIVE + VERIFIED.
 * Purpose: nudge the seller toward their first useful action instead
 * of dropping them on an empty dashboard.
 *
 * Three suggestions, each a card with a single CTA:
 *   1. Update bank details (so payouts can land when the first
 *      settlement runs).
 *   2. List your first product (deep-link into the existing product
 *      creation flow).
 *   3. Enable a delivery method (Self-delivery or iThink).
 *
 * The page surfaces a "Skip for now" link that takes them to the
 * main dashboard — first-listing is encouraged, not blocking. A
 * dismissed flag is stored in localStorage so the page doesn't
 * keep nagging on every login; the seller's dashboard sidebar still
 * shows the same shortcuts if they want to come back.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface SellerProfile {
  sellerId: string;
  sellerName: string;
  status: string;
  verificationStatus: string;
  // hint signals — populated if the seller already started something
  hasBankDetails?: boolean;
  hasFirstProduct?: boolean;
  hasDeliveryMethod?: boolean;
}

const DISMISS_KEY = 'seller-first-listing-dismissed';

export default function FirstListingPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient<SellerProfile>('/seller/profile');
        if (!cancelled) {
          setProfile((res?.data as SellerProfile) ?? (res as unknown as SellerProfile));
        }
      } catch {
        if (!cancelled) setProfile(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // If the seller previously dismissed AND has at least one product +
  // bank details, skip straight to the main dashboard. Otherwise let
  // them see the suggestions again.
  useEffect(() => {
    if (!profile) return;
    try {
      const dismissed = localStorage.getItem(DISMISS_KEY) === '1';
      if (
        dismissed &&
        profile.hasFirstProduct &&
        profile.hasBankDetails &&
        profile.hasDeliveryMethod
      ) {
        router.replace('/dashboard');
      }
    } catch {
      // localStorage unavailable — ignore
    }
  }, [profile, router]);

  // If the seller isn't actually approved yet, route back to onboarding.
  useEffect(() => {
    if (!profile) return;
    if (
      profile.status !== 'ACTIVE' ||
      profile.verificationStatus !== 'VERIFIED'
    ) {
      router.replace('/dashboard/onboarding');
    }
  }, [profile, router]);

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore
    }
    router.push('/dashboard');
  };

  if (loading) return <main style={{ padding: 24 }}>Loading…</main>;
  if (!profile) return <main style={{ padding: 24 }}>Profile unavailable.</main>;

  return (
    <main className="first-listing">
      <header className="first-listing__header">
        <h1>Welcome to SportSmart, {profile.sellerName.split(' ')[0]}!</h1>
        <p>
          Your account is approved. Three quick steps to get your first
          order moving:
        </p>
      </header>

      <ol className="first-listing__cards">
        <li
          className={`first-listing__card ${
            profile.hasBankDetails ? 'first-listing__card--done' : ''
          }`}
        >
          <div className="first-listing__card-step">Step 1</div>
          <h2>Add your bank details</h2>
          <p>
            Payouts run weekly. Add your business bank account so the first
            settlement lands without a delay.
          </p>
          <Link
            href="/dashboard/profile?tab=bank"
            className="first-listing__btn"
          >
            {profile.hasBankDetails ? 'Update bank details' : 'Add bank details'}
          </Link>
        </li>

        <li
          className={`first-listing__card ${
            profile.hasFirstProduct ? 'first-listing__card--done' : ''
          }`}
        >
          <div className="first-listing__card-step">Step 2</div>
          <h2>List your first product</h2>
          <p>
            Add a product with photos, price, stock count and HSN code.
            Once approved by our catalog team, it goes live to customers.
          </p>
          <Link href="/dashboard/products/new" className="first-listing__btn">
            {profile.hasFirstProduct ? 'Add another product' : 'List a product'}
          </Link>
        </li>

        <li
          className={`first-listing__card ${
            profile.hasDeliveryMethod ? 'first-listing__card--done' : ''
          }`}
        >
          <div className="first-listing__card-step">Step 3</div>
          <h2>Enable a delivery method</h2>
          <p>
            Either ship yourself (Self-delivery) or let our courier
            partner (iThink) handle pickups. You can enable both.
          </p>
          <Link
            href="/dashboard/profile/delivery"
            className="first-listing__btn"
          >
            {profile.hasDeliveryMethod ? 'Manage delivery' : 'Set up delivery'}
          </Link>
        </li>
      </ol>

      <footer className="first-listing__footer">
        <button
          type="button"
          onClick={handleDismiss}
          className="first-listing__skip"
        >
          Skip — take me to the dashboard
        </button>
      </footer>

      <style jsx>{`
        .first-listing {
          padding: 32px 24px;
          max-width: 960px;
          margin: 0 auto;
        }
        .first-listing__header h1 {
          font-size: 24px;
          margin: 0 0 6px;
        }
        .first-listing__header p {
          color: #555;
          font-size: 14px;
          margin: 0 0 24px;
        }
        .first-listing__cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 16px;
          padding: 0;
          margin: 0 0 24px;
          list-style: none;
        }
        .first-listing__card {
          background: #fff;
          border: 1px solid #d0d7de;
          border-radius: 10px;
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
        }
        .first-listing__card--done {
          border-color: #2e7d32;
          background: #f1f8e9;
        }
        .first-listing__card-step {
          font-size: 11px;
          color: #888;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .first-listing__card h2 {
          font-size: 16px;
          margin: 0 0 8px;
        }
        .first-listing__card p {
          color: #555;
          font-size: 13px;
          flex: 1;
          margin: 0 0 14px;
        }
        .first-listing__btn {
          display: inline-block;
          padding: 8px 14px;
          background: #1565c0;
          color: #fff;
          text-decoration: none;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          align-self: flex-start;
        }
        .first-listing__card--done .first-listing__btn {
          background: #2e7d32;
        }
        .first-listing__footer {
          text-align: center;
        }
        .first-listing__skip {
          background: transparent;
          border: none;
          color: #555;
          text-decoration: underline;
          cursor: pointer;
          font-size: 13px;
        }
      `}</style>
    </main>
  );
}
