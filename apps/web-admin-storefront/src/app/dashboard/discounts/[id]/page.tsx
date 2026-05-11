'use client';

import { useParams } from 'next/navigation';
import DiscountForm from '../_components/DiscountForm';
import { DiscountAuditHistory } from './_components/DiscountAuditHistory';

export default function EditDiscountPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <DiscountForm discountId={id} />
      {/* Phase E (P1.1) — audit history panel below the form. */}
      {id && <DiscountAuditHistory discountId={id} />}
    </>
  );
}
