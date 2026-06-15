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
import { validatePassword, validateOwnerName } from '@/lib/validators';

type PincodeData = {
  district: string;
  state: string;
  places: { name: string; type: string; delivery: string }[];
};

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
  };
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
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Store-address pincode auto-fill is handled by the shared <PincodeFields>.

  // Warehouse pincode lookup — shows confirmation hint only (no separate city/state field)
  const [warehousePincodeData, setWarehousePincodeData] = useState<PincodeData | null>(null);
  const [warehousePincodeLoading, setWarehousePincodeLoading] = useState(false);
  const [warehousePincodeError, setWarehousePincodeError] = useState('');

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

  // lookupPincode removed — the store address now uses the shared <PincodeFields>.

  async function lookupWarehousePincode(pincode: string) {
    if (pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
      setWarehousePincodeData(null);
      setWarehousePincodeError('');
      return;
    }

    setWarehousePincodeLoading(true);
    setWarehousePincodeError('');
    try {
      const data = await apiClient<any>(`/pincodes/${pincode}`);

      if (data.success && data.data) {
        setWarehousePincodeData(data.data);
      } else {
        setWarehousePincodeError('Invalid pincode');
        setWarehousePincodeData(null);
      }
    } catch {
      setWarehousePincodeError('Failed to lookup pincode');
      setWarehousePincodeData(null);
    } finally {
      setWarehousePincodeLoading(false);
    }
  }

  const loadProfile = async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await franchiseProfileService.getProfile();
      if (res.data) {
        setProfile(res.data);
        setForm(profileToForm(res.data));
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.body.message || 'Failed to load profile');
      } else {
        setError('Failed to load profile');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

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
    // Name: letters + spaces + basic punctuation, no digits.
    name: (v: string) => v.replace(/[0-9]/g, '').slice(0, 80),
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
        // Business names commonly include digits (e.g. "3M", "7-Eleven", "Demo1"),
        // so we don't reject them here. Length cap is enforced by the input's
        // sanitize.name() in handleChange.
        return '';
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
    else if (field === 'ownerName' || field === 'businessName')
      next = sanitize.name(value);

    setForm((prev) => ({ ...prev, [field]: next }));
    setFieldErrors((prev) => ({ ...prev, [field]: validateField(field, next) }));
  };

  const handleEdit = () => {
    setError('');
    setSuccessMessage('');
    setIsEditing(true);
    // Re-run lookup for existing pincodes so user sees the auto-fill hint
    if (form.warehousePincode) lookupWarehousePincode(form.warehousePincode);
  };

  const handleCancel = () => {
    if (profile) setForm(profileToForm(profile));
    setError('');
    setIsEditing(false);
    setWarehousePincodeData(null);
    setWarehousePincodeError('');
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
      };

      const res = await franchiseProfileService.updateProfile(payload);
      if (res.data) {
        setProfile(res.data);
        setForm(profileToForm(res.data));

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
              // Locked once registered with a logistics partner — the
              // franchise can't edit here; pop a modal pointing them to
              // support so the franchise admin makes the change.
              if (profile?.logisticsLocked) {
                const ok = await confirmDialog({
                  title: 'Profile locked',
                  message:
                    "This profile is registered with a logistics partner, so these details can't be edited here. Please ask your franchise admin to update them. Open a support request now?",
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
                  disabled={isSaving || profile?.logisticsLocked}
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
                  disabled={isSaving || profile?.logisticsLocked}
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
                disabled={isSaving || profile?.logisticsLocked}
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
              disabled={isSaving || profile?.logisticsLocked}
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
                    disabled={isSaving || profile?.logisticsLocked}
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
                    disabled={isSaving || profile?.logisticsLocked}
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

        {/* Bank Account */}
        <div className="card">
          <h2>Bank Account</h2>
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
              No bank account on file yet. Add your payout account during onboarding.
            </div>
          )}
        </div>

        {/* Warehouse */}
        <div className="card">
          <h2>Warehouse</h2>
          <div className="grid-2">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="warehouseAddress">Warehouse Address</label>
              {isEditing ? (
                <textarea
                  id="warehouseAddress"
                  value={form.warehouseAddress}
                  onChange={(e) => handleChange('warehouseAddress', e.target.value)}
                  disabled={isSaving || profile?.logisticsLocked}
                />
              ) : (
                <div className={`value${profile.warehouseAddress ? '' : ' muted'}`}>
                  {profile.warehouseAddress || 'Not set'}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="warehousePincode">Warehouse Pincode</label>
              {isEditing ? (
                <>
                  <input
                    id="warehousePincode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={form.warehousePincode}
                    onChange={(e) => {
                      handleChange('warehousePincode', e.target.value);
                      const sanitized = e.target.value.replace(/\D/g, '').slice(0, 6);
                      lookupWarehousePincode(sanitized);
                    }}
                    disabled={isSaving || profile?.logisticsLocked}
                    placeholder="6-digit pincode"
                    style={fieldErrors.warehousePincode ? { borderColor: '#dc2626' } : undefined}
                  />
                  {fieldErrors.warehousePincode && (
                    <small style={{ color: '#dc2626', display: 'block', marginTop: 4 }}>
                      {fieldErrors.warehousePincode}
                    </small>
                  )}
                  {warehousePincodeLoading && (
                    <small style={{ color: '#6b7280' }}>Looking up pincode…</small>
                  )}
                  {warehousePincodeError && !fieldErrors.warehousePincode && (
                    <small style={{ color: '#dc2626' }}>{warehousePincodeError}</small>
                  )}
                  {warehousePincodeData && !warehousePincodeError && !warehousePincodeLoading && (
                    <small style={{ color: '#16a34a' }}>
                      {warehousePincodeData.district}, {warehousePincodeData.state}
                    </small>
                  )}
                </>
              ) : (
                <div className={`value${profile.warehousePincode ? '' : ' muted'}`}>
                  {profile.warehousePincode || 'Not set'}
                </div>
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
              disabled={isSaving || profile?.logisticsLocked}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSaving || profile?.logisticsLocked}>
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
