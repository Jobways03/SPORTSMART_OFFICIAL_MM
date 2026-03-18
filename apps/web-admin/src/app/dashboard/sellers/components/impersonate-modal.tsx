'use client';

import { useState } from 'react';
import { SellerListItem, adminSellersService } from '@/services/admin-sellers.service';
import { ApiError } from '@/lib/api-client';
import './modal.css';

interface Props {
  seller: SellerListItem;
  onClose: () => void;
}

export default function ImpersonateModal({ seller, onClose }: Props) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleImpersonate = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await adminSellersService.impersonateSeller(seller.sellerId);
      if (res.data) {
        const sellerPortalUrl = process.env.NEXT_PUBLIC_SELLER_URL || 'http://localhost:3002';
        const sellerData = btoa(JSON.stringify({
          sellerId: seller.sellerId,
          sellerName: seller.sellerName,
          sellerShopName: seller.sellerShopName,
          email: seller.email,
          phoneNumber: seller.phoneNumber,
        }));
        window.open(
          `${sellerPortalUrl}/impersonate?token=${encodeURIComponent(res.data.accessToken)}&data=${encodeURIComponent(sellerData)}`,
          '_blank',
        );
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to impersonate seller');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = seller.sellerName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Impersonate Seller</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="modal-seller-info">
            <div className="seller-avatar">{initials}</div>
            <div className="seller-details">
              <div className="name">{seller.sellerName}</div>
              <div className="email">{seller.email}</div>
            </div>
          </div>

          <div className="modal-warning">
            You are about to impersonate this seller. A new tab will open with a 30-minute session on the seller portal. All actions will be logged.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleImpersonate}
            disabled={submitting}
          >
            {submitting ? 'Generating token...' : 'Impersonate'}
          </button>
        </div>
      </div>
    </div>
  );
}
