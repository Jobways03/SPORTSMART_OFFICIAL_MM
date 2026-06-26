'use client';

import { useState, useEffect, useRef, useCallback, useMemo, FormEvent, CSSProperties } from 'react';
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
import EditBankModal from '../components/edit-bank-modal';
import KycReviewModal from '../components/kyc-review-modal';
import '../components/modal.css';
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
type ModalType = 'status' | 'verification' | 'kyc' | 'message' | 'password' | 'delete' | 'impersonate' | 'editbank' | null;

// Phase 254 — presentational helpers for the Tax / GST identity card.
function TaxBadge({ state }: { state: 'verified' | 'pending' | 'missing' }) {
  const map = {
    verified: { bg: '#DCFCE7', fg: '#166534', text: 'Verified' },
    pending: { bg: '#FEF3C7', fg: '#92400E', text: 'Pending' },
    missing: { bg: '#FEE2E2', fg: '#991B1B', text: 'Missing' },
  } as const;
  const s = map[state];
  return (
    <span style={{ background: s.bg, color: s.fg, padding: '2px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {s.text}
    </span>
  );
}

// Logistics pickup-registration badge. Delivery is the main source of value for
// a seller, so a missing pickup registration is flagged in red (blocking), a
// registered one in green. Not colour-only — both carry an icon + text.
function LogisticsBadge({ registered, partners }: { registered: boolean; partners?: string[] }) {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  };
  if (registered) {
    const list = partners && partners.length ? partners.join(', ') : undefined;
    return (
      <span
        style={{ ...base, background: '#DCFCE7', color: '#166534' }}
        title={list ? `Pickup registered with ${list}` : 'Pickup address registered with a courier'}
      >
        <span aria-hidden>&#10003;</span> Logistics ready
      </span>
    );
  }
  return (
    <span
      style={{ ...base, background: '#FEE2E2', color: '#991B1B' }}
      title="No courier pickup address registered — orders cannot be shipped"
    >
      <span aria-hidden>&#9888;</span> Pickup not registered
    </span>
  );
}

// Prominent, actionable banner for an approved seller whose pickup address is
// not yet registered with a courier (so their orders cannot be shipped).
function LogisticsSetupBanner({ onSetup }: { onSetup: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '12px 16px',
        background: '#FEF3C7',
        border: '1px solid #FDE68A',
        borderRadius: 8,
        marginBottom: 16,
      }}
    >
      <span aria-hidden style={{ fontSize: 18, lineHeight: '22px', color: '#B45309' }}>&#9888;</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: '#92400E', fontSize: 14, marginBottom: 2 }}>
          Pickup address not registered with a courier
        </div>
        <div style={{ color: '#92400E', fontSize: 13, lineHeight: 1.5 }}>
          This seller is approved, but their pickup location has not been added to
          logistics — so their orders <strong>cannot be shipped</strong>. Register a
          pickup location to enable delivery.
        </div>
      </div>
      <button
        type="button"
        onClick={onSetup}
        style={{
          alignSelf: 'center',
          padding: '8px 14px',
          borderRadius: 6,
          border: '1px solid #D97706',
          background: '#D97706',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Set up logistics
      </button>
    </div>
  );
}

function taxVerifyBtnStyle(bg: string, border: string, disabled: boolean): CSSProperties {
  return {
    marginTop: 10,
    padding: '8px 14px',
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: disabled ? '#9CA3AF' : bg,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

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

const ENTITY_LABELS: Record<string, string> = {
  PUBLIC_LIMITED: 'Public Limited Company',
  PRIVATE_LIMITED: 'Private Limited Company',
  SOLE_PROPRIETORSHIP: 'Sole Proprietorship',
  GENERAL_PARTNERSHIP: 'General Partnership',
  LLP: 'Limited Liability Partnership (LLP)',
};

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
      const data = await apiClient<any>(`/pincodes/${pincode}`);

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
  // Phase 254 — manual PAN / GSTIN verification in progress (null when idle).
  const [verifyingTaxId, setVerifyingTaxId] = useState<null | 'pan' | 'gst'>(null);
  // Which tax id the confirm modal is open for (null = closed). Mirrors the
  // d2c-seller-admin styled modal that replaced the native window.confirm.
  const [verifyConfirm, setVerifyConfirm] = useState<null | 'pan' | 'gst'>(null);

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

  // Phase 254 — manually mark the seller's PAN / GSTIN verified. PAN
  // verification is what drops §194-O TDS from the 5% no-PAN penalty to the
  // configured rate; GSTIN verification feeds tax invoicing. Idempotent.
  // Open the in-app confirm modal (replaces the native window.confirm).
  const verifyTaxId = useCallback(
    (which: 'pan' | 'gst') => {
      if (verifyingTaxId) return;
      setVerifyConfirm(which);
    },
    [verifyingTaxId],
  );

  // Actual verification — run from the modal's confirm button.
  const runVerify = useCallback(
    async (which: 'pan' | 'gst') => {
      const label = which === 'pan' ? 'PAN' : 'GSTIN';
      setVerifyConfirm(null);
      setVerifyingTaxId(which);
      try {
        const res =
          which === 'pan'
            ? await adminSellersService.verifyPan(sellerId)
            : await adminSellersService.verifyGstin(sellerId);
        addToast('success', res?.message ?? `${label} verified`);
        await fetchSeller();
      } catch (err) {
        addToast(
          'error',
          err instanceof ApiError ? err.message : `${label} verification failed`,
        );
      } finally {
        setVerifyingTaxId(null);
      }
    },
    [sellerId, addToast, fetchSeller],
  );

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

  const canReviewKyc = ['SUPER_ADMIN', 'SELLER_ADMIN', 'RETAILER_ADMIN'].includes(adminRole) && seller?.verificationStatus === 'UNDER_REVIEW';
  const canImpersonate = ['SUPER_ADMIN', 'SELLER_ADMIN', 'RETAILER_ADMIN'].includes(adminRole) && seller?.status === 'ACTIVE';
  const canDelete = ['SUPER_ADMIN', 'SELLER_ADMIN', 'RETAILER_ADMIN'].includes(adminRole);
  // Phase 254 — verifying statutory IDs is a management action available at any
  // status (the seller is usually already VERIFIED/ACTIVE by the time finance
  // verifies the PAN for the TDS rate).
  const canVerifyTaxIds = ['SUPER_ADMIN', 'SELLER_ADMIN', 'RETAILER_ADMIN'].includes(adminRole);

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
    legalBusinessName: seller.legalBusinessName,
    gstin: seller.gstin,
    gstStateCode: seller.gstStateCode,
    panLast4: seller.panLast4,
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

      {/* KYC review callout — makes the approval path unmistakable. Account
          status (Active/Inactive) is a SEPARATE control and does NOT approve
          KYC; admins were conflating the two. Only shown to reviewers while the
          seller is awaiting review. */}
      {canReviewKyc && (
        <div
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            padding: '14px 18px',
            marginBottom: 16,
            borderRadius: 10,
            background: 'var(--color-warning-bg, #FFF7ED)',
            border: '1px solid var(--color-warning, #F59E0B)',
          }}
        >
          <div style={{ maxWidth: 680 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 15,
                color: 'var(--color-text, #1A1A1A)',
                marginBottom: 2,
              }}
            >
              KYC awaiting your review
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #525A65)' }}>
              This seller submitted KYC and cannot start selling until you approve it
              here. Changing the <strong>account status</strong> (Active/Inactive) does{' '}
              <strong>not</strong> approve KYC.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveModal('kyc')}
            style={{
              whiteSpace: 'nowrap',
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--color-success, #16A34A)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Review &amp; Approve KYC
          </button>
        </div>
      )}

      {/* Admin Actions */}
      <div className="sa-actions">
        {canReviewKyc && (
          <ActionBtn
            label="Verify KYC"
            icon="kyc"
            variant="primary"
            onClick={() => setActiveModal('kyc')}
          />
        )}
        <ActionBtn label="Account Status" icon="status" onClick={() => setActiveModal('status')} />
        <ActionBtn label="Send Message" icon="message" onClick={() => setActiveModal('message')} />
        <ActionBtn label="Change Password" icon="password" onClick={() => setActiveModal('password')} />
        {/* Logistics partners (courier registration). Carries the sellerId
            so the Settings panel renders for this brand instead of the
            "append ?sellerId=" placeholder. */}
        <ActionBtn
          label="Logistics Partners"
          icon="logistics"
          onClick={() =>
            router.push(`/dashboard/settings?sellerId=${seller.sellerId}`)
          }
        />
        {canImpersonate && (
          <ActionBtn
            label="Impersonate"
            icon="impersonate"
            onClick={() => setActiveModal('impersonate')}
          />
        )}
        {canDelete && (
          <ActionBtn
            label="Delete"
            icon="delete"
            variant="danger"
            onClick={() => setActiveModal('delete')}
          />
        )}
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
        {/* Logistics pickup readiness — the gate for product delivery. */}
        <LogisticsBadge
          registered={!!seller.logisticsPickupRegistered}
          partners={seller.logisticsRegisteredPartners}
        />
      </div>

      {/* Logistics setup warning — shown when the seller is approved but their
          pickup address has not been registered with a courier, so their
          orders cannot be shipped. This is the main source for delivery. */}
      {!seller.logisticsPickupRegistered &&
        (seller.status === 'ACTIVE' || seller.verificationStatus === 'VERIFIED') && (
          <LogisticsSetupBanner
            onSetup={() => router.push(`/dashboard/settings?sellerId=${seller.sellerId}`)}
          />
        )}

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
          <div className="media-preview-container">
            <div className="media-preview-circle">
              {seller.sellerProfileImageUrl ? (
                <img src={seller.sellerProfileImageUrl} alt="Profile" />
              ) : (
                <span className="media-placeholder-icon">&#128100;</span>
              )}
            </div>
          </div>
          <div className="media-info">
            <h3>Profile Image</h3>
            <div className="media-guidelines">
              {seller.sellerProfileImageUrl ? 'Image uploaded' : 'No image uploaded'}
            </div>
          </div>
        </div>
        <div className="media-upload-card">
          <div className="media-preview-container">
            <div className="media-preview-rect">
              {seller.sellerShopLogoUrl ? (
                <img src={seller.sellerShopLogoUrl} alt="Shop logo" />
              ) : (
                <span className="media-placeholder-icon">&#127978;</span>
              )}
            </div>
          </div>
          <div className="media-info">
            <h3>Shop Logo</h3>
            <div className="media-guidelines">
              {seller.sellerShopLogoUrl ? 'Logo uploaded' : 'No logo uploaded'}
            </div>
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
                id="sellerName" type="text" value={formData.sellerName} maxLength={100}
                onChange={e => updateField('sellerName', e.target.value.replace(/[^A-Za-z .'-]/g, ''))}
                onBlur={() => handleBlur('sellerName')}
                aria-invalid={!!errors.sellerName}
                disabled={isSaving} placeholder="Seller name"
              />
              {errors.sellerName && <span className="profile-field-error" role="alert">{errors.sellerName}</span>}
            </div>
            <div className="profile-form-group">
              <label htmlFor="sellerShopName">Shop Name *</label>
              <input
                id="sellerShopName" type="text" value={formData.sellerShopName} maxLength={150}
                onChange={e => updateField('sellerShopName', e.target.value.replace(/[^A-Za-z0-9 &.,\-/()']/g, ''))}
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
                value={formData.sellerContactNumber} maxLength={15}
                onChange={e => updateField('sellerContactNumber', e.target.value.replace(/\D/g, '').slice(0, 15))}
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

        {/* Tax / GST identity — Phase 254. Verify PAN/GSTIN here. PAN
            verification drops §194-O TDS from the 5% no-PAN penalty to the
            configured rate (e.g. 1%); GSTIN verification feeds tax invoicing. */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h2>Tax / GST identity</h2>
            <p>
              Statutory IDs and verification. Verifying the <strong>PAN</strong>{' '}
              drops this seller&apos;s Section&nbsp;194-O TDS from the 5% no-PAN
              penalty rate to your configured rate (e.g. 1%).
            </p>
          </div>

          {/* Legal name + state code — full, unmasked, for admin audit. */}
          <div className="form-grid-2">
            <div className="profile-form-group">
              <label>Legal business name</label>
              <div className="readonly-field">{seller.legalBusinessName || '—'}</div>
            </div>
            <div className="profile-form-group">
              <label>GST state code</label>
              <div className="readonly-field">{seller.gstStateCode || '—'}</div>
            </div>
          </div>

          <div className="form-grid-2">
            {/* PAN — shown in full to admin (not masked). */}
            <div className="profile-form-group">
              <label>PAN</label>
              <div
                className="readonly-field"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
              >
                <span style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}>
                  {seller.panNumber || 'Missing'}
                </span>
                <TaxBadge
                  state={seller.panVerified ? 'verified' : seller.panNumber ? 'pending' : 'missing'}
                />
              </div>
              {canVerifyTaxIds && seller.panNumber && !seller.panVerified && (
                <button
                  type="button"
                  onClick={() => void verifyTaxId('pan')}
                  disabled={verifyingTaxId !== null}
                  style={taxVerifyBtnStyle('#059669', '#047857', verifyingTaxId !== null)}
                >
                  {verifyingTaxId === 'pan' ? 'Verifying…' : 'Verify PAN'}
                </button>
              )}
            </div>

            {/* GSTIN */}
            <div className="profile-form-group">
              <label>GSTIN</label>
              <div
                className="readonly-field"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
              >
                <span style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}>
                  {seller.gstin || 'Missing'}
                </span>
                <TaxBadge
                  state={seller.isGstVerified ? 'verified' : seller.gstin ? 'pending' : 'missing'}
                />
              </div>
              {canVerifyTaxIds && seller.gstin && !seller.isGstVerified && (
                <button
                  type="button"
                  onClick={() => void verifyTaxId('gst')}
                  disabled={verifyingTaxId !== null}
                  style={taxVerifyBtnStyle('#2563EB', '#1D4ED8', verifyingTaxId !== null)}
                >
                  {verifyingTaxId === 'gst' ? 'Verifying…' : 'Verify GSTIN'}
                </button>
              )}
            </div>
          </div>
          {(!seller.gstin || !seller.panNumber) && (
            <p style={{ marginTop: 12, padding: 10, background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: 13, color: '#92400E' }}>
              <strong>Missing ID:</strong> GSTIN + PAN are required (PAN is mandatory
              for §194-O TDS). Ask the seller to submit the missing field via
              onboarding before it can be verified.
            </p>
          )}
        </div>

        {/* Verify PAN/GSTIN confirmation modal (replaces native window.confirm). */}
        {verifyConfirm && (
          <div className="modal-overlay" onClick={() => setVerifyConfirm(null)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Verify {verifyConfirm === 'pan' ? 'PAN' : 'GSTIN'}</h2>
                <button className="modal-close" onClick={() => setVerifyConfirm(null)}>
                  &times;
                </button>
              </div>
              <div className="modal-body">
                <p style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.5, margin: 0 }}>
                  Confirm you have verified this seller&apos;s{' '}
                  <strong>{verifyConfirm === 'pan' ? 'PAN' : 'GSTIN'}</strong> on the
                  official portal.
                </p>
                <div className="modal-warning" style={{ marginTop: 12 }}>
                  {verifyConfirm === 'pan'
                    ? 'This drops their Section 194-O TDS from the 5% no-PAN penalty rate to the configured rate (e.g. 1%).'
                    : 'This marks the GSTIN as verified for tax invoicing.'}
                </div>
              </div>
              <div className="modal-footer">
                <button className="modal-btn" onClick={() => setVerifyConfirm(null)}>
                  Cancel
                </button>
                <button
                  className="modal-btn modal-btn-primary"
                  onClick={() => void runVerify(verifyConfirm)}
                >
                  Confirm &amp; verify
                </button>
              </div>
            </div>
          </div>
        )}

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

        {/* GST & Tax (read-only) */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h2>GST &amp; Tax</h2>
            <p>Tax identity submitted during onboarding</p>
          </div>
          <InfoRow label="Legal business name" value={seller.legalBusinessName || '—'} />
          <InfoRow
            label="Entity type"
            value={seller.entityType ? ENTITY_LABELS[seller.entityType] ?? seller.entityType : '—'}
          />
          <InfoRow label="GST registration type" value={seller.gstRegistrationType || '—'} />
          <InfoRow label="GSTIN" value={seller.gstin || '— (not submitted)'} />
          <InfoRow label="GST state code" value={seller.gstStateCode || '—'} />
          <InfoRow label="PAN" value={seller.panLast4 ? `XXXXXX${seller.panLast4}` : '—'} />
          <InfoRow label="GST verified" value={seller.isGstVerified ? 'Yes' : 'No'} />
          <InfoRow
            label="Registered address"
            value={(() => {
              const j = seller.registeredBusinessAddressJson;
              if (!j) return '—';
              return (
                [j.line1, j.line2, j.locality, j.city, j.state, j.pincode]
                  .filter(Boolean)
                  .join(', ') || '—'
              );
            })()}
          />
        </div>

        {/* Bank Account */}
        <div className="profile-card">
          <div className="profile-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2>Bank Account</h2>
              <p>Settlement payout account (masked)</p>
            </div>
            <button
              type="button"
              onClick={() => setActiveModal('editbank')}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600,
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                background: '#fff', cursor: 'pointer', color: 'var(--primary, #2563eb)',
                whiteSpace: 'nowrap',
              }}
            >
              {seller.hasBankDetails ? 'Edit' : 'Add'}
            </button>
          </div>
          {seller.hasBankDetails ? (
            <>
              <InfoRow label="Bank name" value={seller.bankName || '—'} />
              <InfoRow label="Account holder" value={seller.bankAccountHolderName || '—'} />
              <InfoRow
                label="Account number"
                value={seller.bankAccountLast4 ? `••••••${seller.bankAccountLast4}` : '—'}
              />
              <InfoRow label="IFSC" value={seller.bankIfscCode || '—'} />
            </>
          ) : (
            <InfoRow label="Bank account" value="Not provided yet" />
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
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm('Suspend ALL active mappings for this seller? They will be hidden from allocation until reactivated.')) {
                  return;
                }
                try {
                  await apiClient(`/admin/sellers/${sellerId}/suspend-mappings`, { method: 'POST' });
                  await fetchProductMappings();
                } catch (e) {
                  alert((e as Error).message || 'Suspend failed');
                }
              }}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600,
                border: '1px solid #fecaca', borderRadius: 'var(--radius)',
                background: '#fff', cursor: 'pointer', color: '#991b1b',
              }}
            >
              Suspend all mappings
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm('Re-activate ALL suspended mappings for this seller?')) {
                  return;
                }
                try {
                  await apiClient(`/admin/sellers/${sellerId}/activate-mappings`, { method: 'POST' });
                  await fetchProductMappings();
                } catch (e) {
                  alert((e as Error).message || 'Activate failed');
                }
              }}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600,
                border: '1px solid #bbf7d0', borderRadius: 'var(--radius)',
                background: '#fff', cursor: 'pointer', color: '#15803d',
              }}
            >
              Re-activate all
            </button>
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
      {activeModal === 'kyc' && sellerListItem && (
        <KycReviewModal seller={sellerListItem} onClose={closeModal} onSuccess={onActionComplete} />
      )}
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
      {activeModal === 'editbank' && sellerListItem && (
        <EditBankModal
          seller={sellerListItem}
          initial={{
            bankName: seller.bankName,
            accountHolderName: seller.bankAccountHolderName,
            accountLast4: seller.bankAccountLast4,
            ifscCode: seller.bankIfscCode,
          }}
          onClose={closeModal}
          onSuccess={onActionComplete}
        />
      )}
      {activeModal === 'impersonate' && sellerListItem && (
        <ImpersonateModal seller={sellerListItem} onClose={closeModal} />
      )}
    </div>
  );
}

const ACTION_ICONS = {
  kyc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  status: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  ),
  message: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  ),
  password: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  logistics: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 18.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </svg>
  ),
  impersonate: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  delete: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  ),
};

function ActionBtn({
  label,
  onClick,
  icon,
  variant = 'secondary',
}: {
  label: string;
  onClick: () => void;
  icon?: keyof typeof ACTION_ICONS;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`sa-action sa-action--${variant}`}
    >
      {icon && <span className="sa-action__icon">{ACTION_ICONS[icon]}</span>}
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
