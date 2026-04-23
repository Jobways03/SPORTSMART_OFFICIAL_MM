'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  adminFranchisesService,
  FranchiseDetail,
  FranchiseListItem,
  FranchiseCatalogMapping,
  FranchiseInventoryItem,
  FranchiseOrderItem,
} from '@/services/admin-franchises.service';
import { useModal } from '@sportsmart/ui';
import { apiClient, ApiError } from '@/lib/api-client';
import FranchiseStatusModal from '../components/franchise-status-modal';
import FranchiseVerificationModal from '../components/franchise-verification-modal';
import FranchiseCommissionModal from '../components/franchise-commission-modal';
import ApproveCatalogMappingModal from '../components/approve-catalog-mapping-modal';
import StopCatalogMappingModal from '../components/stop-catalog-mapping-modal';
import SendMessageModal from '../components/send-message-modal';
import ChangePasswordModal from '../components/change-password-modal';
import ImpersonateModal from '../components/impersonate-modal';
import DeleteFranchiseModal from '../components/delete-franchise-modal';
import '../franchises.css';

type ModalType = 'status' | 'verification' | 'commission' | 'approve-mapping' | 'stop-mapping' | 'message' | 'password' | 'impersonate' | 'delete' | null;
type TabKey = 'profile' | 'location' | 'catalog' | 'inventory' | 'orders' | 'commission' | 'finance' | 'settlements' | 'pos';

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

  // Finance ledger
  const [financeLedger, setFinanceLedger] = useState<any[]>([]);
  const [financeLoading, setFinanceLoading] = useState(false);

  // Settlements
  const [settlements, setSettlements] = useState<any[]>([]);
  const [settlementsLoading, setSettlementsLoading] = useState(false);

  // POS Sales
  const [posSales, setPosSales] = useState<any[]>([]);
  const [posLoading, setPosLoading] = useState(false);

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
      if (res.data?.orders) {
        setOrders(res.data.orders);
      }
    } catch {
      // Non-critical
    } finally {
      setOrdersLoading(false);
    }
  }, [franchiseId]);

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
  }, [activeTab, franchiseId, fetchCatalog, fetchInventory, fetchOrders, fetchFinanceLedger, fetchSettlements, fetchPosSales]);

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
                        <tr key={o.id}>
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
                          </td>
                        </tr>
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
                  {/* TODO: wire a real adjustment modal — button left as placeholder */}
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
                      {posSales.map((sale: any) => (
                        <tr key={sale.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12 }}>{sale.id?.slice(0, 8)}...</td>
                          <td style={{ padding: '10px 14px' }}>{(sale.saleType || sale.type || 'WALK_IN').replace(/_/g, ' ')}</td>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600 }}>{'\u20B9'}{Number(sale.totalAmount || sale.amount || 0).toLocaleString('en-IN')}</td>
                          <td style={{ padding: '10px 14px' }}>{sale.itemCount || sale.items?.length || 0}</td>
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
