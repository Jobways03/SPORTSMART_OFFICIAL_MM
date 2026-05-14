// Phase 26 GST — TaxCompatibilityService.
//
// Single safe entry point for callers that need tax data on orders
// which may pre-date the Phase-5 tax-snapshot wiring (legacy orders
// imported from the pre-GST system, or orders placed before Phase 5
// shipped). Replaces ad-hoc `if (snapshot) { … } else { fallback }`
// scattered through return / refund / settlement / display code.
//
// Three return shapes — caller pattern-matches on `kind`:
//
//   { kind: 'snapshot', snapshot }
//     New flow. The sub-order has snapshot rows + (likely) a tax
//     document. Money breakdown is authoritative.
//
//   { kind: 'legacy', legacyReceipt }
//     Pre-GST order with a LEGACY_RECEIPT document (Phase 14). Zero
//     GST is correct; the customer's record is the receipt.
//
//   { kind: 'pre_snapshot', orderItemTotalInPaise }
//     Edge case: order is post-Phase-5 but the snapshot row didn't
//     write (a bug in production fixed after-the-fact, or a manual
//     SQL insert). Caller treats this as "best-effort gross refund;
//     escalate to ops for manual GST reconciliation".
//
// Pure pass-through wrapper around existing services + Prisma. No
// new schema, no migrations. The point is consolidation, not
// new behaviour.

import { Injectable, Logger } from '@nestjs/common';
import type { OrderItemTaxSnapshot, TaxDocument } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { LegacyReceiptService } from './legacy-receipt.service';

export type TaxSnapshotResolution =
  | { kind: 'snapshot'; snapshot: OrderItemTaxSnapshot }
  | { kind: 'legacy'; legacyReceipt: Pick<TaxDocument, 'id' | 'documentNumber'> }
  | { kind: 'pre_snapshot'; orderItemTotalInPaise: bigint };

export interface SubOrderTaxResolution {
  kind: 'invoice' | 'legacy' | 'absent';
  document: Pick<
    TaxDocument,
    | 'id'
    | 'documentNumber'
    | 'documentType'
    | 'status'
    | 'documentTotalInPaise'
    | 'taxableAmountInPaise'
    | 'totalTaxAmountInPaise'
  > | null;
  /** Reason text for "absent" — surfaced to callers' audit / UI. */
  reason?: string;
}

export interface OrderDisplayTaxBreakdown {
  hasGstData: boolean;
  taxableInPaise: bigint;
  cgstInPaise: bigint;
  sgstInPaise: bigint;
  igstInPaise: bigint;
  totalTaxInPaise: bigint;
  grandTotalInPaise: bigint;
  /** Display-side disclosure. UI renders this verbatim under the
   *  totals when `hasGstData` is false. */
  disclosure?: string;
}

@Injectable()
export class TaxCompatibilityService {
  private readonly logger = new Logger(TaxCompatibilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly legacy: LegacyReceiptService,
  ) {}

  /**
   * Resolve the tax shape for one OrderItem. Returns a tagged union
   * so the caller can branch without juggling nulls.
   */
  async resolveForOrderItem(
    orderItemId: string,
  ): Promise<TaxSnapshotResolution> {
    const snapshot = await this.prisma.orderItemTaxSnapshot.findFirst({
      where: { orderItemId },
    });
    if (snapshot) {
      return { kind: 'snapshot', snapshot };
    }

    // Look at the sub-order to decide between 'legacy' and 'pre_snapshot'.
    const orderItem = await this.prisma.orderItem.findUnique({
      where: { id: orderItemId },
      select: { totalPriceInPaise: true, subOrderId: true },
    });
    if (!orderItem) {
      // No order item at all — surface as pre_snapshot with zero
      // so the caller's switch can handle uniformly.
      return { kind: 'pre_snapshot', orderItemTotalInPaise: 0n };
    }

    const isLegacy = await this.legacy.isLegacyOrder(orderItem.subOrderId);
    if (isLegacy) {
      const receipt = await this.prisma.taxDocument.findFirst({
        where: {
          subOrderId: orderItem.subOrderId,
          documentType: 'LEGACY_RECEIPT',
          status: { notIn: ['VOIDED_DRAFT'] },
        },
        select: { id: true, documentNumber: true },
      });
      if (receipt) {
        return { kind: 'legacy', legacyReceipt: receipt };
      }
    }

    // Truly pre-snapshot: snapshot row never wrote, no legacy receipt
    // generated yet. Caller falls back to gross.
    return {
      kind: 'pre_snapshot',
      orderItemTotalInPaise: orderItem.totalPriceInPaise,
    };
  }

  /**
   * Resolve the tax-document shape for one SubOrder. Used by
   * settlement / return / refund flows that need to know "is there
   * a real invoice here or a legacy receipt or nothing".
   */
  async resolveForSubOrder(
    subOrderId: string,
  ): Promise<SubOrderTaxResolution> {
    const realInvoice = await this.prisma.taxDocument.findFirst({
      where: {
        subOrderId,
        documentType: {
          in: ['TAX_INVOICE', 'INVOICE_CUM_BILL_OF_SUPPLY'],
        },
        status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
      },
      orderBy: { generatedAt: 'desc' },
      select: {
        id: true,
        documentNumber: true,
        documentType: true,
        status: true,
        documentTotalInPaise: true,
        taxableAmountInPaise: true,
        totalTaxAmountInPaise: true,
      },
    });
    if (realInvoice) {
      return { kind: 'invoice', document: realInvoice };
    }

    const legacy = await this.prisma.taxDocument.findFirst({
      where: {
        subOrderId,
        documentType: 'LEGACY_RECEIPT',
        status: { notIn: ['VOIDED_DRAFT'] },
      },
      select: {
        id: true,
        documentNumber: true,
        documentType: true,
        status: true,
        documentTotalInPaise: true,
        taxableAmountInPaise: true,
        totalTaxAmountInPaise: true,
      },
    });
    if (legacy) {
      return { kind: 'legacy', document: legacy };
    }

    return {
      kind: 'absent',
      document: null,
      reason:
        'No tax document exists for this sub-order. Likely mid-checkout ' +
        '(invoice not yet generated) or a pre-GST order that has not had ' +
        'a LEGACY_RECEIPT minted yet.',
    };
  }

  /**
   * Build the totals block for an order display surface (customer
   * order page, admin order detail page). When no GST data exists,
   * the breakdown carries zero tax + a human-readable disclosure
   * so the UI can render "Total ₹X (pre-GST order; no tax breakdown
   * available)".
   */
  async getDisplayTaxBreakdown(
    subOrderId: string,
  ): Promise<OrderDisplayTaxBreakdown> {
    const docResolution = await this.resolveForSubOrder(subOrderId);
    if (docResolution.kind === 'invoice' && docResolution.document) {
      const d = docResolution.document;
      return {
        hasGstData: true,
        taxableInPaise: d.taxableAmountInPaise,
        cgstInPaise: 0n,
        sgstInPaise: 0n,
        igstInPaise: 0n,
        totalTaxInPaise: d.totalTaxAmountInPaise,
        grandTotalInPaise: d.documentTotalInPaise,
      };
    }

    // No real invoice — sum from line items.
    const items = await this.prisma.orderItem.findMany({
      where: { subOrderId },
      select: { totalPriceInPaise: true },
    });
    const grossTotal = items.reduce((s, it) => s + it.totalPriceInPaise, 0n);

    if (docResolution.kind === 'legacy') {
      return {
        hasGstData: false,
        taxableInPaise: 0n,
        cgstInPaise: 0n,
        sgstInPaise: 0n,
        igstInPaise: 0n,
        totalTaxInPaise: 0n,
        grandTotalInPaise: grossTotal,
        disclosure:
          'Pre-GST order. No tax breakdown is available. ' +
          `Receipt: ${docResolution.document?.documentNumber}.`,
      };
    }

    return {
      hasGstData: false,
      taxableInPaise: 0n,
      cgstInPaise: 0n,
      sgstInPaise: 0n,
      igstInPaise: 0n,
      totalTaxInPaise: 0n,
      grandTotalInPaise: grossTotal,
      disclosure:
        'Tax invoice not yet generated for this order. Refresh later ' +
        'or contact support for details.',
    };
  }

  /**
   * Safe wrapper around `OrderItemTaxSnapshot` lookups for callers
   * that just want "the snapshot or a zeroed-out shape". Distinct
   * from `resolveForOrderItem` (which returns the tagged union);
   * use this when the caller doesn't care about the legacy / pre-
   * snapshot distinction.
   */
  async safeGetSnapshot(
    orderItemId: string,
  ): Promise<OrderItemTaxSnapshot | null> {
    return this.prisma.orderItemTaxSnapshot
      .findFirst({ where: { orderItemId } })
      .catch((err) => {
        this.logger.warn(
          `safeGetSnapshot(${orderItemId}) failed: ${(err as Error).message}`,
        );
        return null;
      });
  }
}
