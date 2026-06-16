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
 * page redirects straight to the dashboard.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { PincodeFields } from '@sportsmart/ui';
import { validatePincode, validateText, validatePersonName } from '@/lib/validators';
import './onboarding.css';

// Phase 26 GST — policy change (2026-05-18): UNREGISTERED is no longer
// a valid GST registration type for new sellers. The type union still
// permits it so legacy profiles loaded from the API don't crash the
// page, but the form prevents new submissions in that state.
type GstType = 'REGULAR' | 'COMPOSITION' | 'CASUAL' | 'UNREGISTERED';
type EntityType =
  | 'PUBLIC_LIMITED'
  | 'PRIVATE_LIMITED'
  | 'SOLE_PROPRIETORSHIP'
  | 'GENERAL_PARTNERSHIP'
  | 'LLP';

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
  entityType?: EntityType | null;
  /**
   * Phase 19 (2026-05-20) — API no longer returns the full PAN. The
   * onboarding page used to read panNumber from the profile to
   * pre-fill the form on resubmit (post-reject). After Phase 19,
   * panNumber is undefined; we keep the field on the type so old
   * cached data still parses, and the form lets the seller re-enter
   * the full PAN on resubmit (the API cross-checks against GSTIN).
   */
  panNumber?: string | null;
  panLast4?: string | null;
  registeredBusinessAddressJson?: {
    line1?: string;
    line2?: string;
    locality?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  } | null;
  locality?: string | null;
  storeAddress?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  sellerZipCode?: string | null;
  hasBankDetails?: boolean;
  bankAccountLast4?: string | null;
  bankName?: string | null;
  /**
   * Phase 19 (2026-05-20) — kept for back-compat with rows that still
   * carry a value in the legacy column. New rejections write to
   * `kycRejectionReason` instead.
   */
  gstVerificationNotes?: string | null;
  kycRejectionReason?: string | null;
  kycApprovalNotes?: string | null;
  kycReviewedAt?: string | null;
  lastProfileUpdatedAt?: string | null;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const STATE_CODE_RE = /^\d{2}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^[0-9]{9,18}$/;

const ENTITY_LABELS: Record<string, string> = {
  PUBLIC_LIMITED: 'Public Limited Company',
  PRIVATE_LIMITED: 'Private Limited Company',
  SOLE_PROPRIETORSHIP: 'Sole Proprietorship',
  GENERAL_PARTNERSHIP: 'General Partnership',
  LLP: 'Limited Liability Partnership (LLP)',
};

const titleCase = (s?: string | null) =>
  (s ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Mask the PAN portion of a GSTIN so it's consistent with the masked PAN:
// keep the 2-digit state code + the PAN's last 4 + the entity/Z/checksum.
const maskGstin = (g: string) =>
  g.length === 15 ? `${g.slice(0, 2)}XXXXXX${g.slice(8, 12)}${g.slice(12)}` : g;

const joinAddr = (parts: (string | null | undefined)[]) =>
  parts.map((p) => (p ?? '').trim()).filter(Boolean).join(', ');

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
    entityType: '' as '' | EntityType,
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
      locality: '',
    },
    storeAddress: '',
    city: '',
    state: '',
    country: 'India',
    sellerZipCode: '',
    storeLocality: '',
    sameAsRegistered: false,
    shortStoreDescription: '',
    bankAccountHolderName: '',
    bankAccountNumber: '',
    bankIfscCode: '',
    bankName: '',
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
        entityType: (data.entityType as EntityType) ?? prev.entityType,
        gstin: data.gstin ?? prev.gstin,
        gstStateCode: data.gstStateCode ?? prev.gstStateCode,
        panNumber: data.panNumber ?? prev.panNumber,
        registeredAddress: {
          line1: data.registeredBusinessAddressJson?.line1 ?? '',
          line2: data.registeredBusinessAddressJson?.line2 ?? '',
          locality: data.registeredBusinessAddressJson?.locality ?? '',
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
    // Phase 19 (2026-05-20) — notify the dashboard layout (and any
    // other tab) to re-read the profile so banners + sidebar gating
    // refresh without a hard navigation. The layout listens for this
    // event; absence of a listener is a no-op.
    try {
      window.dispatchEvent(new Event('seller-profile-updated'));
    } catch {
      // SSR / no-DOM environments
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Mirror the store/pickup address to the registered address while
  // "same as registered" is ticked.
  useEffect(() => {
    if (!form.sameAsRegistered) return;
    setForm((f) => ({
      ...f,
      storeAddress: f.registeredAddress.line1,
      sellerZipCode: f.registeredAddress.pincode,
      city: f.registeredAddress.city,
      state: f.registeredAddress.state,
      country: f.registeredAddress.country,
      storeLocality: f.registeredAddress.locality,
    }));
  }, [
    form.sameAsRegistered,
    form.registeredAddress.line1,
    form.registeredAddress.pincode,
    form.registeredAddress.city,
    form.registeredAddress.state,
    form.registeredAddress.country,
    form.registeredAddress.locality,
  ]);

  // Once approved, go straight to the dashboard (the first-listing wizard was
  // removed — approval lands the seller directly on the dashboard).
  useEffect(() => {
    if (
      profile?.status === 'ACTIVE' &&
      profile?.verificationStatus === 'VERIFIED'
    ) {
      router.push('/dashboard');
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
    if (!form.entityType)
      errs.push('Type of entity is required.');
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
    // City + state are required on the registered business address; without
    // them the KYC record can't be matched against the GSTIN jurisdiction.
    if (validateText(form.registeredAddress.city, { min: 2, max: 100, label: 'Registered address city' }))
      errs.push('Registered address city is required.');
    if (validateText(form.registeredAddress.state, { min: 2, max: 100, label: 'Registered address state' }))
      errs.push('Registered address state is required.');
    if (validatePincode(form.registeredAddress.pincode))
      errs.push('Registered address pincode must be a valid 6-digit pincode.');
    if (form.storeAddress.trim().length < 5)
      errs.push('Store address is required.');
    if (validateText(form.city, { min: 2, max: 100, label: 'Store city' }))
      errs.push('Store city is required.');
    if (validateText(form.state, { min: 2, max: 100, label: 'Store state' }))
      errs.push('Store state is required.');
    if (validatePincode(form.sellerZipCode))
      errs.push('Store zip code must be a valid 6-digit pincode.');
    // Account holder is a PERSON name — alphabets only (no digits/specials),
    // not a business name. Use the strict person-name validator.
    const holderErr = validatePersonName(
      form.bankAccountHolderName,
      'Bank account holder name',
    );
    if (holderErr) errs.push(holderErr);
    if (!ACCOUNT_RE.test(form.bankAccountNumber.replace(/\s+/g, '')))
      errs.push('Bank account number must be 9–18 digits.');
    if (!IFSC_RE.test(form.bankIfscCode.trim().toUpperCase()))
      errs.push('IFSC must be 4 letters + 0 + 6 alphanumerics (e.g. HDFC0001234).');
    if (form.bankName.trim().length < 2)
      errs.push('Bank name is required.');
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
      // Save the payout bank account first — the endpoint encrypts the
      // account number at rest. Then submit the KYC for review.
      await apiClient('/seller/bank-details', {
        method: 'PATCH',
        body: JSON.stringify({
          accountHolderName: form.bankAccountHolderName.trim(),
          accountNumber: form.bankAccountNumber.replace(/\s+/g, ''),
          ifscCode: form.bankIfscCode.trim().toUpperCase(),
          bankName: form.bankName.trim() || undefined,
        }),
      });
      await apiClient('/seller/onboarding/submit', {
        method: 'POST',
        body: JSON.stringify({
          legalBusinessName: form.legalBusinessName.trim(),
          // Phase 26 GST — GSTIN + state code are mandatory; no more
          // conditional skipping for UNREGISTERED. Validation above
          // already blocks submission if either is missing.
          gstRegistrationType: form.gstRegistrationType,
          entityType: form.entityType,
          gstin: form.gstin.toUpperCase(),
          gstStateCode: form.gstStateCode,
          panNumber: form.panNumber.toUpperCase(),
          // Locality is sent as its own field (registered: inside the address
          // JSON; store: the top-level `locality`) so it lands in its column
          // instead of being appended to the address text.
          registeredBusinessAddress: {
            line1: form.registeredAddress.line1,
            line2: form.registeredAddress.line2 || '',
            locality: form.registeredAddress.locality || undefined,
            city: form.registeredAddress.city,
            state: form.registeredAddress.state,
            pincode: form.registeredAddress.pincode,
            country: form.registeredAddress.country,
          },
          storeAddress: form.storeAddress.trim(),
          locality: form.storeLocality || undefined,
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
          {profile.verificationStatus === 'REJECTED' &&
            (profile.kycRejectionReason || profile.gstVerificationNotes) && (
            <div className="onboarding__reject-box">
              <strong>Admin's reason:</strong>
              {/* Phase 19 (2026-05-20) — read from the dedicated
                  kycRejectionReason column first; fall back to the
                  legacy overloaded gstVerificationNotes for rows
                  that haven't been re-rejected post-migration. */}
              <p>{profile.kycRejectionReason ?? profile.gstVerificationNotes}</p>
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
                setForm({
                  ...form,
                  // Business name — keep letters, digits, and a small
                  // punctuation set; strip anything else on type/paste.
                  legalBusinessName: e.target.value.replace(/[^A-Za-z0-9 &.,\-/()']/g, ''),
                })
              }
              required
              maxLength={150}
            />

            {/* Phase 35 — explicit hint that GST fields go through the
                admin GSTN-verification queue before they're used on
                invoices / GSTR filings. Mirrors the product tax-config
                attestation banner so sellers don't expect immediate
                effect. */}
            <div
              className="onboarding__hint"
              style={{
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                color: '#1e3a8a',
                padding: '10px 12px',
                borderRadius: 6,
                fontSize: 13,
                marginBottom: 8,
              }}
            >
              <strong>Heads up:</strong> GST registration details (GSTIN,
              state code, PAN, registered address) are reviewed by the
              Sportsmart admin team after submission. Tax invoices,
              GSTR-1 filings, and e-invoicing will only use these
              fields once an admin marks them <em>verified</em> against
              the GSTN portal. Until then, your draft profile is held
              and any documents we generate carry a “DRAFT — not for
              ITC” banner.
            </div>

            <label htmlFor="entityType">Type of entity *</label>
            <select
              id="entityType"
              value={form.entityType}
              onChange={(e) =>
                setForm({ ...form, entityType: e.target.value as EntityType })
              }
            >
              <option value="">Select entity type…</option>
              <option value="PUBLIC_LIMITED">Public Limited Company</option>
              <option value="PRIVATE_LIMITED">Private Limited Company</option>
              <option value="SOLE_PROPRIETORSHIP">Sole Proprietorship</option>
              <option value="GENERAL_PARTNERSHIP">General Partnership</option>
              <option value="LLP">Limited Liability Partnership (LLP)</option>
            </select>

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
              {/* Composition & Casual hidden for now — only Regular is offered
                  (default stays REGULAR). Re-enable these <option>s to restore
                  the full GST registration type list. */}
              {/* <option value="COMPOSITION">Composition</option> */}
              {/* <option value="CASUAL">Casual</option> */}
              {/* Phase 26 GST — UNREGISTERED removed from new submissions.
                  GSTIN is mandatory for every active seller. Sub-threshold
                  sellers must register for GSTIN before listing. */}
            </select>

            <label htmlFor="gstin">GSTIN *</label>
            <input
              id="gstin"
              value={form.gstin}
              onChange={(e) => {
                // Uppercase, strip non-alphanumerics, cap at 15 so a paste
                // with spaces/dashes can't slip a malformed GSTIN into state.
                const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
                // GST state code = the first 2 digits of the GSTIN, so derive it
                // automatically and keep the field read-only (no manual entry).
                setForm({
                  ...form,
                  gstin: v,
                  gstStateCode: v.slice(0, 2).replace(/\D/g, ''),
                });
              }}
              maxLength={15}
              required
              placeholder="e.g. 27ABCDE1234F1Z5"
            />

            <label htmlFor="gstStateCode">GST state code *</label>
            <input
              id="gstStateCode"
              value={form.gstStateCode}
              readOnly
              maxLength={2}
              required
              placeholder="Auto-filled from GSTIN"
              aria-describedby="gstStateCode-hint"
              style={{ background: '#f1f5f9', color: '#475569', cursor: 'not-allowed' }}
            />
            <p id="gstStateCode-hint" className="onboarding__hint" style={{ margin: '4px 0 0' }}>
              Auto-filled from the first 2 digits of your GSTIN.
            </p>

            <label htmlFor="panNumber">PAN number *</label>
            <input
              id="panNumber"
              value={form.panNumber}
              onChange={(e) =>
                setForm({
                  ...form,
                  // Uppercase, strip non-alphanumerics, cap at 10 chars.
                  panNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10),
                })
              }
              maxLength={10}
              required
              placeholder="ABCDE1234F"
            />

            <fieldset className="onboarding__group">
              <legend>Registered business address *</legend>
              <label>Street address</label>
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
              <PincodeFields
                idPrefix="reg"
                value={{
                  pincode: form.registeredAddress.pincode,
                  city: form.registeredAddress.city,
                  state: form.registeredAddress.state,
                  locality: form.registeredAddress.locality,
                }}
                onChange={(patch) =>
                  setForm((f) => ({
                    ...f,
                    registeredAddress: { ...f.registeredAddress, ...patch },
                  }))
                }
              />
            </fieldset>

            <fieldset className="onboarding__group">
              <legend>Store / pickup address *</legend>
              <label className="onboarding__check" style={{ margin: '0 0 6px' }}>
                <input
                  type="checkbox"
                  checked={form.sameAsRegistered}
                  onChange={(e) =>
                    setForm({ ...form, sameAsRegistered: e.target.checked })
                  }
                />
                <span>Same as registered business address</span>
              </label>
              <label>Street address</label>
              <input
                value={form.storeAddress}
                onChange={(e) => setForm({ ...form, storeAddress: e.target.value })}
                disabled={form.sameAsRegistered}
                required
              />
              <PincodeFields
                idPrefix="store"
                showCountry
                disabled={form.sameAsRegistered}
                value={{
                  pincode: form.sellerZipCode,
                  city: form.city,
                  state: form.state,
                  country: form.country,
                  locality: form.storeLocality,
                }}
                onChange={(patch) =>
                  setForm((f) => ({
                    ...f,
                    sellerZipCode: patch.pincode ?? f.sellerZipCode,
                    city: patch.city ?? f.city,
                    state: patch.state ?? f.state,
                    country: patch.country ?? f.country,
                    storeLocality: patch.locality ?? f.storeLocality,
                  }))
                }
              />
            </fieldset>

            <fieldset className="onboarding__group">
              <legend>Bank account details *</legend>
              <label>Account holder name</label>
              <input
                value={form.bankAccountHolderName}
                onChange={(e) =>
                  setForm({
                    ...form,
                    // Strip anything that isn't a letter/space/period/apostrophe/
                    // hyphen so digits can't be typed or pasted into a name.
                    bankAccountHolderName: e.target.value.replace(/[^A-Za-z .'-]/g, ''),
                  })
                }
                maxLength={100}
                placeholder="Name as per bank records"
                required
              />
              <label>Account number</label>
              <input
                value={form.bankAccountNumber}
                onChange={(e) =>
                  setForm({
                    ...form,
                    bankAccountNumber: e.target.value.replace(/\D/g, '').slice(0, 18),
                  })
                }
                inputMode="numeric"
                maxLength={18}
                placeholder="9–18 digit account number"
                required
              />
              <label>IFSC code</label>
              <input
                value={form.bankIfscCode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    // Uppercase, strip non-alphanumerics, cap at 11 chars.
                    bankIfscCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11),
                  })
                }
                maxLength={11}
                placeholder="e.g. HDFC0001234"
                required
              />
              <label>Bank name</label>
              <input
                value={form.bankName}
                onChange={(e) =>
                  setForm({
                    ...form,
                    // Bank name is a business name — keep letters/digits and a
                    // small punctuation set; strip anything else.
                    bankName: e.target.value.replace(/[^A-Za-z0-9 &.,\-/()']/g, ''),
                  })
                }
                maxLength={150}
                placeholder="e.g. HDFC Bank"
              />
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

          {/* Phase 19 (2026-05-20) — read-only submission summary so the
              seller can verify what's in admin review without leaving
              the page. PAN is shown as last-4 only; the full value is
              never returned by the API. */}
          <div
            style={{
              marginTop: 16,
              padding: 16,
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              fontSize: 13,
              color: '#374151',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#111827' }}>
              Submitted details
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>Legal business name:</strong>{' '}
              {profile.legalBusinessName ?? '—'}
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>Entity type:</strong>{' '}
              {profile.entityType
                ? ENTITY_LABELS[profile.entityType] ?? profile.entityType
                : '—'}
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>GST registration type:</strong>{' '}
              {profile.gstRegistrationType ?? '—'}
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>GSTIN:</strong>{' '}
              {profile.gstin ? maskGstin(profile.gstin) : '—'}
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>PAN:</strong>{' '}
              {profile.panLast4 ? `XXXXXX${profile.panLast4}` : '—'}
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>Registered business address:</strong>{' '}
              {profile.registeredBusinessAddressJson
                ? joinAddr([
                    profile.registeredBusinessAddressJson.line1,
                    profile.registeredBusinessAddressJson.line2,
                    profile.registeredBusinessAddressJson.locality,
                    titleCase(profile.registeredBusinessAddressJson.city),
                    titleCase(profile.registeredBusinessAddressJson.state),
                    profile.registeredBusinessAddressJson.pincode,
                  ])
                : '—'}
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>Store address:</strong>{' '}
              {profile.storeAddress
                ? joinAddr([
                    profile.storeAddress,
                    profile.locality,
                    titleCase(profile.city),
                    titleCase(profile.state),
                    profile.sellerZipCode,
                  ])
                : '—'}
            </div>
            <div style={{ marginBottom: 4 }}>
              <strong>Bank account:</strong>{' '}
              {profile.hasBankDetails
                ? `••••${profile.bankAccountLast4 ?? '----'}${
                    profile.bankName ? ` · ${profile.bankName}` : ''
                  }`
                : '—'}
            </div>
            {profile.lastProfileUpdatedAt && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                Submitted {new Date(profile.lastProfileUpdatedAt).toLocaleString()}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={loadProfile}
            className="onboarding__btn onboarding__btn--ghost"
            style={{ marginTop: 16 }}
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
