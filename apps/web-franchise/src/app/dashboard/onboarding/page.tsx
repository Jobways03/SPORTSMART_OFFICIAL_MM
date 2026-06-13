'use client';

/**
 * Phase 20 (2026-05-20) — Franchise KYC onboarding.
 *
 * Three states:
 *   1. KYC missing (no GSTIN/PAN on file) — show submit form
 *   2. UNDER_REVIEW — show pending message
 *   3. REJECTED — show rejection reason, allow edit + resubmit
 *   4. VERIFIED — redirect back to dashboard
 *
 * Submits POST /franchise/onboarding/submit which cross-checks GSTIN
 * positions [0,2) against state code and [2,12) against PAN.
 */

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, ApiError } from '@/lib/api-client';
import { franchiseProfileService, FranchiseProfile } from '@/services/profile.service';
import { PincodeFields } from '@sportsmart/ui';
import { validatePincode } from '@/lib/validators';
import './franchise-onboarding.css';

type GstType = 'REGULAR' | 'COMPOSITION' | 'CASUAL';

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PIN_RE = /^\d{6}$/;
const STATE_CODE_RE = /^\d{2}$/;

interface FormState {
  legalBusinessName: string;
  gstRegistrationType: GstType;
  gstNumber: string;
  gstStateCode: string;
  panNumber: string;
  businessLine1: string;
  businessLine2: string;
  businessCity: string;
  businessState: string;
  businessPincode: string;
  businessLocality: string;
  warehouseLine1: string;
  warehouseLine2: string;
  warehouseCity: string;
  warehouseState: string;
  warehousePincode: string;
  warehouseLocality: string;
  confirmedAccurate: boolean;
}

const EMPTY: FormState = {
  legalBusinessName: '',
  gstRegistrationType: 'REGULAR',
  gstNumber: '',
  gstStateCode: '',
  panNumber: '',
  businessLine1: '',
  businessLine2: '',
  businessCity: '',
  businessState: '',
  businessPincode: '',
  businessLocality: '',
  warehouseLine1: '',
  warehouseLine2: '',
  warehouseCity: '',
  warehouseState: '',
  warehousePincode: '',
  warehouseLocality: '',
  confirmedAccurate: false,
};

export default function FranchiseOnboardingPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<FranchiseProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await franchiseProfileService.getProfile();
        if (cancelled) return;
        if (res.data) {
          setProfile(res.data);
          if (res.data.verificationStatus === 'VERIFIED') {
            router.replace('/dashboard');
            return;
          }
          setForm((prev) => ({
            ...prev,
            legalBusinessName: res.data!.businessName ?? prev.legalBusinessName,
            gstNumber: res.data!.gstNumber ?? prev.gstNumber,
            gstStateCode: res.data!.gstNumber
              ? res.data!.gstNumber.slice(0, 2)
              : prev.gstStateCode,
            panNumber: res.data!.panNumber ?? prev.panNumber,
          }));
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setServerError('Failed to load profile. Please refresh.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (form.legalBusinessName.trim().length < 2) {
      next.legalBusinessName = 'Legal business name is required';
    }
    if (!GSTIN_RE.test(form.gstNumber.trim().toUpperCase())) {
      next.gstNumber = 'Enter a valid 15-character GSTIN';
    }
    if (!STATE_CODE_RE.test(form.gstStateCode.trim())) {
      next.gstStateCode = 'State code must be 2 digits';
    }
    if (
      GSTIN_RE.test(form.gstNumber.trim().toUpperCase()) &&
      STATE_CODE_RE.test(form.gstStateCode.trim()) &&
      form.gstNumber.trim().slice(0, 2) !== form.gstStateCode.trim()
    ) {
      next.gstStateCode = 'GSTIN does not match the selected state code';
    }
    if (!PAN_RE.test(form.panNumber.trim().toUpperCase())) {
      next.panNumber = 'Enter a valid 10-character PAN';
    }
    if (
      GSTIN_RE.test(form.gstNumber.trim().toUpperCase()) &&
      PAN_RE.test(form.panNumber.trim().toUpperCase()) &&
      form.gstNumber.trim().toUpperCase().slice(2, 12) !==
        form.panNumber.trim().toUpperCase()
    ) {
      next.panNumber = 'PAN must match the embedded PAN inside GSTIN';
    }
    if (!form.businessLine1.trim()) next.businessLine1 = 'Address line 1 is required';
    if (!form.businessCity.trim()) next.businessCity = 'City is required';
    if (!form.businessState.trim()) next.businessState = 'State is required';
    if (!PIN_RE.test(form.businessPincode.trim())) {
      next.businessPincode = 'Pincode must be 6 digits';
    }
    // Warehouse address is optional, but if the franchise has started filling
    // it in, the pincode must be a real 6-digit Indian pincode (can't start
    // with 0). The payload only sends a warehouseAddress when one of these
    // fields is set, so mirror that "partially filled" condition here.
    const warehouseStarted =
      !!form.warehouseLine1.trim() ||
      !!form.warehouseCity.trim() ||
      !!form.warehouseState.trim() ||
      !!form.warehousePincode.trim();
    if (warehouseStarted) {
      const whPinError = validatePincode(form.warehousePincode);
      if (whPinError) next.warehousePincode = whPinError;
    }
    if (!form.confirmedAccurate) {
      next.confirmedAccurate = 'You must confirm the details are accurate';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setSuccess(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const warehouseFilled =
        form.warehouseLine1 || form.warehouseCity || form.warehouseState || form.warehousePincode;
      const payload = {
        legalBusinessName: form.legalBusinessName.trim(),
        gstRegistrationType: form.gstRegistrationType,
        gstNumber: form.gstNumber.trim().toUpperCase(),
        gstStateCode: form.gstStateCode.trim(),
        panNumber: form.panNumber.trim().toUpperCase(),
        businessAddress: {
          line1: form.businessLine1.trim(),
          line2:
            form.businessLine2.trim() || form.businessLocality || undefined,
          city: form.businessCity.trim(),
          state: form.businessState.trim(),
          pincode: form.businessPincode.trim(),
          country: 'IN',
        },
        warehouseAddress: warehouseFilled
          ? {
              line1: form.warehouseLine1.trim(),
              line2:
                form.warehouseLine2.trim() ||
                form.warehouseLocality ||
                undefined,
              city: form.warehouseCity.trim(),
              state: form.warehouseState.trim(),
              pincode: form.warehousePincode.trim(),
              country: 'IN',
            }
          : undefined,
        confirmedAccurate: form.confirmedAccurate,
      };
      await apiClient('/franchise/onboarding/submit', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setSuccess('KYC submitted. We will email you when a decision is made.');
      const res = await franchiseProfileService.getProfile();
      if (res.data) setProfile(res.data);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          router.replace('/login');
          return;
        }
        if (err.status === 409) {
          setServerError(
            err.message || 'This GSTIN or PAN is already in use by another franchise.',
          );
        } else if (err.status === 422 && err.body.errors) {
          const fieldErrors: Partial<Record<keyof FormState, string>> = {};
          for (const e of err.body.errors) {
            (fieldErrors as Record<string, string>)[e.field] = e.message;
          }
          setErrors(fieldErrors);
        } else if (err.status === 400) {
          setServerError(err.message || 'Please review the form and try again.');
        } else {
          setServerError('Something went wrong. Please try again.');
        }
      } else {
        setServerError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }
  if (!profile) {
    return <div style={{ padding: 24 }}>{serverError ?? 'Unable to load profile.'}</div>;
  }

  const status = profile.verificationStatus;
  const readOnly = status === 'UNDER_REVIEW';

  return (
    <div className="fr-kyc" style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Franchise KYC Onboarding</h1>
      <p style={{ color: '#64748b', marginBottom: 16 }}>
        Submit your GSTIN, PAN, and business address so an admin can approve your account.
      </p>

      {status === 'UNDER_REVIEW' && (
        <div
          role="status"
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 8,
            border: '1px solid #93c5fd',
            background: '#eff6ff',
            color: '#1e40af',
          }}
        >
          Your submission is under review. We will email you when a decision is made.
        </div>
      )}
      {status === 'REJECTED' && (
        <div
          role="alert"
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 8,
            border: '1px solid #fca5a5',
            background: '#fef2f2',
            color: '#991b1b',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>KYC Rejected</div>
          <div>Please update the details below and resubmit.</div>
        </div>
      )}
      {serverError && (
        <div
          role="alert"
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 8,
            border: '1px solid #fca5a5',
            background: '#fef2f2',
            color: '#991b1b',
          }}
        >
          {serverError}
        </div>
      )}
      {success && (
        <div
          role="status"
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 8,
            border: '1px solid #86efac',
            background: '#f0fdf4',
            color: '#166534',
          }}
        >
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <fieldset disabled={submitting || readOnly} style={{ border: 0, padding: 0 }}>
          <Field
            label="Legal Business Name *"
            error={errors.legalBusinessName}
            input={
              <input
                type="text"
                maxLength={200}
                value={form.legalBusinessName}
                onChange={(e) =>
                  setForm({ ...form, legalBusinessName: e.target.value })
                }
              />
            }
          />

          <Field
            label="GST Registration Type *"
            input={
              <select
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
              </select>
            }
          />

          <Field
            label="GSTIN *"
            error={errors.gstNumber}
            input={
              <input
                type="text"
                maxLength={15}
                value={form.gstNumber}
                onChange={(e) =>
                  setForm({ ...form, gstNumber: e.target.value.toUpperCase() })
                }
                placeholder="15-character GSTIN"
              />
            }
          />

          <Field
            label="GST State Code *"
            error={errors.gstStateCode}
            input={
              <input
                type="text"
                maxLength={2}
                value={form.gstStateCode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    gstStateCode: e.target.value.replace(/\D/g, '').slice(0, 2),
                  })
                }
                placeholder="2-digit code"
                inputMode="numeric"
              />
            }
          />

          <Field
            label="PAN Number *"
            error={errors.panNumber}
            input={
              <input
                type="text"
                maxLength={10}
                value={form.panNumber}
                onChange={(e) =>
                  setForm({ ...form, panNumber: e.target.value.toUpperCase() })
                }
                placeholder="ABCDE1234F"
              />
            }
          />

          <h2 style={{ marginTop: 24, marginBottom: 8, fontSize: 16 }}>
            Business Address
          </h2>

          <Field
            label="Address Line 1 *"
            error={errors.businessLine1}
            input={
              <input
                type="text"
                value={form.businessLine1}
                onChange={(e) =>
                  setForm({ ...form, businessLine1: e.target.value })
                }
              />
            }
          />

          <Field
            label="Address Line 2"
            input={
              <input
                type="text"
                value={form.businessLine2}
                onChange={(e) =>
                  setForm({ ...form, businessLine2: e.target.value })
                }
              />
            }
          />

          <PincodeFields
            idPrefix="biz"
            value={{
              pincode: form.businessPincode,
              city: form.businessCity,
              state: form.businessState,
              locality: form.businessLocality,
            }}
            onChange={(patch) =>
              setForm((f) => ({
                ...f,
                businessPincode: patch.pincode ?? f.businessPincode,
                businessCity: patch.city ?? f.businessCity,
                businessState: patch.state ?? f.businessState,
                businessLocality: patch.locality ?? f.businessLocality,
              }))
            }
          />

          <h2 style={{ marginTop: 24, marginBottom: 8, fontSize: 16 }}>
            Warehouse Address (optional)
          </h2>

          <Field
            label="Address Line 1"
            input={
              <input
                type="text"
                value={form.warehouseLine1}
                onChange={(e) =>
                  setForm({ ...form, warehouseLine1: e.target.value })
                }
              />
            }
          />

          <Field
            label="Address Line 2"
            input={
              <input
                type="text"
                value={form.warehouseLine2}
                onChange={(e) =>
                  setForm({ ...form, warehouseLine2: e.target.value })
                }
              />
            }
          />

          <PincodeFields
            idPrefix="wh"
            errors={{ pincode: errors.warehousePincode }}
            value={{
              pincode: form.warehousePincode,
              city: form.warehouseCity,
              state: form.warehouseState,
              locality: form.warehouseLocality,
            }}
            onChange={(patch) =>
              setForm((f) => ({
                ...f,
                warehousePincode: patch.pincode ?? f.warehousePincode,
                warehouseCity: patch.city ?? f.warehouseCity,
                warehouseState: patch.state ?? f.warehouseState,
                warehouseLocality: patch.locality ?? f.warehouseLocality,
              }))
            }
          />

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              marginTop: 16,
              fontSize: 14,
            }}
          >
            <input
              type="checkbox"
              checked={form.confirmedAccurate}
              onChange={(e) =>
                setForm({ ...form, confirmedAccurate: e.target.checked })
              }
              style={{ marginTop: 3 }}
            />
            <span>
              I confirm the information above is accurate. False submissions
              may delay or void the approval.
            </span>
          </label>
          {errors.confirmedAccurate && (
            <div className="field-error" role="alert" style={{ color: '#dc2626', fontSize: 13 }}>
              {errors.confirmedAccurate}
            </div>
          )}

          <button
            type="submit"
            className="btn-submit"
            style={{
              marginTop: 24,
              padding: '12px 16px',
              background: '#0f172a',
              color: 'white',
              border: 0,
              borderRadius: 8,
              cursor: submitting || readOnly ? 'not-allowed' : 'pointer',
              opacity: submitting || readOnly ? 0.6 : 1,
            }}
            aria-busy={submitting}
          >
            {submitting
              ? 'Submitting…'
              : status === 'REJECTED'
                ? 'Resubmit KYC'
                : 'Submit KYC'}
          </button>
        </fieldset>
      </form>
    </div>
  );
}

function Field(props: { label: string; error?: string; input: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label
        style={{
          display: 'block',
          marginBottom: 4,
          fontSize: 13,
          fontWeight: 600,
          color: '#0f172a',
        }}
      >
        {props.label}
      </label>
      {props.input}
      {props.error && (
        <div
          className="field-error"
          role="alert"
          style={{ color: '#dc2626', fontSize: 13, marginTop: 4 }}
        >
          {props.error}
        </div>
      )}
    </div>
  );
}
