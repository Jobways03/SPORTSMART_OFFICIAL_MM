'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { adminSellersService, SellerListItem, ListSellersParams } from '@/services/admin-sellers.service';
import { ApiError } from '@/lib/api-client';
import ActionMenu from './components/action-menu';
import StatusModal from './components/status-modal';

import SendMessageModal from './components/send-message-modal';
import ChangePasswordModal from './components/change-password-modal';
import DeleteSellerModal from './components/delete-seller-modal';
import ImpersonateModal from './components/impersonate-modal';
import './sellers.css';

type ModalType = 'status' | 'message' | 'password' | 'delete' | 'impersonate' | null;

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function SellersPage() {
  const router = useRouter();
  const [sellers, setSellers] = useState<SellerListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [verificationFilter, setVerificationFilter] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [selectedSeller, setSelectedSeller] = useState<SellerListItem | null>(null);

  // Admin role for permission checks
  const [adminRole, setAdminRole] = useState('');

  useEffect(() => {
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) {
        const admin = JSON.parse(adminData);
        setAdminRole(admin.role);
      }
    } catch {
      // ignore
    }
  }, []);

  // Pre-filter from the URL (?status=PENDING_APPROVAL) so the dashboard's
  // "Pending seller review" KPI lands directly on the pending list. Read on
  // the client only (window is undefined during SSR); setting statusFilter
  // triggers the fetch effect below.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status');
    if (s) setStatusFilter(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSellers = useCallback(async (params: ListSellersParams = {}) => {
    setLoading(true);
    setError('');
    try {
      const res = await adminSellersService.listSellers({
        page: params.page || pagination.page,
        limit: 20,
        search: params.search !== undefined ? params.search : search,
        status: params.status !== undefined ? params.status : statusFilter,
        verificationStatus: params.verificationStatus !== undefined ? params.verificationStatus : verificationFilter,
        sortBy: params.sortBy || sortBy,
        sortOrder: params.sortOrder || sortOrder,
      });
      if (res.data) {
        setSellers(res.data.sellers);
        setPagination(res.data.pagination);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError('Failed to load sellers. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, search, statusFilter, verificationFilter, sortBy, sortOrder, router]);

  useEffect(() => {
    fetchSellers({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, verificationFilter, sortBy, sortOrder]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchSellers({ page: 1, search: value });
    }, 400);
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const handlePageChange = (page: number) => {
    fetchSellers({ page });
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setVerificationFilter('');
    setSortBy('createdAt');
    setSortOrder('desc');
    fetchSellers({ page: 1, search: '', status: '', verificationStatus: '' });
  };

  const openModal = (type: ModalType, seller: SellerListItem) => {
    setSelectedSeller(seller);
    setActiveModal(type);
  };

  const closeModal = () => {
    setActiveModal(null);
    setSelectedSeller(null);
  };

  const onActionComplete = () => {
    closeModal();
    fetchSellers({ page: pagination.page });
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'status-badge active';
      case 'PENDING_APPROVAL': return 'status-badge pending';
      case 'INACTIVE': return 'status-badge inactive';
      case 'SUSPENDED': return 'status-badge suspended';
      case 'DEACTIVATED': return 'status-badge deactivated';
      default: return 'status-badge';
    }
  };

  const getVerificationBadgeClass = (status: string) => {
    switch (status) {
      case 'VERIFIED': return 'verification-badge verified';
      case 'NOT_VERIFIED': return 'verification-badge not-verified';
      case 'REJECTED': return 'verification-badge rejected';
      case 'UNDER_REVIEW': return 'verification-badge under-review';
      default: return 'verification-badge';
    }
  };

  const formatStatus = (status: string) => status.replace(/_/g, ' ');

  const getCompletionClass = (pct: number) => {
    if (pct >= 70) return 'high';
    if (pct >= 40) return 'medium';
    return 'low';
  };

  const sortArrow = (field: string) => {
    if (sortBy !== field) return '';
    return sortOrder === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  const hasFilters = search || statusFilter || verificationFilter;

  return (
    <div className="sellers-page">
      <div className="sellers-header">
        <div>
          <h1>
            Sellers
            {!loading && (
              <span className="sellers-count-pill">{pagination.total}</span>
            )}
          </h1>
          <p className="sellers-subtitle">
            Manage registered sellers — verification, access and account actions.
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="sellers-table-wrap">
        {/* Toolbar (search + filters) */}
        <div className="sellers-toolbar">
          <div className="sellers-search">
            <span className="sellers-search-icon">&#128269;</span>
            <input
              type="text"
              placeholder="Search by name, email, phone, shop..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>

          <div className="sellers-toolbar-filters">
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING_APPROVAL">Pending Approval</option>
              <option value="INACTIVE">Inactive</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="DEACTIVATED">Deactivated</option>
            </select>

            <select
              className="filter-select"
              value={verificationFilter}
              onChange={(e) => setVerificationFilter(e.target.value)}
            >
              <option value="">All Verification</option>
              <option value="VERIFIED">Verified</option>
              <option value="NOT_VERIFIED">Not Verified</option>
              <option value="UNDER_REVIEW">Under Review</option>
              <option value="REJECTED">Rejected</option>
            </select>

            {hasFilters && (
              <button className="filter-clear-btn" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="sellers-loading">Loading sellers...</div>
        ) : error ? (
          <div className="sellers-error">
            <p>{error}</p>
            <button onClick={() => fetchSellers({ page: pagination.page })}>Retry</button>
          </div>
        ) : sellers.length === 0 ? (
          <div className="sellers-empty">
            <h3>{hasFilters ? 'No sellers match your filters' : 'No sellers yet'}</h3>
            <p>{hasFilters ? 'Try adjusting your search or filters.' : 'Sellers will appear here once they register.'}</p>
          </div>
        ) : (
          <>
            <table className="sellers-table">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => handleSort('sellerName')}>
                    Seller{sortArrow('sellerName')}
                  </th>
                  <th>Contact</th>
                  <th className="sortable" onClick={() => handleSort('status')}>
                    Status{sortArrow('status')}
                  </th>
                  <th>Verification</th>
                  <th>Profile</th>
                  <th className="sortable" onClick={() => handleSort('createdAt')}>
                    Joined{sortArrow('createdAt')}
                  </th>
                  <th style={{ width: 60 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map(seller => (
                  <tr key={seller.sellerId}>
                    <td>
                      <div className="seller-cell">
                        <div
                          className="seller-avatar"
                          style={{
                            background: `hsl(${avatarHue(seller.sellerName)}, 60%, 92%)`,
                            color: `hsl(${avatarHue(seller.sellerName)}, 45%, 35%)`,
                          }}
                        >
                          {getInitials(seller.sellerName)}
                        </div>
                        <div className="seller-name-cell">
                          <span className="seller-name-primary">{seller.sellerName}</span>
                          <span className="seller-name-shop">{seller.sellerShopName}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="seller-contact-cell">
                        <span className="seller-contact-email">{seller.email}</span>
                        <span className="seller-contact-phone">{seller.phoneNumber}</span>
                      </div>
                    </td>
                    <td>
                      <span className={getStatusBadgeClass(seller.status)}>
                        {formatStatus(seller.status)}
                      </span>
                    </td>
                    <td>
                      <span className={`verification-badge ${seller.isEmailVerified ? 'verified' : 'not-verified'}`}>
                        {seller.isEmailVerified ? 'VERIFIED' : 'NOT VERIFIED'}
                      </span>
                    </td>
                    <td>
                      <div className="completion-bar">
                        <div className="completion-track">
                          <div
                            className={`completion-fill ${getCompletionClass(seller.profileCompletionPercentage)}`}
                            style={{ width: `${seller.profileCompletionPercentage}%` }}
                          />
                        </div>
                        <span className="completion-text">{seller.profileCompletionPercentage}%</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                      {new Date(seller.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      <ActionMenu
                        seller={seller}
                        adminRole={adminRole}
                        onView={() => router.push(`/dashboard/sellers/${seller.sellerId}`)}
                        onEditStatus={() => openModal('status', seller)}

                        onSendMessage={() => openModal('message', seller)}
                        onChangePassword={() => openModal('password', seller)}
                        onImpersonate={() => openModal('impersonate', seller)}
                        onDelete={() => openModal('delete', seller)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="sellers-pagination">
                <div className="pagination-info">
                  Showing {(pagination.page - 1) * pagination.limit + 1}-{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
                </div>
                <div className="pagination-buttons">
                  <button
                    className="pagination-btn"
                    disabled={pagination.page <= 1}
                    onClick={() => handlePageChange(pagination.page - 1)}
                  >
                    Prev
                  </button>
                  {generatePageNumbers(pagination.page, pagination.totalPages).map((p) =>
                    typeof p === 'string' ? (
                      <span key={p} style={{ padding: '6px 8px', fontSize: 13 }}>...</span>
                    ) : (
                      <button
                        key={p}
                        className={`pagination-btn${pagination.page === p ? ' active' : ''}`}
                        onClick={() => handlePageChange(p)}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <button
                    className="pagination-btn"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => handlePageChange(pagination.page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {activeModal === 'status' && selectedSeller && (
        <StatusModal seller={selectedSeller} onClose={closeModal} onSuccess={onActionComplete} />
      )}

      {activeModal === 'message' && selectedSeller && (
        <SendMessageModal seller={selectedSeller} onClose={closeModal} onSuccess={onActionComplete} />
      )}
      {activeModal === 'password' && selectedSeller && (
        <ChangePasswordModal seller={selectedSeller} onClose={closeModal} onSuccess={onActionComplete} />
      )}
      {activeModal === 'delete' && selectedSeller && (
        <DeleteSellerModal seller={selectedSeller} onClose={closeModal} onSuccess={onActionComplete} />
      )}
      {activeModal === 'impersonate' && selectedSeller && (
        <ImpersonateModal seller={selectedSeller} onClose={closeModal} />
      )}
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }
  return hash;
}

function generatePageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | string)[] = [1];
  if (current > 3) pages.push('dots-start');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('dots-end');
  pages.push(total);
  return pages;
}
