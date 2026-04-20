'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import {
  franchiseProfileService,
  FranchiseProfile,
  UpdateFranchiseProfilePayload,
} from '@/services/profile.service';
import { ApiError } from '@/lib/api-client';

type PincodeData = {
  district: string;
  state: string;
  places: { name: string; type: string; delivery: string }[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const AUTO_FILLED_STYLE: React.CSSProperties = {
  background: '#f0fdf4',
  borderColor: '#86efac',
};

const LOCALITY_SELECT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '10px 40px 10px 14px',
  fontSize: 14,
  lineHeight: '20px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background:
    '#ffffff url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\' fill=\'none\'><path d=\'M1 1L6 6L11 1\' stroke=\'%236b7280\' stroke-width=\'1.8\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/></svg>") no-repeat right 14px center',
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  color: '#111827',
  cursor: 'pointer',
  outline: 'none',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease',
};

const LOCALITY_SELECT_STYLE_SELECTED: React.CSSProperties = {
  ...LOCALITY_SELECT_STYLE,
  background: LOCALITY_SELECT_STYLE.background?.toString().replace('#ffffff', '#f0fdf4'),
  borderColor: '#86efac',
  boxShadow: '0 0 0 1px #86efac',
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
  const [profile, setProfile] = useState<FranchiseProfile | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Pincode lookup state — store pincode drives city/state
  const [pincodeData, setPincodeData] = useState<PincodeData | null>(null);
  const [pincodeLoading, setPincodeLoading] = useState(false);
  const [pincodeError, setPincodeError] = useState('');
  const [pincodeAutoFilled, setPincodeAutoFilled] = useState(false);

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
    if (pwNew.length < 8) {
      setPwError('New password must be at least 8 characters');
      return;
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d)/.test(pwNew)) {
      setPwError('New password must contain at least one letter and one number');
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
      if (kind === 'profile') {
        await franchiseProfileService.uploadProfileImage(file);
      } else {
        await franchiseProfileService.uploadLogo(file);
      }
      await loadProfile();
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

  const handleMediaRemove = async (kind: 'profile' | 'logo') => {
    if (!confirm(`Remove your ${kind === 'profile' ? 'profile image' : 'logo'}?`)) return;
    setMediaError('');
    setMediaSaving(kind);
    try {
      if (kind === 'profile') {
        await franchiseProfileService.deleteProfileImage();
      } else {
        await franchiseProfileService.deleteLogo();
      }
      await loadProfile();
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

  async function lookupPincode(pincode: string) {
    if (pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
      setPincodeData(null);
      setPincodeError('');
      setPincodeAutoFilled(false);
      return;
    }

    setPincodeLoading(true);
    setPincodeError('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/pincodes/${pincode}`);
      const data = await res.json();

      if (data.success && data.data) {
        setPincodeData(data.data);
        setPincodeAutoFilled(true);
        setForm((prev) => ({
          ...prev,
          city: data.data.district,
          state: data.data.state,
        }));
      } else {
        setPincodeError('Invalid pincode');
        setPincodeData(null);
        setPincodeAutoFilled(false);
      }
    } catch {
      setPincodeError('Failed to lookup pincode');
      setPincodeData(null);
      setPincodeAutoFilled(false);
    } finally {
      setPincodeLoading(false);
    }
  }

  async function lookupWarehousePincode(pincode: string) {
    if (pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
      setWarehousePincodeData(null);
      setWarehousePincodeError('');
      return;
    }

    setWarehousePincodeLoading(true);
    setWarehousePincodeError('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/pincodes/${pincode}`);
      const data = await res.json();

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

  const handleChange = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEdit = () => {
    setError('');
    setSuccessMessage('');
    setIsEditing(true);
    // Re-run lookup for existing pincodes so user sees the auto-fill hint
    if (form.pincode) lookupPincode(form.pincode);
    if (form.warehousePincode) lookupWarehousePincode(form.warehousePincode);
  };

  const handleCancel = () => {
    if (profile) setForm(profileToForm(profile));
    setError('');
    setIsEditing(false);
    setPincodeData(null);
    setPincodeError('');
    setPincodeAutoFilled(false);
    setWarehousePincodeData(null);
    setWarehousePincodeError('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
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
          <button type="button" className="btn btn-primary" onClick={handleEdit}>
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
                  disabled={isSaving}
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
                  disabled={isSaving}
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
                disabled={isSaving}
                rows={3}
              />
            ) : (
              <div className={`value${profile.address ? '' : ' muted'}`}>
                {profile.address || 'Not set'}
              </div>
            )}
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="pincode">ZIP / PIN Code</label>
              {isEditing ? (
                <>
                  <input
                    id="pincode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={form.pincode}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                      handleChange('pincode', val);
                      lookupPincode(val);
                    }}
                    disabled={isSaving}
                    placeholder="ZIP / PIN code"
                  />
                  {pincodeLoading && (
                    <small style={{ color: '#6b7280', display: 'block', marginTop: 4 }}>
                      Looking up pincode…
                    </small>
                  )}
                  {pincodeError && (
                    <small style={{ color: '#dc2626', display: 'block', marginTop: 4 }}>
                      {pincodeError}
                    </small>
                  )}
                  {pincodeData && !pincodeError && !pincodeLoading && (
                    <small style={{ color: '#16a34a', display: 'block', marginTop: 4, fontWeight: 500 }}>
                      {pincodeData.district}, {pincodeData.state}
                    </small>
                  )}
                </>
              ) : (
                <div className={`value${profile.pincode ? '' : ' muted'}`}>
                  {profile.pincode || 'Not set'}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="country">Country</label>
              {isEditing ? (
                <input
                  id="country"
                  type="text"
                  value={form.country}
                  onChange={(e) => handleChange('country', e.target.value)}
                  disabled={isSaving}
                  placeholder="Country"
                />
              ) : (
                <div className={`value${profile.country ? '' : ' muted'}`}>
                  {profile.country || 'Not set'}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="city">City / District</label>
              {isEditing ? (
                <input
                  id="city"
                  type="text"
                  value={form.city}
                  onChange={(e) => {
                    handleChange('city', e.target.value);
                    if (pincodeAutoFilled) setPincodeAutoFilled(false);
                  }}
                  readOnly={pincodeAutoFilled}
                  style={pincodeAutoFilled ? AUTO_FILLED_STYLE : undefined}
                  disabled={isSaving}
                  placeholder="City"
                />
              ) : (
                <div className={`value${profile.city ? '' : ' muted'}`}>
                  {profile.city || 'Not set'}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="state">State</label>
              {isEditing ? (
                <input
                  id="state"
                  type="text"
                  value={form.state}
                  onChange={(e) => {
                    handleChange('state', e.target.value);
                    if (pincodeAutoFilled) setPincodeAutoFilled(false);
                  }}
                  readOnly={pincodeAutoFilled}
                  style={pincodeAutoFilled ? AUTO_FILLED_STYLE : undefined}
                  disabled={isSaving}
                  placeholder="State"
                />
              ) : (
                <div className={`value${profile.state ? '' : ' muted'}`}>
                  {profile.state || 'Not set'}
                </div>
              )}
            </div>
          </div>

          {isEditing && pincodeData && pincodeData.places && pincodeData.places.length > 0 && (
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="locality">Locality</label>
              <select
                id="locality"
                value={form.locality}
                onChange={(e) => handleChange('locality', e.target.value)}
                disabled={isSaving}
                style={form.locality ? LOCALITY_SELECT_STYLE_SELECTED : LOCALITY_SELECT_STYLE}
              >
                <option value="">Select your locality</option>
                {pincodeData.places.map((place, idx) => (
                  <option key={idx} value={place.name}>
                    {place.name}
                  </option>
                ))}
              </select>
              <small style={{ color: '#6b7280', display: 'block', marginTop: 6, fontSize: 12 }}>
                {pincodeData.places.length} localit{pincodeData.places.length === 1 ? 'y' : 'ies'} found for this pincode
              </small>
            </div>
          )}

          {!isEditing && profile.locality && (
            <div className="field" style={{ marginTop: 16 }}>
              <label>Locality</label>
              <div className="value">{profile.locality}</div>
            </div>
          )}
        </div>

        {/* Tax Info */}
        <div className="card">
          <h2>Tax Information</h2>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="gstNumber">GST Number</label>
              {isEditing ? (
                <input
                  id="gstNumber"
                  type="text"
                  value={form.gstNumber}
                  onChange={(e) => handleChange('gstNumber', e.target.value)}
                  disabled={isSaving}
                />
              ) : (
                <div className={`value${profile.gstNumber ? '' : ' muted'}`}>
                  {profile.gstNumber || 'Not set'}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="panNumber">PAN Number</label>
              {isEditing ? (
                <input
                  id="panNumber"
                  type="text"
                  value={form.panNumber}
                  onChange={(e) => handleChange('panNumber', e.target.value)}
                  disabled={isSaving}
                />
              ) : (
                <div className={`value${profile.panNumber ? '' : ' muted'}`}>
                  {profile.panNumber || 'Not set'}
                </div>
              )}
            </div>
          </div>
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
                  disabled={isSaving}
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
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                      handleChange('warehousePincode', val);
                      lookupWarehousePincode(val);
                    }}
                    disabled={isSaving}
                    placeholder="6-digit pincode"
                  />
                  {warehousePincodeLoading && (
                    <small style={{ color: '#6b7280' }}>Looking up pincode…</small>
                  )}
                  {warehousePincodeError && (
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
              disabled={isSaving}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
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
