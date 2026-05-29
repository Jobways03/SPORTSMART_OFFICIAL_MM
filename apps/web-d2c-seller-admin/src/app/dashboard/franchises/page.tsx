'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminFranchisesService,
  FranchiseListItem,
  ListFranchisesParams,
} from '@/services/admin-franchises.service';
import { ApiError } from '@/lib/api-client';
import ActionMenu from './components/action-menu';
import FranchiseStatusModal from './components/franchise-status-modal';
import FranchiseVerificationModal from './components/franchise-verification-modal';
import FranchiseCommissionModal from './components/franchise-commission-modal';
import SendMessageModal from './components/send-message-modal';
import ChangePasswordModal from './components/change-password-modal';
import ImpersonateModal from './components/impersonate-modal';
import DeleteFranchiseModal from './components/delete-franchise-modal';
import './franchises.css';

type ModalType = 'status' | 'verification' | 'commission' | 'message' | 'password' | 'impersonate' | 'delete' | null;

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function FranchisesPage() {
  const router = useRouter();
  const [franchises, setFranchises] = useState<FranchiseListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [verificationFilter, setVerificationFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [selectedFranchise, setSelectedFranchise] = useState<FranchiseListItem | null>(null);

  const fetchFranchises = useCallback(
    async (params: ListFranchisesParams = {}) => {
      setLoading(true);
      setError('');
      try {
        const res = await adminFranchisesService.listFranchises({
          page: params.page || pagination.page,
          limit: 20,
          search: params.search !== undefined ? params.search : search,
          status: params.status !== undefined ? params.status : statusFilter,
          verificationStatus:
            params.verificationStatus !== undefined ? params.verificationStatus : verificationFilter,
          state: params.state !== undefined ? params.state : stateFilter,
          sortBy: params.sortBy || sortBy,
          sortOrder: params.sortOrder || sortOrder,
        });
        if (res.data) {
          setFranchises(res.data.franchises);
          setPagination(res.data.pagination);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError('Failed to load franchises. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pagination.page, search, statusFilter, verificationFilter, stateFilter, sortBy, sortOrder, router],
  );

  useEffect(() => {
    fetchFranchises({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, verificationFilter, stateFilter, sortBy, sortOrder]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchFranchises({ page: 1, search: value });
    }, 400);
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const handlePageChange = (page: number) => {
    fetchFranchises({ page });
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setVerificationFilter('');
    setStateFilter('');
    setSortBy('createdAt');
    setSortOrder('desc');
    fetchFranchises({
      page: 1,
      search: '',
      status: '',
      verificationStatus: '',
      state: '',
    });
  };

  const openModal = (type: ModalType, franchise: FranchiseListItem) => {
    setSelectedFranchise(franchise);
    setActiveModal(type);
  };

  const closeModal = () => {
    setActiveModal(null);
    setSelectedFranchise(null);
  };

  const onActionComplete = () => {
    closeModal();
    fetchFranchises({ page: pagination.page });
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'PENDING': return 'status-badge pending';
      case 'APPROVED': return 'status-badge approved';
      case 'ACTIVE': return 'status-badge active';
      case 'SUSPENDED': return 'status-badge suspended';
      case 'DEACTIVATED': return 'status-badge deactivated';
      default: return 'status-badge';
    }
  };

  const getVerificationBadgeClass = (status: string) => {
    switch (status) {
      case 'NOT_VERIFIED': return 'verification-badge not-verified';
      case 'UNDER_REVIEW': return 'verification-badge under-review';
      case 'VERIFIED': return 'verification-badge verified';
      case 'REJECTED': return 'verification-badge rejected';
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

  const hasFilters = search || statusFilter || verificationFilter || stateFilter;

  return (
    <div className="franchises-page">
      <div className="franchises-header">
        <h1>
          Franchises
          {!loading && <span className="franchises-header-count">({pagination.total})</span>}
        </h1>
      </div>

      {/* Filters */}
      <div className="franchises-filters">
        <div className="franchises-search">
          <span className="franchises-search-icon">&#128269;</span>
          <input
            type="text"
            placeholder="Search by code, owner, business, email, phone..."
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
          />
        </div>

        <select
          className="filter-select"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DEACTIVATED">Deactivated</option>
        </select>

        <select
          className="filter-select"
          value={verificationFilter}
          onChange={e => setVerificationFilter(e.target.value)}
        >
          <option value="">All Verification</option>
          <option value="NOT_VERIFIED">Not Verified</option>
          <option value="UNDER_REVIEW">Under Review</option>
          <option value="VERIFIED">Verified</option>
          <option value="REJECTED">Rejected</option>
        </select>

        <input
          className="filter-select"
          type="text"
          placeholder="State"
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value)}
          style={{ minWidth: 120, cursor: 'text' }}
        />

        {hasFilters && (
          <button className="filter-clear-btn" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="franchises-table-wrap">
        {loading ? (
          <div className="franchises-loading">Loading franchises...</div>
        ) : error ? (
          <div className="franchises-error">
            <p>{error}</p>
            <button onClick={() => fetchFranchises({ page: pagination.page })}>Retry</button>
          </div>
        ) : franchises.length === 0 ? (
          <div className="franchises-empty">
            <h3>{hasFilters ? 'No franchises match your filters' : 'No franchises yet'}</h3>
            <p>
              {hasFilters
                ? 'Try adjusting your search or filters.'
                : 'Franchises will appear here once they register.'}
            </p>
          </div>
        ) : (
          <>
            <table className="franchises-table">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => handleSort('franchiseCode')}>
                    Franchise{sortArrow('franchiseCode')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('ownerName')}>
                    Owner{sortArrow('ownerName')}
                  </th>
                  <th>Contact</th>
                  <th>Location</th>
                  <th className="sortable" onClick={() => handleSort('status')}>
                    Status{sortArrow('status')}
                  </th>
                  <th>Verification</th>
                  <th>Profile</th>
                  <th style={{ width: 60 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {franchises.map(franchise => (
                  <tr
                    key={franchise.id}
                    onClick={() => router.push(`/dashboard/franchises/${franchise.id}`)}
                  >
                    <td>
                      <div className="franchise-name-cell">
                        <span className="franchise-name-code">{franchise.franchiseCode}</span>
                        <span className="franchise-name-business">{franchise.businessName}</span>
                      </div>
                    </td>
                    <td>
                      <div className="franchise-owner-cell">
                        <span className="franchise-owner-name">{franchise.ownerName}</span>
                      </div>
                    </td>
                    <td>
                      <div className="franchise-contact-cell">
                        <span className="franchise-contact-email">{franchise.email}</span>
                        <span className="franchise-contact-phone">{franchise.phoneNumber}</span>
                      </div>
                    </td>
                    <td>
                      <div className="franchise-location-cell">
                        <span className="franchise-location-state">{franchise.state || '\u2014'}</span>
                        <span className="franchise-location-city">{franchise.city || ''}</span>
                      </div>
                    </td>
                    <td>
                      <span className={getStatusBadgeClass(franchise.status)}>
                        {formatStatus(franchise.status)}
                      </span>
                    </td>
                    <td>
                      <span className={getVerificationBadgeClass(franchise.verificationStatus)}>
                        {formatStatus(franchise.verificationStatus)}
                      </span>
                    </td>
                    <td>
                      <div className="completion-bar">
                        <div className="completion-track">
                          <div
                            className={`completion-fill ${getCompletionClass(
                              franchise.profileCompletionPercentage,
                            )}`}
                            style={{ width: `${franchise.profileCompletionPercentage}%` }}
                          />
                        </div>
                        <span className="completion-text">
                          {franchise.profileCompletionPercentage}%
                        </span>
                      </div>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <ActionMenu
                        onView={() => router.push(`/dashboard/franchises/${franchise.id}`)}
                        onEditStatus={() => openModal('status', franchise)}
                        onEditVerification={() => openModal('verification', franchise)}
                        onEditCommission={() => openModal('commission', franchise)}
                        onSendMessage={() => openModal('message', franchise)}
                        onChangePassword={() => openModal('password', franchise)}
                        onImpersonate={() => openModal('impersonate', franchise)}
                        onDelete={() => openModal('delete', franchise)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="franchises-pagination">
                <div className="pagination-info">
                  Showing {(pagination.page - 1) * pagination.limit + 1}-
                  {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                  {pagination.total}
                </div>
                <div className="pagination-buttons">
                  <button
                    className="pagination-btn"
                    disabled={pagination.page <= 1}
                    onClick={() => handlePageChange(pagination.page - 1)}
                  >
                    Prev
                  </button>
                  {generatePageNumbers(pagination.page, pagination.totalPages).map(p =>
                    typeof p === 'string' ? (
                      <span key={p} style={{ padding: '6px 8px', fontSize: 13 }}>
                        ...
                      </span>
                    ) : (
                      <button
                        key={p}
                        className={`pagination-btn${pagination.page === p ? ' active' : ''}`}
                        onClick={() => handlePageChange(p)}
                      >
                        {p}
                      </button>
                    ),
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
      {activeModal === 'status' && selectedFranchise && (
        <FranchiseStatusModal
          franchise={selectedFranchise}
          onClose={closeModal}
          onSuccess={onActionComplete}
        />
      )}
      {activeModal === 'verification' && selectedFranchise && (
        <FranchiseVerificationModal
          franchise={selectedFranchise}
          onClose={closeModal}
          onSuccess={onActionComplete}
        />
      )}
      {activeModal === 'commission' && selectedFranchise && (
        <FranchiseCommissionModal
          franchiseId={selectedFranchise.id}
          businessName={selectedFranchise.businessName}
          email={selectedFranchise.email}
          currentOnlineFulfillmentRate={null}
          currentProcurementFeeRate={null}
          onClose={closeModal}
          onSuccess={onActionComplete}
        />
      )}
      {activeModal === 'message' && selectedFranchise && (
        <SendMessageModal
          franchise={selectedFranchise}
          onClose={closeModal}
          onSuccess={onActionComplete}
        />
      )}
      {activeModal === 'password' && selectedFranchise && (
        <ChangePasswordModal
          franchise={selectedFranchise}
          onClose={closeModal}
          onSuccess={onActionComplete}
        />
      )}
      {activeModal === 'impersonate' && selectedFranchise && (
        <ImpersonateModal
          franchise={selectedFranchise}
          onClose={closeModal}
          onSuccess={onActionComplete}
        />
      )}
      {activeModal === 'delete' && selectedFranchise && (
        <DeleteFranchiseModal
          franchise={selectedFranchise}
          onClose={closeModal}
          onSuccess={onActionComplete}
        />
      )}
    </div>
  );
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
