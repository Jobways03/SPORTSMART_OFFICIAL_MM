'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { useModal } from '@sportsmart/ui';
import { ApiError } from '@/lib/api-client';
import { useAuthGuard } from '@/lib/useAuthGuard';
import {
  customerTaxProfileService,
  CustomerTaxProfile,
  CreateTaxProfilePayload,
} from '@/services/customer-tax-profile.service';

// Phase 200 (audit #4/#8) — the backend now returns legalNameMismatch +
// portalStatus on each profile (read-only verification signals). The shared
// service type predates these fields, so widen it locally for the UI warnings.
type TaxProfileWithVerification = CustomerTaxProfile & {
  legalNameMismatch?: boolean;
  portalStatus?: string | null;
};
import {
  IndiaStateRef,
  taxReferenceService,
} from '@/services/addresses.service';

interface FormState {
  gstin: string;
  legalName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  isDefault: boolean;
}

const EMPTY_FORM: FormState = {
  gstin: '',
  legalName: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  pincode: '',
  country: 'India',
  isDefault: false,
};

// Client-side format check before submitting — the backend re-validates and
// runs the full Mod-36 checksum. This guard avoids a round-trip for the obvious
// typo cases ("not 15 chars", "missing state-code prefix").
//
// Phase 200 (audit #18) — aligned to the SERVER regex (gstin-validator.ts):
// position 14 is [A-Z] (the entity is usually 'Z' but the CBIC spec allows any
// letter), position 13 is [1-9A-Z], position 15 is [0-9A-Z]. The old client
// regex hard-coded 'Z' at position 14 and would reject a few valid GSTINs the
// server accepts.
const GSTIN_LOOSE_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z][0-9A-Z]$/;

export default function TaxProfilesPage() {
  const { notify, confirmDialog } = useModal();
  const router = useRouter();
  const authStatus = useAuthGuard();

  const [profiles, setProfiles] = useState<TaxProfileWithVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [indiaStates, setIndiaStates] = useState<IndiaStateRef[]>([]);

  useEffect(() => {
    taxReferenceService
      .indiaStates()
      .then((res) => {
        if (res.data) setIndiaStates(res.data);
      })
      .catch(() => {
        // Non-fatal — falls back to free-text state input.
      });
  }, []);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchProfiles = () => {
    setLoading(true);
    customerTaxProfileService
      .list()
      .then((res) => {
        if (res.data) setProfiles(res.data);
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (authStatus !== 'authed') return;
    fetchProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  const openCreateModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (profile: CustomerTaxProfile) => {
    setEditingId(profile.id);
    setForm({
      gstin: profile.gstin,
      legalName: profile.legalName,
      line1: profile.billingAddress?.line1 ?? '',
      line2: profile.billingAddress?.line2 ?? '',
      city: profile.billingAddress?.city ?? '',
      state: profile.billingAddress?.state ?? '',
      pincode: profile.billingAddress?.pincode ?? '',
      country: profile.billingAddress?.country ?? 'India',
      isDefault: profile.isDefault,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setFormError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Create-only client-side guards. Edit doesn't touch GSTIN.
    if (!editingId) {
      const normalized = form.gstin.trim().toUpperCase();
      if (normalized.length !== 15 || !GSTIN_LOOSE_REGEX.test(normalized)) {
        setFormError(
          'GSTIN must be 15 characters in the standard format ' +
            '(e.g. 27AAACR4849R1ZL). The server runs a checksum on submit.',
        );
        return;
      }
    }

    setSaving(true);
    try {
      const billingAddress = {
        line1: form.line1.trim(),
        line2: form.line2.trim() || undefined,
        city: form.city.trim(),
        state: form.state.trim(),
        pincode: form.pincode.trim(),
        country: form.country.trim() || 'India',
      };

      if (editingId) {
        await customerTaxProfileService.update(editingId, {
          legalName: form.legalName.trim(),
          billingAddress,
          // Only flip when the user explicitly checked it; the
          // backend rejects clearing a default this way (must
          // set a different profile as default instead).
          isDefault: form.isDefault === true ? true : undefined,
        });
        void notify({ kind: 'success', message: 'Tax profile updated' });
      } else {
        const payload: CreateTaxProfilePayload = {
          gstin: form.gstin.trim().toUpperCase(),
          legalName: form.legalName.trim(),
          billingAddress,
          isDefault: form.isDefault,
        };
        await customerTaxProfileService.create(payload);
        void notify({ kind: 'success', message: 'Tax profile added' });
      }
      setModalOpen(false);
      setEditingId(null);
      fetchProfiles();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message || 'Failed to save tax profile.');
      } else {
        setFormError('An unexpected error occurred.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (profile: CustomerTaxProfile) => {
    try {
      await customerTaxProfileService.setDefault(profile.id);
      void notify({
        kind: 'success',
        message: `${profile.legalName} is now your default`,
      });
      fetchProfiles();
    } catch (err) {
      void notify(
        err instanceof ApiError
          ? err.message || 'Failed to set default'
          : 'Failed to set default',
      );
    }
  };

  const handleDelete = async (profile: CustomerTaxProfile) => {
    const ok = await confirmDialog({
      title: 'Delete this tax profile?',
      message: `Future invoices will no longer use GSTIN ${profile.gstin} (${profile.legalName}). This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      await customerTaxProfileService.delete(profile.id);
      void notify({ kind: 'success', message: 'Tax profile deleted' });
      fetchProfiles();
    } catch (err) {
      void notify(
        err instanceof ApiError
          ? err.message || 'Failed to delete profile'
          : 'Failed to delete profile',
      );
    }
  };

  if (authStatus === 'checking' || loading) {
    return (
      <StorefrontShell>
        <div className="account-page">
          <div className="orders-loading">Loading your tax profiles…</div>
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
          <span>Tax Profiles (GSTIN)</span>
        </div>

        <div className="addresses-header">
          <h1 className="orders-page-title">Tax Profiles</h1>
          <button className="profile-save-btn" onClick={openCreateModal}>
            + Add GSTIN
          </button>
        </div>

        <p
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          Add a GSTIN to receive B2B tax invoices in the name of your
          registered business. The default profile applies to all future
          orders. Personal customers don&apos;t need a profile &mdash; orders
          without one receive a standard B2C tax invoice.
        </p>

        {profiles.length === 0 ? (
          <div className="orders-empty">
            <span className="orders-empty-icon">&#128196;</span>
            <h3>No tax profiles yet</h3>
            <p>Add your GSTIN to receive B2B invoices for business purchases.</p>
            <button className="orders-empty-btn" onClick={openCreateModal}>
              Add GSTIN
            </button>
          </div>
        ) : (
          <div className="orders-list">
            {profiles.map((profile) => (
              <div key={profile.id} className="address-card">
                <div className="orders-card-header">
                  <div className="orders-card-header-left">
                    <span className="orders-card-number">{profile.legalName}</span>
                    {profile.isDefault && (
                      <span className="address-card-default-badge">Default</span>
                    )}
                    {profile.isVerified && !profile.legalNameMismatch && (
                      <span
                        className="address-card-default-badge"
                        style={{
                          background: '#dcfce7',
                          color: '#166534',
                        }}
                      >
                        Verified
                      </span>
                    )}
                    {/* Phase 200 (audit #4) — portal name differs from saved name. */}
                    {profile.legalNameMismatch && (
                      <span
                        className="address-card-default-badge"
                        style={{ background: '#fef3c7', color: '#92400e' }}
                        title="The legal name you saved differs from the GST portal. Edit it to match, or your B2B invoice may be rejected."
                      >
                        Name mismatch
                      </span>
                    )}
                    {/* Phase 200 (audit #8) — GSTIN not ACTIVE on the portal. */}
                    {profile.portalStatus &&
                      profile.portalStatus !== 'ACTIVE' &&
                      profile.portalStatus !== 'UNKNOWN' && (
                        <span
                          className="address-card-default-badge"
                          style={{ background: '#fee2e2', color: '#991b1b' }}
                          title={`This GSTIN is ${profile.portalStatus.toLowerCase()} on the GST portal and cannot back a B2B invoice.`}
                        >
                          {profile.portalStatus === 'CANCELLED'
                            ? 'GSTIN cancelled'
                            : profile.portalStatus === 'SUSPENDED'
                              ? 'GSTIN suspended'
                              : 'GSTIN inactive'}
                        </span>
                      )}
                  </div>
                  <span
                    className="orders-card-date"
                    style={{ fontFamily: 'var(--font-mono, monospace)' }}
                  >
                    {profile.gstin}
                  </span>
                </div>

                <div className="address-card-body">
                  <div>{profile.billingAddress?.line1}</div>
                  {profile.billingAddress?.line2 && (
                    <div>{profile.billingAddress.line2}</div>
                  )}
                  <div>
                    {profile.billingAddress?.city}, {profile.billingAddress?.state}{' '}
                    {profile.billingAddress?.pincode}
                  </div>
                  <div>{profile.billingAddress?.country || 'India'}</div>
                </div>

                <div className="address-card-actions">
                  <button
                    className="address-card-action-btn"
                    onClick={() => openEditModal(profile)}
                  >
                    Edit
                  </button>
                  {!profile.isDefault && (
                    <button
                      className="address-card-action-btn"
                      onClick={() => handleSetDefault(profile)}
                    >
                      Set as Default
                    </button>
                  )}
                  <button
                    className="address-card-action-btn address-card-action-btn-danger"
                    onClick={() => handleDelete(profile)}
                  >
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
            <h2 className="address-modal-title">
              {editingId ? 'Edit Tax Profile' : 'Add Tax Profile'}
            </h2>
            <form onSubmit={handleSubmit}>
              <div className="profile-form-grid">
                <div className="profile-field profile-field-full">
                  <label htmlFor="gstin">
                    GSTIN <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    id="gstin"
                    type="text"
                    className="profile-input"
                    value={form.gstin}
                    onChange={(e) =>
                      setForm({ ...form, gstin: e.target.value.toUpperCase() })
                    }
                    placeholder="27AAACR4849R1ZL"
                    maxLength={15}
                    style={{ fontFamily: 'var(--font-mono, monospace)' }}
                    disabled={!!editingId}
                    required
                  />
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    {editingId
                      ? 'GSTIN is fixed once saved. Delete and re-add to switch.'
                      : '15 characters. The state code (first 2 digits) is auto-detected.'}
                  </span>
                </div>

                <div className="profile-field profile-field-full">
                  <label htmlFor="legalName">
                    Legal Business Name <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    id="legalName"
                    type="text"
                    className="profile-input"
                    value={form.legalName}
                    onChange={(e) =>
                      setForm({ ...form, legalName: e.target.value })
                    }
                    placeholder="As registered on your GSTIN"
                    maxLength={200}
                    required
                  />
                </div>

                <div className="profile-field profile-field-full">
                  <label htmlFor="line1">
                    Address Line 1 <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    id="line1"
                    type="text"
                    className="profile-input"
                    value={form.line1}
                    onChange={(e) => setForm({ ...form, line1: e.target.value })}
                    required
                  />
                </div>

                <div className="profile-field profile-field-full">
                  <label htmlFor="line2">Address Line 2</label>
                  <input
                    id="line2"
                    type="text"
                    className="profile-input"
                    value={form.line2}
                    onChange={(e) => setForm({ ...form, line2: e.target.value })}
                  />
                </div>

                <div className="profile-field">
                  <label htmlFor="city">
                    City <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    id="city"
                    type="text"
                    className="profile-input"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    required
                  />
                </div>

                <div className="profile-field">
                  <label htmlFor="state">
                    State <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  {indiaStates.length > 0 ? (
                    <select
                      id="state"
                      className="profile-input"
                      value={form.state}
                      onChange={(e) => setForm({ ...form, state: e.target.value })}
                      required
                    >
                      <option value="">Select state…</option>
                      {indiaStates.map((s) => (
                        <option key={s.code} value={s.name}>
                          {s.name} {s.isUnionTerritory ? '(UT)' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="state"
                      type="text"
                      className="profile-input"
                      value={form.state}
                      onChange={(e) => setForm({ ...form, state: e.target.value })}
                      required
                    />
                  )}
                </div>

                <div className="profile-field">
                  <label htmlFor="pincode">
                    PIN Code <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    id="pincode"
                    type="text"
                    className="profile-input"
                    value={form.pincode}
                    onChange={(e) =>
                      setForm({ ...form, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })
                    }
                    pattern="\d{6}"
                    inputMode="numeric"
                    maxLength={6}
                    required
                  />
                </div>

                <div className="profile-field">
                  <label htmlFor="country">Country</label>
                  <input
                    id="country"
                    type="text"
                    className="profile-input"
                    value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                  />
                </div>

                <div className="profile-field profile-field-full">
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontWeight: 400,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.isDefault}
                      onChange={(e) =>
                        setForm({ ...form, isDefault: e.target.checked })
                      }
                    />
                    Use this profile by default for future tax invoices
                  </label>
                </div>
              </div>

              {formError && (
                <div
                  style={{
                    color: '#b91c1c',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: 6,
                    padding: '8px 12px',
                    marginTop: 12,
                    fontSize: 13,
                  }}
                >
                  {formError}
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 8,
                  marginTop: 16,
                }}
              >
                <button
                  type="button"
                  className="address-card-action-btn"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="profile-save-btn"
                  disabled={saving}
                >
                  {saving
                    ? 'Saving…'
                    : editingId
                      ? 'Save Changes'
                      : 'Add GSTIN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </StorefrontShell>
  );
}
