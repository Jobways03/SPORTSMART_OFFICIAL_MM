// Phase 164 (Credit Note Generation audit #19) — domain events for the
// credit-note lifecycle. Published via EventBusService so downstream
// consumers (notification retry/outbox, accounting export, analytics) can
// react durably instead of relying on the best-effort in-process email
// fired at issuance time.

export const CREDIT_NOTE_EVENTS = {
  /** A credit note was issued (new) for a return. */
  ISSUED: 'tax.creditNote.issued',
} as const;

export type CreditNoteEventName =
  (typeof CREDIT_NOTE_EVENTS)[keyof typeof CREDIT_NOTE_EVENTS];

export interface CreditNoteIssuedPayload {
  creditNoteId: string;
  documentNumber: string;
  returnId: string;
  returnNumber: string;
  sourceInvoiceId: string;
  sourceInvoiceNumber: string;
  customerId: string | null;
  sellerId: string | null;
  taxableReversalInPaise: string;
  totalTaxReversalInPaise: string;
  cessReversalInPaise: string;
  documentTotalInPaise: string;
  isB2b: boolean;
  buyerGstin: string | null;
  partialCoverageLineCount: number;
}
