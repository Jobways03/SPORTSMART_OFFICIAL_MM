'use client';

import { useState, useEffect, useRef, useCallback, useMemo, FormEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { adminSellersService, SellerDetail, SellerListItem } from '@/services/admin-sellers.service';
import { apiClient, ApiError } from '@/lib/api-client';
import {
  validateProfileSellerName,
  validateProfileShopName,
  validateCountryCode,
  validateContactNumber,
  validatePhoneCrossField,
  validateStoreAddress,
  validateCity,
  validateState,
  validateCountry,
  validateZipCode,
  validateRichText,
  isEditorEmpty,
  getPlainTextLength,
} from '@/lib/profile-validators';
import StatusModal from '../components/status-modal';
import VerificationModal from '../components/verification-modal';
import SendMessageModal from '../components/send-message-modal';
import ChangePasswordModal from '../components/change-password-modal';
import DeleteSellerModal from '../components/delete-seller-modal';
import ImpersonateModal from '../components/impersonate-modal';
import './profile.css';
import '../sellers.css';

const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });
import 'react-quill-new/dist/quill.snow.css';

const COUNTRY_CODES = [
  '+91', '+1', '+44', '+61', '+81', '+86', '+49', '+33', '+39', '+7',
  '+55', '+52', '+34', '+82', '+65', '+60', '+62', '+66', '+971', '+966',
];

const QUILL_MODULES = {
  toolbar: [
    ['bold', 'italic', 'underline', 'strike'],
    [{ header: [2, 3, false] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['blockquote', 'link'],
    ['clean'],
  ],
};

const QUILL_FORMATS = [
  'bold', 'italic', 'underline', 'strike',
  'header', 'list', 'blockquote', 'link',
];

interface FormData {
  sellerName: string;
  sellerShopName: string;
  sellerContactCountryCode: string;
  sellerContactNumber: string;
  storeAddress: string;
  city: string;
  state: string;
  country: string;
  sellerZipCode: string;
  shortStoreDescription: string;
  detailedStoreDescription: string;
  sellerPolicy: string;
}

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

type FormErrors = Partial<Record<keyof FormData | 'phone', string>>;
type ModalType = 'status' | 'verification' | 'message' | 'password' | 'delete' | 'impersonate' | null;

function detailToFormData(p: SellerDetail): FormData {
  return {
    sellerName: p.sellerName || '',
    sellerShopName: p.sellerShopName || '',
    sellerContactCountryCode: p.sellerContactCountryCode || '+91',
    sellerContactNumber: p.sellerContactNumber || p.phoneNumber || '',
    storeAddress: p.storeAddress || '',
    city: p.city || '',
    state: p.state || '',
    country: p.country || 'India',
    sellerZipCode: p.sellerZipCode || '',
    shortStoreDescription: p.shortStoreDescription || '',
    detailedStoreDescription: p.detailedStoreDescription || '',
    sellerPolicy: p.sellerPolicy || '',
  };
}

function detailToInitialData(p: SellerDetail): FormData {
  return {
    sellerName: p.sellerName || '',
    sellerShopName: p.sellerShopName || '',
    sellerContactCountryCode: p.sellerContactCountryCode || '',
    sellerContactNumber: p.sellerContactNumber || '',
    storeAddress: p.storeAddress || '',
    city: p.city || '',
    state: p.state || '',
    country: p.country || '',
    sellerZipCode: p.sellerZipCode || '',
    shortStoreDescription: p.shortStoreDescription || '',
    detailedStoreDescription: p.detailedStoreDescription || '',
    sellerPolicy: p.sellerPolicy || '',
  };
}

function computeDiff(current: FormData, initial: FormData): Record<string, string> {
  const diff: Record<string, string> = {};
  const keys = Object.keys(current) as (keyof FormData)[];
  for (const key of keys) {
    if (current[key] !== initial[key]) {
      diff[key] = current[key];
    }
  }
  if (diff.sellerContactCountryCode !== undefined && diff.sellerContactNumber === undefined) {
    diff.sellerContactNumber = current.sellerContactNumber;
  }
  if (diff.sellerContactNumber !== undefined && diff.sellerContactCountryCode === undefined) {
    diff.sellerContactCountryCode = current.sellerContactCountryCode;
  }
  return diff;
}

function getStatusBadgeClass(status: string): string {
  return `status-badge status-${status.toLowerCase()}`;
}

function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: 'Active', INACTIVE: 'Inactive', PENDING_APPROVAL: 'Pending Approval',
    SUSPENDED: 'Suspended', DEACTIVATED: 'Deactivated',
  };
  return map[status] || status;
}

function getVerificationLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function AdminSellerDetailPage() {
  const router = useRouter();
  const params = useParams();
  const sellerId = params.sellerId as string;

  const [seller, setSeller] = useState<SellerDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [formData, setFormData] = useState<FormData>({
    sellerName: '', sellerShopName: '',
    sellerContactCountryCode: '', sellerContactNumber: '',
    storeAddress: '', city: '', state: '', country: '', sellerZipCode: '',
    shortStoreDescription: '', detailedStoreDescription: '', sellerPolicy: '',
  });
  const [initialFormData, setInitialFormData] = useState<FormData | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  // Pincode auto-fill state
  const [pincodeData, setPincodeData] = useState<{ district: string; state: string; places: { name: string; type: string; delivery: string }[] } | null>(null);
  const [pincodeLoading, setPincodeLoading] = useState(false);
  const [pincodeError, setPincodeError] = useState('');
  const [selectedPlace, setSelectedPlace] = useState('');
  const [pincodeAutoFilled, setPincodeAutoFilled] = useState(false);

  async function lookupPincode(pincode: string) {
    if (pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
      setPincodeData(null);
      setPincodeError('');
      setPincodeAutoFilled(false);
      setSelectedPlace('');
      return;
    }

    setPincodeLoading(true);
    setPincodeError('');
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const res = await fetch(`${API_BASE}/api/v1/pincodes/${pincode}`);
      const data = await res.json();

      if (data.success && data.data) {
        setPincodeData(data.data);
        setPincodeAutoFilled(true);
        setSelectedPlace('');
        setFormData(prev => ({
          ...prev,
          city: data.data.district,
          state: data.data.state,
        }));
        setErrors(prev => {
          const next = { ...prev };
          delete next.city;
          delete next.state;
          return next;
        });
      } else {
        setPincodeError('Invalid pincode');
        setPincodeData(null);
        setPincodeAutoFilled(false);
        setSelectedPlace('');
      }
    } catch {
      setPincodeError('Failed to lookup pincode');
      setPincodeData(null);
      setPincodeAutoFilled(false);
    } finally {
      setPincodeLoading(false);
    }
  }

  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [adminRole, setAdminRole] = useState('');

  useEffect(() => {
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) setAdminRole(JSON.parse(adminData).role);
    } catch { /* ignore */ }
  }, []);

  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev.slice(-2), { id, type, message }]);
    if (type === 'success' || type === 'info') {
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    }
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const fetchSeller = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const res = await adminSellersService.getSeller(sellerId);
      if (res.data) {
        setSeller(res.data);
        setFormData(detailToFormData(res.data));
        setInitialFormData(detailToInitialData(res.data));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setFetchError(err instanceof ApiError ? err.message : 'Failed to load seller details');
    } finally {
      setIsLoading(false);
    }
  }, [sellerId, router]);

  useEffect(() => {
    fetchSeller();
  }, [fetchSeller]);

  // Field handlers
  const updateField = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
    }
    if ((field === 'sellerContactCountryCode' || field === 'sellerContactNumber') && errors.phone) {
      setErrors(prev => { const next = { ...prev }; delete next.phone; return next; });
    }
  };

  const handleBlur = (field: keyof FormData) => {
    let error: string | null = null;
    const v = formData[field];
    switch (field) {
      case 'sellerName': error = validateProfileSellerName(v); break;
      case 'sellerShopName': error = validateProfileShopName(v); break;
      case 'sellerContactCountryCode': error = validateCountryCode(v); break;
      case 'sellerContactNumber': error = validateContactNumber(v); break;
      case 'storeAddress': error = validateStoreAddress(v); break;
      case 'city': error = validateCity(v); break;
      case 'state': error = validateState(v); break;
      case 'country': error = validateCountry(v); break;
      case 'sellerZipCode': error = validateZipCode(v); break;
    }
    setErrors(prev => {
      const next = { ...prev };
      if (error) next[field] = error; else delete next[field];
      return next;
    });
  };

  const validateAll = (): boolean => {
    const newErrors: FormErrors = {};
    const nameErr = validateProfileSellerName(formData.sellerName);
    if (nameErr) newErrors.sellerName = nameErr;
    const shopErr = validateProfileShopName(formData.sellerShopName);
    if (shopErr) newErrors.sellerShopName = shopErr;
    const codeErr = validateCountryCode(formData.sellerContactCountryCode);
    if (codeErr) newErrors.sellerContactCountryCode = codeErr;
    const phoneErr = validateContactNumber(formData.sellerContactNumber);
    if (phoneErr) newErrors.sellerContactNumber = phoneErr;
    if (!codeErr && !phoneErr) {
      const crossErr = validatePhoneCrossField(formData.sellerContactCountryCode, formData.sellerContactNumber);
      if (crossErr) newErrors.phone = crossErr;
    }
    const hasAddr = [formData.storeAddress, formData.city, formData.state, formData.country, formData.sellerZipCode].some(v => v.trim().length > 0);
    if (hasAddr) {
      const ae = validateStoreAddress(formData.storeAddress); if (ae) newErrors.storeAddress = ae;
      const ce = validateCity(formData.city); if (ce) newErrors.city = ce;
      const se = validateState(formData.state); if (se) newErrors.state = se;
      const coe = validateCountry(formData.country); if (coe) newErrors.country = coe;
      const ze = validateZipCode(formData.sellerZipCode); if (ze) newErrors.sellerZipCode = ze;
    }
    if (formData.shortStoreDescription && !isEditorEmpty(formData.shortStoreDescription)) {
      const err = validateRichText(formData.shortStoreDescription, 'Short description', 500);
      if (err) newErrors.shortStoreDescription = err;
    }
    if (formData.detailedStoreDescription && !isEditorEmpty(formData.detailedStoreDescription)) {
      const err = validateRichText(formData.detailedStoreDescription, 'Detailed description', 10000);
      if (err) newErrors.detailedStoreDescription = err;
    }
    if (formData.sellerPolicy && !isEditorEmpty(formData.sellerPolicy)) {
      const err = validateRichText(formData.sellerPolicy, 'Seller policy', 10000);
      if (err) newErrors.sellerPolicy = err;
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isDirty = initialFormData
    ? Object.keys(formData).some(k => formData[k as keyof FormData] !== initialFormData[k as keyof FormData])
    : false;

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!seller || !initialFormData) return;
    if (!validateAll()) {
      const el = document.querySelector('[aria-invalid="true"]') as HTMLElement;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
      return;
    }
    const diff = computeDiff(formData, initialFormData);
    if (Object.keys(diff).length === 0) {
      addToast('info', 'No changes to save');
      return;
    }
    setIsSaving(true);
    try {
      await adminSellersService.editSeller(sellerId, diff);
      // Refetch to get updated data
      const res = await adminSellersService.getSeller(sellerId);
      if (res.data) {
        setSeller(res.data);
        setFormData(detailToFormData(res.data));
        setInitialFormData(detailToInitialData(res.data));
        setErrors({});
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 1500);
        addToast('success', 'Seller profile updated successfully');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) { router.replace('/login'); return; }
        const msg = Array.isArray(err.body.message) ? err.body.message.join('. ') : err.body.message;
        addToast('error', typeof msg === 'string' ? msg : 'Failed to update');
      } else {
        addToast('error', 'Something went wrong. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const closeModal = () => setActiveModal(null);
  const onActionComplete = () => {
    closeModal();
    fetchSeller();
  };

  const canImpersonate = ['SUPER_ADMIN', 'SELLER_ADMIN'].includes(adminRole) && seller?.status === 'ACTIVE';
  const canDelete = ['SUPER_ADMIN', 'SELLER_ADMIN'].includes(adminRole);

  // ---- Product Mappings State ----
  interface SellerProductMappingItem {
    id: string;
    productId: string;
    variantId: string | null;
    product: { id: string; title: string; slug: string; productCode: string; status: string };
    variant: { id: string; masterSku: string; title: string; sku: string } | null;
    stockQty: number;
    reservedQty: number;
    availableQty: number;
    lowStockThreshold: number;
    mappingDisplayStatus: string;
    sellerInternalSku: string | null;
    dispatchSla: number;
    isActive: boolean;
    updatedAt: string;
  }

  const [productMappings, setProductMappings] = useState<SellerProductMappingItem[]>([]);
  const [productMappingsLoading, setProductMappingsLoading] = useState(false);

  const fetchProductMappings = useCallback(async () => {
    if (!sellerId) return;
    setProductMappingsLoading(true);
    try {
      const res = await apiClient<{ mappings: SellerProductMappingItem[]; pagination: any }>(
        `/admin/seller-mappings?sellerId=${sellerId}&limit=100`,
      );
      if (res.data?.mappings) {
        setProductMappings(res.data.mappings);
      }
    } catch {
      // Non-critical
    } finally {
      setProductMappingsLoading(false);
    }
  }, [sellerId]);

  useEffect(() => {
    if (sellerId) fetchProductMappings();
  }, [sellerId, fetchProductMappings]);

  function formatMappingTimeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function getMappingStatusStyle(status: string): React.CSSProperties {
    switch (status) {
      case 'ACTIVE': return { background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' };
      case 'LOW_STOCK': return { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' };
      case 'OUT_OF_STOCK': return { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' };
      case 'INACTIVE': return { background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' };
      default: return { background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' };
    }
  }

  // For modals
  const sellerListItem: SellerListItem | null = seller ? {
    sellerId: seller.sellerId,
    sellerName: seller.sellerName,
    sellerShopName: seller.sellerShopName,
    email: seller.email,
    phoneNumber: seller.phoneNumber,
    status: seller.status,
    verificationStatus: seller.verificationStatus,
    profileCompletionPercentage: seller.profileCompletionPercentage,
    isProfileCompleted: seller.isProfileCompleted,
    isEmailVerified: seller.isEmailVerified,
    profileImageUrl: seller.sellerProfileImageUrl,
    createdAt: seller.createdAt,
    lastLoginAt: seller.lastLoginAt,
  } : null;

  // Loading
  if (isLoading) {
    return (
      <div className="profile-page">
        <div className="profile-header">
          <div className="skeleton skeleton-line wide" />
          <div className="skeleton skeleton-line short" />
        </div>
        <div className="skeleton skeleton-input" />
        {[1, 2, 3, 4].map(i => (
          <div className="profile-card" key={i}>
            <div className="skeleton skeleton-line medium" />
            <div className="skeleton skeleton-input" />
            <div className="skeleton skeleton-input" />
          </div>
        ))}
      </div>
    );
  }

  // Error
  if (fetchError) {
    return (
      <div className="profile-error-page">
        <h2>Unable to load seller</h2>
        <p>{fetchError}</p>
        <button className="btn-retry" onClick={fetchSeller}>Try Again</button>
      </div>
    );
  }

  if (!seller) return null;

  return (
    <div className="profile-page">
      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast toast-${t.type}`} role="alert">
              <span>{t.message}</span>
              <button className="toast-dismiss" onClick={() => dismissToast(t.id)} aria-label="Dismiss">&times;</button>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="profile-header">
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => router.push('/dashboard/sellers')}
            style={{
              background: 'none', border: '1px solid var(--color-border)', borderRadius: 8,
              padding: '6px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--color-text-secondary)',
            }}
          >
            &larr; Back to Sellers
          </button>
        </div>
        <div className="profile-header-top">
          <h1>{seller.sellerName}</h1>
          <span className={getStatusBadgeClass(seller.status)}>{getStatusLabel(seller.status)}</span>
        </div>
        <p>{seller.sellerShopName} &middot; {seller.email}</p>
      </div>

      {/* Admin Actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <ActionBtn label="Change Status" onClick={() => setActiveModal('status')} />
        <ActionBtn label="Send Message" onClick={() => setActiveModal('message')} />
        <ActionBtn label="Change Password" onClick={() => setActiveModal('password')} />
        {canImpersonate && <ActionBtn label="Impersonate" onClick={() => setActiveModal('impersonate')} />}
        {canDelete && <ActionBtn label="Delete" onClick={() => setActiveModal('delete')} danger />}
      </div>

      {/* Verification & Completion */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={`verification-badge ${seller.verificationStatus === 'VERIFIED' ? 'verified' : seller.verificationStatus === 'REJECTED' ? 'rejected' : seller.verificationStatus === 'UNDER_REVIEW' ? 'under-review' : 'not-verified'}`}>
          {getVerificationLabel(seller.verificationStatus)}
        </span>
        {seller.isEmailVerified && (
          <div className="email-verified-badge" style={{ marginBottom: 0 }}>
            <span className="verified-icon">&#10003;</span>
            Email Verified
          </div>
        )}
        {!seller.isEmailVerified && (
          <span style={{ fontSize: 13, color: 'var(--color-warning)', fontWeight: 500 }}>Email Not Verified</span>
        )}
      </div>

      {/* Completion Bar */}
      <div className="completion-bar-wrapper">
        <div className="completion-bar-header">
          <span className="completion-bar-label">Profile Completion</span>
          <span className="completion-bar-value">{seller.profileCompletionPercentage}%</span>
        </div>
        <div className="completion-bar-track" role="progressbar" aria-valuenow={seller.profileCompletionPercentage} aria-valuemin={0} aria-valuemax={100}>
          <div
            className={`completion-bar-fill${seller.isProfileCompleted ? ' complete' : ''}`}
            style={{ width: `${seller.profileCompletionPercentage}%` }}
          />
        </div>
      </div>

      {/* Media Preview (read-only for admin) */}
      <div className="media-cards-row">
        <div className="media-upload-card">
          <h3>Profile Image</h3>
          <div className="media-preview-container">
            <div className="media-preview-circle">
              {seller.sellerProfileImageUrl ? (
                <img src={seller.sellerProfileImageUrl} alt="Profile" />
              ) : (
                <span className="media-placeholder-icon">&#128100;</span>
              )}
            </div>
          </div>
          <div className="media-guidelines">
            {seller.sellerProfileImageUrl ? 'Image uploaded' : 'No image uploaded'}
          </div>
        </div>
        <div className="media-upload-card">
          <h3>Shop Logo</h3>
          <div className="media-preview-container">
            <div className="media-preview-rect">
              {seller.sellerShopLogoUrl ? (
                <img src={seller.sellerShopLogoUrl} alt="Shop logo" />
              ) : (
                <span className="media-placeholder-icon">&#127978;</span>
              )}
            </div>
          </div>
          <div className="media-guidelines">
            {seller.sellerShopLogoUrl ? 'Logo uploaded' : 'No logo uploaded'}
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSave} noValidate>
        {/* Account Details */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h2>Account Details</h2>
            <p>Seller identity and contact information</p>
          </div>

          <div className="form-grid-2">
            <div className="profile-form-group">
              <label>Email</label>
              <div className="readonly-field">
                <span className="lock-icon">&#128274;</span>
                {seller.email}
              </div>
            </div>
            <div className="profile-form-group">
              <label>Registered Phone</label>
              <div className="readonly-field">
                <span className="lock-icon">&#128274;</span>
                {seller.phoneNumber}
              </div>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="profile-form-group">
              <label htmlFor="sellerName">Seller Name *</label>
              <input
                id="sellerName" type="text" value={formData.sellerName}
                onChange={e => updateField('sellerName', e.target.value)}
                onBlur={() => handleBlur('sellerName')}
                aria-invalid={!!errors.sellerName}
                disabled={isSaving} placeholder="Seller name"
              />
              {errors.sellerName && <span className="profile-field-error" role="alert">{errors.sellerName}</span>}
            </div>
            <div className="profile-form-group">
              <label htmlFor="sellerShopName">Shop Name *</label>
              <input
                id="sellerShopName" type="text" value={formData.sellerShopName}
                onChange={e => updateField('sellerShopName', e.target.value)}
                onBlur={() => handleBlur('sellerShopName')}
                aria-invalid={!!errors.sellerShopName}
                disabled={isSaving} placeholder="Shop name"
              />
              {errors.sellerShopName && <span className="profile-field-error" role="alert">{errors.sellerShopName}</span>}
            </div>
          </div>

          <div className="profile-form-group">
            <label htmlFor="sellerContactNumber">Contact Number</label>
            <div className="phone-input-group">
              <select
                id="sellerContactCountryCode" value={formData.sellerContactCountryCode}
                onChange={e => updateField('sellerContactCountryCode', e.target.value)}
                onBlur={() => handleBlur('sellerContactCountryCode')}
                aria-invalid={!!errors.sellerContactCountryCode}
                disabled={isSaving}
              >
                <option value="">Code</option>
                {COUNTRY_CODES.map(code => <option key={code} value={code}>{code}</option>)}
              </select>
              <input
                id="sellerContactNumber" type="tel" inputMode="numeric"
                value={formData.sellerContactNumber}
                onChange={e => updateField('sellerContactNumber', e.target.value.replace(/\D/g, ''))}
                onBlur={() => handleBlur('sellerContactNumber')}
                aria-invalid={!!errors.sellerContactNumber}
                disabled={isSaving} placeholder="Phone number"
              />
            </div>
            {(errors.sellerContactCountryCode || errors.sellerContactNumber || errors.phone) && (
              <span className="profile-field-error" role="alert">
                {errors.sellerContactCountryCode || errors.sellerContactNumber || errors.phone}
              </span>
            )}
          </div>
        </div>

        {/* Store Address */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h2>Store Address</h2>
            <p>Physical store or warehouse address</p>
          </div>

          <div className="profile-form-group">
            <label htmlFor="storeAddress">Address</label>
            <textarea
              id="storeAddress" rows={3} value={formData.storeAddress}
              onChange={e => updateField('storeAddress', e.target.value)}
              onBlur={() => handleBlur('storeAddress')}
              aria-invalid={!!errors.storeAddress}
              disabled={isSaving} placeholder="Street address, building, landmark"
            />
            {errors.storeAddress && <span className="profile-field-error" role="alert">{errors.storeAddress}</span>}
          </div>

          <div className="form-grid-2">
            <div className="profile-form-group">
              <label htmlFor="sellerZipCode">ZIP / PIN Code</label>
              <input id="sellerZipCode" type="text" value={formData.sellerZipCode}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  updateField('sellerZipCode', val);
                  lookupPincode(val);
                }}
                onBlur={() => handleBlur('sellerZipCode')}
                aria-invalid={!!errors.sellerZipCode} disabled={isSaving} placeholder="ZIP / PIN code"
                maxLength={6} />
              {pincodeLoading && (
                <span style={{ color: '#6b7280', fontSize: 12 }}>Looking up pincode...</span>
              )}
              {pincodeError && (
                <span className="profile-field-error" role="alert" style={{ color: '#dc2626' }}>{pincodeError}</span>
              )}
              {pincodeData && !pincodeError && !pincodeLoading && (
                <span style={{ color: '#16a34a', fontSize: 12 }}>{pincodeData.district}, {pincodeData.state}</span>
              )}
              {errors.sellerZipCode && <span className="profile-field-error" role="alert">{errors.sellerZipCode}</span>}
            </div>
            <div className="profile-form-group">
              <label htmlFor="country">Country</label>
              <input id="country" type="text" value={formData.country}
                onChange={e => updateField('country', e.target.value)} onBlur={() => handleBlur('country')}
                aria-invalid={!!errors.country} disabled={isSaving} placeholder="Country" />
              {errors.country && <span className="profile-field-error" role="alert">{errors.country}</span>}
            </div>
          </div>

          <div className="form-grid-2">
            <div className="profile-form-group">
              <label htmlFor="city">City / District</label>
              <input id="city" type="text" value={formData.city}
                onChange={e => {
                  updateField('city', e.target.value);
                  if (pincodeAutoFilled) setPincodeAutoFilled(false);
                }}
                onBlur={() => handleBlur('city')}
                aria-invalid={!!errors.city} disabled={isSaving}
                readOnly={pincodeAutoFilled}
                placeholder="City"
                style={pincodeAutoFilled ? { background: '#f0fdf4', borderColor: '#86efac' } : undefined} />
              {errors.city && <span className="profile-field-error" role="alert">{errors.city}</span>}
            </div>
            <div className="profile-form-group">
              <label htmlFor="state">State</label>
              <input id="state" type="text" value={formData.state}
                onChange={e => {
                  updateField('state', e.target.value);
                  if (pincodeAutoFilled) setPincodeAutoFilled(false);
                }}
                onBlur={() => handleBlur('state')}
                aria-invalid={!!errors.state} disabled={isSaving}
                placeholder="State / Province"
                style={pincodeAutoFilled ? { background: '#f0fdf4', borderColor: '#86efac' } : undefined} />
              {errors.state && <span className="profile-field-error" role="alert">{errors.state}</span>}
            </div>
          </div>

          {pincodeData && pincodeData.places && pincodeData.places.length > 0 && (
            <div className="profile-form-group">
              <label htmlFor="locality">Locality</label>
              <select
                id="locality"
                value={selectedPlace}
                onChange={e => setSelectedPlace(e.target.value)}
                disabled={isSaving}
                style={pincodeAutoFilled ? { background: '#f0fdf4', borderColor: '#86efac' } : undefined}
              >
                <option value="">Select your locality</option>
                {pincodeData.places.map((place, idx) => (
                  <option key={idx} value={place.name}>{place.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Store Description */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h2>Store Description</h2>
            <p>Store description and details</p>
          </div>

          <div className="profile-form-group">
            <label>Short Description</label>
            <div className="editor-wrapper" data-invalid={!!errors.shortStoreDescription}>
              <ReactQuill theme="snow" value={formData.shortStoreDescription}
                onChange={val => updateField('shortStoreDescription', val)}
                modules={QUILL_MODULES} formats={QUILL_FORMATS}
                placeholder="Brief description (max 500 characters)" readOnly={isSaving} />
            </div>
            <div className={`editor-char-count${getPlainTextLength(formData.shortStoreDescription) > 500 ? ' char-error' : getPlainTextLength(formData.shortStoreDescription) > 450 ? ' char-warning' : ''}`}>
              {getPlainTextLength(formData.shortStoreDescription)} / 500
            </div>
            {errors.shortStoreDescription && <span className="profile-field-error" role="alert">{errors.shortStoreDescription}</span>}
          </div>

          <div className="profile-form-group">
            <label>Detailed Description</label>
            <div className="editor-wrapper editor-tall" data-invalid={!!errors.detailedStoreDescription}>
              <ReactQuill theme="snow" value={formData.detailedStoreDescription}
                onChange={val => updateField('detailedStoreDescription', val)}
                modules={QUILL_MODULES} formats={QUILL_FORMATS}
                placeholder="Detailed description of the store" readOnly={isSaving} />
            </div>
            <div className={`editor-char-count${getPlainTextLength(formData.detailedStoreDescription) > 10000 ? ' char-error' : getPlainTextLength(formData.detailedStoreDescription) > 9500 ? ' char-warning' : ''}`}>
              {getPlainTextLength(formData.detailedStoreDescription)} / 10,000
            </div>
            {errors.detailedStoreDescription && <span className="profile-field-error" role="alert">{errors.detailedStoreDescription}</span>}
          </div>
        </div>

        {/* Seller Policy */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h2>Seller Policy</h2>
            <p>Return, refund, shipping, and exchange policies</p>
          </div>

          <div className="profile-form-group">
            <label>Policy Content</label>
            <div className="editor-wrapper editor-tall" data-invalid={!!errors.sellerPolicy}>
              <ReactQuill theme="snow" value={formData.sellerPolicy}
                onChange={val => updateField('sellerPolicy', val)}
                modules={QUILL_MODULES} formats={QUILL_FORMATS}
                placeholder="Store policies" readOnly={isSaving} />
            </div>
            <div className={`editor-char-count${getPlainTextLength(formData.sellerPolicy) > 10000 ? ' char-error' : getPlainTextLength(formData.sellerPolicy) > 9500 ? ' char-warning' : ''}`}>
              {getPlainTextLength(formData.sellerPolicy)} / 10,000
            </div>
            {errors.sellerPolicy && <span className="profile-field-error" role="alert">{errors.sellerPolicy}</span>}
          </div>
        </div>

        {/* Account Info (read-only) */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h2>Account &amp; Security</h2>
            <p>Login and security information</p>
          </div>
          <InfoRow label="Failed Login Attempts" value={String(seller.failedLoginAttempts)} />
          <InfoRow label="Lock Until" value={seller.lockUntil ? new Date(seller.lockUntil).toLocaleString() : 'Not locked'} />
          <InfoRow label="Last Login" value={seller.lastLoginAt ? new Date(seller.lastLoginAt).toLocaleString() : 'Never'} />
          <InfoRow label="Last Profile Update" value={seller.lastProfileUpdatedAt ? new Date(seller.lastProfileUpdatedAt).toLocaleString() : 'N/A'} />
          <InfoRow label="Joined" value={new Date(seller.createdAt).toLocaleString()} />
          <InfoRow label="Last Updated" value={new Date(seller.updatedAt).toLocaleString()} />
        </div>

        {/* Save Footer */}
        <div className="save-footer">
          <button
            type="submit"
            className={`btn-save${saveSuccess ? ' save-success' : ''}`}
            disabled={!isDirty || isSaving}
            aria-busy={isSaving}
          >
            {isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Product Mappings */}
      <div className="profile-card" style={{ marginTop: 20 }}>
        <div className="profile-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Product Mappings</h2>
            <p>Products this seller is mapped to with stock levels</p>
          </div>
          <button
            type="button"
            onClick={fetchProductMappings}
            disabled={productMappingsLoading}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 500,
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
              background: '#fff', cursor: 'pointer', color: 'var(--color-text)',
            }}
          >
            {productMappingsLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {productMappingsLoading && productMappings.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', padding: '12px 0' }}>Loading product mappings...</p>
        ) : productMappings.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', padding: '12px 0' }}>No products mapped to this seller yet.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border, #e5e7eb)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Product</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Code</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Variant (SKU)</th>
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Stock</th>
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Available</th>
                    <th style={{ textAlign: 'center', padding: '8px 10px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>SLA</th>
                    <th style={{ textAlign: 'center', padding: '8px 10px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Status</th>
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {productMappings.map((m) => (
                    <tr key={m.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.product.title}
                      </td>
                      <td style={{ padding: '8px 10px', color: 'var(--color-text-secondary)', fontSize: 12 }}>
                        {m.product.productCode}
                      </td>
                      <td style={{ padding: '8px 10px', color: 'var(--color-text-secondary)' }}>
                        {m.variant?.masterSku || '\u2014'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 500 }}>{m.stockQty}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 500 }}>{m.availableQty}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{m.dispatchSla}d</td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 10px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          ...getMappingStatusStyle(m.mappingDisplayStatus),
                        }}>
                          {m.mappingDisplayStatus.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--color-text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {formatMappingTimeAgo(m.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, padding: '10px 0 0', borderTop: '1px solid #f3f4f6', fontSize: 13, color: 'var(--color-text-secondary)', display: 'flex', gap: 16 }}>
              <span>Total: <strong style={{ color: 'var(--color-text)' }}>{productMappings.length}</strong> mapping{productMappings.length !== 1 ? 's' : ''}</span>
              <span>Total Stock: <strong style={{ color: 'var(--color-text)' }}>{productMappings.reduce((s, m) => s + m.stockQty, 0).toLocaleString()}</strong></span>
              <span>Total Available: <strong style={{ color: 'var(--color-text)' }}>{productMappings.reduce((s, m) => s + m.availableQty, 0).toLocaleString()}</strong></span>
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {activeModal === 'status' && sellerListItem && (
        <StatusModal seller={sellerListItem} onClose={closeModal} onSuccess={onActionComplete} />
      )}
      {activeModal === 'verification' && sellerListItem && (
        <VerificationModal seller={sellerListItem} onClose={closeModal} onSuccess={onActionComplete} />
      )}
      {activeModal === 'message' && sellerListItem && (
        <SendMessageModal seller={sellerListItem} onClose={closeModal} onSuccess={onActionComplete} />
      )}
      {activeModal === 'password' && sellerListItem && (
        <ChangePasswordModal seller={sellerListItem} onClose={closeModal} onSuccess={onActionComplete} />
      )}
      {activeModal === 'delete' && sellerListItem && (
        <DeleteSellerModal seller={sellerListItem} onClose={closeModal} onSuccess={onActionComplete} />
      )}
      {activeModal === 'impersonate' && sellerListItem && (
        <ImpersonateModal seller={sellerListItem} onClose={closeModal} />
      )}
    </div>
  );
}

function ActionBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 16px', fontSize: 13, fontWeight: 500,
        border: `1px solid ${danger ? '#fecaca' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius)', background: '#fff', cursor: 'pointer',
        color: danger ? 'var(--color-error)' : 'var(--color-text)',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontSize: 14, borderBottom: '1px solid #f9fafb' }}>
      <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{label}</span>
      <span style={{ color: 'var(--color-text)', fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
