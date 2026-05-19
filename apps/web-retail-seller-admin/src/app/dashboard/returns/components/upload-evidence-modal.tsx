'use client';

import { useState } from 'react';
import { adminReturnsService } from '@/services/admin-returns.service';
import '../../sellers/components/modal.css';

interface Props {
  returnId: string;
  returnNumber: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function UploadEvidenceModal({
  returnId,
  returnNumber,
  onClose,
  onSuccess,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!file) {
      setError('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File must be under 5 MB');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await adminReturnsService.uploadQcEvidence(
        returnId,
        file,
        description.trim() || undefined,
      );
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload evidence');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Upload QC Evidence</h2>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div
            style={{
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              marginBottom: 16,
            }}
          >
            Upload a photo as QC evidence for return{' '}
            <strong style={{ color: 'var(--color-text)' }}>
              {returnNumber}
            </strong>
            . Max size 5 MB.
          </div>

          {error && <div className="modal-alert modal-alert-error">{error}</div>}

          <div className="modal-form-group">
            <label>Image File *</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="modal-form-group">
            <label>Description (optional)</label>
            <textarea
              placeholder="Describe what this photo shows..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
            <div className="char-count">{description.length}/500</div>
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="modal-btn"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="modal-btn modal-btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !file}
          >
            {submitting ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
