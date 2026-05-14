// Phase 12 GST — CreditNoteEligibilityService.
//
// Classifies a QC-approved return against the Section 34 time-bar
// rule for credit notes:
//
//   ELIGIBLE                 — source invoice exists + now() is on
//                              or before 30 Sept of FY+1.
//   TIME_BARRED              — cutoff already passed. The wallet
//                              refund path proceeds, but the GST
//                              output-tax reduction is permanently
//                              denied — platform absorbs the GST cost.
//   REQUIRES_FINANCE_REVIEW  — within `approachingDays` of the cutoff
//                              and no credit note issued yet, OR the
//                              source invoice has a status that the
//                              auto-flow can't process (VOIDED_DRAFT /
//                              SUPERSEDED / FULLY_REVERSED). Finance
//                              lead must triage manually.
//
// Pure decision logic + small DB lookup (find source invoice). All
// side effects (Return update, AdminTask creation) are owned by the
// cron caller so this service stays unit-test-friendly.
//
// See:
//   - docs/tax/CREDIT_NOTE_TIME_BAR_POLICY.md
//   - apps/api/src/modules/tax/domain/credit-note-time-bar.ts (pure
//     IST cutoff math)

import { Injectable, Logger } from '@nestjs/common';
import type {
  CreditNoteEligibilityStatus,
  TaxDocument,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  isWithinSection34Window,
  section34CutoffFor,
} from '../../domain/credit-note-time-bar';

export interface EligibilityDecision {
  status: CreditNoteEligibilityStatus;
  cutoff: Date | null;
  daysToCutoff: number | null;
  reason: string;
  sourceInvoice: Pick<
    TaxDocument,
    'id' | 'documentNumber' | 'generatedAt' | 'status'
  > | null;
}

export interface ClassifyOptions {
  /** Override "now" — useful for unit tests + back-dated re-classification. */
  now?: Date;
  /** Returns within this many days of the cutoff are flagged as
   *  REQUIRES_FINANCE_REVIEW so finance can chase the credit note out
   *  the door before the deadline. Default 7 days. */
  approachingDays?: number;
}

@Injectable()
export class CreditNoteEligibilityService {
  private readonly logger = new Logger(CreditNoteEligibilityService.name);
  private static readonly DEFAULT_APPROACHING_DAYS = 7;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Classify a single return. Returns the eligibility decision but
   * does NOT persist anything — the cron is responsible for writes.
   *
   * Throws only if the return ID is unknown or the return hasn't
   * completed QC. All other unusual states (no source invoice,
   * already time-barred, etc.) resolve to a non-ELIGIBLE bucket
   * with an explanatory reason.
   */
  async classifyReturn(
    returnId: string,
    options: ClassifyOptions = {},
  ): Promise<EligibilityDecision> {
    const now = options.now ?? new Date();
    const approachingDays =
      options.approachingDays ??
      CreditNoteEligibilityService.DEFAULT_APPROACHING_DAYS;

    const returnRow = await this.prisma.return.findUnique({
      where: { id: returnId },
      select: {
        id: true,
        returnNumber: true,
        subOrderId: true,
        qcCompletedAt: true,
        qcDecision: true,
      },
    });
    if (!returnRow) {
      throw new Error(`Return ${returnId} not found`);
    }
    if (!returnRow.qcCompletedAt) {
      throw new Error(
        `Return ${returnRow.returnNumber} has not completed QC; classification is premature.`,
      );
    }

    // Look up the source invoice for this sub-order. We accept both
    // TAX_INVOICE and INVOICE_CUM_BILL_OF_SUPPLY since either can be
    // credit-noted. Exclude terminally-cancelled docs (VOIDED_DRAFT /
    // SUPERSEDED) — those route to REQUIRES_FINANCE_REVIEW so finance
    // can decide whether to re-generate or absorb.
    const sourceInvoice = await this.prisma.taxDocument.findFirst({
      where: {
        subOrderId: returnRow.subOrderId,
        documentType: {
          in: ['TAX_INVOICE', 'INVOICE_CUM_BILL_OF_SUPPLY'],
        },
      },
      orderBy: { generatedAt: 'desc' },
      select: {
        id: true,
        documentNumber: true,
        generatedAt: true,
        status: true,
      },
    });

    if (!sourceInvoice) {
      // Phase 14 — distinguish between two no-invoice cases:
      //   (a) Legacy order: LEGACY_RECEIPT exists. The wallet-adjustment
      //       path is the correct destination — no GST to reverse, no
      //       Section 34 cutoff to track.
      //   (b) Pre-invoice / mid-checkout: snapshots exist but invoice
      //       hasn't generated yet. Finance must wait for the regular
      //       invoice flow rather than routing through wallet.
      const legacyReceipt = await this.prisma.taxDocument.findFirst({
        where: {
          subOrderId: returnRow.subOrderId,
          documentType: 'LEGACY_RECEIPT',
          status: { notIn: ['VOIDED_DRAFT'] },
        },
        select: {
          id: true,
          documentNumber: true,
          generatedAt: true,
          status: true,
        },
      });
      if (legacyReceipt) {
        return {
          status: 'REQUIRES_FINANCE_REVIEW',
          cutoff: null,
          daysToCutoff: null,
          reason:
            `Legacy order — LEGACY_RECEIPT ${legacyReceipt.documentNumber} ` +
            `predates the GST module. No GST output liability to reverse. ` +
            `Route refund via wallet adjustment; the absorbed-GST snapshot ` +
            `stays null because there was never a GST claim to absorb.`,
          sourceInvoice: legacyReceipt,
        };
      }
      return {
        status: 'REQUIRES_FINANCE_REVIEW',
        cutoff: null,
        daysToCutoff: null,
        reason:
          'No source tax invoice found for the sub-order. Likely the ' +
          'invoice generator has not run yet (mid-checkout) or this is a ' +
          'truly pre-GST legacy order that needs LEGACY_RECEIPT generation. ' +
          'Finance must triage manually.',
        sourceInvoice: null,
      };
    }

    if (!sourceInvoice.generatedAt) {
      return {
        status: 'REQUIRES_FINANCE_REVIEW',
        cutoff: null,
        daysToCutoff: null,
        reason: `Source invoice ${sourceInvoice.documentNumber} has no generatedAt timestamp.`,
        sourceInvoice,
      };
    }

    // Status check — only invoice-side statuses where issuing a
    // credit note makes sense are auto-eligible.
    if (
      sourceInvoice.status === 'VOIDED_DRAFT' ||
      sourceInvoice.status === 'SUPERSEDED' ||
      sourceInvoice.status === 'FULLY_REVERSED'
    ) {
      const cutoff = section34CutoffFor(sourceInvoice.generatedAt);
      return {
        status: 'REQUIRES_FINANCE_REVIEW',
        cutoff,
        daysToCutoff: daysBetween(now, cutoff),
        reason:
          `Source invoice ${sourceInvoice.documentNumber} is ${sourceInvoice.status}. ` +
          `Auto credit-note flow does not handle this state — finance must triage.`,
        sourceInvoice,
      };
    }

    const cutoff = section34CutoffFor(sourceInvoice.generatedAt);
    const withinWindow = isWithinSection34Window(
      sourceInvoice.generatedAt,
      now,
    );

    if (!withinWindow) {
      return {
        status: 'TIME_BARRED',
        cutoff,
        daysToCutoff: daysBetween(now, cutoff), // negative — already past
        reason:
          `Section 34 cutoff (${cutoff.toISOString()}) has lapsed. ` +
          `GST output liability cannot be reduced; refund must route ` +
          `through wallet adjustment and the platform absorbs the GST cost.`,
        sourceInvoice,
      };
    }

    const daysToCutoff = daysBetween(now, cutoff);
    if (daysToCutoff <= approachingDays) {
      return {
        status: 'REQUIRES_FINANCE_REVIEW',
        cutoff,
        daysToCutoff,
        reason:
          `Within ${approachingDays}-day early-warning window of Sec 34 cutoff ` +
          `(${cutoff.toISOString()}). Issue the credit note immediately or ` +
          `prepare for wallet-adjustment routing.`,
        sourceInvoice,
      };
    }

    return {
      status: 'ELIGIBLE',
      cutoff,
      daysToCutoff,
      reason:
        `Within Sec 34 window (${daysToCutoff} day(s) to cutoff ${cutoff.toISOString()}).`,
      sourceInvoice,
    };
  }
}

/**
 * Whole-day delta from `from` to `to`. Returns negative when `to` is
 * already in the past relative to `from`. Used for human-readable
 * "N days to cutoff" messaging and for the approaching-window check.
 */
function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}
