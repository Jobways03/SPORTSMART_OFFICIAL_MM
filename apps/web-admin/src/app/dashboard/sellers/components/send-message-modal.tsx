'use client';

import { useState } from 'react';
import { SellerListItem, adminSellersService } from '@/services/admin-sellers.service';
import { ApiError } from '@/lib/api-client';
import './modal.css';

interface Props {
  seller: SellerListItem;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SendMessageModal({ seller, onClose, onSuccess }: Props) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const subjectError = subject.length > 200 ? 'Subject must be 200 characters or less' : '';
  const messageError = message.length > 5000 ? 'Message must be 5000 characters or less' : '';

  const handleSubmit = async () => {
    if (!subject.trim() || !message.trim()) return;
    if (subjectError || messageError) return;
    setSubmitting(true);
    setError('');
    try {
      await adminSellersService.sendMessage(seller.sellerId, subject.trim(), message.trim());
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send message');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = seller.sellerName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Send Message</h2>
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

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Subject *</label>
            <input
              type="text"
              placeholder="Message subject"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              maxLength={200}
            />
            {subjectError && <span className="field-error">{subjectError}</span>}
            <div className="char-count">{subject.length}/200</div>
          </div>

          <div className="modal-form-group">
            <label>Message *</label>
            <textarea
              placeholder="Write your message..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              maxLength={5000}
              style={{ minHeight: 140 }}
            />
            {messageError && <span className="field-error">{messageError}</span>}
            <div className="char-count">{message.length}/5000</div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !subject.trim() || !message.trim()}
          >
            {submitting ? 'Sending...' : 'Send Message'}
          </button>
        </div>
      </div>
    </div>
  );
}
