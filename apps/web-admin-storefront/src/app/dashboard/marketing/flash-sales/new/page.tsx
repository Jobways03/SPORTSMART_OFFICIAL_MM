'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { flashSalesService, FlashSaleWriteInput } from '@/services/flash-sales.service';
import { ApiError } from '@/lib/api-client';
import { FlashSaleForm } from '../_components/FlashSaleForm';

export default function NewFlashSalePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (input: FlashSaleWriteInput) => {
    setSubmitting(true);
    setError(null);
    try {
      await flashSalesService.create(input);
      router.push('/dashboard/marketing');
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.body?.message || 'Failed to create flash sale'
          : 'Failed to create flash sale',
      );
      setSubmitting(false);
    }
  };

  return (
    <FlashSaleForm mode="create" onSubmit={handleSubmit} submitting={submitting} error={error} />
  );
}
