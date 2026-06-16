'use client';

import { useState } from 'react';
import { SellerListItem, adminSellersService } from '@/services/admin-sellers.service';
import { ApiError } from '@/lib/api-client';
import { validatePersonName } from '@/lib/validators';
import './modal.css';

interface Props {
  seller: SellerListItem;
  initial?: {
    bankName?: string | null;
    accountHolderName?: string | null;
    accountLast4?: string | null;
    ifscCode?: string | null;
  };
  onClose: () => void;
  onSuccess: () => void;
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^[0-9]{9,18}$/;

export default function EditBankModal({ seller, initial, onClose, onSuccess }: Props) {
  const [accountHolderName, setAccountHolderName] = useState(initial?.accountHolderName ?? '');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState(initial?.ifscCode ?? '');
  const [bankName, setBankName] = useState(initial?.bankName ?? '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const acctValid = ACCOUNT_RE.test(accountNumber.replace(/\s+/g, ''));
  const ifscValid = IFSC_RE.test(ifscCode.trim().toUpperCase());
  const holderError = validatePersonName(accountHolderName, 'Account holder name');
  const holderValid = holderError === null;
  const bankValid = bankName.trim().length > 0;
  const canSubmit = acctValid && ifscValid && holderValid && bankValid;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await adminSellersService.updateBankDetails(seller.sellerId, {
        accountHolderName: accountHolderName.trim(),
        accountNumber: accountNumber.replace(/\s+/g, ''),
        ifscCode: ifscCode.trim().toUpperCase(),
        bankName: bankName.trim(),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update bank details');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = seller.sellerName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Bank Account</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
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
            This changes where the seller&apos;s payouts are settled. Re-enter the full account number
            (only the last 4 digits are stored in plain text).
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Account Holder Name *</label>
            <input
              value={accountHolderName}
              onChange={(e) => setAccountHolderName(e.target.value.replace(/[^A-Za-z .'-]/g, ''))}
              placeholder="As per bank records"
            />
            {accountHolderName && holderError && (
              <span className="field-error">{holderError}</span>
            )}
          </div>

          <div className="modal-form-group">
            <label>Account Number *</label>
            <input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 18))}
              inputMode="numeric"
              maxLength={18}
              placeholder={
                initial?.accountLast4
                  ? `Current ends ••••${initial.accountLast4} — re-enter full number`
                  : '9–18 digits'
              }
            />
            {accountNumber && !acctValid && (
              <span className="field-error">Account number must be 9–18 digits</span>
            )}
          </div>

          <div className="modal-form-group">
            <label>IFSC Code *</label>
            <input
              value={ifscCode}
              onChange={(e) => setIfscCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))}
              maxLength={11}
              placeholder="e.g. HDFC0001234"
            />
            {ifscCode && !ifscValid && (
              <span className="field-error">
                Invalid IFSC — 4 letters + 0 + 6 alphanumerics
              </span>
            )}
          </div>

          <div className="modal-form-group">
            <label>Bank Name *</label>
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value.replace(/[^A-Za-z0-9 &.,\-/()']/g, ''))}
              maxLength={150}
              placeholder="e.g. HDFC Bank"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting ? 'Saving...' : 'Save Bank Details'}
          </button>
        </div>
      </div>
    </div>
  );
}
