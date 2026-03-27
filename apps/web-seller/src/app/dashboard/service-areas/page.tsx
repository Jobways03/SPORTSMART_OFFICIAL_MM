'use client';

import { useEffect, useState, useCallback } from 'react';
import { sellerProductService } from '@/services/product.service';
import '../products/product-form.css';

interface ServiceArea {
  id: string;
  pincode: string;
  city: string | null;
  state: string | null;
  isActive: boolean;
  createdAt: string;
}

interface ServiceAreasResponse {
  serviceAreas: ServiceArea[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export default function ServiceAreasPage() {
  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addPincodesText, setAddPincodesText] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingPincode, setRemovingPincode] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const getToken = (): string | null => {
    try {
      return sessionStorage.getItem('accessToken');
    } catch {
      return null;
    }
  };

  const fetchServiceAreas = useCallback(async (page = 1) => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    try {
      const res = await sellerProductService.getServiceAreas(token, { page, limit: 20 });
      const data = res.data as ServiceAreasResponse;
      if (data) {
        setServiceAreas(data.serviceAreas || []);
        setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 });
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to load service areas', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchServiceAreas(1);
  }, [fetchServiceAreas]);

  const handleAddPincodes = async () => {
    if (!addPincodesText.trim()) return;
    const token = getToken();
    if (!token) return;

    // Parse pincodes: support comma-separated, newline-separated, or space-separated
    const pincodes = addPincodesText
      .split(/[\n,\s]+/)
      .map(p => p.trim())
      .filter(p => /^\d{6}$/.test(p));

    if (pincodes.length === 0) {
      showToast('No valid 6-digit pincodes found. Please check your input.', 'error');
      return;
    }

    setAdding(true);
    try {
      await sellerProductService.addServiceAreas(token, pincodes);
      showToast(`Successfully added ${pincodes.length} pincode(s)`, 'success');
      setAddPincodesText('');
      setShowAddModal(false);
      fetchServiceAreas(1);
    } catch (err: any) {
      showToast(err?.message || 'Failed to add pincodes', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (pincode: string) => {
    const token = getToken();
    if (!token) return;

    setRemovingPincode(pincode);
    try {
      await sellerProductService.removeServiceArea(token, pincode);
      showToast(`Pincode ${pincode} removed`, 'success');
      setConfirmRemove(null);
      fetchServiceAreas(pagination.page);
    } catch (err: any) {
      showToast(err?.message || 'Failed to remove pincode', 'error');
    } finally {
      setRemovingPincode(null);
    }
  };

  // Filter service areas by search query (client-side filter on current page)
  const filtered = searchQuery.trim()
    ? serviceAreas.filter(
        sa =>
          sa.pincode.includes(searchQuery.trim()) ||
          (sa.city && sa.city.toLowerCase().includes(searchQuery.trim().toLowerCase())) ||
          (sa.state && sa.state.toLowerCase().includes(searchQuery.trim().toLowerCase()))
      )
    : serviceAreas;

  return (
    <div className="product-form-page">
      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>{toast.message}</div>
      )}

      {/* Header */}
      <div className="product-form-header">
        <h1>Service Areas</h1>
        <button
          className="form-btn primary"
          onClick={() => setShowAddModal(true)}
        >
          + Add Pincodes
        </button>
      </div>

      {/* Search / Filter */}
      <div className="form-card" style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search by pincode, city, or state..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ flex: 1, maxWidth: 400 }}
          />
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            {pagination.total} total pincode{pagination.total !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="form-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="form-loading">Loading service areas...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#128205;</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, color: '#374151' }}>
              {searchQuery ? 'No matching pincodes' : 'No service areas yet'}
            </h3>
            <p style={{ margin: 0, fontSize: 14 }}>
              {searchQuery
                ? 'Try a different search term.'
                : 'Add pincodes to define where you can deliver.'}
            </p>
          </div>
        ) : (
          <table className="variant-table-rich">
            <thead>
              <tr>
                <th>Pincode</th>
                <th>City</th>
                <th>State</th>
                <th>Status</th>
                <th style={{ width: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(sa => (
                <tr key={sa.id || sa.pincode}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 14 }}>
                    {sa.pincode}
                  </td>
                  <td>{sa.city || '--'}</td>
                  <td>{sa.state || '--'}</td>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '3px 10px',
                        borderRadius: 100,
                        fontSize: 12,
                        fontWeight: 600,
                        background: sa.isActive ? '#f0fdf4' : '#f3f4f6',
                        color: sa.isActive ? '#166534' : '#6b7280',
                        border: `1px solid ${sa.isActive ? '#bbf7d0' : '#e5e7eb'}`,
                      }}
                    >
                      {sa.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    {confirmRemove === sa.pincode ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          className="form-btn"
                          style={{
                            padding: '4px 12px',
                            fontSize: 12,
                            background: '#dc2626',
                            color: '#fff',
                            borderColor: '#dc2626',
                          }}
                          onClick={() => handleRemove(sa.pincode)}
                          disabled={removingPincode === sa.pincode}
                        >
                          {removingPincode === sa.pincode ? '...' : 'Yes'}
                        </button>
                        <button
                          className="form-btn"
                          style={{ padding: '4px 12px', fontSize: 12 }}
                          onClick={() => setConfirmRemove(null)}
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        className="form-btn"
                        style={{
                          padding: '4px 12px',
                          fontSize: 12,
                          color: '#dc2626',
                          borderColor: '#fca5a5',
                        }}
                        onClick={() => setConfirmRemove(sa.pincode)}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            marginTop: 20,
          }}
        >
          <button
            className="form-btn"
            style={{ padding: '6px 16px', fontSize: 13 }}
            disabled={pagination.page <= 1}
            onClick={() => fetchServiceAreas(pagination.page - 1)}
          >
            Previous
          </button>
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            className="form-btn"
            style={{ padding: '6px 16px', fontSize: 13 }}
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => fetchServiceAreas(pagination.page + 1)}
          >
            Next
          </button>
        </div>
      )}

      {/* Add Pincodes Modal */}
      {showAddModal && (
        <div className="variant-modal-overlay" onClick={() => !adding && setShowAddModal(false)}>
          <div className="variant-modal" onClick={e => e.stopPropagation()}>
            <div className="variant-modal-header">
              <h2>Add Pincodes</h2>
              <button
                className="variant-modal-close"
                onClick={() => !adding && setShowAddModal(false)}
              >
                &times;
              </button>
            </div>
            <div className="variant-modal-body">
              <div className="info-box" style={{ marginBottom: 16 }}>
                Enter 6-digit pincodes, one per line or comma-separated. Invalid entries will be
                ignored.
              </div>
              <div className="form-group">
                <label className="form-label">Pincodes</label>
                <textarea
                  className="form-textarea tall"
                  placeholder={"110001\n110002\n400001\n\nor: 110001, 110002, 400001"}
                  value={addPincodesText}
                  onChange={e => setAddPincodesText(e.target.value)}
                  disabled={adding}
                  rows={8}
                />
                <span className="form-hint">
                  {(() => {
                    const count = addPincodesText
                      .split(/[\n,\s]+/)
                      .filter(p => /^\d{6}$/.test(p.trim())).length;
                    return count > 0
                      ? `${count} valid pincode${count !== 1 ? 's' : ''} detected`
                      : 'No valid pincodes yet';
                  })()}
                </span>
              </div>
            </div>
            <div className="variant-modal-footer">
              <button
                className="form-btn"
                onClick={() => setShowAddModal(false)}
                disabled={adding}
              >
                Cancel
              </button>
              <button
                className="form-btn primary"
                onClick={handleAddPincodes}
                disabled={adding || !addPincodesText.trim()}
              >
                {adding ? 'Adding...' : 'Add Pincodes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
