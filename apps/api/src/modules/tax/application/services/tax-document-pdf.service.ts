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
import { TaxModeService } from './tax-mode.service';

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
  ) {}

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

    const updated = await this.prisma.taxDocument.update({
      where: { id: doc.id },
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
    const updated = await this.prisma.taxDocument.update({
      where: { id: args.documentId },
      data: {
        status: 'PDF_FAILED',
        pdfFailureReason: args.reason,
        pdfLastAttemptedAt: new Date(),
        pdfRetryCount: { increment: 1 },
      },
    });
    this.logger.warn(
      `PDF render failed: ${updated.documentNumber} (attempt ${updated.pdfRetryCount}): ${args.reason}`,
    );
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
    if (doc.status !== 'PDF_GENERATED' || !doc.pdfStoragePath) {
      throw new PdfDocumentNotReadyError(doc.id, doc.status);
    }

    const url = await this.storage.createSignedUrl({
      storagePath: doc.pdfStoragePath,
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
