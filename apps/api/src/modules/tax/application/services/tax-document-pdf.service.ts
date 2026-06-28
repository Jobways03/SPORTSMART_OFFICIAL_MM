// Phase 19 GST — TaxDocumentPdfService.
//
// Owns the render → upload → persist lifecycle for tax-document PDFs:
//
//   renderAndUpload({ documentId })
//     1. Loads document + lines.
//     2. Renders HTML via the domain template.
//     3. Wraps the HTML as the PDF buffer. The stub provider accepts
//        HTML directly; once a real HTML→PDF converter (puppeteer /
//        playwright) is wired the wrap step swaps to a binary render.
//     4. Uploads via the configured storage provider.
//     5. Updates tax_documents.{pdfUrl, pdfStoragePath, pdfSha256,
//        pdfProvider, pdfLastAttemptedAt, status, pdfFailureReason}
//        — status flips PDF_PENDING / PDF_FAILED → PDF_GENERATED.
//
//   markAttemptFailed({ documentId, reason })
//     Increments retry_count, stamps last_attempted_at + failure_reason,
//     keeps status at PDF_FAILED. Called by the retry cron when the
//     upload throws.
//
//   getSignedDownloadUrl({ documentId, expiresInSeconds? })
//     For the customer / admin "download PDF" surface. Refuses on
//     non-PDF_GENERATED documents. Bumps `downloadCount` +
//     `lastDownloadedAt`.
//
// Retry strategy: PDF_PENDING (initial state) + PDF_FAILED (transient
// failure) rows are eligible. The cron applies a cooldown + retry cap
// (env-configurable). After the cap, status stays PDF_FAILED and an
// AdminTask (TAX_DOCUMENT_PDF_FAILED) opens.

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TaxDocument } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  renderHtmlForDocument,
  type TemplateInput,
} from '../../domain/tax-document-html-template';
import {
  TAX_PDF_STORAGE_PROVIDER,
  type TaxPdfStorageProvider,
} from '../../infrastructure/pdf/tax-pdf-storage.provider';
import { HtmlToPdfService } from '../../infrastructure/pdf/html-to-pdf.service';
import { TaxModeService } from './tax-mode.service';
import { isPdfDownloadable } from '../../domain/tax-document-state-machine';

export class PdfDocumentNotReadyError extends Error {
  constructor(
    public readonly documentId: string,
    public readonly currentStatus: string,
  ) {
    super(
      `TaxDocument ${documentId} not yet PDF_GENERATED (status=${currentStatus}); cannot generate download URL.`,
    );
    this.name = 'PdfDocumentNotReadyError';
  }
}

export class PdfDocumentNotFoundError extends Error {
  constructor(public readonly documentId: string) {
    super(`TaxDocument ${documentId} not found`);
    this.name = 'PdfDocumentNotFoundError';
  }
}

@Injectable()
export class TaxDocumentPdfService {
  private readonly logger = new Logger(TaxDocumentPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TAX_PDF_STORAGE_PROVIDER)
    private readonly storage: TaxPdfStorageProvider,
    // Phase 23 — drives the DRAFT banner suppression once CA signs off
    // and the system flips to STRICT mode.
    private readonly taxMode: TaxModeService,
    // Real HTML→PDF renderer (headless Chromium) for the combined
    // customer-facing invoice download.
    private readonly htmlToPdf: HtmlToPdfService,
  ) {}

  /**
   * Build ONE PDF containing every active tax invoice for a master order —
   * each invoice on its own page. Multi-seller orders produce one invoice per
   * seller (different GSTINs ⇒ legally separate invoices that GST forbids
   * merging), so this bundles them into a single downloadable file for the
   * customer without merging the invoices themselves.
   *
   * Returns null when the order has no renderable invoice yet (so the caller
   * can 404 cleanly). Ownership is the CALLER's responsibility — pass a
   * masterOrderId already verified to belong to the requester.
   */
  async buildOrderInvoicesPdf(
    masterOrderId: string,
  ): Promise<{ buffer: Buffer; count: number; orderNumber: string } | null> {
    const docs = await this.prisma.taxDocument.findMany({
      where: {
        masterOrderId,
        documentType: { in: ['TAX_INVOICE', 'INVOICE_CUM_BILL_OF_SUPPLY'] },
        status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
      // Stable, human-sensible order: oldest invoice first.
      orderBy: { generatedAt: 'asc' },
    });
    if (docs.length === 0) return null;

    const order = await this.prisma.masterOrder.findUnique({
      where: { id: masterOrderId },
      select: { orderNumber: true },
    });

    const mode = await this.taxMode.getMode();
    const htmls = docs.map((doc) =>
      renderHtmlForDocument({ mode, document: doc, lines: doc.lines } as TemplateInput),
    );
    const combined = combineInvoiceHtml(htmls);
    const buffer = await this.htmlToPdf.render(combined);
    return {
      buffer,
      count: docs.length,
      orderNumber: order?.orderNumber ?? masterOrderId,
    };
  }

  /**
   * Render + upload the PDF for one document. Returns the updated
   * row. Throws on upload failure; the retry cron catches + calls
   * markAttemptFailed.
   */
  async renderAndUpload(args: { documentId: string }): Promise<TaxDocument> {
    const doc = await this.prisma.taxDocument.findUnique({
      where: { id: args.documentId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!doc) throw new PdfDocumentNotFoundError(args.documentId);

    if (doc.status === 'VOIDED_DRAFT' || doc.status === 'SUPERSEDED') {
      throw new Error(
        `TaxDocument ${doc.id} (${doc.status}) is not eligible for PDF rendering.`,
      );
    }

    const mode = await this.taxMode.getMode();
    const html = renderHtmlForDocument({
      mode,
      document: doc,
      lines: doc.lines,
    } as TemplateInput);
    const body = Buffer.from(html, 'utf-8');
    const storagePath = this.buildStoragePath(doc);

    const result = await this.storage.upload({
      storagePath,
      body,
      // The stub accepts HTML; a real puppeteer adapter would set
      // 'application/pdf' here.
      contentType: 'text/html; charset=utf-8',
    });

    // CAS (Cluster E, CRITICAL): scope the status flip to the PDF
    // sub-lifecycle states the cron actually feeds us (PDF_PENDING /
    // PDF_FAILED). Pre-fix this was a plain `update` that wrote
    // status='PDF_GENERATED' unconditionally — so if a concurrent
    // credit-note flow flipped the row to PARTIALLY_REVERSED /
    // FULLY_REVERSED between our findUnique above and this write, we
    // clobbered a legal-reversal state with PDF_GENERATED (a
    // transition the FSM forbids — see tax-document-state-machine).
    // The conditional write loses the race instead of corrupting it.
    const cas = await this.prisma.taxDocument.updateMany({
      where: { id: doc.id, status: { in: ['PDF_PENDING', 'PDF_FAILED'] } },
      data: {
        pdfUrl: result.publicUrl,
        pdfStoragePath: result.storagePath,
        pdfSha256: result.sha256,
        pdfProvider: result.provider,
        pdfLastAttemptedAt: new Date(),
        pdfFailureReason: null,
        status: 'PDF_GENERATED',
      },
    });
    if (cas.count === 0) {
      // The row left the PDF sub-lifecycle under us (reversed /
      // superseded). The uploaded artifact is harmless; the document's
      // current status is the source of truth. Surface the current row
      // so the cron records a no-op rather than a fake success.
      const current = await this.prisma.taxDocument.findUnique({
        where: { id: doc.id },
      });
      this.logger.warn(
        `PDF render for ${doc.documentNumber} skipped status flip: row is ` +
          `now ${current?.status ?? 'GONE'} (not PDF_PENDING/PDF_FAILED).`,
      );
      if (!current) throw new PdfDocumentNotFoundError(doc.id);
      return current;
    }

    const updated = await this.prisma.taxDocument.findUniqueOrThrow({
      where: { id: doc.id },
    });
    this.logger.log(
      `PDF rendered: ${doc.documentNumber} → ${result.storagePath} ` +
        `(provider=${result.provider}, sha256=${result.sha256.slice(0, 12)}...)`,
    );
    return updated;
  }

  /** Increment retry count + stamp failure reason on a failed attempt. */
  async markAttemptFailed(args: {
    documentId: string;
    reason: string;
  }): Promise<TaxDocument> {
    // CAS (Cluster E): same guard as renderAndUpload — only stamp a
    // failure while the row is still in the PDF sub-lifecycle. If a
    // concurrent reversal advanced it to PARTIALLY_REVERSED /
    // FULLY_REVERSED, do NOT yank it back to PDF_FAILED (that is a
    // forbidden transition and would resurrect a closed render queue
    // entry on the next cron tick).
    const cas = await this.prisma.taxDocument.updateMany({
      where: {
        id: args.documentId,
        status: { in: ['PDF_PENDING', 'PDF_FAILED'] },
      },
      data: {
        status: 'PDF_FAILED',
        pdfFailureReason: args.reason,
        pdfLastAttemptedAt: new Date(),
        pdfRetryCount: { increment: 1 },
      },
    });
    const updated = await this.prisma.taxDocument.findUniqueOrThrow({
      where: { id: args.documentId },
    });
    if (cas.count === 0) {
      this.logger.warn(
        `PDF render failed for ${updated.documentNumber} but row is now ` +
          `${updated.status} (left PDF sub-lifecycle); not re-flagging PDF_FAILED.`,
      );
    } else {
      this.logger.warn(
        `PDF render failed: ${updated.documentNumber} (attempt ${updated.pdfRetryCount}): ${args.reason}`,
      );
    }
    return updated;
  }

  /**
   * Build a signed download URL for the customer / admin. Refuses
   * on documents that haven't been rendered yet so callers don't
   * hand out broken links.
   */
  async getSignedDownloadUrl(args: {
    documentId: string;
    expiresInSeconds?: number;
  }): Promise<{ url: string; documentNumber: string }> {
    const doc = await this.prisma.taxDocument.findUnique({
      where: { id: args.documentId },
      select: {
        id: true,
        documentNumber: true,
        status: true,
        pdfStoragePath: true,
      },
    });
    if (!doc) throw new PdfDocumentNotFoundError(args.documentId);
    // Downloadable iff a PDF was rendered AND the status still retains it.
    // This deliberately includes PARTIALLY_REVERSED / FULLY_REVERSED: a credit
    // note does not void the original tax invoice — both stay downloadable.
    if (!isPdfDownloadable(doc.status, doc.pdfStoragePath)) {
      throw new PdfDocumentNotReadyError(doc.id, doc.status);
    }
    // isPdfDownloadable guarantees a non-null pdfStoragePath here.
    const storagePath = doc.pdfStoragePath as string;

    const url = await this.storage.createSignedUrl({
      storagePath,
      expiresInSeconds: args.expiresInSeconds,
    });

    // Best-effort download counter. Don't fail the URL if the
    // counter update races (the page-rendering retry will just
    // ask again).
    await this.prisma.taxDocument
      .update({
        where: { id: doc.id },
        data: {
          downloadCount: { increment: 1 },
          lastDownloadedAt: new Date(),
        },
      })
      .catch(() => undefined);

    return { url, documentNumber: doc.documentNumber };
  }

  /**
   * Compose the storage path for a document. Format:
   *   `${fy}/${supplierGstin|PLATFORM}/${documentType}/${documentNumber}.html`
   * The .html suffix matches the stub's content-type; the real PDF
   * adapter rewrites this to `.pdf` at the provider boundary.
   */
  private buildStoragePath(doc: TaxDocument): string {
    const supplier = doc.supplierGstin ?? 'PLATFORM';
    // documentNumber may contain '/' (per CBIC numbering); replace with
    // '-' so we don't accidentally create subdirectories.
    const safeNumber = doc.documentNumber.replace(/[/\\]/g, '-');
    return `${doc.financialYear}/${supplier}/${doc.documentType}/${safeNumber}.html`;
  }
}

/**
 * Merge several full invoice HTML documents into ONE document, each invoice on
 * its own page. renderHtmlForDocument emits a complete, self-contained doc
 * (`<!DOCTYPE html>…<style>…</style>…<body>…</body>…`); invoices all share the
 * same template stylesheet, so we keep ONE copy of the styles (from the first)
 * and stitch each document's <body> inner HTML into a page-break section. This
 * lets a single headless-Chromium render produce a clean multi-page PDF without
 * a separate PDF-merge dependency.
 */
function combineInvoiceHtml(htmls: string[]): string {
  if (htmls.length === 1) return htmls[0]!;

  const styleMatch = htmls[0]!.match(/<style>([\s\S]*?)<\/style>/i);
  const styles = styleMatch ? styleMatch[1] : '';

  const sections = htmls
    .map((html, i) => {
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const inner = bodyMatch ? bodyMatch[1] : html;
      const last = i === htmls.length - 1;
      // Each invoice on its own page; the last one mustn't force a trailing
      // blank page.
      return `<section style="${last ? '' : 'page-break-after: always; break-after: page;'}">${inner}</section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>${styles}
  /* Combined-invoice page breaks (one invoice per page). */
  section { break-after: page; page-break-after: always; }
  section:last-child { break-after: auto; page-break-after: auto; }
  </style>
</head>
<body>${sections}</body>
</html>`;
}
