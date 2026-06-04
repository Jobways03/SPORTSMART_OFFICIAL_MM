'use client';

import { useParams } from 'next/navigation';
import DiscountForm from '../_components/DiscountForm';
import { DiscountAuditHistory } from './_components/DiscountAuditHistory';
import { DiscountStatusControls } from './_components/DiscountStatusControls';

export default function EditDiscountPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      {/* Phase 243 (#status/#pause) — lifecycle controls (Pause/Resume/Archive)
          via the dedicated status FSM endpoint. */}
      {id && (
        <div style={{ maxWidth: 1060, margin: '0 auto 16px' }}>
          <DiscountStatusControls discountId={id} />
        </div>
      )}
      <DiscountForm discountId={id} />
      {/* Phase E (P1.1) — audit history panel below the form. */}
      {id && <DiscountAuditHistory discountId={id} />}
    </>
  );
}
