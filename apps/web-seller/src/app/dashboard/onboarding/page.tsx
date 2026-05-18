'use client';

/**
 * Seller onboarding wizard.
 *
 * Three steps:
 *   1. Verify email (if not already verified — backend auto-sends the
 *      OTP on registration; this UI lets the seller retry/resend and
 *      enter the 6-digit code).
 *   2. Submit KYC details (legal business name, GST registration type,
 *      GSTIN, GST state code, PAN, registered business address, store
 *      address). The Submit hits POST /seller/onboarding/submit and
 *      transitions verificationStatus → UNDER_REVIEW.
 *   3. Wait for admin decision — show the current status. If REJECTED,
 *      show the reason and let the seller edit + re-submit.
 *
 * After approval (verificationStatus=VERIFIED + status=ACTIVE), this
 * page redirects to the first-listing wizard at
 * /dashboard/onboarding/first-listing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

// Phase 26 GST — policy change (2026-05-18): UNREGISTERED is no longer
// a valid GST registration type for new sellers. The type union still
// permits it so legacy profiles loaded from the API don't crash the
// page, but the form prevents new submissions in that state.
type GstType = 'REGULAR' | 'COMPOSITION' | 'CASUAL' | 'UNREGISTERED';

interface SellerProfile {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  email: string;
  isEmailVerified: boolean;
  status: string;
  verificationStatus: string;
  legalBusinessName?: string | null;
  gstin?: string | null;
  gstStateCode?: string | null;
  gstRegistrationType?: GstType | null;
  panNumber?: string | null;
  registeredBusinessAddressJson?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  } | null;
  storeAddress?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  sellerZipCode?: string | null;
  gstVerificationNotes?: string | null;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PIN_RE = /^\d{6}$/;
const STATE_CODE_RE = /^\d{2}$/;

export default function SellerOnboardingPage() {
  const router = useRouter();

  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Email-verify step state
  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [otpMessage, setOtpMessage] = useState<string | null>(null);

  // Form state — initialised from profile on load
  const [form, setForm] = useState({
    legalBusinessName: '',
    gstRegistrationType: 'REGULAR' as GstType,
    gstin: '',
    gstStateCode: '',
    panNumber: '',
    registeredAddress: {
      line1: '',
      line2: '',
      city: '',
      state: '',
      pincode: '',
      country: 'India',
    },
    storeAddress: '',
    city: '',
    state: '',
    country: 'India',
    sellerZipCode: '',
    shortStoreDescription: '',
    confirmedAccurate: false,
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient<SellerProfile>('/seller/profile');
      const data = (res?.data as SellerProfile) ?? (res as unknown as SellerProfile);
      setProfile(data);
      // Pre-fill form from existing profile (so REJECTED → re-edit works).
      setForm((prev) => ({
        ...prev,
        legalBusinessName: data.legalBusinessName ?? prev.legalBusinessName,
        gstRegistrationType:
          (data.gstRegistrationType as GstType) ?? prev.gstRegistrationType,
        gstin: data.gstin ?? prev.gstin,
        gstStateCode: data.gstStateCode ?? prev.gstStateCode,
        panNumber: data.panNumber ?? prev.panNumber,
        registeredAddress: {
          line1: data.registeredBusinessAddressJson?.line1 ?? '',
          line2: data.registeredBusinessAddressJson?.line2 ?? '',
          city: data.registeredBusinessAddressJson?.city ?? '',
          state: data.registeredBusinessAddressJson?.state ?? '',
          pincode: data.registeredBusinessAddressJson?.pincode ?? '',
          country: data.registeredBusinessAddressJson?.country ?? 'India',
        },
        storeAddress: data.storeAddress ?? prev.storeAddress,
        city: data.city ?? prev.city,
        state: data.state ?? prev.state,
        country: data.country ?? prev.country,
        sellerZipCode: data.sellerZipCode ?? prev.sellerZipCode,
      }));
    } catch (err) {
      setError((err as Error).message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Once approved, jump to first-listing wizard.
  useEffect(() => {
    if (
      profile?.status === 'ACTIVE' &&
      profile?.verificationStatus === 'VERIFIED'
    ) {
      router.push('/dashboard/onboarding/first-listing');
    }
  }, [profile, router]);

  // ── Step 1: email verify ────────────────────────────────────────
  const handleResend = async () => {
    setResending(true);
    setOtpMessage(null);
    try {
      await apiClient('/seller/profile/verify-email/send-otp', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setOtpMessage('A new OTP has been sent to your email.');
    } catch (err) {
      setOtpMessage((err as Error).message || 'Failed to resend OTP');
    } finally {
      setResending(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      setOtpMessage('Enter the 6-digit code from your email.');
      return;
    }
    setVerifying(true);
    setOtpMessage(null);
    try {
      await apiClient('/seller/profile/verify-email/verify', {
        method: 'POST',
        body: JSON.stringify({ otp }),
      });
      setOtpMessage('Email verified.');
      setOtp('');
      await loadProfile();
    } catch (err) {
      setOtpMessage((err as Error).message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  // ── Step 2: KYC submit ──────────────────────────────────────────
  const validationErrors = useMemo<string[]>(() => {
    const errs: string[] = [];
    if (form.legalBusinessName.trim().length < 2)
      errs.push('Legal business name is required.');
    // Phase 26 GST — GSTIN + GST state code are mandatory for every
    // seller now. UNREGISTERED was previously the escape hatch; the
    // dropdown no longer offers it, but if a legacy profile still has
    // that value loaded the form blocks submission and asks the seller
    // to pick REGULAR or COMPOSITION.
    if (form.gstRegistrationType === 'UNREGISTERED') {
      errs.push('GST registration is now mandatory. Pick REGULAR or COMPOSITION and enter your GSTIN.');
    }
    if (!GSTIN_RE.test(form.gstin))
      errs.push('GSTIN must be 15 chars (format: 2-digit state + PAN + entity + Z + checksum).');
    if (!STATE_CODE_RE.test(form.gstStateCode))
      errs.push('GST state code must be 2 digits.');
    if (form.gstin && form.gstin.substring(2, 12) !== form.panNumber)
      errs.push('GSTIN positions 3-12 must equal PAN.');
    if (!PAN_RE.test(form.panNumber))
      errs.push('PAN must be 5 letters + 4 digits + 1 letter (uppercase).');
    if (form.registeredAddress.line1.trim().length < 3)
      errs.push('Registered address line 1 is required.');
    if (!PIN_RE.test(form.registeredAddress.pincode))
      errs.push('Registered address pincode must be 6 digits.');
    if (form.storeAddress.trim().length < 5)
      errs.push('Store address is required.');
    if (!PIN_RE.test(form.sellerZipCode))
      errs.push('Store zip code must be 6 digits.');
    if (!form.confirmedAccurate)
      errs.push('Tick the confirmation that the information is accurate.');
    return errs;
  }, [form]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validationErrors.length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiClient('/seller/onboarding/submit', {
        method: 'POST',
        body: JSON.stringify({
          legalBusinessName: form.legalBusinessName.trim(),
          // Phase 26 GST — GSTIN + state code are mandatory; no more
          // conditional skipping for UNREGISTERED. Validation above
          // already blocks submission if either is missing.
          gstRegistrationType: form.gstRegistrationType,
          gstin: form.gstin.toUpperCase(),
          gstStateCode: form.gstStateCode,
          panNumber: form.panNumber.toUpperCase(),
          registeredBusinessAddress: form.registeredAddress,
          storeAddress: form.storeAddress.trim(),
          city: form.city,
          state: form.state,
          country: form.country,
          sellerZipCode: form.sellerZipCode,
          shortStoreDescription: form.shortStoreDescription || undefined,
          confirmedAccurate: true,
        }),
      });
      await loadProfile();
    } catch (err) {
      setSubmitError((err as Error).message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <main style={{ padding: 24 }}>Loading…</main>;
  if (error) return <main style={{ padding: 24, color: '#c62828' }}>{error}</main>;
  if (!profile)
    return <main style={{ padding: 24 }}>No profile data available.</main>;

  const showEmailStep = !profile.isEmailVerified;
  const showKycStep =
    profile.isEmailVerified &&
    (profile.verificationStatus === 'NOT_VERIFIED' ||
      profile.verificationStatus === 'REJECTED');
  const showWaitingStep = profile.verificationStatus === 'UNDER_REVIEW';

  return (
    <main className="onboarding">
      <h1 className="onboarding__title">Seller onboarding</h1>
      <p className="onboarding__subtitle">
        Complete the steps below to start selling on SportSmart. Our team
        reviews submissions within 2-3 business days.
      </p>

      <ol className="onboarding__stepper" aria-label="Onboarding progress">
        <li
          className={`onboarding__step ${
            profile.isEmailVerified ? 'onboarding__step--done' : 'onboarding__step--active'
          }`}
        >
          1. Verify email
        </li>
        <li
          className={`onboarding__step ${
            showKycStep
              ? 'onboarding__step--active'
              : profile.verificationStatus === 'UNDER_REVIEW' ||
                profile.verificationStatus === 'VERIFIED'
                ? 'onboarding__step--done'
                : ''
          }`}
        >
          2. Submit KYC
        </li>
        <li
          className={`onboarding__step ${
            profile.verificationStatus === 'VERIFIED'
              ? 'onboarding__step--done'
              : showWaitingStep
                ? 'onboarding__step--active'
                : ''
          }`}
        >
          3. Await approval
        </li>
      </ol>

      {/* ── Email verify ──────────────────────────────────────────── */}
      {showEmailStep && (
        <section className="onboarding__card">
          <h2>Step 1 — Verify your email</h2>
          <p>
            We sent a 6-digit code to <strong>{profile.email}</strong>.
            Enter it below.
          </p>
          <form onSubmit={handleVerify} className="onboarding__form">
            <label htmlFor="otp">6-digit code</label>
            <input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              required
            />
            <div className="onboarding__row">
              <button type="submit" disabled={verifying} className="onboarding__btn">
                {verifying ? 'Verifying…' : 'Verify'}
              </button>
              <button
                type="button"
                disabled={resending}
                onClick={handleResend}
                className="onboarding__btn onboarding__btn--ghost"
              >
                {resending ? 'Sending…' : 'Resend OTP'}
              </button>
            </div>
            {otpMessage && <p className="onboarding__hint">{otpMessage}</p>}
          </form>
        </section>
      )}

      {/* ── KYC submit ────────────────────────────────────────────── */}
      {showKycStep && (
        <section className="onboarding__card">
          <h2>
            Step 2 — Submit KYC details
            {profile.verificationStatus === 'REJECTED' && (
              <span className="onboarding__rej-tag">Previously rejected</span>
            )}
          </h2>
          {profile.verificationStatus === 'REJECTED' && profile.gstVerificationNotes && (
            <div className="onboarding__reject-box">
              <strong>Admin's reason:</strong>
              <p>{profile.gstVerificationNotes}</p>
              <p className="onboarding__hint">
                Fix the issue below and re-submit. The reviewer will see the
                same form again.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="onboarding__form">
            <label htmlFor="legalBusinessName">Legal business name *</label>
            <input
              id="legalBusinessName"
              value={form.legalBusinessName}
              onChange={(e) =>
                setForm({ ...form, legalBusinessName: e.target.value })
              }
              required
              maxLength={200}
            />

            <label htmlFor="gstRegistrationType">GST registration type *</label>
            <select
              id="gstRegistrationType"
              value={form.gstRegistrationType}
              onChange={(e) =>
                setForm({
                  ...form,
                  gstRegistrationType: e.target.value as GstType,
                })
              }
            >
              <option value="REGULAR">Regular</option>
              <option value="COMPOSITION">Composition</option>
              <option value="CASUAL">Casual</option>
              {/* Phase 26 GST — UNREGISTERED removed from new submissions.
                  GSTIN is mandatory for every active seller. Sub-threshold
                  sellers must register for GSTIN before listing. */}
            </select>

            <label htmlFor="gstin">GSTIN *</label>
            <input
              id="gstin"
              value={form.gstin}
              onChange={(e) =>
                setForm({ ...form, gstin: e.target.value.toUpperCase() })
              }
              maxLength={15}
              required
              placeholder="e.g. 27ABCDE1234F1Z5"
            />

            <label htmlFor="gstStateCode">GST state code *</label>
            <input
              id="gstStateCode"
              value={form.gstStateCode}
              onChange={(e) =>
                setForm({ ...form, gstStateCode: e.target.value.replace(/\D/g, '') })
              }
              maxLength={2}
              required
              placeholder="e.g. 27 for Maharashtra"
            />

            <label htmlFor="panNumber">PAN number *</label>
            <input
              id="panNumber"
              value={form.panNumber}
              onChange={(e) =>
                setForm({ ...form, panNumber: e.target.value.toUpperCase() })
              }
              maxLength={10}
              required
              placeholder="ABCDE1234F"
            />

            <fieldset className="onboarding__group">
              <legend>Registered business address *</legend>
              <label>Line 1</label>
              <input
                value={form.registeredAddress.line1}
                onChange={(e) =>
                  setForm({
                    ...form,
                    registeredAddress: {
                      ...form.registeredAddress,
                      line1: e.target.value,
                    },
                  })
                }
                required
              />
              <label>Line 2 (optional)</label>
              <input
                value={form.registeredAddress.line2}
                onChange={(e) =>
                  setForm({
                    ...form,
                    registeredAddress: {
                      ...form.registeredAddress,
                      line2: e.target.value,
                    },
                  })
                }
              />
              <div className="onboarding__row">
                <div style={{ flex: 1 }}>
                  <label>City</label>
                  <input
                    value={form.registeredAddress.city}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        registeredAddress: {
                          ...form.registeredAddress,
                          city: e.target.value,
                        },
                      })
                    }
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label>State</label>
                  <input
                    value={form.registeredAddress.state}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        registeredAddress: {
                          ...form.registeredAddress,
                          state: e.target.value,
                        },
                      })
                    }
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Pincode</label>
                  <input
                    value={form.registeredAddress.pincode}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        registeredAddress: {
                          ...form.registeredAddress,
                          pincode: e.target.value.replace(/\D/g, ''),
                        },
                      })
                    }
                    maxLength={6}
                    required
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className="onboarding__group">
              <legend>Store / pickup address *</legend>
              <label>Street address</label>
              <input
                value={form.storeAddress}
                onChange={(e) => setForm({ ...form, storeAddress: e.target.value })}
                required
              />
              <div className="onboarding__row">
                <div style={{ flex: 1 }}>
                  <label>City</label>
                  <input
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label>State</label>
                  <input
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Country</label>
                  <input
                    value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Pincode</label>
                  <input
                    value={form.sellerZipCode}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        sellerZipCode: e.target.value.replace(/\D/g, ''),
                      })
                    }
                    maxLength={6}
                    required
                  />
                </div>
              </div>
            </fieldset>

            <label htmlFor="shortStoreDescription">Store description (optional)</label>
            <textarea
              id="shortStoreDescription"
              rows={3}
              maxLength={300}
              value={form.shortStoreDescription}
              onChange={(e) =>
                setForm({ ...form, shortStoreDescription: e.target.value })
              }
              placeholder="What does your store sell? (300 chars)"
            />

            <label className="onboarding__check">
              <input
                type="checkbox"
                checked={form.confirmedAccurate}
                onChange={(e) =>
                  setForm({ ...form, confirmedAccurate: e.target.checked })
                }
              />
              I confirm the information above is accurate and that I have the
              legal authority to submit it.
            </label>

            {validationErrors.length > 0 && (
              <ul className="onboarding__errors" aria-live="polite">
                {validationErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}
            {submitError && (
              <p className="onboarding__server-error">{submitError}</p>
            )}

            <button
              type="submit"
              disabled={submitting || validationErrors.length > 0}
              className="onboarding__btn"
            >
              {submitting ? 'Submitting…' : 'Submit for review'}
            </button>
          </form>
        </section>
      )}

      {/* ── Waiting for admin ─────────────────────────────────────── */}
      {showWaitingStep && (
        <section className="onboarding__card">
          <h2>Step 3 — Awaiting admin review</h2>
          <p>
            Your KYC submission is with our team. We'll email you at
            <strong> {profile.email}</strong> when the decision is made
            (usually within 2-3 business days). You can keep this page open
            or check back later.
          </p>
          <button
            type="button"
            onClick={loadProfile}
            className="onboarding__btn onboarding__btn--ghost"
          >
            Refresh status
          </button>
        </section>
      )}

      <style jsx>{`
        .onboarding {
          padding: 24px;
          max-width: 880px;
          margin: 0 auto;
        }
        .onboarding__title {
          margin: 0 0 4px;
          font-size: 22px;
        }
        .onboarding__subtitle {
          color: #666;
          margin: 0 0 24px;
          font-size: 14px;
        }
        .onboarding__stepper {
          display: flex;
          gap: 4px;
          padding: 0;
          margin: 0 0 24px;
          list-style: none;
        }
        .onboarding__step {
          flex: 1;
          padding: 10px 12px;
          background: #f3f4f6;
          color: #555;
          font-size: 13px;
          font-weight: 600;
          border-radius: 4px;
          text-align: center;
        }
        .onboarding__step--active {
          background: #1565c0;
          color: #fff;
        }
        .onboarding__step--done {
          background: #2e7d32;
          color: #fff;
        }
        .onboarding__card {
          background: #fff;
          border: 1px solid #d0d7de;
          border-radius: 8px;
          padding: 20px 24px;
          margin-bottom: 16px;
        }
        .onboarding__card h2 {
          margin: 0 0 12px;
          font-size: 17px;
        }
        .onboarding__form {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .onboarding__form label {
          font-size: 13px;
          font-weight: 600;
          color: #333;
        }
        .onboarding__form input,
        .onboarding__form select,
        .onboarding__form textarea {
          font-family: inherit;
          font-size: 14px;
          padding: 8px 10px;
          border: 1px solid #d0d7de;
          border-radius: 6px;
        }
        .onboarding__row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .onboarding__btn {
          padding: 10px 18px;
          border-radius: 6px;
          border: none;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          background: #1565c0;
          color: #fff;
          align-self: flex-start;
        }
        .onboarding__btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .onboarding__btn--ghost {
          background: #fff;
          color: #333;
          border: 1px solid #d0d7de;
        }
        .onboarding__hint {
          color: #555;
          font-size: 13px;
          margin: 6px 0 0;
        }
        .onboarding__rej-tag {
          margin-left: 8px;
          padding: 2px 8px;
          background: #ffebee;
          color: #c62828;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
        }
        .onboarding__reject-box {
          background: #fff8e1;
          border-left: 3px solid #f57f17;
          padding: 10px 14px;
          margin-bottom: 14px;
          font-size: 13px;
        }
        .onboarding__group {
          border: 1px solid #d0d7de;
          border-radius: 6px;
          padding: 12px 14px;
          margin: 6px 0;
        }
        .onboarding__group legend {
          font-size: 13px;
          font-weight: 600;
          padding: 0 6px;
        }
        .onboarding__check {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          font-weight: 400;
          font-size: 13px;
          margin: 10px 0 4px;
        }
        .onboarding__errors {
          margin: 6px 0;
          padding: 8px 12px 8px 24px;
          background: #ffebee;
          color: #c62828;
          border-radius: 6px;
          font-size: 13px;
        }
        .onboarding__server-error {
          color: #c62828;
          font-size: 13px;
          margin: 0;
        }
      `}</style>
    </main>
  );
}
