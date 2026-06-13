'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  adminFranchisesService,
  FranchiseDetail,
  FranchiseListItem,
  FranchiseCatalogMapping,
  FranchiseInventoryItem,
  FranchiseOrderItem,
  FranchisePosSale,
} from '@/services/admin-franchises.service';
import { useModal } from '@sportsmart/ui';
import { apiClient, ApiError } from '@/lib/api-client';
import {
  validateGSTIN,
  validatePAN,
  validateIndianMobile,
  validateRequiredName,
  validatePincode,
} from '@/lib/validators';
import FranchiseStatusModal from '../components/franchise-status-modal';
import { ShipmentPanel } from './_components/ShipmentPanel';
import FranchiseVerificationModal from '../components/franchise-verification-modal';
import FranchiseCommissionModal from '../components/franchise-commission-modal';
import ApproveCatalogMappingModal from '../components/approve-catalog-mapping-modal';
import StopCatalogMappingModal from '../components/stop-catalog-mapping-modal';
import SendMessageModal from '../components/send-message-modal';
import ChangePasswordModal from '../components/change-password-modal';
import ImpersonateModal from '../components/impersonate-modal';
import DeleteFranchiseModal from '../components/delete-franchise-modal';
import CreatePenaltyModal from '../components/create-penalty-modal';
import CreateAdjustmentModal from '../components/create-adjustment-modal';
import '../franchises.css';

type ModalType = 'status' | 'verification' | 'commission' | 'approve-mapping' | 'stop-mapping' | 'message' | 'password' | 'impersonate' | 'delete' | 'penalty' | 'adjustment' | null;
type TabKey = 'profile' | 'location' | 'catalog' | 'inventory' | 'orders' | 'commission' | 'finance' | 'settlements' | 'pos' | 'tax';

interface FranchiseTaxSummary {
  franchise: {
    id: string;
    franchiseCode: string;
    businessName: string;
    gstNumber: string | null;
    panNumber: string | null;
    state: string | null;
  };
  totals: {
    documentCount: number;
    taxableAmountInPaise: string;
    cgstAmountInPaise: string;
    sgstAmountInPaise: string;
    igstAmountInPaise: string;
    totalTaxAmountInPaise: string;
    documentTotalInPaise: string;
  };
  recentDocuments: Array<{
    id: string;
    documentNumber: string;
    documentType: string;
    financialYear: string;
    generatedAt: string;
    status: string;
    documentTotalInPaise: string;
    totalTaxAmountInPaise: string;
    buyerLegalName: string | null;
  }>;
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'PENDING': return 'status-badge pending';
    case 'APPROVED': return 'status-badge approved';
    case 'ACTIVE': return 'status-badge active';
    case 'SUSPENDED': return 'status-badge suspended';
    case 'DEACTIVATED': return 'status-badge deactivated';
    default: return 'status-badge';
  }
}

function getVerificationBadgeClass(status: string): string {
  switch (status) {
    case 'NOT_VERIFIED': return 'verification-badge not-verified';
    case 'UNDER_REVIEW': return 'verification-badge under-review';
    case 'VERIFIED': return 'verification-badge verified';
    case 'REJECTED': return 'verification-badge rejected';
    default: return 'verification-badge';
  }
}

function formatStatus(s: string): string {
  return s.replace(/_/g, ' ');
}

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString();
}

function formatDateTime(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(d).toLocaleString();
}

function getMappingStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'pending') return 'mapping-status-badge pending';
  if (s === 'approved' || s === 'active') return 'mapping-status-badge approved';
  if (s === 'stopped' || s === 'rejected') return 'mapping-status-badge stopped';
  return 'mapping-status-badge';
}

export default function AdminFranchiseDetailPage() {
  const { notify, confirmDialog } = useModal();
  const router = useRouter();
  const params = useParams();
  const franchiseId = params.id as string;

  const [franchise, setFranchise] = useState<FranchiseDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>('profile');
  const [activeModal, setActiveModal] = useState<ModalType>(null);

  // Catalog
  const [catalog, setCatalog] = useState<FranchiseCatalogMapping[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedMapping, setSelectedMapping] = useState<FranchiseCatalogMapping | null>(null);

  // Inventory
  const [inventory, setInventory] = useState<FranchiseInventoryItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  // Orders
  const [orders, setOrders] = useState<FranchiseOrderItem[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  // Cancel sub-order — parity with the other admin panels.
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelOrderStatus, setCancelOrderStatus] = useState<string>('');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  // SHIPPED (in-transit) cancels need force=true server-side.
  const [forceAck, setForceAck] = useState(false);

  // Finance ledger
  const [financeLedger, setFinanceLedger] = useState<any[]>([]);
  const [financeLoading, setFinanceLoading] = useState(false);

  // Settlements
  const [settlements, setSettlements] = useState<any[]>([]);
  const [settlementsLoading, setSettlementsLoading] = useState(false);

  // POS Sales
  const [posSales, setPosSales] = useState<FranchisePosSale[]>([]);
  const [posLoading, setPosLoading] = useState(false);

  // Tax oversight
  const [taxSummary, setTaxSummary] = useState<FranchiseTaxSummary | null>(null);
  const [taxLoading, setTaxLoading] = useState(false);
  const [taxError, setTaxError] = useState<string | null>(null);

  const fetchTaxSummary = useCallback(async () => {
    setTaxLoading(true);
    setTaxError(null);
    try {
      const res = await apiClient<FranchiseTaxSummary>(
        `/admin/franchises/${franchiseId}/tax-summary`,
      );
      if (res.data) setTaxSummary(res.data);
    } catch (err) {
      setTaxError(
        err instanceof ApiError ? err.message : 'Failed to load tax summary',
      );
    } finally {
      setTaxLoading(false);
    }
  }, [franchiseId]);

  // Profile edit state
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editSuccess, setEditSuccess] = useState('');

  // Pincode lookup state — business address
  type PincodeData = {
    district: string;
    state: string;
    places: { name: string; type: string; delivery: string }[];
  };
  const AUTO_FILLED_STYLE: React.CSSProperties = { background: '#f0fdf4', borderColor: '#86efac' };

  const [pincodeData, setPincodeData] = useState<PincodeData | null>(null);
  const [pincodeLoading, setPincodeLoading] = useState(false);
  const [pincodeError, setPincodeError] = useState('');
  const [pincodeAutoFilled, setPincodeAutoFilled] = useState(false);

  const [whPincodeData, setWhPincodeData] = useState<PincodeData | null>(null);
  const [whPincodeLoading, setWhPincodeLoading] = useState(false);
  const [whPincodeError, setWhPincodeError] = useState('');
  const [whPincodeAutoFilled, setWhPincodeAutoFilled] = useState(false);

  async function doPincodeLookup(
    pincode: string,
    target: 'business' | 'warehouse',
  ) {
    const setData = target === 'business' ? setPincodeData : setWhPincodeData;
    const setLoading = target === 'business' ? setPincodeLoading : setWhPincodeLoading;
    const setErr = target === 'business' ? setPincodeError : setWhPincodeError;
    const setAuto = target === 'business' ? setPincodeAutoFilled : setWhPincodeAutoFilled;

    if (pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
      setData(null);
      setErr('');
      setAuto(false);
      return;
    }

    setLoading(true);
    setErr('');
    try {
      const data = await apiClient<any>(`/pincodes/${pincode}`);

      if (data.success && data.data) {
        setData(data.data);
        setAuto(true);
        setEditForm((prev) =>
          target === 'business'
            ? { ...prev, city: data.data.district, state: data.data.state }
            // Warehouse has no separate city/state columns on the backend;
            // the pincode + green hint is enough to visually confirm.
            : prev,
        );
      } else {
        setErr('Invalid pincode');
        setData(null);
        setAuto(false);
      }
    } catch {
      setErr('Failed to lookup pincode');
      setData(null);
      setAuto(false);
    } finally {
      setLoading(false);
    }
  }

  const initEditForm = (f: FranchiseDetail) => {
    setEditForm({
      ownerName: f.ownerName || '',
      businessName: f.businessName || '',
      phoneNumber: f.phoneNumber || '',
      gstNumber: f.gstNumber || '',
      panNumber: f.panNumber || '',
      address: f.address || '',
      city: f.city || '',
      state: f.state || '',
      pincode: f.pincode || '',
      country: f.country || '',
      locality: f.locality || '',
      warehouseAddress: f.warehouseAddress || '',
      warehousePincode: f.warehousePincode || '',
    });
  };

  const handleEditSave = async () => {if (!franchise) return;
    // Phase 252 — validate KYC fields before persisting. GST/PAN drive §52 TCS /
    // §194-O TDS + tax invoices, so a malformed value must not overwrite the
    // live record. Name/phone required; GST/PAN validated only when provided.
    const gst = (editForm.gstNumber ?? '').trim();
    const pan = (editForm.panNumber ?? '').trim();
    const pincode = (editForm.pincode ?? '').trim();
    const warehousePincode = (editForm.warehousePincode ?? '').trim();
    const validationError =
      validateRequiredName(editForm.ownerName ?? '', 'Owner name') ||
      validateRequiredName(editForm.businessName ?? '', 'Business name') ||
      validateIndianMobile(editForm.phoneNumber ?? '') ||
      (gst ? validateGSTIN(gst) : null) ||
      (pan ? validatePAN(pan) : null) ||
      (pincode ? validatePincode(pincode) : null) ||
      (warehousePincode ? validatePincode(warehousePincode) : null);
    if (validationError) {
      void notify(validationError);
      return;
    }
    setEditSaving(true);
    try {
      await adminFranchisesService.editFranchise(franchise.id, editForm);
      setEditSuccess('Profile updated successfully');
      setEditMode(false);
      setTimeout(() => setEditSuccess(''), 3000);
      await fetchFranchiseRef();
    } catch (err) {
      void notify(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setEditSaving(false);
    }
  };

  // We need a stable ref for fetchFranchise since it's defined below
  const fetchFranchiseRef = async () => { await fetchFranchise(); };

  const fetchFranchise = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const res = await adminFranchisesService.getFranchise(franchiseId);
      if (res.data) {
        setFranchise(res.data);
        initEditForm(res.data);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setFetchError(err instanceof ApiError ? err.message : 'Failed to load franchise details');
    } finally {
      setIsLoading(false);
    }
  }, [franchiseId, router]);

  const fetchCatalog = useCallback(async () => {
    if (!franchiseId) return;
    setCatalogLoading(true);
    try {
      const res = await adminFranchisesService.listCatalog({ franchiseId, limit: 100 });
      if (res.data?.mappings) {
        setCatalog(res.data.mappings);
      }
    } catch {
      // Non-critical
    } finally {
      setCatalogLoading(false);
    }
  }, [franchiseId]);

  const fetchInventory = useCallback(async () => {
    if (!franchiseId) return;
    setInventoryLoading(true);
    try {
      const res = await adminFranchisesService.getInventory(franchiseId);
      if (res.data?.inventory) {
        setInventory(res.data.inventory);
      } else if (Array.isArray((res.data as unknown) as FranchiseInventoryItem[])) {
        setInventory((res.data as unknown) as FranchiseInventoryItem[]);
      }
    } catch {
      // Non-critical
    } finally {
      setInventoryLoading(false);
    }
  }, [franchiseId]);

  const fetchOrders = useCallback(async () => {
    if (!franchiseId) return;
    setOrdersLoading(true);
    try {
      const res = await adminFranchisesService.listFranchiseOrders(franchiseId, { limit: 50 });
      // The API returns RAW sub-order rows under `subOrders` (nested
      // masterOrder + items), NOT a flat `orders` array. Flatten to the
      // FranchiseOrderItem shape the table renders. (This previously read
      // res.data.orders — which never existed — so the Orders tab always
      // showed "No orders yet.")
      const rows = res.data?.subOrders ?? [];
      setOrders(
        rows.map((so): FranchiseOrderItem => ({
          id: so.id,
          orderNumber: so.masterOrder?.orderNumber ?? '—',
          customerName:
            so.masterOrder?.shippingAddressSnapshot?.fullName ??
            so.masterOrder?.shippingAddressSnapshot?.name ??
            '—',
          status: so.fulfillmentStatus ?? '—',
          totalAmount: Number(so.subTotal ?? 0),
          itemsCount: Array.isArray(so.items) ? so.items.length : 0,
          createdAt: so.createdAt,
        })),
      );
    } catch {
      // Non-critical
    } finally {
      setOrdersLoading(false);
    }
  }, [franchiseId]);

  const submitCancel = async () => {
    if (!cancelOrderId || cancelling) return;
    const trimmed = cancelReason.trim();
    if (trimmed.length < 10) {
      setCancelError('Cancellation reason is required (minimum 10 characters)');
      return;
    }
    setCancelError('');
    setCancelling(true);
    const needsForce = cancelOrderStatus === 'SHIPPED' || cancelOrderStatus === 'FULFILLED';
    try {
      await adminFranchisesService.cancelOrder(cancelOrderId, trimmed, needsForce);
      setCancelOrderId(null);
      setCancelOrderStatus('');
      setForceAck(false);
      setCancelReason('');
      fetchOrders();
    } catch (err: any) {
      setCancelError(err?.body?.message || err?.message || 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  const fetchFinanceLedger = useCallback(async () => {
    if (!franchiseId) return;
    setFinanceLoading(true);
    try {
      const res = await adminFranchisesService.getFinanceLedger(franchiseId, { limit: 50 });
      const d = res.data as any;
      if (d?.entries) setFinanceLedger(d.entries);
      else if (Array.isArray(d)) setFinanceLedger(d);
    } catch { /* non-critical */ }
    finally { setFinanceLoading(false); }
  }, [franchiseId]);

  const fetchSettlements = useCallback(async () => {
    if (!franchiseId) return;
    setSettlementsLoading(true);
    try {
      const res = await adminFranchisesService.listSettlements({ franchiseId, limit: 50 });
      const d = res.data as any;
      if (d?.settlements) setSettlements(d.settlements);
      else if (Array.isArray(d)) setSettlements(d);
    } catch { /* non-critical */ }
    finally { setSettlementsLoading(false); }
  }, [franchiseId]);

  const fetchPosSales = useCallback(async () => {
    if (!franchiseId) return;
    setPosLoading(true);
    try {
      const res = await adminFranchisesService.getPosSales(franchiseId, { limit: 50 });
      const d = res.data as any;
      if (d?.sales) setPosSales(d.sales);
      else if (Array.isArray(d)) setPosSales(d);
    } catch { /* non-critical */ }
    finally { setPosLoading(false); }
  }, [franchiseId]);

  useEffect(() => {
    fetchFranchise();
  }, [fetchFranchise]);

  useEffect(() => {
    if (!franchiseId) return;
    if (activeTab === 'catalog') fetchCatalog();
    if (activeTab === 'inventory') fetchInventory();
    if (activeTab === 'orders') fetchOrders();
    if (activeTab === 'finance') fetchFinanceLedger();
    if (activeTab === 'settlements') fetchSettlements();
    if (activeTab === 'pos') fetchPosSales();
    if (activeTab === 'tax') fetchTaxSummary();
  }, [activeTab, franchiseId, fetchCatalog, fetchInventory, fetchOrders, fetchFinanceLedger, fetchSettlements, fetchPosSales, fetchTaxSummary]);

  const closeModal = () => {
    setActiveModal(null);
    setSelectedMapping(null);
  };

  const onActionComplete = () => {
    closeModal();
    fetchFranchise();
  };

  const onCatalogActionComplete = () => {
    closeModal();
    fetchCatalog();
  };

  // Convert to list item for modals
  const franchiseListItem: FranchiseListItem | null = franchise
    ? {
        id: franchise.id,
        franchiseCode: franchise.franchiseCode,
        ownerName: franchise.ownerName,
        businessName: franchise.businessName,
        email: franchise.email,
        phoneNumber: franchise.phoneNumber,
        status: franchise.status,
        verificationStatus: franchise.verificationStatus,
        state: franchise.state,
        city: franchise.city,
        profileCompletionPercentage: franchise.profileCompletionPercentage,
        isEmailVerified: franchise.isEmailVerified,
        createdAt: franchise.createdAt,
      }
    : null;

  if (isLoading) {
    return (
      <div className="franchise-detail-page">
        <div className="franchises-loading">Loading franchise details...</div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="franchise-detail-page">
        <div className="franchises-error">
          <p>{fetchError}</p>
          <button onClick={fetchFranchise}>Try Again</button>
        </div>
      </div>
    );
  }

  if (!franchise || !franchiseListItem) return null;

  return (
    <div className="franchise-detail-page">
      <div style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="back-btn"
          onClick={() => router.push('/dashboard/franchises')}
        >
          &larr; Back to Franchises
        </button>
      </div>

      {/* Header */}
      <div className="franchise-detail-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="code">{franchise.franchiseCode}</span>
          <h1 style={{ margin: 0 }}>{franchise.businessName}</h1>
          <span className={getStatusBadgeClass(franchise.status)}>
            {formatStatus(franchise.status)}
          </span>
          <span className={getVerificationBadgeClass(franchise.verificationStatus)}>
            {formatStatus(franchise.verificationStatus)}
          </span>
          {/* Quick link to delivery-method entitlements (Self Delivery) */}
          <button
            type="button"
            onClick={() => router.push(`/dashboard/franchises/${franchise.id}/delivery-methods`)}
            style={{
              marginLeft: 'auto',
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              color: '#1e3a8a',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 999,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span aria-hidden="true">🚚</span>
            Delivery Methods
          </button>
          {/* Logistics partners (courier registration). The Settings panel
              reads the entity id from ?sellerId=, so we pass the franchise id. */}
          <button
            type="button"
            onClick={() => router.push(`/dashboard/settings?sellerId=${franchise.id}`)}
            style={{
              marginLeft: 8,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              color: '#1e3a8a',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 999,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span aria-hidden="true">📦</span>
            Logistics Partners
          </button>
        </div>
        <p className="subtitle" style={{ marginTop: 6 }}>
          Owned by {franchise.ownerName} &middot; {franchise.email} &middot; {franchise.phoneNumber}
        </p>
      </div>

      <div className="franchise-detail-layout">
        <div className="franchise-detail-main">
          {/* Tabs */}
          <div className="franchise-tabs">
            <TabBtn label="Profile" tab="profile" active={activeTab} setActive={setActiveTab} />
            <TabBtn label="Location" tab="location" active={activeTab} setActive={setActiveTab} />
            <TabBtn label="Catalog" tab="catalog" active={activeTab} setActive={setActiveTab} />
            <TabBtn label="Inventory" tab="inventory" active={activeTab} setActive={setActiveTab} />
            <TabBtn label="Orders" tab="orders" active={activeTab} setActive={setActiveTab} />
            <TabBtn label="Commission" tab="commission" active={activeTab} setActive={setActiveTab} />
            <TabBtn label="Finance" tab="finance" active={activeTab} setActive={setActiveTab} />
            <TabBtn label="Settlements" tab="settlements" active={activeTab} setActive={setActiveTab} />
            <TabBtn label="POS" tab="pos" active={activeTab} setActive={setActiveTab} />
            <TabBtn label="Tax / GST" tab="tax" active={activeTab} setActive={setActiveTab} />
          </div>

          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <>
              {editSuccess && (
                <div className="alert alert-success" style={{ marginBottom: 16 }}>{editSuccess}</div>
              )}

              <div className="franchise-card">
                <div className="franchise-card-header">
                  <div>
                    <h2>Owner Information</h2>
                    <p>Primary contact and owner details</p>
                  </div>
                  {!editMode && (
                    <button className="btn btn-secondary" style={{ fontSize: 13 }} onClick={() => setEditMode(true)}>
                      Edit Profile
                    </button>
                  )}
                </div>
                {editMode ? (
                  <div className="info-grid">
                    <div className="form-group">
                      <label>Owner Name</label>
                      <input value={editForm.ownerName || ''} onChange={e => setEditForm(p => ({ ...p, ownerName: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input value={franchise.email} disabled style={{ background: '#f3f4f6' }} />
                    </div>
                    <div className="form-group">
                      <label>Phone</label>
                      <input value={editForm.phoneNumber || ''} onChange={e => setEditForm(p => ({ ...p, phoneNumber: e.target.value }))} />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="info-grid">
                      <InfoItem label="Owner Name" value={franchise.ownerName} />
                      <InfoItem label="Email" value={franchise.email} />
                      <InfoItem label="Phone" value={franchise.phoneNumber} />
                      <InfoItem label="Email Verified" value={franchise.isEmailVerified ? 'Yes' : 'No'} />
                    </div>
                    <div className="profile-completion-inline" style={{ marginTop: 16 }}>
                      <div className="completion-header">
                        <span className="info-label">Profile Completion</span>
                        <span className="completion-percent">
                          {franchise.profileCompletionPercentage}%
                        </span>
                      </div>
                      <div className="completion-bar">
                        <div className="completion-track">
                          <div
                            className={`completion-fill ${
                              franchise.profileCompletionPercentage >= 80
                                ? 'high'
                                : franchise.profileCompletionPercentage >= 40
                                  ? 'medium'
                                  : 'low'
                            }`}
                            style={{ width: `${franchise.profileCompletionPercentage}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="franchise-card">
                <div className="franchise-card-header">
                  <div>
                    <h2>Business Details</h2>
                    <p>Legal and tax information</p>
                  </div>
                </div>
                {editMode ? (
                  <div className="info-grid">
                    <div className="form-group">
                      <label>Business Name</label>
                      <input value={editForm.businessName || ''} onChange={e => setEditForm(p => ({ ...p, businessName: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label>Franchise Code</label>
                      <input value={franchise.franchiseCode} disabled style={{ background: '#f3f4f6' }} />
                    </div>
                    <div className="form-group">
                      <label>GST Number</label>
                      <input value={editForm.gstNumber || ''} onChange={e => setEditForm(p => ({ ...p, gstNumber: e.target.value }))} placeholder="Enter GST number" />
                    </div>
                    <div className="form-group">
                      <label>PAN Number</label>
                      <input value={editForm.panNumber || ''} onChange={e => setEditForm(p => ({ ...p, panNumber: e.target.value }))} placeholder="Enter PAN number" />
                    </div>
                  </div>
                ) : (
                  <div className="info-grid">
                    <InfoItem label="Business Name" value={franchise.businessName} />
                    <InfoItem label="Franchise Code" value={franchise.franchiseCode} />
                    <InfoItem label="GST Number" value={franchise.gstNumber} />
                    <InfoItem label="PAN Number" value={franchise.panNumber} />
                  </div>
                )}
                {/* Phase 254 — §194-O TDS rate is driven by KYC verification:
                    an unverified franchise (or one without a PAN) is withheld at
                    the §206AA 5% penalty; a VERIFIED franchise with a PAN on file
                    drops to the configured rate (e.g. 1%). Mirrors the seller-side
                    PAN-verify card (franchises have no separate panVerified flag —
                    the overall verificationStatus is the §206AA signal). */}
                {!editMode && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: 12,
                      borderRadius: 8,
                      border: '1px solid',
                      ...(franchise.verificationStatus === 'VERIFIED' && franchise.panNumber
                        ? { background: '#ECFDF5', borderColor: '#A7F3D0', color: '#065F46' }
                        : { background: '#FFFBEB', borderColor: '#FDE68A', color: '#92400E' }),
                    }}
                  >
                    {franchise.verificationStatus === 'VERIFIED' && franchise.panNumber ? (
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        ✓ Section&nbsp;194-O TDS: your configured rate (e.g. 1%). This
                        franchise&apos;s KYC is VERIFIED with a PAN on file — no §206AA penalty.
                      </span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          ⚠ Section&nbsp;194-O TDS: 5% (§206AA penalty).{' '}
                          {franchise.panNumber
                            ? 'Verify this franchise’s KYC to drop TDS to your configured rate (e.g. 1%).'
                            : 'A PAN must be on file before verification can reduce the rate.'}
                        </span>
                        {franchise.panNumber && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => setActiveModal('verification')}
                            style={{ padding: '6px 12px', fontSize: 13 }}
                          >
                            Verify KYC
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {editMode && (
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                  <button className="btn btn-secondary" onClick={() => { setEditMode(false); if (franchise) initEditForm(franchise); }} disabled={editSaving}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={handleEditSave} disabled={editSaving}>
                    {editSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              )}

              {!editMode && (
                <div className="franchise-card">
                  <div className="franchise-card-header">
                    <div>
                      <h2>Contract</h2>
                      <p>Contract timeline</p>
                    </div>
                  </div>
                  <div className="info-grid">
                    <InfoItem label="Contract Start" value={formatDate(franchise.contractStartDate)} />
                    <InfoItem label="Contract End" value={formatDate(franchise.contractEndDate)} />
                    <InfoItem label="Created" value={formatDateTime(franchise.createdAt)} />
                    <InfoItem label="Last Login" value={formatDateTime(franchise.lastLoginAt)} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Location Tab */}
          {activeTab === 'location' && (
            <>
              <div className="franchise-card">
                <div className="franchise-card-header">
                  <div>
                    <h2>Business Address</h2>
                    <p>Registered office address</p>
                  </div>
                  {!editMode && (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 13 }}
                      onClick={() => {
                        setEditMode(true);
                        if (editForm.pincode) doPincodeLookup(editForm.pincode, 'business');
                        if (editForm.warehousePincode) doPincodeLookup(editForm.warehousePincode, 'warehouse');
                      }}
                    >
                      Edit Location
                    </button>
                  )}
                </div>
                {editMode ? (
                  <div className="info-grid">
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                      <label>Address</label>
                      <textarea
                        rows={2}
                        value={editForm.address || ''}
                        onChange={e => setEditForm(p => ({ ...p, address: e.target.value }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Pincode</label>
                      <input
                        value={editForm.pincode || ''}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6-digit pincode"
                        onChange={e => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setEditForm(p => ({ ...p, pincode: val }));
                          doPincodeLookup(val, 'business');
                        }}
                      />
                      {pincodeLoading && <small style={{ color: '#6b7280' }}>Looking up pincode…</small>}
                      {pincodeError && <small style={{ color: '#dc2626' }}>{pincodeError}</small>}
                      {pincodeData && !pincodeError && !pincodeLoading && (
                        <small style={{ color: '#16a34a' }}>
                          {pincodeData.district}, {pincodeData.state}
                        </small>
                      )}
                    </div>
                    <div className="form-group">
                      <label>Country</label>
                      <input
                        value={editForm.country || ''}
                        onChange={e => setEditForm(p => ({ ...p, country: e.target.value }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>City / District</label>
                      <input
                        value={editForm.city || ''}
                        readOnly={pincodeAutoFilled}
                        style={pincodeAutoFilled ? AUTO_FILLED_STYLE : undefined}
                        onChange={e => {
                          setEditForm(p => ({ ...p, city: e.target.value }));
                          if (pincodeAutoFilled) setPincodeAutoFilled(false);
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label>State</label>
                      <input
                        value={editForm.state || ''}
                        readOnly={pincodeAutoFilled}
                        style={pincodeAutoFilled ? AUTO_FILLED_STYLE : undefined}
                        onChange={e => {
                          setEditForm(p => ({ ...p, state: e.target.value }));
                          if (pincodeAutoFilled) setPincodeAutoFilled(false);
                        }}
                      />
                    </div>
                    {pincodeData && pincodeData.places && pincodeData.places.length > 0 && (
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label>Locality</label>
                        <select
                          value={editForm.locality || ''}
                          onChange={e => setEditForm(p => ({ ...p, locality: e.target.value }))}
                        >
                          <option value="">Select your locality</option>
                          {pincodeData.places.map((place, idx) => (
                            <option key={idx} value={place.name}>
                              {place.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="info-grid">
                    <InfoItem label="Address" value={franchise.address} />
                    <InfoItem label="Pincode" value={franchise.pincode} />
                    <InfoItem label="Country" value={franchise.country} />
                    <InfoItem label="City / District" value={franchise.city} />
                    <InfoItem label="State" value={franchise.state} />
                    <InfoItem label="Locality" value={franchise.locality} />
                  </div>
                )}
              </div>

              <div className="franchise-card">
                <div className="franchise-card-header">
                  <div>
                    <h2>Warehouse</h2>
                    <p>Warehouse and fulfillment location</p>
                  </div>
                </div>
                {editMode ? (
                  <div className="info-grid">
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                      <label>Warehouse Address</label>
                      <textarea
                        rows={2}
                        value={editForm.warehouseAddress || ''}
                        onChange={e => setEditForm(p => ({ ...p, warehouseAddress: e.target.value }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Warehouse Pincode</label>
                      <input
                        value={editForm.warehousePincode || ''}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6-digit pincode"
                        onChange={e => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setEditForm(p => ({ ...p, warehousePincode: val }));
                          doPincodeLookup(val, 'warehouse');
                        }}
                      />
                      {whPincodeLoading && <small style={{ color: '#6b7280' }}>Looking up pincode…</small>}
                      {whPincodeError && <small style={{ color: '#dc2626' }}>{whPincodeError}</small>}
                      {whPincodeData && !whPincodeError && !whPincodeLoading && (
                        <small style={{ color: '#16a34a' }}>
                          {whPincodeData.district}, {whPincodeData.state}
                        </small>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="info-grid">
                    <InfoItem label="Warehouse Address" value={franchise.warehouseAddress} />
                    <InfoItem label="Warehouse Pincode" value={franchise.warehousePincode} />
                  </div>
                )}
              </div>

              {editMode && (
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setEditMode(false);
                      if (franchise) initEditForm(franchise);
                      setPincodeData(null); setPincodeError(''); setPincodeAutoFilled(false);
                      setWhPincodeData(null); setWhPincodeError(''); setWhPincodeAutoFilled(false);
                    }}
                    disabled={editSaving}
                  >
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={handleEditSave} disabled={editSaving}>{editSaving ? 'Saving...' : 'Save Changes'}</button>
                </div>
              )}

              {!editMode && (
                <div className="franchise-card">
                  <div className="franchise-card-header">
                    <div>
                      <h2>Assigned Zone</h2>
                      <p>Delivery zone assigned to this franchise</p>
                    </div>
                  </div>
                  <div className="info-grid">
                    <InfoItem label="Zone" value={franchise.assignedZone} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Catalog Tab */}
          {activeTab === 'catalog' && (
            <div className="franchise-card">
              <div className="franchise-card-header">
                <div>
                  <h2>Catalog Mappings</h2>
                  <p>Products this franchise can fulfill</p>
                </div>
                <button
                  className="sidebar-action-btn"
                  style={{ width: 'auto', margin: 0 }}
                  onClick={fetchCatalog}
                  disabled={catalogLoading}
                >
                  {catalogLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>

              {catalogLoading && catalog.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  Loading catalog...
                </p>
              ) : catalog.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  No catalog mappings yet.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="catalog-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>SKU</th>
                        <th>Status</th>
                        <th style={{ width: 180 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {catalog.map(m => (
                        <tr key={m.id}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{m.product?.title || '\u2014'}</div>
                            {m.product?.productCode && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: 'var(--color-text-secondary)',
                                  marginTop: 2,
                                }}
                              >
                                {m.product.productCode}
                              </div>
                            )}
                          </td>
                          <td style={{ color: 'var(--color-text-secondary)' }}>
                            {m.variant?.masterSku || m.sku || '\u2014'}
                          </td>
                          <td>
                            <span className={getMappingStatusClass(m.approvalStatus)}>
                              {formatStatus(m.approvalStatus)}
                            </span>
                          </td>
                          <td>
                            <button
                              className="mapping-action-btn approve"
                              onClick={() => {
                                setSelectedMapping(m);
                                setActiveModal('approve-mapping');
                              }}
                            >
                              Approve
                            </button>
                            <button
                              className="mapping-action-btn stop"
                              onClick={() => {
                                setSelectedMapping(m);
                                setActiveModal('stop-mapping');
                              }}
                            >
                              Stop
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Inventory Tab */}
          {activeTab === 'inventory' && (
            <div className="franchise-card">
              <div className="franchise-card-header">
                <div>
                  <h2>Franchise Stock</h2>
                  <p>Current inventory summary</p>
                </div>
                <button
                  className="sidebar-action-btn"
                  style={{ width: 'auto', margin: 0 }}
                  onClick={() => setActiveTab('finance')}
                >
                  View Finance Ledger
                </button>
              </div>

              {inventoryLoading && inventory.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  Loading inventory...
                </p>
              ) : inventory.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  No stock records yet.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="catalog-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>SKU</th>
                        <th style={{ textAlign: 'right' }}>Stock</th>
                        <th style={{ textAlign: 'right' }}>Reserved</th>
                        <th style={{ textAlign: 'right' }}>Available</th>
                        <th style={{ textAlign: 'right' }}>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventory.map(i => (
                        <tr key={i.id}>
                          <td style={{ fontWeight: 500 }}>{i.productTitle}</td>
                          <td style={{ color: 'var(--color-text-secondary)' }}>
                            {i.sku || '\u2014'}
                          </td>
                          <td style={{ textAlign: 'right' }}>{i.stockQty}</td>
                          <td style={{ textAlign: 'right' }}>{i.reservedQty}</td>
                          <td style={{ textAlign: 'right', fontWeight: 500 }}>{i.availableQty}</td>
                          <td
                            style={{
                              textAlign: 'right',
                              color: 'var(--color-text-secondary)',
                              fontSize: 12,
                            }}
                          >
                            {formatDate(i.updatedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Orders Tab */}
          {activeTab === 'orders' && (
            <div className="franchise-card">
              <div className="franchise-card-header">
                <div>
                  <h2>Franchise Orders</h2>
                  <p>Recent orders fulfilled by this franchise</p>
                </div>
                <button
                  className="sidebar-action-btn"
                  style={{ width: 'auto', margin: 0 }}
                  onClick={fetchOrders}
                  disabled={ordersLoading}
                >
                  {ordersLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>

              {ordersLoading && orders.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  Loading orders...
                </p>
              ) : orders.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  No orders yet.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="catalog-table">
                    <thead>
                      <tr>
                        <th>Order #</th>
                        <th>Customer</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Items</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                        <th style={{ textAlign: 'right' }}>Created</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => (
                        <Fragment key={o.id}>
                        <tr>
                          <td style={{ fontFamily: 'monospace', fontWeight: 500 }}>
                            {o.orderNumber}
                          </td>
                          <td>{o.customerName}</td>
                          <td>
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                              background: o.status === 'DELIVERED' ? '#dcfce7' : o.status === 'CANCELLED' ? '#fee2e2' : '#dbeafe',
                              color: o.status === 'DELIVERED' ? '#15803d' : o.status === 'CANCELLED' ? '#991b1b' : '#1d4ed8',
                            }}>
                              {formatStatus(o.status)}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>{o.itemsCount}</td>
                          <td style={{ textAlign: 'right', fontWeight: 500 }}>
                            {'\u20B9'}{o.totalAmount?.toLocaleString?.() || o.totalAmount}
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--color-text-secondary)', fontSize: 12 }}>
                            {formatDate(o.createdAt)}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {o.status !== 'DELIVERED' && o.status !== 'CANCELLED' && (
                              <button
                                className="btn btn-secondary"
                                style={{ fontSize: 11, padding: '4px 10px' }}
                                onClick={async () => {
                                  try {
                                    await adminFranchisesService.markOrderDelivered(o.id);
                                    fetchOrders();
                                  } catch { void notify('Failed to mark delivered'); }
                                }}
                              >
                                Mark Delivered
                              </button>
                            )}
                            {o.status !== 'DELIVERED' &&
                              o.status !== 'CANCELLED' && (
                                <button
                                  className="btn btn-secondary"
                                  style={{
                                    fontSize: 11, padding: '4px 10px', marginLeft: 6,
                                    color: '#dc2626', borderColor: '#fecaca',
                                  }}
                                  onClick={() => {
                                    setCancelOrderId(o.id);
                                    setCancelOrderStatus(o.status);
                                    setCancelReason('');
                                    setCancelError('');
                                    setForceAck(false);
                                  }}
                                >
                                  Cancel
                                </button>
                              )}
                          </td>
                        </tr>
                        {o.status !== 'CANCELLED' && (
                          <tr>
                            <td colSpan={7} style={{ background: '#fafafa' }}>
                              {/* Delhivery carrier-actions panel — track / re-attempt /
                                  cancel shipment / force-RTO. Same component the Super
                                  Admin uses; o.id is the SubOrder id. */}
                              <ShipmentPanel subOrderId={o.id} onChange={fetchOrders} />
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Commission Tab */}
          {activeTab === 'commission' && (
            <div className="franchise-card">
              <div className="franchise-card-header">
                <div>
                  <h2>Commission Rates</h2>
                  <p>Current commission structure for this franchise</p>
                </div>
                <button
                  className="sidebar-action-btn"
                  style={{ width: 'auto', margin: 0 }}
                  onClick={() => setActiveModal('commission')}
                >
                  Edit Rates
                </button>
              </div>
              <div className="info-grid">
                <InfoItem
                  label="Online Fulfillment Rate"
                  value={
                    franchise.onlineFulfillmentRate != null
                      ? `${franchise.onlineFulfillmentRate}%`
                      : '15% (default)'
                  }
                />
                <InfoItem
                  label="Procurement Fee Rate"
                  value={
                    franchise.procurementFeeRate != null
                      ? `${franchise.procurementFeeRate}%`
                      : '5% (default)'
                  }
                />
              </div>
            </div>
          )}

          {/* Finance Tab */}
          {activeTab === 'finance' && (
            <div className="franchise-card">
              <div className="franchise-card-header">
                <div>
                  <h2>Finance Ledger</h2>
                  <p>Commission entries, adjustments, and penalties</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="sidebar-action-btn"
                    style={{ width: 'auto', margin: 0 }}
                    onClick={() => setActiveModal('adjustment')}
                  >
                    Add Adjustment
                  </button>
                  <button
                    className="sidebar-action-btn"
                    style={{ width: 'auto', margin: 0 }}
                    onClick={() => setActiveModal('penalty')}
                  >
                    Add Penalty
                  </button>
                </div>
              </div>
              {financeLoading ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>Loading...</div>
              ) : financeLedger.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
                  No finance entries yet
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Type</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Base Amt</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Computed</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Franchise</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Status</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {financeLedger.map((entry: any) => (
                        <tr key={entry.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: '#eff6ff', color: '#2563eb' }}>
                              {(entry.sourceType || entry.type || '').replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>{'\u20B9'}{Number(entry.baseAmount || entry.amount || 0).toLocaleString('en-IN')}</td>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>{'\u20B9'}{Number(entry.computedAmount || 0).toLocaleString('en-IN')}</td>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace' }}>{'\u20B9'}{Number(entry.franchiseEarning || 0).toLocaleString('en-IN')}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: entry.status === 'SETTLED' ? '#dcfce7' : '#fef3c7', color: entry.status === 'SETTLED' ? '#15803d' : '#92400e' }}>
                              {entry.status}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: 12 }}>{formatDateTime(entry.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Settlements Tab */}
          {activeTab === 'settlements' && (
            <div className="franchise-card">
              <div className="franchise-card-header">
                <div>
                  <h2>Settlements</h2>
                  <p>Payout cycles and settlement history</p>
                </div>
              </div>
              {settlementsLoading ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>Loading...</div>
              ) : settlements.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
                  No settlements yet
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Period</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Amount</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Status</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settlements.map((s: any) => (
                        <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 14px' }}>
                            {formatDate(s.periodStart)} &mdash; {formatDate(s.periodEnd)}
                          </td>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600 }}>
                            {'\u20B9'}{Number(s.totalAmount || s.amount || 0).toLocaleString('en-IN')}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                              background: s.status === 'PAID' ? '#dcfce7' : s.status === 'APPROVED' ? '#dbeafe' : '#fef3c7',
                              color: s.status === 'PAID' ? '#15803d' : s.status === 'APPROVED' ? '#1d4ed8' : '#92400e',
                            }}>
                              {s.status}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {s.status === 'PENDING' && (
                              <button
                                className="btn btn-secondary"
                                style={{ fontSize: 11, padding: '4px 10px' }}
                                onClick={async () => {
                                  try {
                                    await adminFranchisesService.approveSettlement(s.id);
                                    fetchSettlements();
                                  } catch { void notify('Failed to approve'); }
                                }}
                              >
                                Approve
                              </button>
                            )}
                            {s.status === 'APPROVED' && (
                              <button
                                className="btn btn-primary"
                                style={{ fontSize: 11, padding: '4px 10px' }}
                                onClick={async () => {
                                  try {
                                    await adminFranchisesService.markSettlementPaid(s.id);
                                    fetchSettlements();
                                  } catch { void notify('Failed to mark paid'); }
                                }}
                              >
                                Mark Paid
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* POS Sales Tab */}
          {activeTab === 'tax' && (
            <div className="franchise-card">
              <div className="franchise-card-header">
                <div>
                  <h2>Tax / GST</h2>
                  <p>Per-franchise GSTIN, aggregate tax liability, and recent tax documents (invoices, credit notes, etc).</p>
                </div>
              </div>
              {taxLoading ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>Loading tax summary…</div>
              ) : taxError ? (
                <div style={{ padding: 16, background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 13 }}>{taxError}</div>
              ) : !taxSummary ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>No tax data available.</div>
              ) : (
                <>
                  {/* Identity strip — collected on the franchise profile.
                      Surfaced here too so finance ops doesn't have to
                      switch tabs to check the GSTIN before downloading. */}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
                    <TaxIdChip label="GSTIN" value={taxSummary.franchise.gstNumber} warn={!taxSummary.franchise.gstNumber} />
                    <TaxIdChip label="PAN" value={taxSummary.franchise.panNumber} warn={!taxSummary.franchise.panNumber} />
                    <TaxIdChip label="State" value={taxSummary.franchise.state} warn={!taxSummary.franchise.state} />
                    <TaxIdChip label="Franchise Code" value={taxSummary.franchise.franchiseCode} />
                  </div>

                  {/* Aggregate totals across all tax documents issued for
                      this franchise (sales via marketplace fulfilment).
                      POS-only sales don't currently produce TaxDocument
                      rows — that gap is tracked separately. */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
                    <TaxStat label="Documents" value={String(taxSummary.totals.documentCount)} />
                    <TaxStat label="Taxable value" value={formatPaise(taxSummary.totals.taxableAmountInPaise)} />
                    <TaxStat label="CGST" value={formatPaise(taxSummary.totals.cgstAmountInPaise)} />
                    <TaxStat label="SGST" value={formatPaise(taxSummary.totals.sgstAmountInPaise)} />
                    <TaxStat label="IGST" value={formatPaise(taxSummary.totals.igstAmountInPaise)} />
                    <TaxStat label="Total tax" value={formatPaise(taxSummary.totals.totalTaxAmountInPaise)} highlight />
                    <TaxStat label="Doc total" value={formatPaise(taxSummary.totals.documentTotalInPaise)} />
                  </div>

                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: '20px 0 10px' }}>Recent documents</h3>
                  {taxSummary.recentDocuments.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13, background: '#f9fafb', borderRadius: 6 }}>
                      No tax documents issued yet for this franchise.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                            <th style={taxTh}>Document #</th>
                            <th style={taxTh}>Type</th>
                            <th style={taxTh}>FY</th>
                            <th style={taxTh}>Buyer</th>
                            <th style={taxTh}>Generated</th>
                            <th style={{ ...taxTh, textAlign: 'right' }}>Tax</th>
                            <th style={{ ...taxTh, textAlign: 'right' }}>Total</th>
                            <th style={taxTh}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {taxSummary.recentDocuments.map((d) => (
                            <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td style={{ ...taxTd, fontFamily: 'monospace', fontSize: 12 }}>{d.documentNumber}</td>
                              <td style={taxTd}>{d.documentType.replace(/_/g, ' ')}</td>
                              <td style={taxTd}>{d.financialYear}</td>
                              <td style={taxTd}>{d.buyerLegalName ?? <span style={{ color: '#9ca3af' }}>—</span>}</td>
                              <td style={{ ...taxTd, fontSize: 12, color: '#6b7280' }}>{formatDateTime(d.generatedAt)}</td>
                              <td style={{ ...taxTd, textAlign: 'right' }}>{formatPaise(d.totalTaxAmountInPaise)}</td>
                              <td style={{ ...taxTd, textAlign: 'right', fontWeight: 600 }}>{formatPaise(d.documentTotalInPaise)}</td>
                              <td style={taxTd}>
                                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: '#f3f4f6', color: '#374151' }}>
                                  {d.status.replace(/_/g, ' ')}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'pos' && (
            <div className="franchise-card">
              <div className="franchise-card-header">
                <div>
                  <h2>POS Sales</h2>
                  <p>Point-of-sale transactions at this franchise</p>
                </div>
              </div>
              {posLoading ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>Loading...</div>
              ) : posSales.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
                  No POS sales recorded yet
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Sale ID</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Type</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Amount</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Items</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Status</th>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {posSales.map((sale: FranchisePosSale) => (
                        <tr key={sale.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12 }}>{sale.id?.slice(0, 8)}...</td>
                          <td style={{ padding: '10px 14px' }}>{(sale.saleType || 'WALK_IN').replace(/_/g, ' ')}</td>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600 }}>{'\u20B9'}{Number(sale.netAmount || 0).toLocaleString('en-IN')}</td>
                          <td style={{ padding: '10px 14px' }}>{sale._count?.items ?? 0}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                              background: sale.status === 'COMPLETED' ? '#dcfce7' : sale.status === 'VOIDED' ? '#fee2e2' : '#fef3c7',
                              color: sale.status === 'COMPLETED' ? '#15803d' : sale.status === 'VOIDED' ? '#991b1b' : '#92400e',
                            }}>
                              {sale.status}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: 12 }}>{formatDateTime(sale.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="franchise-detail-sidebar">
          <div className="franchise-sidebar-card">
            <h3>Actions</h3>
            <button className="sidebar-action-btn" onClick={() => setActiveModal('status')}>
              Update Status
            </button>
            <button className="sidebar-action-btn" onClick={() => setActiveModal('verification')}>
              Update Verification
            </button>
            <button className="sidebar-action-btn" onClick={() => setActiveModal('commission')}>
              Update Commission
            </button>
            <button className="sidebar-action-btn" onClick={() => setActiveModal('message')}>
              Send Message
            </button>
            <button className="sidebar-action-btn" onClick={() => setActiveModal('password')}>
              Change Password
            </button>
            <button className="sidebar-action-btn" onClick={() => setActiveModal('impersonate')}>
              Impersonate
            </button>
            <button
              className="sidebar-action-btn"
              style={{ color: '#dc2626', borderColor: '#fecaca' }}
              onClick={() => setActiveModal('delete')}
            >
              Delete Franchise
            </button>
          </div>

          <div className="franchise-sidebar-card">
            <h3>Quick Info</h3>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
              Email Verified
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>
              {franchise.isEmailVerified ? 'Yes' : 'No'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
              Joined
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>
              {formatDate(franchise.createdAt)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
              Last Login
            </div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              {franchise.lastLoginAt ? formatDateTime(franchise.lastLoginAt as string) : 'Never'}
            </div>
          </div>
        </aside>
      </div>

      {/* Modals */}
      {activeModal === 'status' && (
        <FranchiseStatusModal
          franchise={franchiseListItem}
          onClose={closeModal}
          onSuccess={onActionComplete}
        />
      )}
      {activeModal === 'verification' && (
        <FranchiseVerificationModal
          franchise={franchiseListItem}
          onClose={closeModal}
          onSuccess={onActionComplete}
        />
      )}
      {activeModal === 'commission' && (
        <FranchiseCommissionModal
          franchiseId={franchise.id}
          businessName={franchise.businessName}
          email={franchise.email}
          currentOnlineFulfillmentRate={franchise.onlineFulfillmentRate}
          currentProcurementFeeRate={franchise.procurementFeeRate}
          onClose={closeModal}
          onSuccess={onActionComplete}
        />
      )}
      {activeModal === 'penalty' && (
        <CreatePenaltyModal
          franchiseId={franchiseId}
          businessName={franchise.businessName}
          onClose={closeModal}
          onSuccess={() => { closeModal(); fetchFinanceLedger(); }}
        />
      )}
      {activeModal === 'adjustment' && (
        <CreateAdjustmentModal
          franchiseId={franchiseId}
          businessName={franchise.businessName}
          onClose={closeModal}
          onSuccess={() => { closeModal(); fetchFinanceLedger(); }}
        />
      )}
      {activeModal === 'approve-mapping' && selectedMapping && (
        <ApproveCatalogMappingModal
          mapping={selectedMapping}
          onClose={closeModal}
          onSuccess={onCatalogActionComplete}
        />
      )}
      {activeModal === 'stop-mapping' && selectedMapping && (
        <StopCatalogMappingModal
          mapping={selectedMapping}
          onClose={closeModal}
          onSuccess={onCatalogActionComplete}
        />
      )}
      {activeModal === 'message' && franchiseListItem && (
        <SendMessageModal
          franchise={franchiseListItem}
          onClose={closeModal}
          onSuccess={() => { closeModal(); fetchFranchise(); }}
        />
      )}
      {activeModal === 'password' && franchiseListItem && (
        <ChangePasswordModal
          franchise={franchiseListItem}
          onClose={closeModal}
          onSuccess={() => { closeModal(); fetchFranchise(); }}
        />
      )}
      {activeModal === 'impersonate' && franchiseListItem && (
        <ImpersonateModal
          franchise={franchiseListItem}
          onClose={closeModal}
          onSuccess={() => { closeModal(); }}
        />
      )}
      {activeModal === 'delete' && franchiseListItem && (
        <DeleteFranchiseModal
          franchise={franchiseListItem}
          onClose={closeModal}
          onSuccess={() => { router.push('/dashboard/franchises'); }}
        />
      )}

      {/* Cancel-sub-order reason modal */}
      {cancelOrderId && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => !cancelling && setCancelOrderId(null)}
        >
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 440, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#111827' }}>Cancel sub-order</h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
              This releases stock holds and refunds the customer if the order was prepaid. Provide a reason (minimum 10 characters).
            </p>
            {(cancelOrderStatus === 'SHIPPED' || cancelOrderStatus === 'FULFILLED') && (
              <div style={{ margin: '0 0 12px', padding: '10px 12px', background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
                <strong>In-transit cancellation ({cancelOrderStatus}).</strong> Force-cancels the
                sub-order: refunds a prepaid customer, releases stock and cancels the Delhivery AWB.
                It does <strong>not</strong> physically stop a parcel already moving — coordinate the
                courier/recall separately.
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontWeight: 600, cursor: 'pointer' }}>
                  <input type="checkbox" checked={forceAck} onChange={(e) => setForceAck(e.target.checked)} disabled={cancelling} />
                  I understand — force-cancel this in-transit sub-order
                </label>
              </div>
            )}
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation…"
              rows={3}
              style={{ width: '100%', padding: 10, fontSize: 13, borderRadius: 8, border: `1px solid ${cancelReason.trim().length > 0 && cancelReason.trim().length < 10 ? '#dc2626' : '#d1d5db'}`, resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ fontSize: 11, color: cancelReason.trim().length >= 10 ? '#059669' : '#6b7280', marginTop: 4 }}>
              {cancelReason.trim().length}/10 characters minimum {cancelReason.trim().length >= 10 ? '✓' : ''}
            </div>
            {cancelError && (
              <div style={{ marginTop: 8, padding: '6px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
                {cancelError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={() => { setCancelOrderId(null); setCancelReason(''); setCancelError(''); }}
                disabled={cancelling}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, border: '1px solid #d1d5db', background: '#fff', color: '#374151', borderRadius: 8, cursor: 'pointer' }}
              >
                Keep order
              </button>
              <button
                onClick={submitCancel}
                disabled={cancelling || cancelReason.trim().length < 10 || ((cancelOrderStatus === 'SHIPPED' || cancelOrderStatus === 'FULFILLED') && !forceAck)}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', background: cancelling || cancelReason.trim().length < 10 || ((cancelOrderStatus === 'SHIPPED' || cancelOrderStatus === 'FULFILLED') && !forceAck) ? '#fca5a5' : '#dc2626', color: '#fff', borderRadius: 8, cursor: cancelling || cancelReason.trim().length < 10 || ((cancelOrderStatus === 'SHIPPED' || cancelOrderStatus === 'FULFILLED') && !forceAck) ? 'not-allowed' : 'pointer' }}
              >
                {cancelling ? 'Cancelling…' : (cancelOrderStatus === 'SHIPPED' || cancelOrderStatus === 'FULFILLED') ? 'Force cancel (in transit)' : 'Cancel sub-order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({
  label,
  tab,
  active,
  setActive,
}: {
  label: string;
  tab: TabKey;
  active: TabKey;
  setActive: (t: TabKey) => void;
}) {
  return (
    <button
      className={`franchise-tab${active === tab ? ' active' : ''}`}
      onClick={() => setActive(tab)}
      type="button"
    >
      {label}
    </button>
  );
}

function InfoItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="info-item">
      <span className="info-label">{label}</span>
      <span className={`info-value${!value ? ' muted' : ''}`}>{value || 'Not provided'}</span>
    </div>
  );
}

// ── Tax-tab helpers ──────────────────────────────────────────────

function TaxIdChip({ label, value, warn }: { label: string; value: string | null; warn?: boolean }) {
  return (
    <div style={{
      padding: '8px 14px',
      borderRadius: 8,
      background: warn ? '#fef3c7' : '#f8fafc',
      border: `1px solid ${warn ? '#fde68a' : '#e2e8f0'}`,
      minWidth: 140,
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: warn ? '#92400e' : '#111827' }}>
        {value ?? 'Missing'}
      </div>
    </div>
  );
}

function TaxStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: 8,
      background: highlight ? '#eff6ff' : '#fafbfc',
      border: `1px solid ${highlight ? '#bfdbfe' : '#e5e7eb'}`,
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: highlight ? '#1e40af' : '#111827', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function formatPaise(paise: string | undefined): string {
  if (!paise) return '₹0.00';
  try {
    const n = BigInt(paise);
    const rupees = Number(n) / 100;
    return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch {
    return `₹${paise}`;
  }
}

const taxTh: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  whiteSpace: 'nowrap',
};

const taxTd: React.CSSProperties = {
  padding: '10px 14px',
  verticalAlign: 'middle',
};
