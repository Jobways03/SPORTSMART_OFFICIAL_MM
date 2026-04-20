'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import {
  addressesService,
  CustomerAddress,
  AddressPayload,
} from '@/services/addresses.service';
import { ApiError } from '@/lib/api-client';

interface FormState {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  locality: string;
  city: string;
  state: string;
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

export default function AddressesPage() {
  const router = useRouter();
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    try {
      if (!sessionStorage.getItem('accessToken')) {
        router.push('/login');
        return;
      }
    } catch {
      router.push('/login');
      return;
    }
    fetchAddresses();
  }, [router]);

  const openCreateModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
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
      postalCode: addr.postalCode || '',
      isDefault: !!addr.isDefault,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const validateForm = (): string | null => {
    if (!form.fullName.trim()) return 'Full name is required.';
    if (!form.phone.trim()) return 'Phone is required.';

    const phoneDigits = form.phone.replace(/\D/g, '');
    // Accept 10 digits (Indian), or 12 digits starting with 91 (+91XXXXXXXXXX)
    const localDigits = phoneDigits.startsWith('91') && phoneDigits.length === 12
      ? phoneDigits.slice(2)
      : phoneDigits;
    if (localDigits.length !== 10) return 'Phone must be 10 digits.';

    if (!form.addressLine1.trim()) return 'Address line 1 is required.';
    if (!form.city.trim()) return 'City is required.';
    if (!form.state.trim()) return 'State is required.';

    if (!/^\d{6}$/.test(form.postalCode.trim())) return 'Postal code must be 6 digits.';

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
      postalCode: form.postalCode.trim(),
      isDefault: form.isDefault,
    };

    setSaving(true);
    try {
      if (editingId) {
        await addressesService.update(editingId, payload);
      } else {
        await addressesService.create(payload);
      }
      fetchAddresses();
      setModalOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      const msg = err instanceof ApiError ? err.body.message : 'Failed to save address.';
      setFormError(msg || 'Failed to save address.');
      alert(msg || 'Failed to save address.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (addr: CustomerAddress) => {
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`Delete address for ${addr.fullName}? This cannot be undone.`)
      : false;
    if (!confirmed) return;
    try {
      await addressesService.remove(addr.id);
      fetchAddresses();
    } catch (err) {
      const msg = err instanceof ApiError ? err.body.message : 'Failed to delete address.';
      alert(msg || 'Failed to delete address.');
    }
  };

  const handleSetDefault = async (addr: CustomerAddress) => {
    try {
      await addressesService.setDefault(addr.id);
      fetchAddresses();
    } catch (err) {
      const msg = err instanceof ApiError ? err.body.message : 'Failed to set default.';
      alert(msg || 'Failed to set default.');
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="products-loading">
          <div className="loading-spinner"></div>
          <span>Loading addresses...</span>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="account-page">
        <div className="account-breadcrumb">
          <Link href="/account">My Account</Link>
          <span>&rsaquo;</span>
          <span>Addresses</span>
        </div>

        <div className="addresses-header">
          <h1 className="orders-page-title">My Addresses</h1>
          <button className="profile-save-btn" onClick={openCreateModal}>
            + Add New Address
          </button>
        </div>

        {addresses.length === 0 ? (
          <div className="orders-empty">
            <span className="orders-empty-icon">&#127968;</span>
            <h3>No addresses saved</h3>
            <p>Add your first shipping address to speed up checkout.</p>
            <button className="orders-empty-btn" onClick={openCreateModal}>
              Add Address
            </button>
          </div>
        ) : (
          <div className="orders-list">
            {addresses.map((addr) => (
              <div key={addr.id} className="address-card">
                <div className="orders-card-header">
                  <div className="orders-card-header-left">
                    <span className="orders-card-number">{addr.fullName}</span>
                    {addr.isDefault && (
                      <span className="address-card-default-badge">Default</span>
                    )}
                  </div>
                  <span className="orders-card-date">{addr.phone}</span>
                </div>

                <div className="address-card-body">
                  <div>{addr.addressLine1}</div>
                  {addr.addressLine2 && <div>{addr.addressLine2}</div>}
                  {addr.locality && <div>{addr.locality}</div>}
                  <div>
                    {addr.city}, {addr.state} {addr.postalCode}
                  </div>
                  <div>{addr.country || 'India'}</div>
                </div>

                <div className="address-card-actions">
                  <button
                    className="address-card-action-btn"
                    onClick={() => openEditModal(addr)}
                  >
                    Edit
                  </button>
                  {!addr.isDefault && (
                    <button
                      className="address-card-action-btn"
                      onClick={() => handleSetDefault(addr)}
                    >
                      Set as Default
                    </button>
                  )}
                  <button
                    className="address-card-action-btn address-card-action-btn-danger"
                    onClick={() => handleDelete(addr)}
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
              {editingId ? 'Edit Address' : 'Add New Address'}
            </h2>
            <form onSubmit={handleSubmit}>
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
                  <label htmlFor="phone">Phone (10 digits)</label>
                  <input
                    id="phone"
                    type="tel"
                    className="profile-input"
                    placeholder="9876543210"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    required
                  />
                </div>
                <div className="profile-field profile-field-full">
                  <label htmlFor="addressLine1">Address Line 1</label>
                  <input
                    id="addressLine1"
                    type="text"
                    className="profile-input"
                    value={form.addressLine1}
                    onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
                    required
                  />
                </div>
                <div className="profile-field profile-field-full">
                  <label htmlFor="addressLine2">Address Line 2 (optional)</label>
                  <input
                    id="addressLine2"
                    type="text"
                    className="profile-input"
                    value={form.addressLine2}
                    onChange={(e) => setForm({ ...form, addressLine2: e.target.value })}
                  />
                </div>
                <div className="profile-field">
                  <label htmlFor="locality">Locality (optional)</label>
                  <input
                    id="locality"
                    type="text"
                    className="profile-input"
                    value={form.locality}
                    onChange={(e) => setForm({ ...form, locality: e.target.value })}
                  />
                </div>
                <div className="profile-field">
                  <label htmlFor="city">City</label>
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
                  <label htmlFor="state">State</label>
                  <input
                    id="state"
                    type="text"
                    className="profile-input"
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    required
                  />
                </div>
                <div className="profile-field">
                  <label htmlFor="postalCode">Postal Code (6 digits)</label>
                  <input
                    id="postalCode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="profile-input"
                    value={form.postalCode}
                    onChange={(e) =>
                      setForm({ ...form, postalCode: e.target.value.replace(/\D/g, '') })
                    }
                    required
                  />
                </div>
                <div className="profile-field profile-field-full">
                  <label className="profile-checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.isDefault}
                      onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                    />
                    <span>Set as default address</span>
                  </label>
                </div>
              </div>

              {formError && <div className="profile-error-msg">{formError}</div>}

              <div className="address-modal-actions">
                <button
                  type="button"
                  className="address-card-action-btn"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="profile-save-btn" disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update Address' : 'Save Address'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
