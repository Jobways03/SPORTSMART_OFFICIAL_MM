'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import {
  addressesService,
  CustomerAddress,
  AddressPayload,
} from '@/services/addresses.service';
import { useModal, usePincodeLookup } from '@sportsmart/ui';
import { ApiError } from '@/lib/api-client';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  validateText,
  validateIndianMobile,
  validatePincode,
} from '@/lib/validators';

interface FormState {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  locality: string;
  city: string;
  state: string;
  // Phase 34 — selected from the india_states dropdown. Always kept
  // in sync with `state` (the human-readable name) so the existing
  // display paths keep working.
  stateCode: string;
  postalCode: string;
  isDefault: boolean;
}

const EMPTY_FORM: FormState = {
  fullName: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  locality: '',
  city: '',
  state: '',
  stateCode: '',
  postalCode: '',
  isDefault: false,
};

const normalizePhone = (phone: string): string => {
  const trimmed = phone.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
};

const ICONS = {
  plus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  mapPin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  homeEmpty: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V9.5z" />
    </svg>
  ),
};

export default function AddressesPage() {
  const { notify, confirmDialog } = useModal();
  const router = useRouter();
  const authStatus = useAuthGuard();
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Phase 4 / H46 — per-submission idempotency key. Generated when
  // the form opens; reused across retry attempts of the same
  // submission. A new key only on the next "Add" / "Edit" click.
  const [submitKey, setSubmitKey] = useState<string | null>(null);
  // Shared pincode → district/state/post-office lookup — the SAME hook the
  // checkout address form uses. Drives the auto-fill (city + state) + the
  // locality dropdown + the green confirmation line.
  const {
    loading: pincodeLoading,
    error: pincodeError,
    result: pincodeData,
    autoFilled: pincodeAutoFilled,
    lookup: runPincodeLookup,
    reset: resetPincodeLookup,
    setAutoFilled: setPincodeAutoFilled,
  } = usePincodeLookup();

  // Run the lookup and, on success, auto-fill city (district) + state.
  // stateCode is cleared so a pincode-changed state can't keep a stale code;
  // the backend re-resolves stateCode from the state name (same as checkout).
  const lookupPincode = async (raw: string) => {
    const data = await runPincodeLookup(raw);
    if (data) {
      setForm((prev) => ({
        ...prev,
        city: data.district,
        state: data.state,
        stateCode: '',
      }));
    }
  };

  const fetchAddresses = () => {
    setLoading(true);
    addressesService
      .list()
      .then((res) => {
        if (res.data) setAddresses(res.data);
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (authStatus !== 'authed') return;
    fetchAddresses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // Phase 4 / H46 — mint a fresh idempotency key for each modal
  // opening. Retries of the same submission reuse it; the next
  // "Add" / "Edit" click gets a new one.
  const mintSubmitKey = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `address-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const openCreateModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    resetPincodeLookup();
    setSubmitKey(mintSubmitKey());
    setModalOpen(true);
  };

  const openEditModal = (addr: CustomerAddress) => {
    setEditingId(addr.id);
    setForm({
      fullName: addr.fullName || '',
      phone: addr.phone || '',
      addressLine1: addr.addressLine1 || '',
      addressLine2: addr.addressLine2 || '',
      locality: addr.locality || '',
      city: addr.city || '',
      state: addr.state || '',
      stateCode: addr.stateCode || '',
      postalCode: addr.postalCode || '',
      isDefault: !!addr.isDefault,
    });
    setFormError(null);
    // Don't auto-run the lookup on edit — show the saved city/state/locality
    // as editable. A fresh pincode change re-activates the auto-fill+dropdown.
    resetPincodeLookup();
    setSubmitKey(mintSubmitKey());
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    resetPincodeLookup();
  };

  const validateForm = (): string | null => {
    const fullNameError = validateText(form.fullName, { label: 'Full name', max: 100 });
    if (fullNameError) return fullNameError;

    if (!form.phone.trim()) return 'Phone is required.';
    const phoneDigits = form.phone.replace(/\D/g, '');
    const localDigits = phoneDigits.startsWith('91') && phoneDigits.length === 12
      ? phoneDigits.slice(2)
      : phoneDigits;
    const phoneError = validateIndianMobile(localDigits);
    if (phoneError) return phoneError;

    const line1Error = validateText(form.addressLine1, { label: 'Address line 1', max: 200 });
    if (line1Error) return line1Error;
    const line2Error = validateText(form.addressLine2, {
      label: 'Address line 2',
      max: 200,
      required: false,
    });
    if (line2Error) return line2Error;
    const localityError = validateText(form.locality, {
      label: 'Locality',
      max: 100,
      required: false,
    });
    if (localityError) return localityError;
    const cityError = validateText(form.city, { label: 'City', max: 100 });
    if (cityError) return cityError;
    const stateError = validateText(form.state, { label: 'State', max: 100 });
    if (stateError) return stateError;

    const pincodeError = validatePincode(form.postalCode);
    if (pincodeError) return pincodeError;

    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    const payload: AddressPayload = {
      fullName: form.fullName.trim(),
      phone: normalizePhone(form.phone),
      addressLine1: form.addressLine1.trim(),
      addressLine2: form.addressLine2.trim() || undefined,
      locality: form.locality.trim() || undefined,
      city: form.city.trim(),
      state: form.state.trim(),
      // Phase 34 — only send stateCode when the dropdown was used.
      // Empty string → omit, lets the backend re-resolve from the
      // state name as a fallback.
      stateCode: form.stateCode ? form.stateCode : undefined,
      postalCode: form.postalCode.trim(),
      isDefault: form.isDefault,
    };

    setSaving(true);
    try {
      // Phase 4 / H46 — pass the submission-scoped idempotency key
      // so a retry of the same submit (double-click / network blip)
      // returns the cached response instead of writing a duplicate.
      if (editingId) {
        await addressesService.update(
          editingId,
          payload,
          submitKey ?? undefined,
        );
      } else {
        await addressesService.create(payload, submitKey ?? undefined);
      }
      fetchAddresses();
      setModalOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      resetPincodeLookup();
    } catch (err) {
      const msg = err instanceof ApiError ? err.body.message : 'Failed to save address.';
      setFormError(msg || 'Failed to save address.');
      void notify(msg || 'Failed to save address.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (addr: CustomerAddress) => {
    const confirmed = typeof window !== 'undefined'
      ? await confirmDialog(`Delete address for ${addr.fullName}? This cannot be undone.`)
      : false;
    if (!confirmed) return;
    try {
      await addressesService.remove(addr.id);
      fetchAddresses();
    } catch (err) {
      const msg = err instanceof ApiError ? err.body.message : 'Failed to delete address.';
      void notify(msg || 'Failed to delete address.');
    }
  };

  const handleSetDefault = async (addr: CustomerAddress) => {
    try {
      await addressesService.setDefault(addr.id);
      fetchAddresses();
    } catch (err) {
      const msg = err instanceof ApiError ? err.body.message : 'Failed to set default.';
      void notify(msg || 'Failed to set default.');
    }
  };

  if (loading) {
    return (
      <StorefrontShell>
        <div className="products-loading">
          <div className="loading-spinner"></div>
          <span>Loading addresses...</span>
        </div>
      </StorefrontShell>
    );
  }

  return (
    <StorefrontShell>
      <div className="account-page">
        <div className="account-breadcrumb">
          <Link href="/account">My Account</Link>
          <span>&rsaquo;</span>
          <span>Addresses</span>
        </div>

        <div className="addresses-header">
          <div className="addresses-header-text">
            <h1 className="account-page-title">My Addresses</h1>
            <p className="account-page-subtitle">
              Manage shipping addresses for faster checkout
            </p>
          </div>
          <button className="profile-btn-primary addresses-add-btn" onClick={openCreateModal}>
            <span className="addresses-add-icon">{ICONS.plus}</span>
            Add new address
          </button>
        </div>

        {addresses.length === 0 ? (
          <div className="addresses-empty">
            <div className="addresses-empty-icon">{ICONS.homeEmpty}</div>
            <h3>No addresses saved</h3>
            <p>Add your first shipping address to speed up checkout.</p>
            <button className="profile-btn-primary" onClick={openCreateModal}>
              <span className="addresses-add-icon">{ICONS.plus}</span>
              Add address
            </button>
          </div>
        ) : (
          <div className="addresses-grid">
            {addresses.map((addr) => (
              <div
                key={addr.id}
                className={`address-card${addr.isDefault ? ' is-default' : ''}`}
              >
                <div className="address-card-header">
                  <div className="address-card-name">{addr.fullName}</div>
                  {addr.isDefault && (
                    <span className="address-card-default-badge">Default</span>
                  )}
                </div>

                <div className="address-card-info">
                  <div className="address-card-row">
                    <span className="address-card-row-icon">{ICONS.phone}</span>
                    <span>{addr.phone}</span>
                  </div>
                  <div className="address-card-row">
                    <span className="address-card-row-icon">{ICONS.mapPin}</span>
                    <div className="address-card-text">
                      <div>{addr.addressLine1}</div>
                      {addr.addressLine2 && <div>{addr.addressLine2}</div>}
                      {addr.locality && <div>{addr.locality}</div>}
                      <div>
                        {addr.city}, {addr.state} {addr.postalCode}
                      </div>
                      <div className="address-card-country">{addr.country || 'India'}</div>
                    </div>
                  </div>
                </div>

                <div className="address-card-actions">
                  <button
                    className="address-action"
                    onClick={() => openEditModal(addr)}
                  >
                    <span className="address-action-icon">{ICONS.edit}</span>
                    Edit
                  </button>
                  {!addr.isDefault && (
                    <button
                      className="address-action"
                      onClick={() => handleSetDefault(addr)}
                    >
                      <span className="address-action-icon">{ICONS.star}</span>
                      Set as default
                    </button>
                  )}
                  <button
                    className="address-action address-action-danger"
                    onClick={() => handleDelete(addr)}
                  >
                    <span className="address-action-icon">{ICONS.trash}</span>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="address-modal-overlay" onClick={closeModal}>
          <div className="address-modal" onClick={(e) => e.stopPropagation()}>
            <div className="address-modal-header">
              <div>
                <h2 className="address-modal-title">
                  {editingId ? 'Edit address' : 'Add new address'}
                </h2>
                <p className="address-modal-subtitle">
                  {editingId
                    ? 'Update your shipping details below.'
                    : 'We use this address for shipping and order updates.'}
                </p>
              </div>
              <button
                type="button"
                className="address-modal-close"
                onClick={closeModal}
                aria-label="Close"
              >
                {ICONS.close}
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="address-modal-section-label">Contact</div>
              <div className="profile-form-grid">
                <div className="profile-field">
                  <label htmlFor="fullName">Full Name</label>
                  <input
                    id="fullName"
                    type="text"
                    className="profile-input"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    required
                  />
                </div>
                <div className="profile-field">
                  <label htmlFor="phone">Phone</label>
                  <input
                    id="phone"
                    type="tel"
                    className="profile-input"
                    placeholder="9876543210"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    required
                  />
                  <div className="profile-field-helper">10-digit Indian mobile number.</div>
                </div>
              </div>

              <div className="address-modal-section-label">Address</div>
              <div className="profile-form-grid">
                <div className="profile-field profile-field-full">
                  <label htmlFor="addressLine1">Address Line 1</label>
                  <input
                    id="addressLine1"
                    type="text"
                    className="profile-input"
                    placeholder="House / flat number, building, street"
                    value={form.addressLine1}
                    onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
                    required
                  />
                </div>
                <div className="profile-field profile-field-full">
                  <label htmlFor="addressLine2">
                    Address Line 2 <span className="profile-field-optional">(optional)</span>
                  </label>
                  <input
                    id="addressLine2"
                    type="text"
                    className="profile-input"
                    placeholder="Landmark, area"
                    value={form.addressLine2}
                    onChange={(e) => setForm({ ...form, addressLine2: e.target.value })}
                  />
                </div>

                {/* Pincode first — typing 6 digits auto-fills City + State and
                    populates the Locality dropdown (same flow as checkout). */}
                <div className="profile-field profile-field-full">
                  <label htmlFor="postalCode">Postal Code</label>
                  <input
                    id="postalCode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="profile-input tabular"
                    placeholder="6-digit PIN"
                    value={form.postalCode}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setForm({ ...form, postalCode: val });
                      lookupPincode(val);
                    }}
                    required
                  />
                  {pincodeLoading ? (
                    <div className="profile-field-helper">Looking up pincode…</div>
                  ) : pincodeError ? (
                    <div className="profile-field-helper" style={{ color: '#B91C1C' }}>
                      {pincodeError}
                    </div>
                  ) : pincodeData ? (
                    <div
                      className="profile-field-helper"
                      style={{ color: '#15803D', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      {ICONS.check}
                      {pincodeData.district}, {pincodeData.state}
                    </div>
                  ) : form.postalCode.length < 6 ? (
                    <div className="profile-field-helper">
                      Enter your 6-digit PIN to auto-fill city &amp; state.
                    </div>
                  ) : null}
                </div>

                <div className="profile-field">
                  <label htmlFor="city">City / District</label>
                  <input
                    id="city"
                    type="text"
                    className="profile-input"
                    value={form.city}
                    readOnly={pincodeAutoFilled}
                    style={pincodeAutoFilled ? { background: '#F3F4F6' } : undefined}
                    onChange={(e) => {
                      setForm({ ...form, city: e.target.value });
                      if (pincodeAutoFilled) setPincodeAutoFilled(false);
                    }}
                    required
                  />
                </div>
                <div className="profile-field">
                  <label htmlFor="state">State</label>
                  <input
                    id="state"
                    type="text"
                    className="profile-input"
                    placeholder="State"
                    value={form.state}
                    readOnly={pincodeAutoFilled}
                    style={pincodeAutoFilled ? { background: '#F3F4F6' } : undefined}
                    onChange={(e) => {
                      setForm({ ...form, state: e.target.value, stateCode: '' });
                      if (pincodeAutoFilled) setPincodeAutoFilled(false);
                    }}
                    required
                  />
                </div>

                <div className="profile-field profile-field-full">
                  <label htmlFor="locality">
                    Locality <span className="profile-field-optional">(optional)</span>
                  </label>
                  {pincodeData && pincodeData.places && pincodeData.places.length > 0 ? (
                    <select
                      id="locality"
                      className="profile-input"
                      value={form.locality}
                      onChange={(e) => setForm({ ...form, locality: e.target.value })}
                    >
                      <option value="">Select your locality</option>
                      {form.locality &&
                        !pincodeData.places.some((p) => p.name === form.locality) && (
                          <option value={form.locality}>{form.locality}</option>
                        )}
                      {pincodeData.places.map((p, idx) => (
                        <option key={idx} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="locality"
                      type="text"
                      className="profile-input"
                      placeholder="Area / neighbourhood"
                      value={form.locality}
                      onChange={(e) => setForm({ ...form, locality: e.target.value })}
                    />
                  )}
                </div>
              </div>

              <label className="address-default-toggle">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                />
                <span className="address-default-toggle-text">
                  <span className="address-default-toggle-title">Set as default address</span>
                  <span className="address-default-toggle-desc">
                    Use this address by default at checkout.
                  </span>
                </span>
              </label>

              {formError && (
                <div className="profile-alert profile-alert-error">
                  <span className="profile-alert-icon">{ICONS.alert}</span>
                  {formError}
                </div>
              )}

              <div className="address-modal-actions">
                <button
                  type="button"
                  className="profile-btn-secondary"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="profile-btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : editingId ? 'Update address' : 'Save address'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </StorefrontShell>
  );
}
