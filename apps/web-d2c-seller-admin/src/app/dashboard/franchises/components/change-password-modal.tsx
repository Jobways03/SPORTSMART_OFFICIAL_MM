'use client';

import { useState } from 'react';
import { FranchiseListItem, adminFranchisesService } from '@/services/admin-franchises.service';
import { ApiError } from '@/lib/api-client';
import '../../sellers/components/modal.css';

interface Props {
  franchise: FranchiseListItem;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ChangePasswordModal({ franchise, onClose, onSuccess }: Props) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const passwordValid = password.length >= 8;
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleSubmit = async () => {
    if (!passwordValid || !passwordsMatch) return;
    setSubmitting(true);
    setError('');
    try {
      await adminFranchisesService.changePassword(franchise.id, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = franchise.ownerName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Change Franchise Password</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="modal-seller-info">
            <div className="seller-avatar">{initials}</div>
            <div className="seller-details">
              <div className="name">{franchise.ownerName}</div>
              <div className="email">{franchise.email}</div>
            </div>
          </div>

          <div className="modal-warning">
            This will immediately invalidate all active sessions.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>New Password *</label>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter new password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            {password && !passwordValid && (
              <span className="field-error">Password must be at least 8 characters</span>
            )}
          </div>

          <div className="modal-form-group">
            <label>Confirm Password *</label>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
            {confirmPassword && !passwordsMatch && (
              <span className="field-error">Passwords do not match</span>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showPassword}
              onChange={e => setShowPassword(e.target.checked)}
            />
            Show passwords
          </label>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !passwordValid || !passwordsMatch}
          >
            {submitting ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </div>
    </div>
  );
}
