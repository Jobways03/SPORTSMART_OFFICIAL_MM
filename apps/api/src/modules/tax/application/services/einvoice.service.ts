// Phase 22 GST — EInvoiceService.
//
// Owns the IRN lifecycle for tax_documents:
//
//   classifyForDocument({ documentId })
//     Pure decision via `decideEInvoiceApplicability`. Reads supplier
//     turnover + opt-in from the seller's GSTIN row. Persists the
//     einvoice_status on tax_documents (NOT_APPLICABLE / PENDING).
//     Idempotent — re-classification is safe.
//
//   generateForDocument({ documentId })
//     Builds the IRP request payload from the document + lines, calls
//     the provider, persists `irn / ackNo / ackDate / signedDocumentJson
//     / qrCodeUrl` + flips einvoice_status to GENERATED. On provider
//     failure: increments retry_count + sets status=FAILED + captures
//     failure_reason. Idempotent on already-GENERATED rows.
//
//   cancelForDocument({ documentId, cancellationCode, reason, actorId })
//     CBIC permits IRN cancellation within 24h of generation. Past 24h
//     → throws EInvoiceCancellationWindowClosedError. Idempotent on
//     already-cancelled rows (signedDocumentJson updated with the
//     latest cancellation envelope).
//
// Retry strategy: PENDING + FAILED rows are eligible for re-attempt
// by Phase 22's `EInvoiceRetryCron`. After the env cap, the row stays
// FAILED + an AdminTask (`EINVOICE_GENERATION_FAILED`) opens.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, TaxDocument } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE,
  decideEInvoiceApplicability,
} from '../../domain/einvoice-applicability';
import {
  EINVOICE_PROVIDER,
  type EInvoiceProvider,
} from '../../infrastructure/einvoice/einvoice-provider';

export class EInvoiceDocumentNotFoundError extends Error {
  constructor(public readonly documentId: string) {
    super(`TaxDocument ${documentId} not found`);
    this.name = 'EInvoiceDocumentNotFoundError';
  }
}

export class EInvoiceNotApplicableError extends Error {
  constructor(
    public readonly documentId: string,
    public readonly reason: string,
  ) {
    super(
      `TaxDocument ${documentId} is not eligible for IRP: ${reason}`,
    );
    this.name = 'EInvoiceNotApplicableError';
  }
}

export class EInvoiceCancellationWindowClosedError extends Error {
  constructor(
    public readonly documentId: string,
    public readonly ackDate: Date,
  ) {
    super(
      `TaxDocument ${documentId} IRN (ack ${ackDate.toISOString()}) is past the ` +
        '24-hour cancellation window. Generate a Credit/Debit Note instead.',
    );
    this.name = 'EInvoiceCancellationWindowClosedError';
  }
}

@Injectable()
export class EInvoiceService {
  private readonly logger = new Logger(EInvoiceService.name);
  private static readonly CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    @Inject(EINVOICE_PROVIDER) private readonly provider: EInvoiceProvider,
  ) {}

  private turnoverThreshold(): bigint {
    const override = this.env.getNumber(
      'TAX_EINVOICE_TURNOVER_THRESHOLD_PAISE' as any,
      0,
    );
    return override > 0
      ? BigInt(override)
      : DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE;
  }

  /**
   * Classify (and persist) the document's applicability. Idempotent —
   * already-GENERATED / CANCELLED rows are returned as-is. Returns the
   * decision so callers can immediately call `generateForDocument` if
   * applicable.
   */
  async classifyForDocument(
    documentId: string,
  ): Promise<{ applicable: boolean; reason: string; document: TaxDocument }> {
    const doc = await this.prisma.taxDocument.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new EInvoiceDocumentNotFoundError(documentId);

    // If the document already has a terminal e-invoice status,
    // surface that without re-classifying.
    if (doc.einvoiceStatus === 'GENERATED') {
      return { applicable: true, reason: 'Already GENERATED', document: doc };
    }

    // Resolve supplier turnover + opt-in from SellerGstin if we have one.
    let supplierAggregateTurnoverInPaise = 0n;
    let supplierEinvoiceOptedIn = false;
    if (doc.supplierGstin) {
      const sg = await this.prisma.sellerGstin.findUnique({
        where: { gstin: doc.supplierGstin },
        select: {
          aggregateTurnoverInPaise: true,
          einvoiceOptedIn: true,
        },
      });
      if (sg) {
        supplierAggregateTurnoverInPaise = sg.aggregateTurnoverInPaise;
        supplierEinvoiceOptedIn = sg.einvoiceOptedIn;
      }
    }

    const decision = decideEInvoiceApplicability({
      documentType: doc.documentType,
      documentStatus: doc.status,
      buyerGstin: doc.buyerGstin,
      supplierAggregateTurnoverInPaise,
      supplierEinvoiceOptedIn,
      turnoverThresholdInPaise: this.turnoverThreshold(),
    });

    const nextStatus = decision.applicable ? 'PENDING' : 'NOT_APPLICABLE';
    if (doc.einvoiceStatus !== nextStatus) {
      const updated = await this.prisma.taxDocument.update({
        where: { id: doc.id },
        data: { einvoiceStatus: nextStatus },
      });
      return { ...decision, document: updated };
    }
    return { ...decision, document: doc };
  }

  /**
   * Call the provider to mint the IRN. Persists irn / ackNo / ackDate
   * / signedDocumentJson / qrCodeUrl + flips status to GENERATED.
   * Idempotent on already-GENERATED rows.
   */
  async generateForDocument(documentId: string): Promise<TaxDocument> {
    const { applicable, reason, document } =
      await this.classifyForDocument(documentId);
    if (!applicable) {
      throw new EInvoiceNotApplicableError(documentId, reason);
    }
    if (document.einvoiceStatus === 'GENERATED' && document.irn) {
      // Idempotent path — already minted.
      return document;
    }

    // Load lines for the provider payload.
    const lines = await this.prisma.taxDocumentLine.findMany({
      where: { documentId: document.id },
      orderBy: { lineNumber: 'asc' },
    });

    try {
      const result = await this.provider.generate({
        supplierGstin: document.supplierGstin!,
        buyerGstin: document.buyerGstin!,
        documentNumber: document.documentNumber,
        documentDate: document.generatedAt ?? document.createdAt,
        documentType: document.documentType,
        totalInvoiceValueInPaise: document.documentTotalInPaise,
        taxableValueInPaise: document.taxableAmountInPaise,
        cgstInPaise: document.cgstAmountInPaise,
        sgstInPaise: document.sgstAmountInPaise,
        igstInPaise: document.igstAmountInPaise,
        cessInPaise: document.cessAmountInPaise,
        lineItems: lines.map((l) => ({
          productName: l.productName,
          hsnOrSacCode: l.hsnOrSacCode,
          uqcCode: l.uqcCode,
          quantity: Number(l.quantity),
          unitPriceInPaise: l.unitPriceInPaise,
          taxableInPaise: l.taxableAmountInPaise,
          gstRateBps: l.gstRateBps,
        })),
      });

      const updated = await this.prisma.taxDocument.update({
        where: { id: document.id },
        data: {
          irn: result.irn,
          ackNo: result.ackNo,
          ackDate: result.ackDate,
          signedDocumentJson: result.signedDocumentJson as Prisma.InputJsonValue,
          qrCodeUrl: result.qrCodeUrl,
          einvoiceStatus: 'GENERATED',
          einvoiceProvider: this.provider.name,
          einvoiceLastAttemptedAt: new Date(),
          einvoiceFailureReason: null,
        },
      });
      this.logger.log(
        `IRN minted: ${result.irn.slice(0, 12)}... for ${document.documentNumber} via ${this.provider.name}`,
      );
      return updated;
    } catch (err) {
      const reasonText = (err as Error).message ?? String(err);
      const failed = await this.prisma.taxDocument.update({
        where: { id: document.id },
        data: {
          einvoiceStatus: 'FAILED',
          einvoiceFailureReason: reasonText,
          einvoiceLastAttemptedAt: new Date(),
          einvoiceRetryCount: { increment: 1 },
          einvoiceProvider: this.provider.name,
        },
      });
      this.logger.warn(
        `IRN generation FAILED for ${document.documentNumber} (attempt ${failed.einvoiceRetryCount}): ${reasonText}`,
      );
      throw err;
    }
  }

  /**
   * Cancel an issued IRN. Enforces the CBIC 24-hour window. Idempotent
   * on already-cancelled rows.
   */
  async cancelForDocument(args: {
    documentId: string;
    cancellationCode: number;
    cancellationReason: string;
    actorId?: string;
    now?: Date;
  }): Promise<TaxDocument> {
    const doc = await this.prisma.taxDocument.findUnique({
      where: { id: args.documentId },
    });
    if (!doc) throw new EInvoiceDocumentNotFoundError(args.documentId);

    if (doc.einvoiceStatus !== 'GENERATED' || !doc.irn || !doc.ackDate) {
      throw new EInvoiceNotApplicableError(
        args.documentId,
        `Document einvoice status is ${doc.einvoiceStatus}; nothing to cancel.`,
      );
    }

    const now = args.now ?? new Date();
    const ageMs = now.getTime() - doc.ackDate.getTime();
    if (ageMs > EInvoiceService.CANCELLATION_WINDOW_MS) {
      throw new EInvoiceCancellationWindowClosedError(doc.id, doc.ackDate);
    }

    const result = await this.provider.cancel({
      irn: doc.irn,
      cancellationCode: args.cancellationCode,
      cancellationReason: args.cancellationReason,
    });

    return this.prisma.taxDocument.update({
      where: { id: doc.id },
      data: {
        // CBIC after-cancellation status: the legal "issuance" is
        // wiped. We use NOT_APPLICABLE because the tax document itself
        // is no longer a legitimate IRP record — accountants treat the
        // IRN as having never existed (a credit note is then issued
        // separately for the customer-facing reversal).
        einvoiceStatus: 'NOT_APPLICABLE',
        signedDocumentJson: result.signedDocumentJson as Prisma.InputJsonValue,
        einvoiceLastAttemptedAt: result.cancelledAt,
      },
    });
  }
}
