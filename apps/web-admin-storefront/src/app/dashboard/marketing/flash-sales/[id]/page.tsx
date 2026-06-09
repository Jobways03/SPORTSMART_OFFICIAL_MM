'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  flashSalesService,
  FlashSale,
  FlashSaleWriteInput,
} from '@/services/flash-sales.service';
import { ApiError } from '@/lib/api-client';
import { FlashSaleForm } from '../_components/FlashSaleForm';

export default function EditFlashSalePage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id ?? '');

  const [initial, setInitial] = useState<FlashSale | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    flashSalesService
      .get(id)
      .then((res) => {
        if (cancelled) return;
        setInitial(res.data ?? null);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(
          e instanceof ApiError
            ? e.body?.message || 'Flash sale not found'
            : 'Flash sale not found',
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSubmit = async (input: FlashSaleWriteInput) => {
    setSubmitting(true);
    setError(null);
    try {
      await flashSalesService.update(id, input);
      router.push('/dashboard/marketing');
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.body?.message || 'Failed to save changes'
          : 'Failed to save changes',
      );
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await flashSalesService.remove(id);
      router.push('/dashboard/marketing');
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.body?.message || 'Failed to delete flash sale'
          : 'Failed to delete flash sale',
      );
      setSubmitting(false);
    }
  };

  if (loading) {
    return <p style={{ padding: 24, color: '#6b7280', fontSize: 14 }}>Loading…</p>;
  }
  if (loadError) {
    return <p style={{ padding: 24, color: '#b91c1c', fontSize: 14 }}>{loadError}</p>;
  }

  return (
    <FlashSaleForm
      mode="edit"
      initial={initial}
      onSubmit={handleSubmit}
      onDelete={handleDelete}
      submitting={submitting}
      error={error}
    />
  );
}
