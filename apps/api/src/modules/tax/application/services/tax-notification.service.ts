// Phase 24 GST — TaxNotificationService.
//
// Wraps NotificationsPublicFacade with one method per tax event. Each
// method:
//   - Resolves the right `templateKey` (declared as constants below
//     so future template-content edits stay localised).
//   - Resolves the right `eventClass` so user-preference opt-outs work
//     ("a customer who opted out of the 'tax' event class won't get
//     IRN-generated emails").
//   - Builds the `vars` block the template renderer substitutes into
//     subject + body. Variables are JSON-safe (BigInt → decimal string
//     via paiseToRupees-style helpers).
//
// Templates themselves are stored in `notification_templates` and
// rendered server-side. Phase 24 ships the WIRING; CA + UX seed the
// template bodies (Phase 25 admin UI). If a template is missing at
// dispatch time the facade logs + drops — the system never crashes
// on a missing template.
//
// Event classes:
//   'tax.invoice'      — customer / seller invoice + credit note + IRN
//   'tax.ewb'          — seller e-way bill events
//   'tax.settlement'   — seller settlement (incl. TCS)
//   'tax.compliance'   — admin GSTR-8 / audit-readiness reminders
//   'tax.refund'       — customer-facing time-barred refund notice
//
// All methods are non-throwing: notifications are best-effort. A
// notify failure must not crash the upstream tax operation.

import { Injectable, Logger } from '@nestjs/common';
import { NotificationsPublicFacade } from '../../../notifications/application/facades/notifications-public.facade';

// ── Template keys ─────────────────────────────────────────────────
// Keep in one place so future renames don't scatter through the
// codebase. Format: `tax.{actor}.{event}.{channel}`.
export const TAX_TEMPLATE_KEYS = {
  customer: {
    invoiceIssued:        'tax.customer.invoice_issued.email',
    creditNoteIssued:     'tax.customer.credit_note_issued.email',
    // Phase 31 — B2B buyers must reverse the ITC they claimed on the
    // original invoice when a credit note is issued (Section 34 +
    // GSTR-2B auto-population doesn't reverse the buyer's claim, only
    // surfaces the CN). Separate template from the generic credit-note
    // email so the body can include the CGST/SGST/IGST reversal
    // amounts the buyer needs to declare on their GSTR-3B Table 4(B).
    creditNoteB2bItcReversal: 'tax.customer.credit_note_b2b_itc_reversal.email',
    timeBarredRefund:     'tax.customer.refund_via_wallet.email',
  },
  seller: {
    invoiceIssued:        'tax.seller.invoice_issued.email',
    irnGenerated:         'tax.seller.irn_generated.email',
    ewbGenerated:         'tax.seller.ewb_generated.email',
    ewbExpired:           'tax.seller.ewb_expired.email',
    settlementTcs:        'tax.seller.settlement_tcs_collected.email',
    // Phase 161 (TDS 194-O exempt audit #13) — seller learns their §194-O TDS
    // exemption was granted / revoked (their next payout's net amount changes).
    tds194oExemptionChanged: 'tax.seller.tds194o_exemption_changed.email',
  },
  admin: {
    gstr8FilingReminder:  'tax.admin.gstr8_filing_due.email',
    einvoiceFailed:       'tax.admin.einvoice_failed.email',
    timeBarApproaching:   'tax.admin.timebar_approaching.email',
    pdfRenderFailed:      'tax.admin.pdf_render_failed.email',
  },
} as const;

@Injectable()
export class TaxNotificationService {
  private readonly logger = new Logger(TaxNotificationService.name);

  constructor(private readonly notifications: NotificationsPublicFacade) {}

  // ── Customer surface ───────────────────────────────────────────

  /**
   * "Your tax invoice is ready." Fires after Phase 19 marks the doc
   * PDF_GENERATED. Caller passes the resolved `customerId` +
   * `documentId` (we don't re-fetch the doc — the caller already has it).
   */
  async customerInvoiceIssued(args: {
    customerId: string;
    documentId: string;
    documentNumber: string;
    documentTotalInPaise: bigint;
    documentDate: Date;
    downloadUrl?: string | null;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.invoice',
      templateKey: TAX_TEMPLATE_KEYS.customer.invoiceIssued,
      recipientId: args.customerId,
      vars: {
        documentNumber: args.documentNumber,
        documentTotalRupees: paiseToRupees(args.documentTotalInPaise),
        documentDate: formatIstDate(args.documentDate),
        downloadUrl: args.downloadUrl ?? null,
      },
      eventId: args.documentId,
    });
  }

  /** "A credit note has been issued for your return." */
  async customerCreditNoteIssued(args: {
    customerId: string;
    documentId: string;
    documentNumber: string;
    documentTotalInPaise: bigint;
    originalInvoiceNumber: string | null;
    returnNumber: string | null;
    downloadUrl?: string | null;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.invoice',
      templateKey: TAX_TEMPLATE_KEYS.customer.creditNoteIssued,
      recipientId: args.customerId,
      vars: {
        documentNumber: args.documentNumber,
        documentTotalRupees: paiseToRupees(args.documentTotalInPaise),
        originalInvoiceNumber: args.originalInvoiceNumber ?? '',
        returnNumber: args.returnNumber ?? '',
        downloadUrl: args.downloadUrl ?? null,
      },
      eventId: args.documentId,
    });
  }

  /**
   * "Reverse the ITC you claimed on invoice X." Fires alongside
   * `customerCreditNoteIssued` ONLY when the source invoice was B2B
   * (buyer had a GSTIN on the original). The buyer is legally
   * required (Section 34 + GSTR-3B Table 4(B)) to reverse the ITC
   * they claimed on the original tax invoice once the credit note
   * lands on their GSTR-2B; this email is the operational nudge.
   *
   * Body variables list the per-leg reversal so the buyer's
   * accountant can plug them straight into the GSTR-3B return:
   *   - cgstReversalRupees / sgstReversalRupees / igstReversalRupees
   *   - originalInvoiceNumber + originalInvoiceDate
   *   - buyerGstin (echoed so the buyer can confirm the right entity)
   */
  async customerB2bItcReversalRequired(args: {
    customerId: string;
    documentId: string;
    documentNumber: string;
    originalInvoiceNumber: string;
    originalInvoiceDate: Date | null;
    buyerGstin: string;
    cgstReversalInPaise: bigint;
    sgstReversalInPaise: bigint;
    igstReversalInPaise: bigint;
    totalTaxReversalInPaise: bigint;
    returnNumber: string | null;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.invoice',
      templateKey: TAX_TEMPLATE_KEYS.customer.creditNoteB2bItcReversal,
      recipientId: args.customerId,
      vars: {
        documentNumber: args.documentNumber,
        originalInvoiceNumber: args.originalInvoiceNumber,
        originalInvoiceDate: args.originalInvoiceDate
          ? formatIstDate(args.originalInvoiceDate)
          : '',
        buyerGstin: args.buyerGstin,
        cgstReversalRupees: paiseToRupees(args.cgstReversalInPaise),
        sgstReversalRupees: paiseToRupees(args.sgstReversalInPaise),
        igstReversalRupees: paiseToRupees(args.igstReversalInPaise),
        totalTaxReversalRupees: paiseToRupees(args.totalTaxReversalInPaise),
        returnNumber: args.returnNumber ?? '',
        note:
          'Declare the above amounts under "ITC Reversed — Others" on ' +
          'your GSTR-3B Table 4(B)(2) for the period in which this ' +
          'credit note is reflected in your GSTR-2B.',
      },
      eventId: args.documentId,
    });
  }

  /**
   * "Refund processed via wallet. GST adjustment is not available for
   * this return due to statutory reporting timelines." Fires after
   * Phase 13's WalletAdjustmentService approves a TIME_BARRED_CREDIT_NOTE.
   */
  async customerTimeBarredRefund(args: {
    customerId: string;
    returnNumber: string;
    refundAmountInPaise: bigint;
    walletAdjustmentId: string;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.refund',
      templateKey: TAX_TEMPLATE_KEYS.customer.timeBarredRefund,
      recipientId: args.customerId,
      vars: {
        returnNumber: args.returnNumber,
        refundAmountRupees: paiseToRupees(args.refundAmountInPaise),
        reason:
          'GST adjustment is not available for this return due to ' +
          'statutory reporting timelines (CGST Section 34). The refund ' +
          'has been credited to your wallet.',
      },
      eventId: args.walletAdjustmentId,
    });
  }

  // ── Seller surface ─────────────────────────────────────────────

  async sellerInvoiceIssued(args: {
    sellerId: string;
    documentId: string;
    documentNumber: string;
    documentTotalInPaise: bigint;
    documentDate: Date;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.invoice',
      templateKey: TAX_TEMPLATE_KEYS.seller.invoiceIssued,
      recipientId: args.sellerId,
      vars: {
        documentNumber: args.documentNumber,
        documentTotalRupees: paiseToRupees(args.documentTotalInPaise),
        documentDate: formatIstDate(args.documentDate),
      },
      eventId: args.documentId,
    });
  }

  /**
   * Phase 161 (TDS 194-O exempt audit #13) — seller's §194-O TDS exemption
   * was granted or revoked. Best-effort; never blocks the exemption mutation.
   */
  async sellerTds194OExemptionChanged(args: {
    sellerId: string;
    exempt: boolean;
    reason?: string | null;
    effectiveFrom?: Date | null;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.settlement',
      templateKey: TAX_TEMPLATE_KEYS.seller.tds194oExemptionChanged,
      recipientId: args.sellerId,
      vars: {
        status: args.exempt ? 'exempt' : 'not exempt',
        reason: args.reason ?? '',
        effectiveFrom: args.effectiveFrom ? formatIstDate(args.effectiveFrom) : '',
      },
      eventId: `tds194o-exempt:${args.sellerId}:${args.exempt ? 'on' : 'off'}`,
    });
  }

  /** "IRN minted by NIC IRP." Fires after Phase 22's EInvoiceService.generate. */
  async sellerIrnGenerated(args: {
    sellerId: string;
    documentId: string;
    documentNumber: string;
    irn: string;
    ackNo: string;
    ackDate: Date;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.invoice',
      templateKey: TAX_TEMPLATE_KEYS.seller.irnGenerated,
      recipientId: args.sellerId,
      vars: {
        documentNumber: args.documentNumber,
        // Surface the truncated IRN (full 64 chars is overwhelming
        // for an email subject line; full value still on the PDF).
        irnPreview: `${args.irn.slice(0, 8)}…${args.irn.slice(-4)}`,
        ackNo: args.ackNo,
        ackDate: formatIstDate(args.ackDate),
      },
      eventId: args.documentId,
    });
  }

  async sellerEwbGenerated(args: {
    sellerId: string;
    ewbId: string;
    ewbNumber: string;
    documentNumber: string | null;
    validUntil: Date;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.ewb',
      templateKey: TAX_TEMPLATE_KEYS.seller.ewbGenerated,
      recipientId: args.sellerId,
      vars: {
        ewbNumber: args.ewbNumber,
        invoiceNumber: args.documentNumber ?? '',
        validUntil: formatIstDate(args.validUntil),
      },
      eventId: args.ewbId,
    });
  }

  /**
   * "EWB has expired without delivery." Triggered by the future EWB
   * expiry sweeper. Seller may need to reissue.
   */
  async sellerEwbExpired(args: {
    sellerId: string;
    ewbId: string;
    ewbNumber: string;
    documentNumber: string | null;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.ewb',
      templateKey: TAX_TEMPLATE_KEYS.seller.ewbExpired,
      recipientId: args.sellerId,
      vars: {
        ewbNumber: args.ewbNumber,
        invoiceNumber: args.documentNumber ?? '',
      },
      eventId: args.ewbId,
    });
  }

  /**
   * "TCS collected this cycle." Fires after Phase 17's settlement
   * mark-paid + Phase 16's TcsService.markCollected flips the row.
   */
  async sellerSettlementTcsCollected(args: {
    sellerId: string;
    settlementId: string;
    filingPeriod: string;
    tcsDeductedInPaise: bigint;
    netPayoutInPaise: bigint;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.settlement',
      templateKey: TAX_TEMPLATE_KEYS.seller.settlementTcs,
      recipientId: args.sellerId,
      vars: {
        filingPeriod: args.filingPeriod,
        tcsDeductedRupees: paiseToRupees(args.tcsDeductedInPaise),
        netPayoutRupees: paiseToRupees(args.netPayoutInPaise),
      },
      eventId: args.settlementId,
    });
  }

  // ── Admin surface ──────────────────────────────────────────────

  /**
   * "GSTR-8 filing due in N days." Triggered by the future filing
   * reminder cron (lands with Phase 25's admin dashboard). One
   * notification per filing period per admin.
   */
  async adminGstr8FilingReminder(args: {
    adminId: string;
    filingPeriod: string;
    daysUntilDue: number;
    totalTcsInPaise: bigint;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.compliance',
      templateKey: TAX_TEMPLATE_KEYS.admin.gstr8FilingReminder,
      recipientId: args.adminId,
      vars: {
        filingPeriod: args.filingPeriod,
        daysUntilDue: args.daysUntilDue,
        totalTcsRupees: paiseToRupees(args.totalTcsInPaise),
      },
      eventId: `gstr8:${args.filingPeriod}`,
    });
  }

  /**
   * "IRN generation failed past the retry cap for this document."
   * Triggered by Phase 22's EInvoiceRetryCron escalation.
   */
  async adminEinvoiceFailed(args: {
    adminId: string;
    documentId: string;
    documentNumber: string;
    failureReason: string;
    retryCount: number;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.compliance',
      templateKey: TAX_TEMPLATE_KEYS.admin.einvoiceFailed,
      recipientId: args.adminId,
      vars: {
        documentNumber: args.documentNumber,
        failureReason: args.failureReason,
        retryCount: args.retryCount,
      },
      eventId: args.documentId,
    });
  }

  /**
   * "Return is within 7 days of the Section 34 cutoff." Triggered by
   * Phase 12's TaxCreditNoteTimeBarCron when it flags
   * REQUIRES_FINANCE_REVIEW. Finance reviews + decides credit-note vs
   * wallet path.
   */
  async adminTimeBarApproaching(args: {
    adminId: string;
    returnId: string;
    returnNumber: string;
    daysUntilCutoff: number;
    sourceInvoiceNumber: string | null;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.compliance',
      templateKey: TAX_TEMPLATE_KEYS.admin.timeBarApproaching,
      recipientId: args.adminId,
      vars: {
        returnNumber: args.returnNumber,
        daysUntilCutoff: args.daysUntilCutoff,
        sourceInvoiceNumber: args.sourceInvoiceNumber ?? '',
      },
      eventId: args.returnId,
    });
  }

  /** "PDF render failed past the retry cap." Triggered by Phase 19. */
  async adminPdfRenderFailed(args: {
    adminId: string;
    documentId: string;
    documentNumber: string;
    failureReason: string;
    retryCount: number;
  }): Promise<void> {
    await this.safeNotify({
      eventClass: 'tax.compliance',
      templateKey: TAX_TEMPLATE_KEYS.admin.pdfRenderFailed,
      recipientId: args.adminId,
      vars: {
        documentNumber: args.documentNumber,
        failureReason: args.failureReason,
        retryCount: args.retryCount,
      },
      eventId: args.documentId,
    });
  }

  // ── Internals ──────────────────────────────────────────────────

  /**
   * Best-effort wrapper. Notifications are not critical-path; a
   * failure must not crash the upstream tax operation.
   */
  private async safeNotify(args: {
    eventClass: string;
    templateKey: string;
    recipientId: string;
    vars: Record<string, unknown>;
    eventId?: string;
  }): Promise<void> {
    try {
      await this.notifications.notifyFromTemplate(args);
    } catch (err) {
      this.logger.warn(
        `Notification ${args.templateKey} → ${args.recipientId} ` +
          `failed (non-fatal): ${(err as Error).message}`,
      );
    }
  }
}

// ── Var-rendering helpers ────────────────────────────────────────

/** "12345" paise → "123.45". Sign-preserving, no IEEE drift. */
function paiseToRupees(p: bigint): string {
  const negative = p < 0n;
  const abs = negative ? -p : p;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const rupees = `${formatIndianGrouping(whole)}.${cents
    .toString()
    .padStart(2, '0')}`;
  return negative ? `-${rupees}` : rupees;
}

function formatIndianGrouping(n: bigint): string {
  const s = n.toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const groups: string[] = [];
  let i = rest.length;
  while (i > 0) {
    const start = Math.max(0, i - 2);
    groups.unshift(rest.slice(start, i));
    i = start;
  }
  return `${groups.join(',')},${last3}`;
}

function formatIstDate(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const dd = ist.getUTCDate().toString().padStart(2, '0');
  const mm = (ist.getUTCMonth() + 1).toString().padStart(2, '0');
  const yyyy = ist.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}
