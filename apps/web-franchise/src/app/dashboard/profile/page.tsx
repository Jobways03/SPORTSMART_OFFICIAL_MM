'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  franchiseProfileService,
  FranchiseProfile,
  UpdateFranchiseProfilePayload,
} from '@/services/profile.service';
import { useModal, PincodeFields } from '@sportsmart/ui';
import { apiClient, ApiError } from '@/lib/api-client';
import {
  validatePassword,
  validateOwnerName,
  validateBusinessName,
} from '@/lib/validators';

type FormState = {
  ownerName: string;
  businessName: string;
  state: string;
  city: string;
  address: string;
  pincode: string;
  locality: string;
  country: string;
  gstNumber: string;
  panNumber: string;
  warehouseAddress: string;
  warehousePincode: string;
  warehouseCity: string;
  warehouseState: string;
  warehouseLocality: string;
  warehouseCountry: string;
};

const DEFAULT_COUNTRY = 'India';

const EMPTY_FORM: FormState = {
  ownerName: '',
  businessName: '',
  state: '',
  city: '',
  address: '',
  pincode: '',
  locality: '',
  country: DEFAULT_COUNTRY,
  gstNumber: '',
  panNumber: '',
  warehouseAddress: '',
  warehousePincode: '',
  warehouseCity: '',
  warehouseState: '',
  warehouseLocality: '',
  warehouseCountry: DEFAULT_COUNTRY,
};

function profileToForm(p: FranchiseProfile): FormState {
  return {
    ownerName: p.ownerName || '',
    businessName: p.businessName || '',
    state: p.state || '',
    city: p.city || '',
    address: p.address || '',
    pincode: p.pincode || '',
    locality: p.locality || '',
    country: p.country || DEFAULT_COUNTRY,
    gstNumber: p.gstNumber || '',
    panNumber: p.panNumber || '',
    warehouseAddress: p.warehouseAddress || '',
    warehousePincode: p.warehousePincode || '',
    warehouseCity: p.warehouseCity || '',
    warehouseState: p.warehouseState || '',
    warehouseLocality: p.warehouseLocality || '',
    warehouseCountry: p.warehouseCountry || DEFAULT_COUNTRY,
  };
}

// True when the saved warehouse address already matches the store address — used
// to pre-tick the "Same as Franchise Address" checkbox on load.
function warehouseMatchesAddress(p: FranchiseProfile): boolean {
  const norm = (v: string | null) => (v ?? '').trim();
  if (!norm(p.address) || !norm(p.warehouseAddress)) return false;
  return (
    norm(p.address) === norm(p.warehouseAddress) &&
    norm(p.pincode) === norm(p.warehousePincode) &&
    norm(p.city) === norm(p.warehouseCity) &&
    norm(p.state) === norm(p.warehouseState) &&
    norm(p.locality) === norm(p.warehouseLocality) &&
    norm(p.country) === norm(p.warehouseCountry)
  );
}

function formatDate(value: string | null): string {
  if (!value) return 'Not set';
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return value;
  }
}

function formatRate(value: number | null | undefined): string {
  if (value == null) return 'Not set';
  return `${value}%`;
}

export default function ProfilePage() {
  const { notify, confirmDialog } = useModal();
  const router = useRouter();
const [profile, setProfile] = useState<FranchiseProfile | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // "Same as Franchise Address" — when ticked, the warehouse mirrors the store
  // address (copied + kept in sync, fields locked).
  const [warehouseSameAsAddress, setWarehouseSameAsAddress] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Store-address and warehouse pincode auto-fill (city/state/locality) are both
  // handled by the shared <PincodeFields>.

  // Password change modal
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  // Media (profile image + logo) upload state
  const [mediaSaving, setMediaSaving] = useState<'profile' | 'logo' | null>(null);
  const [mediaError, setMediaError] = useState('');
  const profileImageInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const openPwModal = () => {
    setPwCurrent('');
    setPwNew('');
    setPwConfirm('');
    setPwError('');
    setPwSuccess('');
    setPwModalOpen(true);
  };

  const submitPasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');
    // Phase 252 — use the SAME strong rule as register/reset (8+ with upper,
    // lower, digit and special) instead of the weak letter+digit inline check.
    const pwStrengthError = validatePassword(pwNew);
    if (pwStrengthError) {
      setPwError(pwStrengthError);
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError('New password and confirmation do not match');
      return;
    }
    if (pwNew === pwCurrent) {
      setPwError('New password must be different from the current password');
      return;
    }
    setPwSaving(true);
    try {
      await franchiseProfileService.changePassword(pwCurrent, pwNew);
      setPwSuccess('Password changed successfully');
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
      setTimeout(() => setPwModalOpen(false), 1200);
    } catch (err) {
      if (err instanceof ApiError) {
        setPwError(err.body.message || 'Failed to change password');
      } else {
        setPwError('Failed to change password');
      }
    } finally {
      setPwSaving(false);
    }
  };

  const handleMediaUpload = async (kind: 'profile' | 'logo', file: File) => {
    if (!file.type.startsWith('image/')) {
      setMediaError('Please choose an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMediaError('Image must be smaller than 5 MB');
      return;
    }
    setMediaError('');
    setMediaSaving(kind);
    try {
      // Patch only the relevant image field on the profile snapshot so the
      // newly uploaded image renders without re-fetching the whole profile —
      // a full reload would overwrite the form state and wipe out any
      // unsaved edits the user is in the middle of typing.
      if (kind === 'profile') {
        const res = await franchiseProfileService.uploadProfileImage(file);
        const url = res.data?.profileImageUrl ?? null;
        setProfile((prev) => (prev ? { ...prev, profileImageUrl: url } : prev));
      } else {
        const res = await franchiseProfileService.uploadLogo(file);
        const url = res.data?.logoUrl ?? null;
        setProfile((prev) => (prev ? { ...prev, logoUrl: url } : prev));
      }
      setSuccessMessage(
        kind === 'profile' ? 'Profile image updated' : 'Logo updated',
      );
    } catch (err) {
      setMediaError(
        err instanceof ApiError
          ? err.body.message || 'Upload failed'
          : 'Upload failed',
      );
    } finally {
      setMediaSaving(null);
    }
  };

  const handleMediaRemove = async (kind: 'profile' | 'logo') => {if (!(await confirmDialog(`Remove your ${kind === 'profile' ? 'profile image' : 'logo'}?`))) return;
    setMediaError('');
    setMediaSaving(kind);
    try {
      // Patch only the relevant image field — same reason as upload above:
      // calling loadProfile() would clobber any unsaved form edits.
      if (kind === 'profile') {
        await franchiseProfileService.deleteProfileImage();
        setProfile((prev) => (prev ? { ...prev, profileImageUrl: null } : prev));
      } else {
        await franchiseProfileService.deleteLogo();
        setProfile((prev) => (prev ? { ...prev, logoUrl: null } : prev));
      }
      setSuccessMessage(
        kind === 'profile' ? 'Profile image removed' : 'Logo removed',
      );
    } catch (err) {
      setMediaError(
        err instanceof ApiError
          ? err.body.message || 'Remove failed'
          : 'Remove failed',
      );
    } finally {
      setMediaSaving(null);
    }
  };

  // lookupPincode removed — both the store address and the warehouse address now
  // use the shared <PincodeFields>, which runs its own lookup + auto-fill.

  const loadProfile = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setIsLoading(true);
      setError('');
    }
    try {
      const res = await franchiseProfileService.getProfile();
      if (res.data) {
        setProfile(res.data);
        setForm(profileToForm(res.data));
        setWarehouseSameAsAddress(warehouseMatchesAddress(res.data));
      }
    } catch (err) {
      if (!opts?.silent) {
        if (err instanceof ApiError) {
          setError(err.body.message || 'Failed to load profile');
        } else {
          setError('Failed to load profile');
        }
      }
    } finally {
      if (!opts?.silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  // Auto-refresh so an admin-side profile edit appears on the franchise side
  // without a manual reload. Polls every 20s + on tab focus, but SKIPS while
  // editing or saving so it never clobbers in-progress input. Silent = no
  // spinner / error-banner flicker.
  useEffect(() => {
    const refresh = () => {
      if (isEditing || isSaving) return;
      void loadProfile({ silent: true });
    };
    const interval = setInterval(refresh, 20000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, isSaving]);

  // When "Same as Franchise Address" is ticked, mirror the store address into
  // the warehouse fields and keep them in sync while it stays ticked. Depends
  // only on the address fields (not the warehouse ones) so it can't loop.
  useEffect(() => {
    if (!warehouseSameAsAddress) return;
    setForm((prev) => ({
      ...prev,
      warehouseAddress: prev.address,
      warehousePincode: prev.pincode,
      warehouseCity: prev.city,
      warehouseState: prev.state,
      warehouseLocality: prev.locality,
      warehouseCountry: prev.country || DEFAULT_COUNTRY,
    }));
    setFieldErrors((prev) => ({
      ...prev,
      warehousePincode: '',
      warehouseCity: '',
      warehouseState: '',
      warehouseCountry: '',
    }));
  }, [
    warehouseSameAsAddress,
    form.address,
    form.pincode,
    form.city,
    form.state,
    form.locality,
    form.country,
  ]);

  // Bank payout details (masked) for the Bank Account card.
  const [bankInfo, setBankInfo] = useState<{
    hasBankDetails: boolean;
    details?: {
      accountHolderName: string;
      accountNumberLast4: string;
      ifscCode: string;
      bankName: string | null;
    };
  } | null>(null);
  useEffect(() => {
    apiClient('/franchise/bank-details/status')
      .then((res) => setBankInfo((res.data as typeof bankInfo) ?? null))
      .catch(() => {});
  }, []);

  // Bank account add/edit (self-service). The PATCH upserts; the franchise can
  // manage their payout account here even when the profile is approval-locked
  // (payout details are operationally theirs and are needed to receive
  // settlements). Previously the card was display-only and pointed users to
  // "onboarding", leaving no way to add bank post-onboarding.
  const EMPTY_BANK_FORM = {
    accountHolderName: '',
    accountNumber: '',
    ifscCode: '',
    bankName: '',
    upiVpa: '',
  };
  const [bankEditing, setBankEditing] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);
  const [bankError, setBankError] = useState('');
  const [bankForm, setBankForm] = useState(EMPTY_BANK_FORM);

  const refreshBankInfo = () => {
    apiClient('/franchise/bank-details/status')
      .then((res) => setBankInfo((res.data as typeof bankInfo) ?? null))
      .catch(() => {});
  };

  const startBankEdit = () => {
    // Prefill non-secret fields when updating; the account number must be
    // re-entered (we only ever hold the last 4 digits).
    setBankForm(
      bankInfo?.details
        ? {
            accountHolderName: bankInfo.details.accountHolderName || '',
            accountNumber: '',
            ifscCode: bankInfo.details.ifscCode || '',
            bankName: bankInfo.details.bankName || '',
            upiVpa: '',
          }
        : EMPTY_BANK_FORM,
    );
    setBankError('');
    setBankEditing(true);
  };

  const handleSaveBank = async () => {
    setBankError('');
    const accountHolderName = bankForm.accountHolderName.trim();
    const accountNumber = bankForm.accountNumber.replace(/\s+/g, '');
    const ifscCode = bankForm.ifscCode.trim().toUpperCase();
    const bankName = bankForm.bankName.trim();
    const upiVpa = bankForm.upiVpa.trim();
    if (!accountHolderName) {
      setBankError('Account holder name is required.');
      return;
    }
    if (!/^[0-9]{9,18}$/.test(accountNumber)) {
      setBankError('Account number must be 9–18 digits.');
      return;
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
      setBankError('IFSC must be 4 letters + 0 + 6 alphanumerics (e.g. HDFC0001234).');
      return;
    }
    if (!bankName) {
      setBankError('Bank name is required.');
      return;
    }
    if (upiVpa && !/^[\w.\-]+@[A-Za-z]+$/.test(upiVpa)) {
      setBankError('Enter a valid UPI ID (e.g. name@bank) or leave it blank.');
      return;
    }
    setBankSaving(true);
    try {
      await franchiseProfileService.updateBankDetails({
        accountHolderName,
        accountNumber,
        ifscCode,
        bankName,
        ...(upiVpa ? { upiVpa } : {}),
      });
      refreshBankInfo();
      setBankEditing(false);
      setBankForm(EMPTY_BANK_FORM);
      setError('');
      setSuccessMessage('Bank account saved.');
    } catch (err) {
      setBankError(
        err instanceof ApiError
          ? err.body?.message || err.message || 'Failed to save bank details.'
          : 'Failed to save bank details.',
      );
    } finally {
      setBankSaving(false);
    }
  };

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // ── Regex / validators ────────────────────────────────────────────────
  // India PAN: 5 letters, 4 digits, 1 letter (exactly 10 chars).
  const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  // India GSTIN: 15 chars — 2 digit state + 10-char PAN + 1 entity + 1 Z + 1 check.
  const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  // India pincode — 6 digits, can't start with 0.
  const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

  // Hard-input filters applied at keystroke time so the user can't type
  // characters that would never be valid. Kept permissive enough not to
  // frustrate copy-paste (we still coerce on input).
  const sanitize = {
    // PAN: letters + digits only, max 10, uppercase.
    pan: (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10),
    // GST: letters + digits only, max 15, uppercase.
    gst: (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15),
    // Digits only, exact max.
    digitsMax: (v: string, max: number) => v.replace(/\D/g, '').slice(0, max),
    // PERSON name: letters + space + period/apostrophe/hyphen only — strips
    // digits AND other specials (@ # $ …) so they can't be typed or pasted.
    personName: (v: string) => v.replace(/[^A-Za-z .'-]/g, '').slice(0, 100),
    // BUSINESS name: letters, digits and legal punctuation (& . , - / ( ) ').
    // Digits are intentionally KEPT ("3M", "7-Eleven", "Demo1").
    businessName: (v: string) =>
      v.replace(/[^A-Za-z0-9 &.,\-/()']/g, '').slice(0, 150),
  };

  // Per-field validator that returns an error string or empty.
  const validateField = (field: keyof FormState, value: string): string => {
    const trimmed = (value ?? '').trim();
    switch (field) {
      case 'panNumber':
        if (!trimmed) return '';
        if (trimmed.length !== 10) return 'PAN must be exactly 10 characters';
        if (!PAN_REGEX.test(trimmed))
          return 'Invalid PAN format (e.g. ABCDE1234F — 5 letters, 4 digits, 1 letter)';
        return '';
      case 'gstNumber':
        if (!trimmed) return '';
        if (trimmed.length !== 15) return 'GSTIN must be exactly 15 characters';
        if (!GST_REGEX.test(trimmed))
          return 'Invalid GSTIN format (15 chars: 2 digits + 10-char PAN + 3 alphanumeric)';
        return '';
      case 'pincode':
      case 'warehousePincode':
        if (!trimmed) return '';
        if (!PINCODE_REGEX.test(trimmed))
          return 'Pincode must be 6 digits and cannot start with 0';
        return '';
      case 'ownerName':
        // Owner name is a PERSON name — alphabets only (no digits AND no
        // special characters like @ # $ etc.). The keystroke sanitizer below
        // strips digits but still lets specials through, so the strict
        // alphabets-only check is enforced here at validate time.
        if (!trimmed) return '';
        return validateOwnerName(trimmed) ?? '';
      case 'businessName':
        // Business names commonly include digits (e.g. "3M", "7-Eleven",
        // "Demo1") — those are KEPT. Empty is allowed (field is optional);
        // when present, validate the BUSINESS-name format/length on submit.
        if (!trimmed) return '';
        return validateBusinessName(trimmed) ?? '';
      default:
        return '';
    }
  };

  const handleChange = (field: keyof FormState, value: string) => {
    // Apply per-field hard sanitization so invalid characters never enter
    // the state to begin with — the textbox physically refuses them.
    let next = value;
    if (field === 'panNumber') next = sanitize.pan(value);
    else if (field === 'gstNumber') next = sanitize.gst(value);
    else if (field === 'pincode' || field === 'warehousePincode')
      next = sanitize.digitsMax(value, 6);
    else if (field === 'ownerName') next = sanitize.personName(value);
    else if (field === 'businessName') next = sanitize.businessName(value);

    setForm((prev) => ({ ...prev, [field]: next }));
    setFieldErrors((prev) => ({ ...prev, [field]: validateField(field, next) }));
  };

  const handleEdit = () => {
    setError('');
    setSuccessMessage('');
    setIsEditing(true);
  };

  const handleCancel = () => {
    if (profile) {
      setForm(profileToForm(profile));
      setWarehouseSameAsAddress(warehouseMatchesAddress(profile));
    }
    setError('');
    setIsEditing(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    // Pre-submit re-validation of every constrained field. If any fails,
    // populate all errors at once so the user sees everything that needs
    // fixing in one pass rather than one-at-a-time.
    const fields: Array<keyof FormState> = [
      'ownerName',
      'businessName',
      'panNumber',
      'gstNumber',
      'pincode',
      'warehousePincode',
    ];
    const errors: Record<string, string> = {};
    for (const f of fields) {
      const err = validateField(f, (form as any)[f] ?? '');
      if (err) errors[f] = err;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError('Please fix the highlighted fields before saving.');
      // Scroll the first invalid field into view so the user can actually
      // see what failed — without this, the inline + banner errors are
      // far up the page and a user near the Save button just sees nothing.
      const firstInvalid = Object.keys(errors)[0];
      if (typeof window !== 'undefined' && firstInvalid) {
        const el = document.getElementById(firstInvalid);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (el as HTMLInputElement).focus?.();
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
      return;
    }

    setIsSaving(true);

    try {
      // Build payload with trimmed values, omitting empty optional fields
      const payload: UpdateFranchiseProfilePayload = {
        ownerName: form.ownerName.trim() || undefined,
        businessName: form.businessName.trim() || undefined,
        state: form.state.trim() || undefined,
        city: form.city.trim() || undefined,
        address: form.address.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
        locality: form.locality.trim() || undefined,
        country: form.country.trim() || undefined,
        gstNumber: form.gstNumber.trim().toUpperCase() || undefined,
        panNumber: form.panNumber.trim().toUpperCase() || undefined,
        warehouseAddress: form.warehouseAddress.trim() || undefined,
        warehousePincode: form.warehousePincode.trim() || undefined,
        warehouseCity: form.warehouseCity.trim() || undefined,
        warehouseState: form.warehouseState.trim() || undefined,
        warehouseLocality: form.warehouseLocality.trim() || undefined,
        warehouseCountry: form.warehouseCountry.trim() || undefined,
      };

      const res = await franchiseProfileService.updateProfile(payload);
      if (res.data) {
        setProfile(res.data);
        setForm(profileToForm(res.data));
        setWarehouseSameAsAddress(warehouseMatchesAddress(res.data));

        // Update cached franchise in session storage
        try {
          const cached = sessionStorage.getItem('franchise');
          if (cached) {
            const parsed = JSON.parse(cached);
            sessionStorage.setItem(
              'franchise',
              JSON.stringify({
                ...parsed,
                ownerName: res.data.ownerName,
                businessName: res.data.businessName,
                email: res.data.email,
                phoneNumber: res.data.phoneNumber,
                status: res.data.status,
                isEmailVerified: res.data.isEmailVerified,
              }),
            );
          }
        } catch {
          // ignore
        }
      }
      setIsEditing(false);
      setSuccessMessage('Profile updated successfully');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 422 && err.body.errors && err.body.errors.length > 0) {
          setError(err.body.errors.map((e) => `${e.field}: ${e.message}`).join(', '));
        } else {
          setError(err.body.message || 'Failed to update profile');
        }
      } else {
        setError('Failed to update profile');
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Profile</h1>
            <p>Manage your franchise details</p>
          </div>
        </div>
        <div className="card">Loading...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Profile</h1>
          </div>
        </div>
        <div className="card">
          <div className="alert alert-error" style={{ marginBottom: 0 }}>
            {error || 'Unable to load profile'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Profile</h1>
          <p>Manage your franchise details and business information</p>
        </div>
        {!isEditing && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              // Locked — either registered with a logistics partner, or the
              // admin has approved the profile (approval lock). Either way the
              // franchise can't edit here; pop a modal pointing them to support
              // so the franchise admin makes the change.
              if (profile?.logisticsLocked || profile?.profileLocked) {
                const ok = await confirmDialog({
                  title: 'Profile locked',
                  message:
                    profile?.profileLocked && !profile?.logisticsLocked
                      ? 'Your profile is approved and locked. To change any details, please ask your franchise admin — they make the change for you. Open a support request now?'
                      : "This profile is registered with a logistics partner, so these details can't be edited here. Please ask your franchise admin to update them. Open a support request now?",
                  confirmText: 'Talk to Support',
                });
                if (ok) router.push('/dashboard/support/new');
                return;
              }
              handleEdit();
            }}
          >
            Edit Profile
          </button>
        )}
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="alert alert-success" role="status">
          {successMessage}
        </div>
      )}
      {profile?.logisticsLocked && (
        <div className="alert alert-warning" role="alert" style={{ marginBottom: 12 }}>
          Your business name, contact, and pickup/warehouse address are locked
          because they&apos;re registered with a logistics partner. Contact your
          franchise admin to change them.
        </div>
      )}
      {/* Profile approval lock — set once an admin marks the franchise VERIFIED. */}
      {profile?.profileLocked && (
        <div className="alert alert-info" role="status" style={{ marginBottom: 12 }}>
          Your profile is approved and locked. To change any details, please
          contact your franchise admin — they make the change for you.
        </div>
      )}
      {/* Sent back for changes — surface the admin's reason so the franchise
          knows what to fix before resubmitting for approval. */}
      {profile?.verificationStatus === 'REJECTED' &&
        profile?.verificationRejectionReason && (
          <div className="alert alert-warning" role="alert" style={{ marginBottom: 12 }}>
            Your profile was sent back by the admin:{' '}
            {profile.verificationRejectionReason}. Please update your details and
            resubmit for approval.
          </div>
        )}

      {/* Profile Completion */}
      <div className="progress-card">
        <div className="progress-text">
          <span>Profile Completion</span>
          <span>{profile.profileCompletionPercentage}%</span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${profile.profileCompletionPercentage}%` }}
          />
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {/* Business Details */}
        <div className="card">
          <h2>Business Details</h2>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="ownerName">Owner Name</label>
              {isEditing ? (
                <input
                  id="ownerName"
                  type="text"
                  value={form.ownerName}
                  onChange={(e) => handleChange('ownerName', e.target.value)}
                  disabled={isSaving || profile?.logisticsLocked || profile?.profileLocked}
                />
              ) : (
                <div className="value">{profile.ownerName}</div>
              )}
            </div>

            <div className="field">
              <label htmlFor="businessName">Business Name</label>
              {isEditing ? (
                <input
                  id="businessName"
                  type="text"
                  value={form.businessName}
                  onChange={(e) => handleChange('businessName', e.target.value)}
                  disabled={isSaving || profile?.logisticsLocked || profile?.profileLocked}
                />
              ) : (
                <div className="value">{profile.businessName}</div>
              )}
            </div>

            <div className="field">
              <label>Email</label>
              <div className="value">{profile.email}</div>
            </div>

            <div className="field">
              <label>Phone Number</label>
              <div className="value">{profile.phoneNumber}</div>
            </div>

            <div className="field">
              <label>Franchise Code</label>
              <div className="value">{profile.franchiseCode}</div>
            </div>

            <div className="field">
              <label>Status</label>
              <div className="value">{profile.status}</div>
            </div>
          </div>
        </div>

        {/* Franchise Address */}
        <div className="card">
          <h2>Franchise Address</h2>
          <p style={{ marginTop: -6, marginBottom: 16, color: '#6b7280', fontSize: 14 }}>
            Your physical store or warehouse address
          </p>

          <div className="field" style={{ marginBottom: 16 }}>
            <label htmlFor="address">Address</label>
            {isEditing ? (
              <textarea
                id="address"
                value={form.address}
                onChange={(e) => handleChange('address', e.target.value)}
                disabled={isSaving || profile?.logisticsLocked || profile?.profileLocked}
                rows={3}
              />
            ) : (
              <div className={`value${profile.address ? '' : ' muted'}`}>
                {profile.address || 'Not set'}
              </div>
            )}
          </div>

          {isEditing ? (
            <PincodeFields
              idPrefix="store"
              forceLocality
              showCountry
              disabled={isSaving || profile?.logisticsLocked || profile?.profileLocked}
              value={{
                pincode: form.pincode,
                city: form.city,
                state: form.state,
                country: form.country,
                locality: form.locality,
              }}
              errors={{
                pincode: fieldErrors.pincode,
                city: fieldErrors.city,
                state: fieldErrors.state,
                country: fieldErrors.country,
              }}
              onChange={(patch) => {
                if (patch.pincode !== undefined) handleChange('pincode', patch.pincode);
                if (patch.city !== undefined) handleChange('city', patch.city);
                if (patch.state !== undefined) handleChange('state', patch.state);
                if (patch.country !== undefined) handleChange('country', patch.country);
                if (patch.locality !== undefined) handleChange('locality', patch.locality);
              }}
            />
          ) : (
            <>
              <div className="grid-2">
                <div className="field">
                  <label>ZIP / PIN Code</label>
                  <div className={`value${profile.pincode ? '' : ' muted'}`}>
                    {profile.pincode || 'Not set'}
                  </div>
                </div>
                <div className="field">
                  <label>Country</label>
                  <div className={`value${profile.country ? '' : ' muted'}`}>
                    {profile.country || 'Not set'}
                  </div>
                </div>
                <div className="field">
                  <label>City / District</label>
                  <div className={`value${profile.city ? '' : ' muted'}`}>
                    {profile.city || 'Not set'}
                  </div>
                </div>
                <div className="field">
                  <label>State</label>
                  <div className={`value${profile.state ? '' : ' muted'}`}>
                    {profile.state || 'Not set'}
                  </div>
                </div>
              </div>
              {profile.locality && (
                <div className="field" style={{ marginTop: 16 }}>
                  <label>Locality</label>
                  <div className="value">{profile.locality}</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Tax Info */}
        <div className="card">
          <h2>Tax Information</h2>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="gstNumber">GST Number</label>
              {isEditing ? (
                <>
                  <input
                    id="gstNumber"
                    type="text"
                    maxLength={15}
                    value={form.gstNumber}
                    onChange={(e) => handleChange('gstNumber', e.target.value)}
                    disabled={isSaving || profile?.logisticsLocked || profile?.profileLocked}
                    placeholder="e.g. 27AAAPA1234A1Z5"
                    autoCapitalize="characters"
                    spellCheck={false}
                    style={fieldErrors.gstNumber ? { borderColor: '#dc2626' } : undefined}
                  />
                  {fieldErrors.gstNumber ? (
                    <small style={{ color: '#dc2626', display: 'block', marginTop: 4 }}>
                      {fieldErrors.gstNumber}
                    </small>
                  ) : (
                    <small style={{ color: '#6b7280', display: 'block', marginTop: 4 }}>
                      15 characters · {form.gstNumber.length}/15
                    </small>
                  )}
                </>
              ) : (
                <div className={`value${profile.gstNumber ? '' : ' muted'}`}>
                  {profile.gstNumber || 'Not set'}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="panNumber">PAN Number</label>
              {isEditing ? (
                <>
                  <input
                    id="panNumber"
                    type="text"
                    maxLength={10}
                    value={form.panNumber}
                    onChange={(e) => handleChange('panNumber', e.target.value)}
                    disabled={isSaving || profile?.logisticsLocked || profile?.profileLocked}
                    placeholder="e.g. ABCDE1234F"
                    autoCapitalize="characters"
                    spellCheck={false}
                    style={fieldErrors.panNumber ? { borderColor: '#dc2626' } : undefined}
                  />
                  {fieldErrors.panNumber ? (
                    <small style={{ color: '#dc2626', display: 'block', marginTop: 4 }}>
                      {fieldErrors.panNumber}
                    </small>
                  ) : (
                    <small style={{ color: '#6b7280', display: 'block', marginTop: 4 }}>
                      10 characters · 5 letters + 4 digits + 1 letter · {form.panNumber.length}/10
                    </small>
                  )}
                </>
              ) : (
                <div className={`value${profile.panNumber ? '' : ' muted'}`}>
                  {profile.panNumber || 'Not set'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bank Account — self-service add/update of the payout account. */}
        <div className="card">
          <h2>Bank Account</h2>
          {!bankEditing ? (
            <>
              {bankInfo?.hasBankDetails && bankInfo.details ? (
                <div className="grid-2">
                  <div className="field">
                    <label>Bank Name</label>
                    <div className="value">{bankInfo.details.bankName || 'Not set'}</div>
                  </div>
                  <div className="field">
                    <label>Account Holder</label>
                    <div className="value">{bankInfo.details.accountHolderName}</div>
                  </div>
                  <div className="field">
                    <label>Account Number</label>
                    <div className="value">{`••••••${bankInfo.details.accountNumberLast4}`}</div>
                  </div>
                  <div className="field">
                    <label>IFSC Code</label>
                    <div className="value">{bankInfo.details.ifscCode}</div>
                  </div>
                </div>
              ) : (
                <div className="value muted">
                  No bank account on file yet. Add your payout account to receive
                  your settlements.
                </div>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={startBankEdit}
                style={{ marginTop: 12 }}
              >
                {bankInfo?.hasBankDetails ? 'Update bank account' : 'Add bank account'}
              </button>
            </>
          ) : (
            <div
              onKeyDownCapture={(e) => {
                // The card lives inside the main profile <form>; stop Enter from
                // submitting that form while editing bank fields.
                if (e.key === 'Enter') e.preventDefault();
              }}
            >
              {bankError && (
                <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>
                  {bankError}
                </div>
              )}
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="bankAccountHolder">Account Holder Name</label>
                  <input
                    id="bankAccountHolder"
                    type="text"
                    value={bankForm.accountHolderName}
                    onChange={(e) =>
                      setBankForm((f) => ({ ...f, accountHolderName: e.target.value }))
                    }
                    disabled={bankSaving}
                    maxLength={150}
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="bankName">Bank Name</label>
                  <input
                    id="bankName"
                    type="text"
                    value={bankForm.bankName}
                    onChange={(e) =>
                      setBankForm((f) => ({ ...f, bankName: e.target.value }))
                    }
                    disabled={bankSaving}
                    maxLength={150}
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="bankAccountNumber">Account Number</label>
                  <input
                    id="bankAccountNumber"
                    type="text"
                    inputMode="numeric"
                    value={bankForm.accountNumber}
                    onChange={(e) =>
                      setBankForm((f) => ({
                        ...f,
                        accountNumber: e.target.value.replace(/[^0-9]/g, ''),
                      }))
                    }
                    disabled={bankSaving}
                    maxLength={18}
                    placeholder="9–18 digits"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="bankIfsc">IFSC Code</label>
                  <input
                    id="bankIfsc"
                    type="text"
                    value={bankForm.ifscCode}
                    onChange={(e) =>
                      setBankForm((f) => ({
                        ...f,
                        ifscCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                      }))
                    }
                    disabled={bankSaving}
                    maxLength={11}
                    placeholder="e.g. HDFC0001234"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label htmlFor="bankUpi">UPI ID (optional)</label>
                  <input
                    id="bankUpi"
                    type="text"
                    value={bankForm.upiVpa}
                    onChange={(e) =>
                      setBankForm((f) => ({ ...f, upiVpa: e.target.value }))
                    }
                    disabled={bankSaving}
                    maxLength={100}
                    placeholder="name@bank"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveBank}
                  disabled={bankSaving}
                >
                  {bankSaving ? 'Saving…' : 'Save bank account'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setBankEditing(false);
                    setBankError('');
                  }}
                  disabled={bankSaving}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Warehouse */}
        <div className="card">
          <h2>Warehouse</h2>
          {isEditing && (
            <label
              htmlFor="warehouseSameAsAddress"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                margin: '4px 0 16px',
                fontSize: 14,
                color: '#374151',
                cursor: (profile?.logisticsLocked || profile?.profileLocked) ? 'not-allowed' : 'pointer',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                id="warehouseSameAsAddress"
                checked={warehouseSameAsAddress}
                onChange={(e) => setWarehouseSameAsAddress(e.target.checked)}
                disabled={isSaving || profile?.logisticsLocked || profile?.profileLocked}
                style={{ width: 16, height: 16 }}
              />
              Same as Franchise Address
            </label>
          )}
          <div className="grid-2">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="warehouseAddress">Warehouse Address</label>
              {isEditing ? (
                <textarea
                  id="warehouseAddress"
                  value={form.warehouseAddress}
                  onChange={(e) => handleChange('warehouseAddress', e.target.value)}
                  disabled={isSaving || profile?.logisticsLocked || profile?.profileLocked || warehouseSameAsAddress}
                />
              ) : (
                <div className={`value${profile.warehouseAddress ? '' : ' muted'}`}>
                  {profile.warehouseAddress || 'Not set'}
                </div>
              )}
            </div>

            <div className="field" style={{ gridColumn: '1 / -1' }}>
              {isEditing ? (
                <PincodeFields
                  idPrefix="warehouse"
                  forceLocality
                  showCountry
                  pincodeLabel="Warehouse Pincode"
                  disabled={isSaving || profile?.logisticsLocked || profile?.profileLocked || warehouseSameAsAddress}
                  value={{
                    pincode: form.warehousePincode,
                    city: form.warehouseCity,
                    state: form.warehouseState,
                    country: form.warehouseCountry,
                    locality: form.warehouseLocality,
                  }}
                  errors={{
                    pincode: fieldErrors.warehousePincode,
                    city: fieldErrors.warehouseCity,
                    state: fieldErrors.warehouseState,
                    country: fieldErrors.warehouseCountry,
                  }}
                  onChange={(patch) => {
                    if (patch.pincode !== undefined) handleChange('warehousePincode', patch.pincode);
                    if (patch.city !== undefined) handleChange('warehouseCity', patch.city);
                    if (patch.state !== undefined) handleChange('warehouseState', patch.state);
                    if (patch.country !== undefined) handleChange('warehouseCountry', patch.country);
                    if (patch.locality !== undefined) handleChange('warehouseLocality', patch.locality);
                  }}
                />
              ) : (
                <>
                  <div className="grid-2">
                    <div className="field">
                      <label>Warehouse Pincode</label>
                      <div className={`value${profile.warehousePincode ? '' : ' muted'}`}>
                        {profile.warehousePincode || 'Not set'}
                      </div>
                    </div>
                    <div className="field">
                      <label>Country</label>
                      <div className={`value${profile.warehouseCountry ? '' : ' muted'}`}>
                        {profile.warehouseCountry || 'Not set'}
                      </div>
                    </div>
                    <div className="field">
                      <label>City / District</label>
                      <div className={`value${profile.warehouseCity ? '' : ' muted'}`}>
                        {profile.warehouseCity || 'Not set'}
                      </div>
                    </div>
                    <div className="field">
                      <label>State</label>
                      <div className={`value${profile.warehouseState ? '' : ' muted'}`}>
                        {profile.warehouseState || 'Not set'}
                      </div>
                    </div>
                  </div>
                  {profile.warehouseLocality && (
                    <div className="field" style={{ marginTop: 16 }}>
                      <label>Locality</label>
                      <div className="value">{profile.warehouseLocality}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Branding — profile image + logo */}
        <div className="card">
          <h2>Branding</h2>
          <p style={{ marginTop: -6, marginBottom: 16, color: '#6b7280', fontSize: 14 }}>
            Profile image and logo shown to customers and admins
          </p>
          {mediaError && (
            <div className="alert alert-error" role="alert" style={{ marginBottom: 12 }}>
              {mediaError}
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 16,
            }}
          >
            <MediaSlot
              label="Profile Image"
              url={profile.profileImageUrl}
              fallbackInitial={(profile.ownerName || '?').charAt(0).toUpperCase()}
              circular
              saving={mediaSaving === 'profile'}
              inputRef={profileImageInputRef}
              onUpload={(f) => handleMediaUpload('profile', f)}
              onRemove={() => handleMediaRemove('profile')}
            />
            <MediaSlot
              label="Logo"
              url={profile.logoUrl}
              fallbackInitial={(profile.businessName || '?').charAt(0).toUpperCase()}
              saving={mediaSaving === 'logo'}
              inputRef={logoInputRef}
              onUpload={(f) => handleMediaUpload('logo', f)}
              onRemove={() => handleMediaRemove('logo')}
            />
          </div>
        </div>

        {/* Security */}
        <div className="card">
          <h2>Security</h2>
          <p style={{ marginTop: -6, marginBottom: 16, color: '#6b7280', fontSize: 14 }}>
            Change your account password
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={openPwModal}
          >
            Change Password
          </button>
        </div>

        {/* Commission + Contract (read-only) */}
        <div className="card">
          <h2>Commission &amp; Contract</h2>
          <div className="grid-2">
            <div className="field">
              <label>Online Fulfillment Rate</label>
              <div className="value">{formatRate(profile.onlineFulfillmentRate)}</div>
            </div>
            {/* Procurement fee rate is platform-internal — not shown to franchise */}
            <div className="field">
              <label>Contract Start Date</label>
              <div className="value">{formatDate(profile.contractStartDate)}</div>
            </div>
            <div className="field">
              <label>Contract End Date</label>
              <div className="value">{formatDate(profile.contractEndDate)}</div>
            </div>
            <div className="field">
              <label>Assigned Zone</label>
              <div className={`value${profile.assignedZone ? '' : ' muted'}`}>
                {profile.assignedZone || 'Not assigned'}
              </div>
            </div>
            <div className="field">
              <label>Verification Status</label>
              <div className="value">{profile.verificationStatus}</div>
            </div>
          </div>
        </div>

        {isEditing && (
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCancel}
              disabled={isSaving || profile?.logisticsLocked || profile?.profileLocked}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSaving || profile?.logisticsLocked || profile?.profileLocked}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </form>

      {pwModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17, 24, 39, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 50,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !pwSaving) setPwModalOpen(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 24,
              width: '100%',
              maxWidth: 420,
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Change Password</h2>
            <p style={{ marginTop: 4, marginBottom: 16, color: '#6b7280', fontSize: 13 }}>
              Enter your current password and choose a new one.
            </p>
            {pwError && (
              <div className="alert alert-error" style={{ marginBottom: 12 }}>{pwError}</div>
            )}
            {pwSuccess && (
              <div className="alert alert-success" style={{ marginBottom: 12 }}>{pwSuccess}</div>
            )}
            <form onSubmit={submitPasswordChange}>
              <div className="field" style={{ marginBottom: 12 }}>
                <label htmlFor="pwCurrent">Current password</label>
                <input
                  id="pwCurrent"
                  type="password"
                  value={pwCurrent}
                  onChange={(e) => setPwCurrent(e.target.value)}
                  disabled={pwSaving}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <label htmlFor="pwNew">New password</label>
                <input
                  id="pwNew"
                  type="password"
                  value={pwNew}
                  onChange={(e) => setPwNew(e.target.value)}
                  disabled={pwSaving}
                  autoComplete="new-password"
                  required
                />
                <small style={{ color: '#6b7280', fontSize: 12 }}>
                  Minimum 8 characters, with at least one letter and one number.
                </small>
              </div>
              <div className="field" style={{ marginBottom: 16 }}>
                <label htmlFor="pwConfirm">Confirm new password</label>
                <input
                  id="pwConfirm"
                  type="password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  disabled={pwSaving}
                  autoComplete="new-password"
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPwModalOpen(false)}
                  disabled={pwSaving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={pwSaving}>
                  {pwSaving ? 'Saving…' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MediaSlot({
  label,
  url,
  fallbackInitial,
  circular,
  saving,
  inputRef,
  onUpload,
  onRemove,
}: {
  label: string;
  url: string | null;
  fallbackInitial: string;
  circular?: boolean;
  saving: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        padding: 14,
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        background: '#f9fafb',
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: circular ? '50%' : 10,
          background: url ? `#fff url(${url}) center/cover` : '#e0e7ff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
          fontWeight: 700,
          color: '#4338ca',
          flexShrink: 0,
          border: '1px solid #e5e7eb',
          overflow: 'hidden',
        }}
      >
        {!url && fallbackInitial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 6 }}>
          {label}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: 13 }}
            onClick={() => inputRef.current?.click()}
            disabled={saving}
          >
            {saving ? 'Uploading…' : url ? 'Replace' : 'Upload'}
          </button>
          {url && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: 13, color: '#dc2626' }}
              onClick={onRemove}
              disabled={saving}
            >
              Remove
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
