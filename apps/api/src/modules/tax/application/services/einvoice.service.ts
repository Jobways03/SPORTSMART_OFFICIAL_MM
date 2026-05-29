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

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma, TaxDocument } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE,
  decideEInvoiceApplicability,
} from '../../domain/einvoice-applicability';
import {
  EINVOICE_PROVIDER,
  type EInvoiceProvider,
} from '../../infrastructure/einvoice/einvoice-provider';
// Phase 90 (2026-05-23) — Gap #12 / #21 events catalog + category resolver.
import {
  EINVOICE_EVENTS,
  NIC_CANCELLATION_CODES,
  type NicCancellationCode,
} from '../../domain/einvoice-events';
import { resolveTransactionCategory } from '../../domain/einvoice-transaction-category';
import { TaxConfigService } from './tax-config.service';

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
  // Phase 90 — Gap #22 retention default. 9 years > CBIC's 8-year
  // statute so finance can query the JSON during the statutory window
  // then nightly purge strips PII while preserving irn/ackNo/ackDate.
  private static readonly SIGNED_JSON_RETENTION_YEARS = 9;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    @Inject(EINVOICE_PROVIDER) private readonly provider: EInvoiceProvider,
    // Phase 90 — Gap #21 event emission + Gap #28 tax-config knob.
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly taxConfig?: TaxConfigService,
  ) {}

  private async turnoverThreshold(): Promise<bigint> {
    // Phase 90 — Gap #28. Prefer DB-driven config so the CBIC threshold
    // shift (5cr → 1cr expected) is a tax-config row update, not an
    // env file edit. Falls back to env (legacy) then to the constant.
    if (this.taxConfig) {
      try {
        const dbValue = await this.taxConfig.getNumber(
          'einvoice_turnover_threshold_paise' as any,
          0,
        );
        if (dbValue > 0) return BigInt(dbValue);
      } catch {
        // Config read failed — fall back to env / default.
      }
    }
    const override = this.env.getNumber(
      'TAX_EINVOICE_TURNOVER_THRESHOLD_PAISE' as any,
      0,
    );
    return override > 0
      ? BigInt(override)
      : DEFAULT_EINVOICE_TURNOVER_THRESHOLD_PAISE;
  }

  /**
   * Phase 90 — Gap #20 chain of custody.
   */
  private async writeAuditLog(args: {
    taxDocumentId: string;
    action: string;
    fromStatus?: any;
    toStatus?: any;
    actorId?: string | null;
    actorRole?: string | null;
    reason?: string | null;
    providerName?: string | null;
    providerLatencyMs?: number | null;
    payloadBefore?: unknown;
    payloadAfter?: unknown;
    ipAddress?: string | null;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const client = (args.tx ?? this.prisma) as any;
    await client.eInvoiceAuditLog.create({
      data: {
        taxDocumentId: args.taxDocumentId,
        action: args.action,
        fromStatus: args.fromStatus ?? null,
        toStatus: args.toStatus ?? null,
        actorId: args.actorId ?? null,
        actorRole: args.actorRole ?? null,
        reason: args.reason ?? null,
        providerName: args.providerName ?? null,
        providerLatencyMs: args.providerLatencyMs ?? null,
        payloadBefore: (args.payloadBefore as any) ?? null,
        payloadAfter: (args.payloadAfter as any) ?? null,
        ipAddress: args.ipAddress ?? null,
      },
    });
  }

  /**
   * Phase 90 — Gap #21 fire-and-forget event helper.
   */
  private emit(eventName: string, payload: Record<string, unknown>): void {
    if (!this.eventBus) return;
    void this.eventBus
      .publish({
        eventName,
        aggregate: 'TaxDocument',
        aggregateId: String(payload.documentId ?? ''),
        occurredAt: new Date(),
        payload,
      })
      .catch(() => undefined);
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
      turnoverThresholdInPaise: await this.turnoverThreshold(),
    });

    // Phase 90 (2026-05-23) — Gap #11 turnover-zero forensic guard.
    // If turnover is exactly 0 AND opt-in is false AND the document
    // is a B2B TAX_INVOICE (CBIC's actual e-invoice target), refuse
    // to silently skip — the most likely root cause is "operator
    // forgot to populate aggregateTurnoverInPaise". Raise an
    // AdminTask so finance can backfill, instead of writing a row
    // that says NOT_APPLICABLE for a possibly-eligible supplier.
    const turnoverAmbiguous =
      supplierAggregateTurnoverInPaise === 0n &&
      !supplierEinvoiceOptedIn &&
      doc.buyerGstin &&
      doc.documentType === 'TAX_INVOICE';
    if (turnoverAmbiguous && !decision.applicable) {
      try {
        await (this.prisma as any).adminTask.upsert({
          where: { uniqueKey: `einvoice-turnover-missing:${doc.supplierGstin ?? doc.sellerId ?? doc.id}` },
          update: {},
          create: {
            kind: 'EINVOICE_GENERATION_FAILED',
            uniqueKey: `einvoice-turnover-missing:${doc.supplierGstin ?? doc.sellerId ?? doc.id}`,
            severity: 'MEDIUM',
            status: 'OPEN',
            title: `Seller turnover missing for ${doc.supplierGstin ?? 'unknown'} — e-invoice silently skipped`,
            details:
              'aggregateTurnoverInPaise=0 and einvoiceOptedIn=false on the supplier. ' +
              'If the seller is actually above the CBIC threshold, populate the GSTN row + re-classify.',
            relatedResource: 'tax_document',
            relatedResourceId: doc.id,
          },
        });
      } catch {
        // AdminTask write failure must not break classification.
      }
    }

    const nextStatus = decision.applicable ? 'PENDING' : 'NOT_APPLICABLE';
    if (doc.einvoiceStatus !== nextStatus) {
      const updated = await this.prisma.taxDocument.update({
        where: { id: doc.id },
        data: { einvoiceStatus: nextStatus },
      });
      await this.writeAuditLog({
        taxDocumentId: doc.id,
        action: 'CLASSIFY',
        fromStatus: doc.einvoiceStatus,
        toStatus: nextStatus,
        actorId: 'system',
        actorRole: 'SYSTEM',
        reason: decision.reason,
      });
      this.emit(EINVOICE_EVENTS.CLASSIFIED, {
        documentId: doc.id,
        status: nextStatus,
        reason: decision.reason,
      });
      return { ...decision, document: updated };
    }
    return { ...decision, document: doc };
  }

  /**
   * Call the provider to mint the IRN. Persists irn / ackNo / ackDate
   * / signedDocumentJson / qrCodeUrl + flips status to GENERATED.
   * Idempotent on already-GENERATED rows.
   *
   * Phase 90 (2026-05-23) — hardened for:
   *   • Gap #5  : flips status=PDF_PENDING after mint so the PDF
   *               cron re-renders with the IRN block included.
   *   • Gap #7  : SELECT FOR UPDATE row lock around the provider call
   *               so two concurrent admin clicks don't double-mint.
   *   • Gap #10 : Credit/debit notes pass originalIrn + original docNum
   *               in the IRP payload (CBIC requirement).
   *   • Gap #12 : transactionCategory + reverseCharge in payload.
   *   • Gap #20 : audit log entry per attempt.
   *   • Gap #21 : event emission on success/failure.
   */
  async generateForDocument(documentId: string): Promise<TaxDocument> {
    const { applicable, reason, document } =
      await this.classifyForDocument(documentId);
    if (!applicable) {
      throw new EInvoiceNotApplicableError(documentId, reason);
    }
    if (document.einvoiceStatus === 'GENERATED' && document.irn) {
      return document;
    }

    // Phase 90 — Gap #7 row lock + provider call.
    const lockedDoc = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tax_documents WHERE id = ${document.id} FOR UPDATE`;
      const fresh = await tx.taxDocument.findUnique({
        where: { id: document.id },
      });
      if (!fresh) {
        throw new EInvoiceDocumentNotFoundError(document.id);
      }
      // Lost-race idempotency: another tx generated under the lock.
      if (fresh.einvoiceStatus === 'GENERATED' && fresh.irn) {
        return fresh;
      }
      if (fresh.einvoiceStatus === 'CANCELLED') {
        throw new EInvoiceNotApplicableError(
          fresh.id,
          'Document was cancelled; issue a credit/debit note instead.',
        );
      }
      return fresh;
    });
    if (lockedDoc.einvoiceStatus === 'GENERATED' && lockedDoc.irn) {
      return lockedDoc;
    }

    // Load lines.
    const lines = await this.prisma.taxDocumentLine.findMany({
      where: { documentId: document.id },
      orderBy: { lineNumber: 'asc' },
    });

    // Phase 90 — Gap #10. For CN/DN load the original document's IRN.
    let originalIrn: string | null = null;
    let originalDocumentNumber: string | null = null;
    let originalDocumentDate: Date | null = null;
    if (
      (document.documentType === 'CREDIT_NOTE' ||
        document.documentType === 'DEBIT_NOTE') &&
      document.originalDocumentId
    ) {
      const orig = await this.prisma.taxDocument.findUnique({
        where: { id: document.originalDocumentId },
        select: { irn: true, documentNumber: true, generatedAt: true },
      });
      if (orig?.irn) {
        originalIrn = orig.irn;
        originalDocumentNumber = orig.documentNumber;
        originalDocumentDate = orig.generatedAt;
      }
    }

    // Phase 90 — Gap #12 transaction-category resolution.
    const transactionCategory = resolveTransactionCategory({
      buyerGstin: document.buyerGstin,
      reverseChargeApplicable: document.reverseChargeApplicable,
    });

    const t0 = Date.now();
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
        transactionCategory,
        reverseChargeApplicable: document.reverseChargeApplicable,
        placeOfSupplyStateCode: document.placeOfSupplyStateCode ?? null,
        originalIrn,
        originalDocumentNumber,
        originalDocumentDate,
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
      const latencyMs = Date.now() - t0;

      // Phase 90 — Gap #5 PDF re-render trigger.
      // Phase 90 — Gap #22 retention. Stamp the deletion deadline so
      // the nightly purge cron can strip PII after the statutory
      // window (8 years per CBIC; default 9 here).
      const retentionExpiresAt = new Date();
      retentionExpiresAt.setFullYear(
        retentionExpiresAt.getFullYear() +
          EInvoiceService.SIGNED_JSON_RETENTION_YEARS,
      );

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
          // PDF re-render trigger.
          status: 'PDF_PENDING',
          pdfUrl: null,
          pdfStoragePath: null,
          pdfSha256: null,
          pdfRetryCount: 0,
          pdfLastAttemptedAt: null,
          signedDocumentJsonRetentionUntil: retentionExpiresAt,
        },
      });
      await this.writeAuditLog({
        taxDocumentId: document.id,
        action: 'MINT',
        fromStatus: document.einvoiceStatus,
        toStatus: 'GENERATED',
        actorId: 'system',
        actorRole: 'SYSTEM',
        providerName: this.provider.name,
        providerLatencyMs: latencyMs,
        payloadAfter: { ackNo: result.ackNo, transactionCategory },
      });
      this.emit(EINVOICE_EVENTS.GENERATED, {
        documentId: document.id,
        irn: result.irn,
        ackNo: result.ackNo,
        ackDate: result.ackDate.toISOString(),
        provider: this.provider.name,
      });
      this.logger.log(
        `IRN minted: ${result.irn.slice(0, 12)}... for ${document.documentNumber} via ${this.provider.name} (${latencyMs}ms)`,
      );
      return updated;
    } catch (err) {
      const reasonText = (err as Error).message ?? String(err);
      const latencyMs = Date.now() - t0;
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
      await this.writeAuditLog({
        taxDocumentId: document.id,
        action: 'MINT_FAILED',
        fromStatus: document.einvoiceStatus,
        toStatus: 'FAILED',
        actorId: 'system',
        actorRole: 'SYSTEM',
        reason: reasonText,
        providerName: this.provider.name,
        providerLatencyMs: latencyMs,
      });
      this.emit(EINVOICE_EVENTS.FAILED, {
        documentId: document.id,
        retryCount: failed.einvoiceRetryCount,
        reason: reasonText,
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
   *
   * Phase 90 (2026-05-23) — hardened for:
   *   • Gap #8/#17 : sets einvoiceStatus = CANCELLED (not NOT_APPLICABLE).
   *   • Gap #8     : nulls out irn/ackNo/ackDate/qrCodeUrl so the row
   *                  no longer appears as "issued" in admin queues.
   *   • Gap #9     : populates cancelledAt + cancellation reason cols.
   *   • Gap #19    : cancellation code enum-validated server-side.
   *   • Gap #24    : flips status=PDF_PENDING so the customer copy is
   *                  re-rendered without the IRN block.
   *   • Gap #20    : audit log entry.
   *   • Gap #21    : event emission.
   */
  async cancelForDocument(args: {
    documentId: string;
    cancellationCode: number;
    cancellationReason: string;
    actorId?: string;
    now?: Date;
  }): Promise<TaxDocument> {
    // Phase 90 — Gap #19 enum validation.
    if (!NIC_CANCELLATION_CODES.includes(args.cancellationCode as NicCancellationCode)) {
      throw new Error(
        `Invalid cancellationCode ${args.cancellationCode}. NIC accepts 1 (Duplicate), 2 (Data entry mistake), 3 (Order cancelled), 4 (Other).`,
      );
    }
    if (!args.cancellationReason || args.cancellationReason.trim().length < 10) {
      throw new Error('cancellationReason must be at least 10 characters');
    }

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

    const t0 = Date.now();
    const result = await this.provider.cancel({
      irn: doc.irn,
      cancellationCode: args.cancellationCode,
      cancellationReason: args.cancellationReason,
    });
    const latencyMs = Date.now() - t0;

    const updated = await this.prisma.taxDocument.update({
      where: { id: doc.id },
      data: {
        // Phase 90 — Gap #8/#17. Explicit terminal state.
        einvoiceStatus: 'CANCELLED',
        // Phase 90 — Gap #8 cancellation cleanup.
        irn: null,
        ackNo: null,
        ackDate: null,
        qrCodeUrl: null,
        // Preserve cancellation envelope in signedDocumentJson; the
        // admin "view signed" path can render the provider's cancel
        // ack from this blob.
        signedDocumentJson: result.signedDocumentJson as Prisma.InputJsonValue,
        // Phase 90 — Gap #9 audit columns.
        cancelledAt: result.cancelledAt,
        einvoiceCancellationCode: args.cancellationCode,
        einvoiceCancellationReason: args.cancellationReason,
        einvoiceCancelledBy: args.actorId ?? null,
        einvoiceLastAttemptedAt: result.cancelledAt,
        // Phase 90 — Gap #24 PDF re-render trigger.
        status: 'PDF_PENDING',
        pdfUrl: null,
        pdfStoragePath: null,
        pdfSha256: null,
        pdfRetryCount: 0,
        pdfLastAttemptedAt: null,
      },
    });
    await this.writeAuditLog({
      taxDocumentId: doc.id,
      action: 'CANCEL',
      fromStatus: 'GENERATED',
      toStatus: 'CANCELLED',
      actorId: args.actorId ?? null,
      actorRole: 'ADMIN',
      reason: args.cancellationReason,
      providerName: this.provider.name,
      providerLatencyMs: latencyMs,
      payloadAfter: { cancellationCode: args.cancellationCode },
    });
    this.emit(EINVOICE_EVENTS.CANCELLED, {
      documentId: doc.id,
      irn: doc.irn,
      cancellationCode: args.cancellationCode,
      reason: args.cancellationReason,
      cancelledBy: args.actorId ?? null,
    });
    return updated;
  }

  /**
   * Phase 90 (2026-05-23) — Gap #18 manual retry reset.
   *
   * Lets a senior admin zero `einvoiceRetryCount` on a FAILED row so
   * the retry cron picks it back up. Used when NIC outage clears
   * after the cap was hit and ops wants to retry without restarting
   * the cron.
   */
  async resetRetryCount(args: {
    documentId: string;
    actorId: string;
    reason: string;
  }): Promise<TaxDocument> {
    if (!args.reason || args.reason.trim().length < 10) {
      throw new EInvoiceNotApplicableError(
        args.documentId,
        'reason must be at least 10 characters',
      );
    }
    const doc = await this.prisma.taxDocument.findUnique({
      where: { id: args.documentId },
    });
    if (!doc) throw new EInvoiceDocumentNotFoundError(args.documentId);
    if (doc.einvoiceStatus !== 'FAILED') {
      throw new EInvoiceNotApplicableError(
        args.documentId,
        `Reset retry only allowed when status is FAILED (current=${doc.einvoiceStatus})`,
      );
    }
    const updated = await this.prisma.taxDocument.update({
      where: { id: doc.id },
      data: {
        einvoiceRetryCount: 0,
        einvoiceLastAttemptedAt: null,
        einvoiceFailureReason: null,
        einvoiceStatus: 'PENDING',
      },
    });
    await this.writeAuditLog({
      taxDocumentId: doc.id,
      action: 'RESET_RETRY',
      fromStatus: 'FAILED',
      toStatus: 'PENDING',
      actorId: args.actorId,
      actorRole: 'ADMIN',
      reason: args.reason,
    });
    this.emit(EINVOICE_EVENTS.RETRY_RESET, {
      documentId: doc.id,
      actorId: args.actorId,
    });
    return updated;
  }
}
